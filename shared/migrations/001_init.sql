-- SentinelOps schema v1
-- Single source of truth for the database schema. Applied by BOTH the agent
-- (agent/db/migrate.py) and the server (server/src/migrate.js); each runner
-- takes an exclusive write lock and only applies versions not yet recorded in
-- schema_version, so whichever service starts first does the work.
--
-- Conventions:
--   * every timestamp is an INTEGER = Unix epoch milliseconds, UTC
--   * agent owns: metrics, metrics_1m, alerts (detection columns), app_meta
--   * server owns: users, sessions, rules, settings, alerts (operator columns:
--     acked_*, manual resolve)
--   * both may INSERT into notifications_outbox (in the same transaction as the
--     alert change that caused it); only the server consumes it
--
-- Upgrading a pre-migration (v0.1) database: rules/users/settings are kept,
-- sessions are dropped (everyone logs in again), metrics/alerts are dropped
-- (their timestamp format is incompatible).

-- ── rules (kept from v0.1) ──
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    metric_name TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold REAL NOT NULL,
    duration_seconds INTEGER DEFAULT 60,
    severity TEXT NOT NULL,
    summary_template TEXT NOT NULL
);
CREATE TABLE rules_v1 (
    id TEXT PRIMARY KEY,
    metric_name TEXT NOT NULL,
    operator TEXT NOT NULL CHECK (operator IN ('>', '<', '>=', '<=', '==')),
    threshold REAL NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 60 CHECK (duration_seconds >= 0),
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
    summary_template TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO rules_v1 (id, metric_name, operator, threshold, duration_seconds, severity, summary_template, is_active)
    SELECT id, metric_name, operator, threshold, COALESCE(duration_seconds, 60), severity, summary_template, 1
    FROM rules
    WHERE operator IN ('>', '<', '>=', '<=', '==') AND severity IN ('warning', 'critical');
DROP TABLE rules;
ALTER TABLE rules_v1 RENAME TO rules;

-- ── settings (unchanged) ──
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ── users (kept from v0.1) ──
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    must_change_password INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE users_v1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
INSERT INTO users_v1 (id, username, password_hash, salt, must_change_password, created_at)
    SELECT id, username, password_hash, salt, COALESCE(must_change_password, 1),
           CAST(strftime('%s', 'now') AS INTEGER) * 1000
    FROM users;
DROP TABLE users;
ALTER TABLE users_v1 RENAME TO users;

-- ── sessions (recreated with expiry) ──
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,          -- SHA-256 of the bearer token, never the token itself
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- ── metrics (raw samples, short retention) ──
DROP TABLE IF EXISTS metrics;
CREATE TABLE metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    source TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    is_anomaly INTEGER NOT NULL DEFAULT 0,
    z_score REAL,
    lower_bound REAL,
    upper_bound REAL
);
CREATE INDEX idx_metrics_series ON metrics(entity_id, metric_name, ts DESC);
CREATE INDEX idx_metrics_ts ON metrics(ts);

-- ── metrics_1m (1-minute rollups, longer retention) ──
CREATE TABLE metrics_1m (
    entity_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    bucket_ts INTEGER NOT NULL,           -- start of the minute, epoch ms
    source TEXT NOT NULL,
    avg_value REAL NOT NULL,
    min_value REAL NOT NULL,
    max_value REAL NOT NULL,
    sample_count INTEGER NOT NULL,
    PRIMARY KEY (entity_id, metric_name, bucket_ts)
);
CREATE INDEX idx_metrics_1m_ts ON metrics_1m(bucket_ts);

-- ── alerts ──
DROP TABLE IF EXISTS alerts;
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,            -- sha256(rule_id:entity_id)[:16]
    correlation_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,              -- rule id (threshold) or "anomaly:<metric>"
    detector TEXT NOT NULL,               -- 'threshold' | 'anomaly'
    entity_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
    summary TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('firing', 'resolved')),
    first_seen INTEGER NOT NULL,          -- when the condition first became true (pending start)
    fired_at INTEGER NOT NULL,            -- when it passed its `for` duration
    last_seen INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT,                     -- 'auto' or a username
    hit_count INTEGER NOT NULL DEFAULT 1,
    process_snapshot TEXT,                -- JSON array of top processes at fire time
    evidence TEXT,                        -- JSON, detector-specific explanation
    acked_by TEXT,
    acked_at INTEGER
);
-- invariant: at most ONE open alert per fingerprint, enforced by the database
CREATE UNIQUE INDEX ux_alerts_open ON alerts(fingerprint) WHERE state = 'firing';
CREATE INDEX idx_alerts_state ON alerts(state, last_seen DESC);
CREATE INDEX idx_alerts_entity ON alerts(entity_id, state);

-- ── transactional outbox for notifications ──
CREATE TABLE notifications_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    event TEXT NOT NULL CHECK (event IN ('firing', 'resolved')),
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'suppressed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    processed_at INTEGER
);
CREATE INDEX idx_outbox_pending ON notifications_outbox(status, next_attempt_at);

-- ── small key/value table for runtime metadata (agent heartbeat, seed flags) ──
CREATE TABLE app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
