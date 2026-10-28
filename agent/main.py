"""SentinelOps agent: collect -> detect -> manage alert lifecycle, on a fixed
interval. Detection lives here, close to the data; the dashboard server only
reads results, records operator actions and delivers notifications."""
import asyncio
import os
import signal
import time

from agent.collectors.docker_collector import DockerCollector
from agent.collectors.host_collector import HostCollector
from agent.collectors.process_snapshot import ProcessSnapshotter
from agent.collectors.prometheus_pull import PrometheusCollector
from agent.db.sqlite_client import DatabaseManager, now_ms
from agent.engine.alert_manager import AlertManager
from agent.engine.anomaly_detector import AnomalyDetector
from agent.engine.correlator import IncidentCorrelator
from agent.engine.retention import run_retention
from agent.engine.rules_evaluator import ThresholdDetector, load_rules_yaml

VERSION = "0.2.0"


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


async def run_pipeline(stop: asyncio.Event):
    here = os.path.dirname(os.path.abspath(__file__))
    db_path = os.getenv("DB_PATH", "data/sentinelops.db")
    migrations_dir = os.getenv("MIGRATIONS_DIR", os.path.join(here, "..", "shared", "migrations"))
    rules_path = os.getenv("RULES_PATH", os.path.join(here, "config", "rules.yaml"))

    seed_rules, config = load_rules_yaml(rules_path)
    interval = env_int("SCAN_INTERVAL_SECONDS", int(config.get("scan_interval_seconds", 5)))

    db = DatabaseManager(db_path)
    await db.init_db(migrations_dir)
    seeded = await db.seed_rules(seed_rules, force=env_bool("RULES_RESEED", False))
    if seeded:
        print(f"[*] Seeded {seeded} rules from {rules_path}")

    host = HostCollector()
    containers = DockerCollector()
    prom = PrometheusCollector()
    threshold = ThresholdDetector()
    anomaly = AnomalyDetector(
        k_threshold=float(os.getenv("ANOMALY_K", "3.0")),
        for_seconds=env_int("ANOMALY_FOR_SECONDS", 15),
    )
    manager = AlertManager(
        db,
        correlator=IncidentCorrelator(env_int("CORRELATION_WINDOW_SECONDS", 120)),
        snapshotter=lambda sort_by: ProcessSnapshotter.capture(sort_by, 5),
    )

    retention_every_ms = env_int("RETENTION_INTERVAL_MINUTES", 10) * 60_000
    last_retention = 0

    print(f"[*] SentinelOps agent v{VERSION} started | db={db_path} | interval={interval}s "
          f"| docker={'on' if containers.client else 'off'} | prometheus targets={len(prom.targets)}")

    while not stop.is_set():
        started = time.monotonic()
        ts = now_ms()
        try:
            threshold.set_rules(await db.get_active_rules())
            setting = await db.get_setting("anomaly_detection_enabled")
            anomaly.enabled = (setting != "false") if setting is not None else env_bool("ANOMALY_ENABLED", True)

            results = await asyncio.gather(host.collect(), containers.collect(), prom.collect(),
                                           return_exceptions=True)
            metrics = []
            for r in results:
                if isinstance(r, Exception):
                    print(f"[!] collector error: {r!r}")
                else:
                    metrics.extend(r)

            signals = threshold.detect(metrics) + anomaly.detect(metrics)  # anomaly annotates metrics
            await db.insert_metrics(metrics, ts)
            await manager.process(signals, ts)
            await db.set_meta("agent_heartbeat", str(ts))

            if ts - last_retention >= retention_every_ms:
                res = await run_retention(
                    db, ts,
                    raw_hours=env_int("RAW_RETENTION_HOURS", 24),
                    rollup_days=env_int("ROLLUP_RETENTION_DAYS", 7),
                    alert_days=env_int("ALERT_RETENTION_DAYS", 30),
                )
                last_retention = ts
                if any(res.values()):
                    print(f"[retention] {res}")
        except Exception as e:
            print(f"[!] pipeline error: {e!r}")

        elapsed = time.monotonic() - started
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(0.0, interval - elapsed))
        except asyncio.TimeoutError:
            pass

    await db.close()
    print("[*] agent stopped")


def main():
    loop = asyncio.new_event_loop()
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # Windows
            pass
    try:
        loop.run_until_complete(run_pipeline(stop))
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()


if __name__ == "__main__":
    main()
