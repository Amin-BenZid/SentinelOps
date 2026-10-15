import asyncio
import os
import aiosqlite
from agent.db.sqlite_client import DatabaseManager
from agent.collectors.host_collector import HostCollector
from agent.collectors.docker_collector import DockerCollector
from agent.collectors.process_snapshot import ProcessSnapshotter
from agent.engine.rules_evaluator import RulesEvaluator
from agent.engine.deduper import AlertDeduper
from agent.engine.correlator import IncidentCorrelator

async def run_pipeline():
    db_path = os.getenv("DB_PATH", "data/sentinelops.db")
    schema_path = os.getenv("SCHEMA_PATH", "shared/schema.sql")
    rules_path = os.getenv("RULES_PATH", "agent/config/rules.yaml")

    db = DatabaseManager(db_path=db_path)
    await db.init_db(schema_path=schema_path)

    host_collector = HostCollector()
    docker_collector = DockerCollector()
    evaluator = RulesEvaluator(config_path=rules_path, db_path=db_path)
    deduper = AlertDeduper(bucket_ttl_seconds=300)
    correlator = IncidentCorrelator(time_window_seconds=120)

    print("[*] SentinelOps v0.1 Core Engine successfully started.")
    print(f"[*] Monitoring database: {db_path}")

    while True:
        try:
            # 1. Sync active rules from SQLite
            await evaluator.sync_rules_from_db()

            # 2. Concurrently scrape metrics
            host_metrics, docker_metrics = await asyncio.gather(
                host_collector.collect(),
                docker_collector.collect(),
                return_exceptions=True
            )

            safe_host_metrics = host_metrics if isinstance(host_metrics, list) else []
            safe_docker_metrics = docker_metrics if isinstance(docker_metrics, list) else []
            all_metrics = safe_host_metrics + safe_docker_metrics

            if all_metrics:
                await db.insert_metrics(all_metrics)

            # 3. Evaluate violations and get passing rules
            violations, triggered_rule_keys = evaluator.evaluate(all_metrics)
            active_alerts = await db.get_active_alerts()

            # ── 4. AUTO-RECOVERY ENGINE ──
            # If an active alert's metric is now operating normally or the rule was deleted, resolve it!
            for alert in active_alerts:
                alert_key = f"{alert['rule_name']}:{alert['entity_id']}"
                # If rule is no longer violated, auto-resolve it
                if alert_key not in triggered_rule_keys:
                    async with aiosqlite.connect(db_path) as conn:
                        await conn.execute("UPDATE alerts SET status = 'resolved' WHERE id = ?", (alert["id"],))
                        await conn.commit()
                    print(f"[✅ AUTO-RECOVERY] Alert {alert['rule_name']} on {alert['entity_id']} recovered to normal baseline.")

            # ── 5. PROCESS VIOLATIONS ──
            for violation in violations:
                fingerprint = deduper.generate_fingerprint(
                    violation["rule_id"], 
                    violation["entity_id"]
                )
                existing = await db.get_active_alert_by_fingerprint(fingerprint)
                
                alert_action = deduper.process_incident(
                    active_alert_in_db=existing,
                    rule_id=violation["rule_id"],
                    entity_id=violation["entity_id"],
                    severity=violation["severity"],
                    summary=violation["summary"]
                )

                if alert_action["action"] == "INSERT":
                    sort_metric = "memory" if "mem" in violation["rule_id"].lower() else "cpu"
                    loop = asyncio.get_running_loop()
                    snapshot_json = await loop.run_in_executor(
                        None, 
                        ProcessSnapshotter.capture, 
                        sort_metric, 
                        5
                    )
                    alert_action["process_snapshot"] = snapshot_json

                    correlation_id = correlator.correlate(alert_action, active_alerts)
                    alert_action["correlation_id"] = correlation_id
                    print(f"[🚨 ALERT TRIGGERED] ID={correlation_id} | Rule={violation['rule_id']}")
                
                await db.save_alert(alert_action)

        except Exception as e:
            print(f"[!] Engine Pipeline Loop Error: {e}")

        await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(run_pipeline())