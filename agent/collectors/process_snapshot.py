import json
import time

import psutil


class ProcessSnapshotter:
    @staticmethod
    def capture(sort_by: str = "cpu", top_n: int = 5, sample_seconds: float = 0.5) -> str:
        """Snapshot of the top resource-consuming processes.

        psutil's per-process cpu_percent() returns 0.0 on its first call, so we
        prime every process, wait `sample_seconds`, then read real values."""
        procs = []
        for p in psutil.process_iter(["pid", "name", "username"]):
            try:
                p.cpu_percent(None)
                procs.append(p)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
        time.sleep(sample_seconds)

        rows = []
        for p in procs:
            try:
                with p.oneshot():
                    rows.append({
                        "pid": p.pid,
                        "name": p.info.get("name") or "unknown",
                        "user": p.info.get("username") or "system",
                        "cpu_percent": round(p.cpu_percent(None), 1),
                        "memory_mb": round(p.memory_info().rss / (1024 * 1024), 1),
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        key = "memory_mb" if "mem" in sort_by.lower() else "cpu_percent"
        rows.sort(key=lambda r: r[key], reverse=True)
        return json.dumps(rows[:top_n])
