"""Host metrics. When the agent runs in a container, the compose file mounts the
host's /proc at /host/proc and the host's / at /rootfs (read-only), the same
approach node_exporter uses, so these are HOST numbers, not container numbers."""
import asyncio
import os

import psutil

HOST_PROC = os.getenv("HOST_PROC", "/host/proc")
HOST_ROOT = os.getenv("HOST_ROOT", "/rootfs")

if os.path.isdir(HOST_PROC):
    psutil.PROCFS_PATH = HOST_PROC


def _disk_path() -> str:
    return HOST_ROOT if os.path.isdir(HOST_ROOT) else os.path.abspath(os.sep)


class HostCollector:
    def __init__(self, host_id: str | None = None):
        self.host_id = host_id or os.getenv("HOST_ID", "local-host")
        self.disk_path = _disk_path()
        psutil.cpu_percent(None)  # prime: the first call always returns 0.0

    def _collect_sync(self) -> list[dict]:
        cpu = psutil.cpu_percent(None)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage(self.disk_path)
        load1 = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
        out = [
            ("cpu_percent", float(cpu)),
            ("memory_percent", float(mem.percent)),
            ("disk_percent", float(disk.percent)),
        ]
        if load1 is not None:
            out.append(("load1", round(load1, 2)))
        return [{"source": "host", "entity_id": self.host_id, "metric_name": n, "metric_value": v} for n, v in out]

    async def collect(self) -> list[dict]:
        return await asyncio.get_running_loop().run_in_executor(None, self._collect_sync)
