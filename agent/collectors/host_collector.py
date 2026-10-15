import asyncio
import os
import psutil

if os.path.exists("/host/proc"):
    psutil.PROCFS_PATH = "/host/proc"

class HostCollector:
    def __init__(self, host_id: str = "local-host"):
        self.host_id = host_id

    async def collect(self) -> list[dict]:
        loop = asyncio.get_running_loop()
        
        cpu_usage = await loop.run_in_executor(None, psutil.cpu_percent, None)
        mem = await loop.run_in_executor(None, psutil.virtual_memory)
        disk = await loop.run_in_executor(None, psutil.disk_usage, "/")

        return [
            {"source": "host", "entity_id": self.host_id, "metric_name": "cpu_percent", "metric_value": float(cpu_usage)},
            {"source": "host", "entity_id": self.host_id, "metric_name": "memory_percent", "metric_value": float(mem.percent)},
            {"source": "host", "entity_id": self.host_id, "metric_name": "disk_percent", "metric_value": float(disk.percent)}
        ]