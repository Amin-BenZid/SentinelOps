"""Threshold detector: compares each metric sample with the active rules."""
from __future__ import annotations

import math
import operator

import yaml

from agent.engine.signals import Signal

OPERATORS = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
}


def load_rules_yaml(path: str) -> tuple[list[dict], dict]:
    """Returns (rules, top-level config) from rules.yaml, validating each rule."""
    with open(path, encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}
    rules = []
    for r in doc.get("rules", []) or []:
        missing = {"id", "metric", "operator", "threshold", "severity", "summary"} - set(r)
        if missing:
            raise ValueError(f"rule {r.get('id', '?')} is missing {sorted(missing)}")
        if r["operator"] not in OPERATORS:
            raise ValueError(f"rule {r['id']}: unsupported operator {r['operator']!r}")
        if r["severity"] not in ("warning", "critical"):
            raise ValueError(f"rule {r['id']}: severity must be warning|critical")
        rules.append(r)
    config = {k: v for k, v in doc.items() if k != "rules"}
    return rules, config


class ThresholdDetector:
    name = "threshold"

    def __init__(self):
        self.rules: list[dict] = []

    def set_rules(self, db_rules: list[dict]):
        """db_rules are rows from the `rules` table."""
        self.rules = [
            {
                "id": r["id"],
                "metric": r["metric_name"],
                "operator": r["operator"],
                "threshold": float(r["threshold"]),
                "duration_seconds": int(r["duration_seconds"] or 0),
                "severity": r["severity"],
                "summary": r["summary_template"],
            }
            for r in db_rules
            if r["operator"] in OPERATORS
        ]

    def detect(self, metrics: list[dict]) -> list[Signal]:
        signals = []
        for m in metrics:
            value = m["metric_value"]
            if value is None or (isinstance(value, float) and math.isnan(value)):
                continue
            for rule in self.rules:
                if m["metric_name"] != rule["metric"]:
                    continue
                if OPERATORS[rule["operator"]](value, rule["threshold"]):
                    signals.append(Signal(
                        rule_id=rule["id"],
                        detector=self.name,
                        entity_id=m["entity_id"],
                        metric_name=m["metric_name"],
                        severity=rule["severity"],
                        summary=f"{rule['summary']} (observed {value:g} {rule['operator']} {rule['threshold']:g})",
                        for_seconds=rule["duration_seconds"],
                        evidence={
                            "detector": "threshold",
                            "metric": m["metric_name"],
                            "observed": value,
                            "operator": rule["operator"],
                            "threshold": rule["threshold"],
                            "for_seconds": rule["duration_seconds"],
                        },
                    ))
        return signals


# Backwards-compatible name used in older docs
RulesEvaluator = ThresholdDetector
