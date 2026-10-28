"""Quick look at the SentinelOps database: python inspect_db.py [path]"""
import sqlite3
import sys
from datetime import datetime

path = sys.argv[1] if len(sys.argv) > 1 else "data/sentinelops.db"
conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def t(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S") if ms else "-"


print("schema version:", conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0])
hb = conn.execute("SELECT value FROM app_meta WHERE key='agent_heartbeat'").fetchone()
print("agent heartbeat:", t(int(hb[0])) if hb else "never")

print("\n--- LATEST METRICS ---")
for r in conn.execute("""SELECT entity_id, metric_name, metric_value, MAX(ts) FROM metrics
                         GROUP BY entity_id, metric_name ORDER BY entity_id, metric_name"""):
    print(f"{t(r[3])}  {r[0]:<25} {r[1]:<25} {r[2]}")

print("\n--- ALERTS (latest 15) ---")
for r in conn.execute("""SELECT id, state, acked_by, severity, rule_name, entity_id, hit_count, first_seen, fired_at,
                         resolved_at, resolved_by FROM alerts ORDER BY id DESC LIMIT 15"""):
    print(f"#{r[0]} {r[1]:<8} ack={r[2] or '-':<8} {r[3]:<8} {r[4]} on {r[5]} hits={r[6]} "
          f"first={t(r[7])} fired={t(r[8])} resolved={t(r[9])} by={r[10] or '-'}")

print("\n--- NOTIFICATION OUTBOX (latest 10) ---")
for r in conn.execute("""SELECT id, alert_id, event, status, attempts, last_error FROM notifications_outbox
                         ORDER BY id DESC LIMIT 10"""):
    print(r)
