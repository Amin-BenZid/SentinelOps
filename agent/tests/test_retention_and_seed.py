import pytest

from agent.engine.retention import DAY, HOUR, run_retention

pytestmark = pytest.mark.asyncio
NOW = 1_700_000_000_000 - (1_700_000_000_000 % 60_000)


async def count(db, sql):
    async with db.conn.execute(sql) as c:
        return (await c.fetchone())[0]


async def test_rollup_and_raw_retention(db):
    rows = [{"source": "host", "entity_id": "h", "metric_name": "cpu_percent", "metric_value": v} for v in (10, 30)]
    await db.insert_metrics(rows, NOW - 30 * 60_000)          # 30 min ago, same minute
    await db.insert_metrics(rows[:1], NOW - 25 * HOUR)        # older than raw retention
    await run_retention(db, NOW, raw_hours=24, rollup_days=7)
    assert await count(db, "SELECT COUNT(*) FROM metrics") == 2
    async with db.conn.execute("SELECT avg_value, min_value, max_value, sample_count FROM metrics_1m") as c:
        assert [tuple(r) for r in await c.fetchall()] == [(20.0, 10.0, 30.0, 2)]
    # idempotent
    await run_retention(db, NOW, raw_hours=24, rollup_days=7)
    assert await count(db, "SELECT COUNT(*) FROM metrics_1m") == 1
    # rollups expire too
    await run_retention(db, NOW + 8 * DAY, raw_hours=24, rollup_days=7)
    assert await count(db, "SELECT COUNT(*) FROM metrics_1m") == 0


async def test_old_resolved_alerts_are_purged(db):
    sql = ("INSERT INTO alerts (fingerprint, correlation_id, rule_name, detector, entity_id, metric_name, severity,"
           " summary, state, first_seen, fired_at, last_seen, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    await db.conn.execute(sql, ("a", "i", "r", "threshold", "e", "m", "warning", "s", "resolved", 0, 0, 0, NOW - 31 * DAY))
    await db.conn.execute(sql, ("b", "i", "r", "threshold", "e", "m", "warning", "s", "resolved", 0, 0, 0, NOW - DAY))
    await db.conn.execute(sql, ("c", "i", "r", "threshold", "e", "m", "warning", "s", "firing", 0, 0, 0, None))
    await run_retention(db, NOW, alert_days=30)
    async with db.conn.execute("SELECT fingerprint FROM alerts ORDER BY fingerprint") as c:
        assert [r[0] for r in await c.fetchall()] == ["b", "c"]


SEED = [{"id": "r1", "metric": "cpu_percent", "operator": ">", "threshold": 85, "duration_seconds": 60,
         "severity": "critical", "summary": "cpu"}]


async def test_seed_runs_once_and_does_not_revive_deleted_rules(db):
    assert await db.seed_rules(SEED) == 1
    await db.conn.execute("DELETE FROM rules WHERE id='r1'")     # user deleted it in the UI
    assert await db.seed_rules(SEED) == 0                         # restart: not revived
    assert await count(db, "SELECT COUNT(*) FROM rules") == 0


async def test_force_reseed_overwrites_from_yaml(db):
    await db.seed_rules(SEED)
    await db.conn.execute("UPDATE rules SET threshold = 99 WHERE id='r1'")
    await db.seed_rules(SEED, force=True)
    async with db.conn.execute("SELECT threshold FROM rules WHERE id='r1'") as c:
        assert (await c.fetchone())[0] == 85
