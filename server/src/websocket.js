import { WebSocketServer } from 'ws';
import db from './db.js';
import { authService } from './services/auth.js';
import { recentAlerts, agentStatus } from './routes/api.js';

// Browsers cannot set an Authorization header on a WebSocket, so the session
// token is passed as ?token=... and validated BEFORE the upgrade completes.
function tokenFromUrl(url) {
  try {
    const t = new URL(url, 'http://x').searchParams.get('token');
    return t && /^[a-f0-9]{64}$/i.test(t) ? t : null;
  } catch { return null; }
}

function latestMetrics() {
  // latest sample of every series seen in the last 30 s (SQLite returns the
  // row holding MAX(ts) for the bare columns)
  return db.prepare(`
    SELECT entity_id, metric_name, metric_value, MAX(ts) AS timestamp
    FROM metrics WHERE ts >= ? GROUP BY entity_id, metric_name
  `).all(Date.now() - 30_000);
}

export function setupWebSocket(server, intervalMs = 2000) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4096,
    verifyClient: ({ req }, done) => {
      const token = tokenFromUrl(req.url);
      const user = authService.validateToken(token);
      if (!user || user.must_change_password) return done(false, 401, 'Unauthorized');
      req.sessionToken = token;
      done(true);
    },
  });

  wss.on('connection', (ws, req) => {
    ws.sessionToken = req.sessionToken;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', () => {}); // clients do not send commands
    try {
      ws.send(JSON.stringify({ type: 'SNAPSHOT', activeAlerts: recentAlerts(), latestMetrics: latestMetrics(), agent: agentStatus() }));
    } catch (e) { console.error('[ws] snapshot failed:', e.message); }
  });

  const timer = setInterval(() => {
    if (wss.clients.size === 0) return;
    let payload;
    try {
      payload = JSON.stringify({
        type: 'TICK',
        timestamp: Date.now(),
        latestMetrics: latestMetrics(),
        activeAlerts: recentAlerts(),
        agent: agentStatus(),
      });
    } catch (e) {
      console.error('[ws] tick query failed:', e.message); // never swallowed silently
      return;
    }
    for (const ws of wss.clients) {
      if (!authService.validateToken(ws.sessionToken)) { ws.close(4401, 'Session expired'); continue; }
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
      if (ws.readyState === 1) ws.send(payload);
    }
  }, intervalMs);
  timer.unref();

  wss.on('close', () => clearInterval(timer));
  return wss;
}
