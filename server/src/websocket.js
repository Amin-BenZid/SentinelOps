import { WebSocketServer } from 'ws';
import db from './db.js';
import { notifier } from './services/notifier.js';

const notifiedAlertIds = new Set();

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  console.log('[*] WebSocket server registered on top of HTTP server.');

  wss.on('connection', (ws) => {
    sendLiveSnapshot(ws);
  });

  setInterval(async () => {
    if (!db) return;

    try {
      const latestMetrics = db.prepare(`
        SELECT entity_id, metric_name, metric_value, timestamp 
        FROM metrics 
        ORDER BY timestamp DESC 
        LIMIT 10
      `).all();

      const activeAlerts = db.prepare(`
        SELECT * FROM alerts 
        WHERE status = 'active' 
        ORDER BY last_seen DESC
      `).all();

      // Check for un-notified alerts
      for (const alert of activeAlerts) {
        if (!notifiedAlertIds.has(alert.id)) {
          notifiedAlertIds.add(alert.id);
          notifier.dispatch(alert).catch(console.error);
        }
      }

      const payload = JSON.stringify({
        type: 'TICK',
        timestamp: new Date(),
        latestMetrics,
        activeAlerts
      });

      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    } catch (e) {
      // Ignore transient read locks in WAL mode
    }
  }, 2000);

  function sendLiveSnapshot(ws) {
    if (!db) return;
    try {
      const activeAlerts = db.prepare(`SELECT * FROM alerts WHERE status = 'active'`).all();
      ws.send(JSON.stringify({ type: 'SNAPSHOT', activeAlerts }));
    } catch (e) {}
  }

  return wss;
}