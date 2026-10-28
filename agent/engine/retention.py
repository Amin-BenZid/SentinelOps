"""Retention with downsampling.

  raw samples (metrics)        kept RAW_RETENTION_HOURS      (default 24 h)
  1-minute rollups (metrics_1m) kept ROLLUP_RETENTION_DAYS   (default 7 d)
  resolved alerts              kept ALERT_RETENTION_DAYS     (default 30 d)
  processed outbox rows        kept 7 d

Rollups are recomputed for the last 2 hours on every run with INSERT OR
REPLACE, so the job is idempotent and safe to run as often as we like."""
from __future__ import annotations

MINUTE = 60_000
HOUR = 60 * MINUTE
DAY = 24 * HOUR


async def run_retention(db, now_ms: int, raw_hours: int = 24, rollup_days: int = 7,
                        alert_days: int = 30) -> dict:
    conn = db.conn
    current_minute = now_ms - now_ms % MINUTE
    window_start = current_minute - 2 * HOUR
    async with db.transaction():
        await conn.execute(
            """
            INSERT OR REPLACE INTO metrics_1m
                (entity_id, metric_name, bucket_ts, source, avg_value, min_value, max_value, sample_count)
            SELECT entity_id, metric_name, (ts / 60000) * 60000 AS bucket, MAX(source),
                   AVG(metric_value), MIN(metric_value), MAX(metric_value), COUNT(*)
            FROM metrics
            WHERE ts >= ? AND ts < ?
            GROUP BY entity_id, metric_name, bucket
            """,
            (window_start, current_minute),
        )
        raw = await conn.execute("DELETE FROM metrics WHERE ts < ?", (now_ms - raw_hours * HOUR,))
        roll = await conn.execute("DELETE FROM metrics_1m WHERE bucket_ts < ?", (now_ms - rollup_days * DAY,))
        alerts = await conn.execute(
            "DELETE FROM alerts WHERE state = 'resolved' AND resolved_at < ?", (now_ms - alert_days * DAY,))
        outbox = await conn.execute(
            "DELETE FROM notifications_outbox WHERE status != 'pending' AND processed_at < ?", (now_ms - 7 * DAY,))
    await conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
    return {"raw_deleted": raw.rowcount, "rollups_deleted": roll.rowcount,
            "alerts_deleted": alerts.rowcount, "outbox_deleted": outbox.rowcount}
