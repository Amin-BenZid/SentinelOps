import { WebSocketServer } from 'ws';
import db from './db.js';
import { notifier } from './services/notifier.js';

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  console.log('[*] WebSocket server registered on top of HTTP server.');

  wss.on('connection', (ws) => {
    sendLiveSnapshot(ws);
  });

  setInterval(async () => {
    if (!db) return;

    try {
      // 1. Fetch latest metrics for charts
      const latestMetrics = db.prepare(`
        SELECT entity_id, metric_name, metric_value, timestamp 
        FROM metrics 
        ORDER BY timestamp DESC 
        LIMIT 10
      `).all();

      // 2. Fetch recent alerts (BOTH active and resolved so timelines remain visible!)
      const alerts = db.prepare(`
        SELECT * FROM alerts 
        ORDER BY last_seen DESC 
        LIMIT 25
      `).all();

      // 3. GUARANTEED SLACK DELIVERY: Process any alert that hasn't notified Slack yet
      const unnotifiedAlerts = db.prepare(`
        SELECT * FROM alerts 
        WHERE notified = 0 OR notified IS NULL
      `).all();

      for (const alert of unnotifiedAlerts) {
        // Mark as notified in SQLite immediately
        db.prepare(`UPDATE alerts SET notified = 1 WHERE id = ?`).run(alert.id);
        console.log(`[QUEUE] Dispatching Slack/Email notification for alert #${alert.id} (${alert.rule_name})`);
        notifier.dispatch(alert).catch((err) => {
          console.error('[!] Dispatch error:', err.message);
        });
      }

      const payload = JSON.stringify({
        type: 'TICK',
        timestamp: new Date(),
        latestMetrics,
        activeAlerts: alerts // Sends both active and resolved
      });

      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    } catch (e) {
      // Ignore transient SQLite locks
    }
  }, 2000);

  function sendLiveSnapshot(ws) {
    if (!db) return;
    try {
      const alerts = db.prepare(`SELECT * FROM alerts ORDER BY last_seen DESC LIMIT 25`).all();
      ws.send(JSON.stringify({ type: 'SNAPSHOT', activeAlerts: alerts }));
    } catch (e) {}
  }

  return wss;
}