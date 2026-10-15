PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metrics_query 
ON metrics(entity_id, metric_name, timestamp DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    correlation_id TEXT,
    rule_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    hit_count INTEGER DEFAULT 1,
    process_snapshot TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_active 
ON alerts(status, fingerprint);

CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    metric_name TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold REAL NOT NULL,
    duration_seconds INTEGER DEFAULT 60,
    severity TEXT NOT NULL,
    summary_template TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);