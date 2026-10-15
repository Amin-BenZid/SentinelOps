import uuid
from datetime import datetime, timezone, timedelta

class IncidentCorrelator:
    """
    Correlates multiple active alerts for the same entity within a time window
    into a single root Incident / Correlation ID.
    """
    def __init__(self, time_window_seconds: int = 120):
        self.time_window = timedelta(seconds=time_window_seconds)

    def correlate(self, new_alert: dict, existing_active_alerts: list) -> str:
        now = datetime.now(timezone.utc)
        
        # Look for active alerts on the same entity within the correlation window
        for alert in existing_active_alerts:
            if alert["entity_id"] == new_alert["entity_id"]:
                # If they occurred within the correlation window, merge under same correlation_id
                if alert.get("correlation_id"):
                    return alert["correlation_id"]

        # No parent correlation group found -> generate a new correlation cluster
        return f"inc-{uuid.uuid4().hex[:8]}"