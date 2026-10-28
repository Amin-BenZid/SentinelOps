"""Container metrics via the Docker Engine API (through the read-only socket
proxy in docker-compose). All containers are sampled in parallel; CPU % and
memory % follow the same formulas as `docker stats`."""
from __future__ import annotations

import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor

import docker


def cpu_percent(stats: dict) -> float:
    cpu, pre = stats.get("cpu_stats", {}), stats.get("precpu_stats", {})
    cpu_delta = cpu.get("cpu_usage", {}).get("total_usage", 0) - pre.get("cpu_usage", {}).get("total_usage", 0)
    sys_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
    online = cpu.get("online_cpus") or len(cpu.get("cpu_usage", {}).get("percpu_usage") or []) or 1
    if cpu_delta > 0 and sys_delta > 0:
        return round(cpu_delta / sys_delta * online * 100.0, 2)
    return 0.0


def memory_percent(stats: dict) -> float:
    mem = stats.get("memory_stats", {})
    usage, limit = mem.get("usage", 0), mem.get("limit", 0)
    st = mem.get("stats", {}) or {}
    # page cache is reclaimable; docker CLI subtracts it too (cgroup v2 / v1 keys)
    cache = st.get("inactive_file", st.get("total_inactive_file", 0))
    if limit <= 0:
        return 0.0
    return round(max(usage - cache, 0) / limit * 100.0, 2)


def net_bytes(stats: dict) -> tuple[int, int]:
    rx = tx = 0
    for iface in (stats.get("networks") or {}).values():
        rx += iface.get("rx_bytes", 0)
        tx += iface.get("tx_bytes", 0)
    return rx, tx


class DockerCollector:
    def __init__(self, max_workers: int | None = None):
        self.max_workers = max_workers or int(os.getenv("DOCKER_STATS_CONCURRENCY", "8"))
        self.pool = ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="docker-stats")
        self._prev_net: dict[str, tuple[float, int, int]] = {}
        try:
            self.client = docker.from_env(timeout=10)
            self.client.ping()
        except Exception as e:
            print(f"[!] Docker API unavailable ({e}); container metrics disabled")
            self.client = None

    def _one(self, container) -> list[dict]:
        name = container.name
        try:
            stats = container.stats(stream=False)
            restarts = container.attrs.get("RestartCount")
            if restarts is None:
                container.reload()
                restarts = container.attrs.get("RestartCount", 0)
        except Exception:
            return []  # container stopped while sampling

        now = time.time()
        rx, tx = net_bytes(stats)
        rx_kbps = tx_kbps = 0.0
        prev = self._prev_net.get(name)
        if prev and now > prev[0] and rx >= prev[1] and tx >= prev[2]:
            dt = now - prev[0]
            rx_kbps = round((rx - prev[1]) / dt / 1024, 2)
            tx_kbps = round((tx - prev[2]) / dt / 1024, 2)
        self._prev_net[name] = (now, rx, tx)

        values = {
            "docker_cpu_percent": cpu_percent(stats),
            "docker_memory_percent": memory_percent(stats),
            "docker_net_rx_kbps": rx_kbps,
            "docker_net_tx_kbps": tx_kbps,
            "docker_restart_count": float(restarts or 0),
        }
        return [{"source": "docker", "entity_id": name, "metric_name": k, "metric_value": v} for k, v in values.items()]

    def _collect_sync(self) -> list[dict]:
        try:
            containers = self.client.containers.list()
        except Exception as e:
            print(f"[!] Docker list failed: {e}")
            return []
        live = {c.name for c in containers}
        for gone in set(self._prev_net) - live:
            del self._prev_net[gone]
        out: list[dict] = []
        for chunk in self.pool.map(self._one, containers):
            out.extend(chunk)
        return out

    async def collect(self) -> list[dict]:
        if not self.client:
            return []
        return await asyncio.get_running_loop().run_in_executor(None, self._collect_sync)
