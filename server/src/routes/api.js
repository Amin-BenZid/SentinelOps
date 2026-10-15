import { Router } from 'express';
import db from '../db.js';
import { dockerService } from '../services/docker.js';
import { authService } from '../services/auth.js';

// 1. Initialize Router First
const router = Router();

// ── 2. AUTHENTICATION ROUTES (GRAFANA PATTERN) ──

// Login
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const result = authService.login(username.trim(), password);
  if (!result) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.json(result);
});

// Verify current session
router.get('/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/, '') || req.query.token;
  const user = authService.validateToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized session' });
  }
  res.json({ user });
});

// Change credentials (First-login onboarding)
router.post('/auth/change-credentials', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/, '');
  const user = authService.validateToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { new_username, new_password } = req.body;
  if (!new_username || !new_password || new_password.length < 5) {
    return res.status(400).json({ error: 'Password must be at least 5 characters long' });
  }

  try {
    authService.updateCredentials(user.id, new_username, new_password);
    res.json({ success: true, message: 'Credentials updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
router.post('/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/, '');
  if (token) authService.logout(token);
  res.json({ success: true });
});

// ── 3. HEALTH & ALERTS ──

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date() });
});

router.get('/alerts', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  try {
    const alerts = db.prepare(`SELECT * FROM alerts ORDER BY last_seen DESC LIMIT 50`).all();
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/alerts/:id/status', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  try {
    const result = db.prepare(`UPDATE alerts SET status = ? WHERE id = ?`).run(status, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json({ success: true, message: `Alert marked as ${status}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/alerts/purge', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  try {
    db.prepare(`DELETE FROM alerts WHERE status = 'resolved'`).run();
    res.json({ success: true, message: 'Resolved alerts purged' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── 4. METRICS & SERVICE HEALTH ──

router.get('/metrics/history', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });

  const entity = req.query.entity || 'local-host';
  const metricName = req.query.metric || 'cpu_percent';
  const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);

  try {
    const rows = db.prepare(`
      SELECT metric_value, timestamp 
      FROM metrics 
      WHERE entity_id = ? AND metric_name = ?
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(entity, metricName, limit);

    res.json({ data: rows.reverse() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/filters', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  try {
    const entities = db.prepare(`SELECT DISTINCT entity_id, source FROM metrics`).all();
    const metrics = db.prepare(`SELECT DISTINCT metric_name FROM metrics`).all();
    res.json({
      entities: entities.map(e => ({ id: e.entity_id, source: e.source })),
      metrics: metrics.map(m => m.metric_name)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/services', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });

  try {
    const entities = db.prepare(`
      SELECT DISTINCT entity_id, source FROM metrics 
      WHERE timestamp >= datetime('now', '-5 minutes')
    `).all();

    const activeAlerts = db.prepare(`
      SELECT entity_id, severity FROM alerts WHERE status = 'active'
    `).all();

    const result = entities.map(item => {
      const entityAlerts = activeAlerts.filter(a => a.entity_id === item.entity_id);
      let status = 'healthy';
      if (entityAlerts.some(a => a.severity === 'critical')) status = 'critical';
      else if (entityAlerts.some(a => a.severity === 'warning')) status = 'warning';

      return {
        id: item.entity_id,
        source: item.source,
        status: status,
        alertCount: entityAlerts.length
      };
    });

    res.json({ services: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── 5. RULES ENGINE CRUD ──

router.get('/rules', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  try {
    const rules = db.prepare(`SELECT * FROM rules`).all();
    res.json({ rules });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/rules', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  const { id, metric_name, operator, threshold, duration_seconds, severity, summary_template } = req.body;

  if (!id || !metric_name || !operator || threshold === undefined) {
    return res.status(400).json({ error: 'Missing required rule fields' });
  }

  try {
    db.prepare(`
      INSERT INTO rules (id, metric_name, operator, threshold, duration_seconds, severity, summary_template, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        metric_name = excluded.metric_name,
        operator = excluded.operator,
        threshold = excluded.threshold,
        duration_seconds = excluded.duration_seconds,
        severity = excluded.severity,
        summary_template = excluded.summary_template
    `).run(id, metric_name, operator, Number(threshold), Number(duration_seconds || 60), severity || 'warning', summary_template || 'Threshold reached');

    res.json({ success: true, message: 'Rule saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/rules/:id/toggle', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  const { id } = req.params;
  try {
    db.prepare(`UPDATE rules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`).run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/rules/:id', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  const rawId = decodeURIComponent(req.params.id).trim();

  try {
    const result = db.prepare(`DELETE FROM rules WHERE id = ?`).run(rawId);
    db.prepare(`DELETE FROM alerts WHERE rule_name = ?`).run(rawId);
    console.log(`[DELETE] Rule "${rawId}" deleted from SQLite (affected rows: ${result.changes})`);
    res.json({ success: true, changes: result.changes });
  } catch (error) {
    console.error(`[!] Failed to delete rule "${rawId}":`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 6. SETTINGS & NOTIFICATIONS ──

router.get('/settings', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  try {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const settingsMap = {};
    rows.forEach(r => { settingsMap[r.key] = r.value; });
    res.json({ settings: settingsMap });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  const payload = req.body;

  try {
    const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [key, val] of Object.entries(payload)) {
      upsert.run(key, String(val ?? ''));
    }
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/test/slack', async (req, res) => {
  const { webhook_url } = req.body;
  let targetUrl = webhook_url;
  if (!targetUrl && db) {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`).get();
    if (row) targetUrl = row.value;
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'No Slack Webhook URL found. Please enter one first.' });
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '🚀 *SentinelOps Test Alert*: Slack integration is working perfectly!'
      })
    });
    const responseText = await response.text();
    if (!response.ok) {
      return res.status(400).json({ error: `Slack API error (${response.status}): ${responseText}` });
    }
    res.json({ success: true, message: 'Test message sent to Slack successfully!' });
  } catch (err) {
    res.status(500).json({ error: `Failed to reach Slack: ${err.message}` });
  }
});

// ── 7. DOCKER OPS ENDPOINTS ──

router.get('/containers/:id/logs', async (req, res) => {
  const { id } = req.params;
  const tail = parseInt(req.query.tail || '100', 10);
  try {
    const logs = await dockerService.getLogs(id, tail);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/containers/:id/restart', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dockerService.restartContainer(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;