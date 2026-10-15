import asyncio
import docker

class DockerCollector:
    def __init__(self):
        try:
            self.client = docker.from_env()
        except Exception:
            self.client = None

    async def collect(self) -> list[dict]:
        if not self.client:
            return []

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._collect_sync)

    def _collect_sync(self) -> list[dict]:
        metrics = []
        try:
            containers = self.client.containers.list()
            for container in containers:
                c_name = container.name
                stats = container.stats(stream=False)
                
                # Calculate Memory Percentage
                mem_usage = stats.get("memory_stats", {}).get("usage", 0)
                mem_limit = stats.get("memory_stats", {}).get("limit", 1)
                mem_percent = (mem_usage / mem_limit) * 100.0 if mem_limit > 0 else 0.0

                metrics.append({
                    "source": "docker",
                    "entity_id": c_name,
                    "metric_name": "docker_memory_percent",
                    "metric_value": round(mem_percent, 2)
                })
        except Exception as e:
            # Container might stop during scraping; skip gracefully
            pass
        return metrics