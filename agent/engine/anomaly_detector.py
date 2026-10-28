"""Statistical anomaly detector (layer 2 of the Rules -> Stats/ML -> LLM roadmap).

Keeps a rolling window per (entity, metric) and flags samples that fall outside
median +/- k*sigma, where sigma is estimated robustly as 1.4826 * MAD (median
absolute deviation). Unlike mean/stdev, the median/MAD baseline is not dragged
along by the anomaly itself: a sudden sustained jump stays anomalous until it
fills about half the window, then becomes the "new normal". Two guards keep it
quiet on flat series: a noise floor on sigma, and a minimum absolute deviation. Each evaluated sample is annotated in
place (z_score, bounds, is_anomaly) so the values are stored with the metric
and can be charted as an expected band."""
from __future__ import annotations

import statistics
from collections import defaultdict, deque

from agent.engine.signals import Signal


class AnomalyDetector:
    name = "anomaly"

    def __init__(self, window_size: int = 30, k_threshold: float = 3.0, min_noise_floor: float = 2.0,
                 min_abs_delta: float = 8.0, min_samples: int = 10, for_seconds: int = 15,
                 metrics: tuple[str, ...] | None = None):
        self.window_size = window_size
        self.k_threshold = k_threshold
        self.min_noise_floor = min_noise_floor
        self.min_abs_delta = min_abs_delta
        self.min_samples = min_samples
        self.for_seconds = for_seconds
        self.metrics = set(metrics) if metrics else None   # None = every metric
        self.enabled = True
        self.history: dict[str, deque] = defaultdict(lambda: deque(maxlen=window_size))

    def evaluate_metric(self, entity_id: str, metric_name: str, value: float) -> dict:
        samples = self.history[f"{entity_id}:{metric_name}"]
        if len(samples) < self.min_samples:
            samples.append(value)
            return {"is_anomaly": False, "z_score": None, "expected_mean": None,
                    "lower_bound": None, "upper_bound": None, "stdev": None, "baseline_ready": False}

        mean = statistics.median(samples)                       # robust centre
        stdev = 1.4826 * statistics.median(abs(x - mean) for x in samples)  # robust sigma (MAD)
        effective = max(stdev, self.min_noise_floor)
        z = (value - mean) / effective
        upper = mean + self.k_threshold * effective
        lower = mean - self.k_threshold * effective
        if min(samples) >= 0:            # non-negative series (percentages, rates)
            lower = max(lower, 0.0)
        is_outlier = abs(z) > self.k_threshold and abs(value - mean) >= self.min_abs_delta
        samples.append(value)
        return {
            "is_anomaly": is_outlier,
            "z_score": round(z, 2),
            "expected_mean": round(mean, 2),
            "stdev": round(stdev, 2),
            "lower_bound": round(lower, 2),
            "upper_bound": round(upper, 2),
            "baseline_ready": True,
        }

    def detect(self, metrics: list[dict]) -> list[Signal]:
        signals = []
        for m in metrics:
            if self.metrics is not None and m["metric_name"] not in self.metrics:
                continue
            r = self.evaluate_metric(m["entity_id"], m["metric_name"], float(m["metric_value"]))
            # annotate the sample so it is persisted with its expected band
            m["z_score"], m["lower_bound"], m["upper_bound"] = r["z_score"], r["lower_bound"], r["upper_bound"]
            m["is_anomaly"] = r["is_anomaly"]
            if not (self.enabled and r["is_anomaly"]):
                continue
            direction = "above" if m["metric_value"] > r["expected_mean"] else "below"
            signals.append(Signal(
                rule_id=f"anomaly:{m['metric_name']}",
                detector=self.name,
                entity_id=m["entity_id"],
                metric_name=m["metric_name"],
                severity="warning",
                summary=(f"Unusual {m['metric_name']}: {m['metric_value']:g} is {abs(r['z_score']):.1f}σ {direction} "
                         f"its recent baseline ({r['expected_mean']:g} ± {r['stdev']:g})"),
                for_seconds=self.for_seconds,
                evidence={
                    "detector": "anomaly",
                    "metric": m["metric_name"],
                    "observed": m["metric_value"],
                    "expected_mean": r["expected_mean"],
                    "stdev": r["stdev"],
                    "z_score": r["z_score"],
                    "k": self.k_threshold,
                    "lower_bound": r["lower_bound"],
                    "upper_bound": r["upper_bound"],
                    "window": self.window_size,
                },
            ))
        return signals
