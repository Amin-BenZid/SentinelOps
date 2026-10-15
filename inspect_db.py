import sqlite3

def check_data():
    conn = sqlite3.connect("data/sentinelops.db")
    cursor = conn.cursor()
    
    print("\n--- RECENT METRICS (LAST 5) ---")
    try:
        cursor.execute("SELECT id, source, entity_id, metric_name, metric_value, timestamp FROM metrics ORDER BY timestamp DESC LIMIT 5;")
        rows = cursor.fetchall()
        for r in rows:
            print(r)
    except sqlite3.OperationalError as e:
        print(f"Table not ready yet: {e}")

    print("\n--- ACTIVE ALERTS ---")
    try:
        cursor.execute("SELECT id, correlation_id, rule_name, entity_id, severity, summary, hit_count FROM alerts;")
        alerts = cursor.fetchall()
        for a in alerts:
            print(a)
    except sqlite3.OperationalError as e:
        print(f"Table not ready yet: {e}")
        
    conn.close()

if __name__ == "__main__":
    check_data()