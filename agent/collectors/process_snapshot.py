import psutil
import json

class ProcessSnapshotter:
    @staticmethod
    def capture(sort_by: str = "cpu", top_n: int = 5) -> str:
        """
        Takes an instant snapshot of top resource-consuming processes.
        sort_by can be 'cpu' or 'memory'.
        """
        processes = []
        
        # Iterate over processes with low-overhead attrs dictionary
        for proc in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_info']):
            try:
                pinfo = proc.info
                mem_mb = round(pinfo['memory_info'].rss / (1024 * 1024), 1) if pinfo.get('memory_info') else 0.0
                cpu_p = round(pinfo.get('cpu_percent') or 0.0, 1)

                processes.append({
                    "pid": pinfo['pid'],
                    "name": pinfo.get('name') or "unknown",
                    "user": pinfo.get('username') or "system",
                    "cpu_percent": cpu_p,
                    "memory_mb": mem_mb
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        # Sort according to violation type
        if "mem" in sort_by.lower():
            processes.sort(key=lambda p: p["memory_mb"], reverse=True)
        else:
            processes.sort(key=lambda p: p["cpu_percent"], reverse=True)

        return json.dumps(processes[:top_n])