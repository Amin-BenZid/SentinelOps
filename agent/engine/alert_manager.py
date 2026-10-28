"""Alert lifecycle state machine (same model as Prometheus alerting rules).

    (none) --condition true--> PENDING --held for `for`--> FIRING --condition false--> RESOLVED
                                  |  condition false
                                  +--> dropped silently

* PENDING lives in memory only: a short blip never reaches the database or a
  notification channel.
* FIRING / RESOLVED live in the database. Acknowledgement is an orthogonal flag
  (acked_by / acked_at) set by an operator; an acknowledged alert is still
  FIRING, so it still auto-resolves and is never duplicated.
* If an operator resolves an alert manually while the condition is still true,
  the alert re-enters PENDING and fires again after its `for` duration.
"""
from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass

from agent.engine.correlator import IncidentCorrelator
from agent.engine.deduper import fingerprint
from agent.engine.signals import Signal


@dataclass
class Pending:
    since_ms: int
    hits: int


class AlertManager:
    def __init__(self, db, correlator: IncidentCorrelator | None = None, snapshotter=None, log=print):
        self.db = db
        self.correlator = correlator or IncidentCorrelator()
        self.snapshotter = snapshotter     # callable(sort_metric) -> JSON string, may be None
        self.pending: dict[tuple[str, str], Pending] = {}
        self.log = log

    async def _snapshot(self, signal: Signal) -> str | None:
        if not self.snapshotter:
            return None
        sort_by = "memory" if "mem" in signal.metric_name.lower() else "cpu"
        try:
            return await asyncio.get_running_loop().run_in_executor(None, self.snapshotter, sort_by)
        except Exception as e:  # forensics must never break alerting
            self.log(f"[!] process snapshot failed: {e}")
            return None

    async def process(self, signals: list[Signal], now_ms: int) -> dict:
        """Run one evaluation cycle. Returns counters (useful for tests/logs)."""
        stats = {"fired": 0, "resolved": 0, "updated": 0, "pending": 0}

        # One signal per key (a rule can only produce one per entity per cycle,
        # but be defensive and keep the highest severity).
        current: dict[tuple[str, str], Signal] = {}
        for s in signals:
            prev = current.get(s.key)
            if prev is None or (s.severity == "critical" and prev.severity != "critical"):
                current[s.key] = s

        open_alerts = await self.db.get_open_alerts()
        open_by_fp = {a["fingerprint"]: a for a in open_alerts}

        # 1. conditions that are still / newly true
        for key, sig in current.items():
            fp = fingerprint(sig.rule_id, sig.entity_id)
            existing = open_by_fp.get(fp)
            if existing:
                await self.db.touch_alert(existing["id"], now_ms, sig.summary, sig.evidence)
                stats["updated"] += 1
                continue

            p = self.pending.get(key)
            if p is None:
                p = self.pending[key] = Pending(since_ms=now_ms, hits=0)
            p.hits += 1

            if now_ms - p.since_ms < sig.for_seconds * 1000:
                stats["pending"] += 1
                continue

            # PENDING -> FIRING
            alert = {
                "fingerprint": fp,
                "correlation_id": self.correlator.correlate(sig.entity_id, p.since_ms, open_alerts),
                "rule_name": sig.rule_id,
                "detector": sig.detector,
                "entity_id": sig.entity_id,
                "metric_name": sig.metric_name,
                "severity": sig.severity,
                "summary": sig.summary,
                "first_seen": p.since_ms,
                "fired_at": now_ms,
                "hit_count": p.hits,
                "process_snapshot": await self._snapshot(sig),
                "evidence": sig.evidence,
            }
            try:
                alert["id"] = await self.db.open_alert(alert)
            except sqlite3.IntegrityError:
                # someone (an operator re-opening) opened the same fingerprint
                # between our read and write; the unique index protected us.
                continue
            open_alerts.append({**alert, "state": "firing"})
            del self.pending[key]
            stats["fired"] += 1
            self.log(f"[ALERT FIRING] {alert['correlation_id']} {sig.rule_id} on {sig.entity_id}: {sig.summary}")

        # 2. pending conditions that went away -> dropped silently
        for key in list(self.pending):
            if key not in current:
                del self.pending[key]

        # 3. open alerts whose condition is no longer true -> RESOLVED
        current_fps = {fingerprint(*k) for k in current}
        for a in open_alerts:
            if a.get("id") and a["fingerprint"] not in current_fps:
                if await self.db.resolve_alert(a["id"], now_ms):
                    stats["resolved"] += 1
                    self.log(f"[RESOLVED] {a['rule_name']} on {a['entity_id']}")
        return stats
