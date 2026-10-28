import pytest

from agent.collectors.docker_collector import cpu_percent, memory_percent
from agent.collectors.prometheus_pull import parse_exposition, parse_targets
from agent.engine.anomaly_detector import AnomalyDetector
from agent.engine.correlator import IncidentCorrelator
from agent.engine.rules_evaluator import ThresholdDetector, load_rules_yaml


def m(value, metric="cpu_percent", entity="host"):
    return {"source": "host", "entity_id": entity, "metric_name": metric, "metric_value": value}


def rule(**kw):
    base = dict(id="r", metric_name="cpu_percent", operator=">", threshold=80, duration_seconds=60,
                severity="warning", summary_template="cpu")
    base.update(kw)
    return base


@pytest.mark.parametrize("op,threshold,value,expected", [
    (">", 80, 81, True), (">", 80, 80, False), (">=", 80, 80, True),
    ("<", 10, 5, True), ("<=", 10, 10, True), ("==", 1, 1, True), ("==", 1, 0, False),
])
def test_threshold_operators(op, threshold, value, expected):
    d = ThresholdDetector()
    d.set_rules([rule(operator=op, threshold=threshold)])
    assert bool(d.detect([m(value)])) is expected


def test_threshold_signal_carries_duration_and_evidence():
    d = ThresholdDetector()
    d.set_rules([rule(duration_seconds=45)])
    (s,) = d.detect([m(91.5)])
    assert s.for_seconds == 45
    assert s.evidence == {"detector": "threshold", "metric": "cpu_percent", "observed": 91.5,
                          "operator": ">", "threshold": 80.0, "for_seconds": 45}


def test_threshold_ignores_other_metrics():
    d = ThresholdDetector()
    d.set_rules([rule()])
    assert d.detect([m(99, metric="memory_percent")]) == []


def test_rules_yaml_loads_and_validates(tmp_path):
    p = tmp_path / "r.yaml"
    p.write_text("scan_interval_seconds: 7\nrules:\n  - {id: a, metric: m, operator: '>', threshold: 1, severity: warning, summary: s}\n")
    rules, cfg = load_rules_yaml(str(p))
    assert rules[0]["id"] == "a" and cfg["scan_interval_seconds"] == 7
    p.write_text("rules:\n  - {id: a, metric: m, operator: '~', threshold: 1, severity: warning, summary: s}\n")
    with pytest.raises(ValueError):
        load_rules_yaml(str(p))


def test_shipped_rules_yaml_is_valid():
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "config", "rules.yaml")
    rules, _ = load_rules_yaml(path)
    assert len(rules) >= 3


def test_anomaly_needs_baseline_then_flags_spike():
    d = AnomalyDetector(min_samples=10, k_threshold=3.0, for_seconds=15)
    for v in [20, 21, 19, 20, 22, 20, 21, 19, 20, 21]:
        assert d.detect([m(v)]) == []
    sample = m(75)
    (s,) = d.detect([sample])
    assert s.detector == "anomaly" and s.rule_id == "anomaly:cpu_percent" and s.for_seconds == 15
    assert s.evidence["z_score"] > 3 and sample["is_anomaly"] is True
    assert sample["upper_bound"] < 75


def test_anomaly_ignores_small_moves_on_flat_series():
    d = AnomalyDetector(min_samples=10)
    for _ in range(15):
        d.detect([m(0.0)])
    assert d.detect([m(3.0)]) == []   # below noise floor / min delta


def test_anomaly_disabled_still_annotates():
    d = AnomalyDetector(min_samples=3)
    d.enabled = False
    for v in (10, 10, 10):
        d.detect([m(v)])
    s = m(90)
    assert d.detect([s]) == [] and s["is_anomaly"] is True


def test_correlator_respects_window():
    c = IncidentCorrelator(time_window_seconds=120)
    open_alerts = [{"entity_id": "host", "correlation_id": "inc-1", "first_seen": 0}]
    assert c.correlate("host", 60_000, open_alerts) == "inc-1"
    assert c.correlate("host", 600_000, open_alerts) != "inc-1"
    assert c.correlate("other", 1_000, open_alerts) != "inc-1"


def test_docker_formulas_match_docker_cli():
    stats = {
        "cpu_stats": {"cpu_usage": {"total_usage": 2_000_000}, "system_cpu_usage": 20_000_000, "online_cpus": 4},
        "precpu_stats": {"cpu_usage": {"total_usage": 1_000_000}, "system_cpu_usage": 10_000_000},
        "memory_stats": {"usage": 600, "limit": 1000, "stats": {"inactive_file": 100}},
    }
    assert cpu_percent(stats) == 40.0
    assert memory_percent(stats) == 50.0


def test_prometheus_parsing():
    text = """# HELP up x
node_load1 0.42
http_requests_total{code="500",method="get"} 7 1700000000
ignored_metric 1
bad_value NaN
"""
    got = parse_exposition(text, {"node_load1", "http_requests_total", "bad_value"})
    assert got == [("node_load1", 0.42), ('http_requests_total{code="500",method="get"}', 7.0)]
    assert parse_targets("api=http://api:8000/metrics, node=https://n/metrics") == {
        "api": "http://api:8000/metrics", "node": "https://n/metrics"}
    with pytest.raises(ValueError):
        parse_targets("api=file:///etc/passwd")


def test_anomaly_sustained_step_stays_anomalous_then_becomes_new_normal():
    d = AnomalyDetector(min_samples=10, window_size=30)
    flags = []
    for v in [0.1] * 12 + [99.0] * 25:
        s = m(v)
        d.detect([s])
        flags.append(s["is_anomaly"])
    step = flags[12:]
    assert all(step[:10]), "a sustained jump must stay anomalous long enough to pass a `for` duration"
    assert not step[-1], "after ~half a window the new level is accepted as normal"
