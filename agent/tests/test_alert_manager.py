import pytest

from agent.engine.alert_manager import AlertManager
from agent.engine.signals import Signal

pytestmark = pytest.mark.asyncio
T0 = 1_700_000_000_000
S = 1000


def sig(entity="host", rule="cpu_hot", for_seconds=60, severity="critical"):
    return Signal(rule_id=rule, detector="threshold", entity_id=entity, metric_name="cpu_percent",
                  severity=severity, summary="cpu high", for_seconds=for_seconds,
                  evidence={"detector": "threshold", "observed": 95, "threshold": 85})


async def alerts(db):
    async with db.conn.execute("SELECT * FROM alerts ORDER BY id") as c:
        return [dict(r) for r in await c.fetchall()]


async def outbox(db):
    async with db.conn.execute("SELECT alert_id, event, status FROM notifications_outbox ORDER BY id") as c:
        return [tuple(r) for r in await c.fetchall()]


async def test_pending_does_not_fire_before_duration(db):
    am = AlertManager(db, log=lambda *_: None)
    for t in (0, 20, 40, 55):
        await am.process([sig()], T0 + t * S)
    assert await alerts(db) == []
    assert await outbox(db) == []


async def test_fires_after_duration_and_writes_outbox(db):
    am = AlertManager(db, log=lambda *_: None)
    for t in (0, 30, 60):
        await am.process([sig()], T0 + t * S)
    rows = await alerts(db)
    assert len(rows) == 1
    a = rows[0]
    assert a["state"] == "firing" and a["first_seen"] == T0 and a["fired_at"] == T0 + 60 * S
    assert a["hit_count"] == 3
    assert await outbox(db) == [(a["id"], "firing", "pending")]


async def test_short_blip_is_dropped(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig()], T0)
    await am.process([], T0 + 5 * S)            # condition went away -> pending dropped
    await am.process([sig()], T0 + 61 * S)      # starts a NEW pending period
    assert await alerts(db) == []


async def test_zero_duration_fires_immediately(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(for_seconds=0)], T0)
    assert len(await alerts(db)) == 1


async def test_repeat_signal_updates_instead_of_duplicating(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(for_seconds=0)], T0)
    for t in range(1, 5):
        await am.process([sig(for_seconds=0)], T0 + t * 5 * S)
    rows = await alerts(db)
    assert len(rows) == 1 and rows[0]["hit_count"] == 5 and rows[0]["last_seen"] == T0 + 20 * S


async def test_auto_resolve_writes_resolved_event(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(for_seconds=0)], T0)
    await am.process([], T0 + 5 * S)
    a = (await alerts(db))[0]
    assert a["state"] == "resolved" and a["resolved_by"] == "auto" and a["resolved_at"] == T0 + 5 * S
    assert [e for _, e, _ in await outbox(db)] == ["firing", "resolved"]


async def test_acknowledged_alert_still_auto_resolves_and_never_duplicates(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(for_seconds=0)], T0)
    # operator acknowledges through the server
    await db.conn.execute("UPDATE alerts SET acked_by='amin', acked_at=? WHERE id=1", (T0 + S,))
    await am.process([sig(for_seconds=0)], T0 + 5 * S)
    await am.process([sig(for_seconds=0)], T0 + 10 * S)
    assert len(await alerts(db)) == 1
    await am.process([], T0 + 15 * S)
    a = (await alerts(db))[0]
    assert a["state"] == "resolved" and a["acked_by"] == "amin"


async def test_manual_resolve_while_still_bad_refires_after_duration(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(for_seconds=10)], T0)
    await am.process([sig(for_seconds=10)], T0 + 10 * S)
    await db.conn.execute("UPDATE alerts SET state='resolved', resolved_by='amin', resolved_at=? WHERE id=1",
                          (T0 + 11 * S,))
    await am.process([sig(for_seconds=10)], T0 + 15 * S)   # pending again
    assert len(await alerts(db)) == 1
    await am.process([sig(for_seconds=10)], T0 + 25 * S)   # fires a new alert
    rows = await alerts(db)
    assert len(rows) == 2 and rows[1]["state"] == "firing"


async def test_deleted_rule_resolves_its_alert(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(for_seconds=0), sig(rule="other", for_seconds=0)], T0)
    await am.process([sig(rule="other", for_seconds=0)], T0 + 5 * S)  # cpu_hot no longer evaluated
    states = {a["rule_name"]: a["state"] for a in await alerts(db)}
    assert states == {"cpu_hot": "resolved", "other": "firing"}


async def test_correlation_groups_same_entity_within_window(db):
    am = AlertManager(db, log=lambda *_: None)
    await am.process([sig(rule="a", for_seconds=0)], T0)
    await am.process([sig(rule="a", for_seconds=0), sig(rule="b", for_seconds=0)], T0 + 30 * S)
    await am.process([sig(rule="a", for_seconds=0), sig(rule="b", for_seconds=0),
                      sig(rule="c", for_seconds=0, entity="other-host")], T0 + 35 * S)
    rows = {a["rule_name"]: a["correlation_id"] for a in await alerts(db)}
    assert rows["a"] == rows["b"]
    assert rows["c"] != rows["a"]


async def test_snapshot_failure_does_not_block_alerting(db):
    def boom(_):
        raise RuntimeError("no /proc")
    am = AlertManager(db, snapshotter=boom, log=lambda *_: None)
    await am.process([sig(for_seconds=0)], T0)
    a = (await alerts(db))[0]
    assert a["state"] == "firing" and a["process_snapshot"] is None
