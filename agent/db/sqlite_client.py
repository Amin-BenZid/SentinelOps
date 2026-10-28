"""Agent-side data access. One persistent aiosqlite connection in autocommit
mode; multi-statement changes use explicit BEGIN IMMEDIATE ... COMMIT so an
alert change and its outbox event are written atomically."""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager

import aiosqlite

from agent.db.migrate import migrate


def now_ms() -> int:
    return int(time.time() * 1000)


class DatabaseManager:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn: aiosqlite.Connection | None = None

    async def init_db(self, migrations_dir: str):
        migrate(self.db_path, migrations_dir)
        self.conn = await aiosqlite.connect(self.db_path, isolation_level=None)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.execute("PRAGMA journal_mode=WAL")
        await self.conn.execute("PRAGMA synchronous=NORMAL")
        await self.conn.execute("PRAGMA busy_timeout=5000")
        await self.conn.execute("PRAGMA foreign_keys=ON")

    async def close(self):
        if self.conn:
            await self.conn.close()
            self.conn = None

    @asynccontextmanager
    async def transaction(self):
        await self.conn.execute("BEGIN IMMEDIATE")
        try:
            yield self.conn
            await self.conn.execute("COMMIT")
        except BaseException:
            await self.conn.execute("ROLLBACK")
            raise

    # ── metadata ──
    async def get_meta(self, key: str) -> str | None:
        async with self.conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
            return row["value"] if row else None

    async def set_meta(self, key: str, value: str):
        await self.conn.execute(
            "INSERT INTO app_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    async def get_setting(self, key: str) -> str | None:
        async with self.conn.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
            return row["value"] if row else None

    # ── rules ──
    async def seed_rules(self, rules: list[dict], force: bool = False) -> int:
        """Seed rules from rules.yaml. Runs once per database (so rules deleted
        in the UI are not revived on restart) unless force=True, which upserts
        the YAML definitions over the database (GitOps mode)."""
        if not force and await self.get_meta("rules_seeded_at"):
            return 0
        verb = "INSERT INTO" if force else "INSERT OR IGNORE INTO"
        conflict = (
            " ON CONFLICT(id) DO UPDATE SET metric_name=excluded.metric_name, operator=excluded.operator,"
            " threshold=excluded.threshold, duration_seconds=excluded.duration_seconds,"
            " severity=excluded.severity, summary_template=excluded.summary_template"
            if force else ""
        )
        async with self.transaction():
            for r in rules:
                await self.conn.execute(
                    f"{verb} rules (id, metric_name, operator, threshold, duration_seconds, severity, summary_template, is_active)"
                    f" VALUES (?, ?, ?, ?, ?, ?, ?, 1){conflict}",
                    (r["id"], r["metric"], r["operator"], float(r["threshold"]),
                     int(r.get("duration_seconds", 60)), r["severity"], r["summary"]),
                )
            await self.set_meta("rules_seeded_at", str(now_ms()))
        return len(rules)

    async def get_active_rules(self) -> list[dict]:
        async with self.conn.execute("SELECT * FROM rules WHERE is_active = 1") as cur:
            return [dict(r) for r in await cur.fetchall()]

    # ── metrics ──
    async def insert_metrics(self, metrics: list[dict], ts: int):
        if not metrics:
            return
        await self.conn.executemany(
            "INSERT INTO metrics (ts, source, entity_id, metric_name, metric_value, is_anomaly, z_score, lower_bound, upper_bound)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (ts, m["source"], m["entity_id"], m["metric_name"], m["metric_value"],
                 1 if m.get("is_anomaly") else 0, m.get("z_score"), m.get("lower_bound"), m.get("upper_bound"))
                for m in metrics
            ],
        )

    # ── alerts ──
    async def get_open_alerts(self) -> list[dict]:
        async with self.conn.execute("SELECT * FROM alerts WHERE state = 'firing'") as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def touch_alert(self, alert_id: int, ts: int, summary: str, evidence: dict):
        await self.conn.execute(
            "UPDATE alerts SET last_seen = ?, hit_count = hit_count + 1, summary = ?, evidence = ?"
            " WHERE id = ? AND state = 'firing'",
            (ts, summary, json.dumps(evidence), alert_id),
        )

    async def open_alert(self, a: dict) -> int:
        """Insert a firing alert + its 'firing' outbox event atomically."""
        async with self.transaction():
            cur = await self.conn.execute(
                "INSERT INTO alerts (fingerprint, correlation_id, rule_name, detector, entity_id, metric_name, severity,"
                " summary, state, first_seen, fired_at, last_seen, hit_count, process_snapshot, evidence)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'firing', ?, ?, ?, ?, ?, ?)",
                (a["fingerprint"], a["correlation_id"], a["rule_name"], a["detector"], a["entity_id"],
                 a["metric_name"], a["severity"], a["summary"], a["first_seen"], a["fired_at"], a["fired_at"],
                 a["hit_count"], a.get("process_snapshot"), json.dumps(a.get("evidence") or {})),
            )
            alert_id = cur.lastrowid
            await self.conn.execute(
                "INSERT INTO notifications_outbox (alert_id, event, created_at, next_attempt_at) VALUES (?, 'firing', ?, ?)",
                (alert_id, a["fired_at"], a["fired_at"]),
            )
        return alert_id

    async def resolve_alert(self, alert_id: int, ts: int) -> bool:
        """Auto-resolve + 'resolved' outbox event atomically. Returns False if
        the alert was already resolved (e.g. manually, by an operator)."""
        async with self.transaction():
            cur = await self.conn.execute(
                "UPDATE alerts SET state = 'resolved', resolved_at = ?, resolved_by = 'auto'"
                " WHERE id = ? AND state = 'firing'",
                (ts, alert_id),
            )
            if cur.rowcount == 0:
                return False
            await self.conn.execute(
                "INSERT INTO notifications_outbox (alert_id, event, created_at, next_attempt_at) VALUES (?, 'resolved', ?, ?)",
                (alert_id, ts, ts),
            )
        return True
