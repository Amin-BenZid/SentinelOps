"""The common contract between detectors and the AlertManager.

Every detector (threshold rules, statistical anomaly, future ML/LLM layers)
turns metrics into Signals. The AlertManager only ever sees Signals, so adding a
detector never touches the alert lifecycle code."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class Signal:
    rule_id: str            # threshold rule id, or "anomaly:<metric>"
    detector: str           # 'threshold' | 'anomaly'
    entity_id: str
    metric_name: str
    severity: str           # 'warning' | 'critical'
    summary: str
    for_seconds: int        # how long the condition must hold before firing
    evidence: dict = field(default_factory=dict, hash=False, compare=False)

    @property
    def key(self) -> tuple[str, str]:
        return (self.rule_id, self.entity_id)


class Detector(Protocol):
    name: str

    def detect(self, metrics: list[dict]) -> list[Signal]: ...
