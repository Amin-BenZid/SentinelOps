# agent/engine/deduper.py
import hashlib
from datetime import datetime, timezone, timedelta

class AlertDeduper:
    def __init__(self, bucket_ttl_seconds: int = 300):
        self.bucket_ttl = timedelta(seconds=bucket_ttl_seconds)

    @staticmethod
    def generate_fingerprint(rule_id: str, entity_id: str) -> str:
        payload = f"{rule_id}:{entity_id}"
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def process_incident(self, active_alert_in_db: dict, rule_id: str, entity_id: str, severity: str, summary: str):
        now = datetime.now(timezone.utc)
        fingerprint = self.generate_fingerprint(rule_id, entity_id)

        if active_alert_in_db:
            # Duplicate alert inside active window -> increment hit_count and update last_seen
            return {
                "action": "UPDATE",
                "id": active_alert_in_db["id"],
                "last_seen": now,
                "hit_count": active_alert_in_db["hit_count"] + 1
            }
        else:
            # Brand new alert
            return {
                "action": "INSERT",
                "fingerprint": fingerprint,
                "rule_name": rule_id,
                "entity_id": entity_id,
                "severity": severity,
                "summary": summary,
                "status": "active",
                "first_seen": now,
                "last_seen": now,
                "hit_count": 1
            }