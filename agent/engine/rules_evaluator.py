import operator
import yaml
import os
import aiosqlite

OPERATORS = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
}

class RulesEvaluator:
    def __init__(self, config_path: str = "agent/config/rules.yaml", db_path: str = "data/sentinelops.db"):
        self.config_path = config_path
        self.db_path = db_path
        self.cached_rules = []

    async def sync_rules_from_db(self):
        """Fetches active threshold rules directly from SQLite without reviving deleted rules."""
        try:
            async with aiosqlite.connect(self.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT * FROM rules WHERE is_active = 1") as cursor:
                    rows = await cursor.fetchall()
                    # Strictly synchronize in-memory rules with what is currently in SQLite
                    self.cached_rules = [
                        {
                            "id": r["id"],
                            "metric": r["metric_name"],
                            "operator": r["operator"],
                            "threshold": float(r["threshold"]),
                            "duration_seconds": r["duration_seconds"],
                            "severity": r["severity"],
                            "summary": r["summary_template"]
                        }
                        for r in rows
                    ]
        except Exception as e:
            pass

    def evaluate(self, metrics: list[dict]) -> tuple[list[dict], set[str]]:
        """
        Evaluates metrics against active rules.
        Returns:
          violations: list of triggered rule events
          passing_rule_ids: set of rule IDs that are currently NOT violated (healthy)
        """
        violations = []
        triggered_rule_keys = set()

        for metric in metrics:
            for rule in self.cached_rules:
                if metric["metric_name"] == rule["metric"]:
                    op_func = OPERATORS.get(rule["operator"])
                    if op_func and op_func(metric["metric_value"], rule["threshold"]):
                        violations.append({
                            "rule_id": rule["id"],
                            "entity_id": metric["entity_id"],
                            "severity": rule["severity"],
                            "summary": f"{rule['summary']} (Observed: {metric['metric_value']} {rule['operator']} {rule['threshold']})"
                        })
                        triggered_rule_keys.add(f"{rule['id']}:{metric['entity_id']}")

        return violations, triggered_rule_keys