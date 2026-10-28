import hashlib


def fingerprint(rule_id: str, entity_id: str) -> str:
    """Stable identity of an alert: the same rule on the same entity is always
    the same alert while it is open (enforced by ux_alerts_open in the DB)."""
    return hashlib.sha256(f"{rule_id}:{entity_id}".encode()).hexdigest()[:16]


class AlertDeduper:  # kept for backwards compatibility
    generate_fingerprint = staticmethod(fingerprint)
