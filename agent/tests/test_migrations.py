import sqlite3

from agent.db.migrate import latest_version, migrate

LEGACY_V01 = """
CREATE TABLE metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, entity_id TEXT NOT NULL,
  metric_name TEXT NOT NULL, metric_value REAL NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL, correlation_id TEXT,
  rule_name TEXT NOT NULL, entity_id TEXT NOT NULL, severity TEXT NOT NULL, summary TEXT NOT NULL,
  status TEXT NOT NULL, first_seen DATETIME NOT NULL, last_seen DATETIME NOT NULL, hit_count INTEGER DEFAULT 1);
CREATE TABLE rules (id TEXT PRIMARY KEY, metric_name TEXT NOT NULL, operator TEXT NOT NULL, threshold REAL NOT NULL,
  duration_seconds INTEGER DEFAULT 60, severity TEXT NOT NULL, summary_template TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  salt TEXT NOT NULL, must_change_password INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
INSERT INTO rules VALUES ('my_rule', 'cpu_percent', '>', 50, 30, 'warning', 'cpu');
INSERT INTO settings VALUES ('slack_webhook_url', 'https://hooks.slack.com/x');
INSERT INTO users (username, password_hash, salt, must_change_password) VALUES ('amin', 'h', 's', 0);
INSERT INTO sessions (token, user_id) VALUES ('t', 1);
INSERT INTO alerts (fingerprint, rule_name, entity_id, severity, summary, status, first_seen, last_seen)
  VALUES ('f', 'r', 'e', 'warning', 's', 'active', 'x', 'y');
"""


def tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_fresh_database(tmp_path, migrations_dir):
    db = str(tmp_path / "fresh.db")
    assert migrate(db, migrations_dir, log=lambda *_: None) == latest_version(migrations_dir)
    conn = sqlite3.connect(db)
    assert {"metrics", "metrics_1m", "alerts", "rules", "settings", "users", "sessions",
            "notifications_outbox", "app_meta", "schema_version"} <= tables(conn)


def test_idempotent(tmp_path, migrations_dir):
    db = str(tmp_path / "x.db")
    migrate(db, migrations_dir, log=lambda *_: None)
    migrate(db, migrations_dir, log=lambda *_: None)  # second run must be a no-op
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == latest_version(migrations_dir)


def test_upgrades_v01_database_keeping_rules_users_settings(tmp_path, migrations_dir):
    db = str(tmp_path / "legacy.db")
    c = sqlite3.connect(db)
    c.executescript(LEGACY_V01)
    c.close()

    migrate(db, migrations_dir, log=lambda *_: None)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT id, threshold, duration_seconds, is_active FROM rules").fetchall() == [("my_rule", 50.0, 30, 1)]
    assert conn.execute("SELECT username, must_change_password FROM users").fetchall() == [("amin", 0)]
    assert conn.execute("SELECT value FROM settings").fetchone()[0] == "https://hooks.slack.com/x"
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    cols = {r[1] for r in conn.execute("PRAGMA table_info(alerts)")}
    assert {"state", "acked_at", "evidence", "fired_at"} <= cols


def test_unique_open_alert_per_fingerprint(tmp_path, migrations_dir):
    db = str(tmp_path / "u.db")
    migrate(db, migrations_dir, log=lambda *_: None)
    conn = sqlite3.connect(db)
    row = ("fp", "inc", "r", "threshold", "e", "m", "warning", "s", 1, 1, 1)
    sql = ("INSERT INTO alerts (fingerprint, correlation_id, rule_name, detector, entity_id, metric_name, severity,"
           " summary, state, first_seen, fired_at, last_seen) VALUES (?,?,?,?,?,?,?,?,'firing',?,?,?)")
    conn.execute(sql, row)
    try:
        conn.execute(sql, row)
        raise AssertionError("second open alert with same fingerprint must be rejected")
    except sqlite3.IntegrityError:
        pass
