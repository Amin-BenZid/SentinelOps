import aiosqlite
import os

class DatabaseManager:
    def __init__(self, db_path: str = "/data/sentinelops.db"):
        self.db_path = db_path

    async def init_db(self, schema_path: str = "shared/schema.sql"):
        """Initializes database schema and enables Write-Ahead Logging (WAL)."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA journal_mode=WAL;")
            await db.execute("PRAGMA synchronous=NORMAL;")
            
            if os.path.exists(schema_path):
                with open(schema_path, "r", encoding="utf-8") as f:
                    schema_sql = f.read()
                await db.executescript(schema_sql)

            # Safe auto-migration for existing databases
            try:
                await db.execute("ALTER TABLE alerts ADD COLUMN process_snapshot TEXT;")
            except Exception:
                pass

            try:
                await db.execute("ALTER TABLE rules ADD COLUMN is_active INTEGER DEFAULT 1;")
            except Exception:
                pass

            # Auto-migration for Anomaly Detection fields
            try:
                await db.execute("ALTER TABLE metrics ADD COLUMN is_anomaly INTEGER DEFAULT 0;")
                await db.execute("ALTER TABLE metrics ADD COLUMN z_score REAL DEFAULT 0.0;")
                await db.execute("ALTER TABLE metrics ADD COLUMN upper_bound REAL DEFAULT 0.0;")
                await db.execute("ALTER TABLE metrics ADD COLUMN lower_bound REAL DEFAULT 0.0;")
            except Exception:
                pass

            await db.commit()

    async def insert_metrics(self, metrics: list[dict]):
        if not metrics:
            return
            
        query = """
            INSERT INTO metrics (source, entity_id, metric_name, metric_value, is_anomaly, z_score, upper_bound, lower_bound)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        records = [
            (
                m["source"], 
                m["entity_id"], 
                m["metric_name"], 
                m["metric_value"],
                1 if m.get("is_anomaly") else 0,
                m.get("z_score", 0.0),
                m.get("upper_bound", 0.0),
                m.get("lower_bound", 0.0)
            )
            for m in metrics
        ]
        async with aiosqlite.connect(self.db_path) as db:
            await db.executemany(query, records)
            await db.commit()

    async def get_active_alert_by_fingerprint(self, fingerprint: str) -> dict | None:
        query = """
            SELECT id, fingerprint, correlation_id, hit_count, status
            FROM alerts 
            WHERE fingerprint = ? AND status = 'active'
            LIMIT 1
        """
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(query, (fingerprint,)) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None

    async def get_active_alerts(self) -> list[dict]:
        query = "SELECT * FROM alerts WHERE status = 'active'"
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(query) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    async def save_alert(self, alert_payload: dict):
        async with aiosqlite.connect(self.db_path) as db:
            if alert_payload.get("action") == "UPDATE":
                query = """
                    UPDATE alerts 
                    SET last_seen = ?, hit_count = ?
                    WHERE id = ?
                """
                await db.execute(query, (
                    alert_payload["last_seen"],
                    alert_payload["hit_count"],
                    alert_payload["id"]
                ))
            else:
                query = """
                    INSERT INTO alerts 
                    (fingerprint, correlation_id, rule_name, entity_id, severity, summary, status, first_seen, last_seen, hit_count, process_snapshot)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """
                await db.execute(query, (
                    alert_payload["fingerprint"],
                    alert_payload["correlation_id"],
                    alert_payload["rule_name"],
                    alert_payload["entity_id"],
                    alert_payload["severity"],
                    alert_payload["summary"],
                    alert_payload["status"],
                    alert_payload["first_seen"],
                    alert_payload["last_seen"],
                    alert_payload["hit_count"],
                    alert_payload.get("process_snapshot", None)
                ))
            await db.commit()
    

