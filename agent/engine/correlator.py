import uuid


class IncidentCorrelator:
    """Groups alerts into incidents: a new alert joins the incident of another
    OPEN alert on the same entity only if that alert started within
    `time_window_seconds`. Otherwise it opens a new incident."""

    def __init__(self, time_window_seconds: int = 120):
        self.window_ms = time_window_seconds * 1000

    def correlate(self, entity_id: str, started_at_ms: int, open_alerts: list[dict]) -> str:
        candidates = [
            a for a in open_alerts
            if a["entity_id"] == entity_id
            and a.get("correlation_id")
            and abs(started_at_ms - a["first_seen"]) <= self.window_ms
        ]
        if candidates:
            # join the earliest incident in the window
            return min(candidates, key=lambda a: a["first_seen"])["correlation_id"]
        return f"inc-{uuid.uuid4().hex[:8]}"
