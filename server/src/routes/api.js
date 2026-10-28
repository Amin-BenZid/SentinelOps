import { Router } from 'express';
import db, { transaction } from '../db.js';
import { dockerService } from '../services/docker.js';
import { authService, loginLimiter, AuthError } from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth); // deny-by-default: see PUBLIC in middleware/auth.js

const AGENT_STALE_MS = 30_000;

// ── helpers ──
const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** DB row -> API shape. `status` keeps the v0.1 contract used by the UI. */
export function toApiAlert(a) {
  return {
    id: a.id,
    fingerprint: a.fingerprint,
    correlation_id: a.correlation_id,
    rule_name: a.rule_name,
    detector: a.detector,
    entity_id: a.entity_id,
    metric_name: a.metric_name,
    severity: a.severity,
    summary: a.summary,
    state: a.state,
    status: a.state === 'resolved' ? 'resolved' : a.acked_at ? 'acknowledged' : 'active',
    first_seen: a.first_seen,
    fired_at: a.fired_at,
    last_seen: a.last_seen,
    resolved_at: a.resolved_at,
    resolved_by: a.resolved_by,
    acked_by: a.acked_by,
    acked_at: a.acked_at,
    hit_count: a.hit_count,
    process_snapshot: a.process_snapshot,
    evidence: parseJson(a.evidence, {}),
  };
}

export function recentAlerts(limit = 50) {
  return db.prepare(`SELECT * FROM alerts ORDER BY (state = 'firing') DESC, last_seen DESC LIMIT ?`)
    .all(limit).map(toApiAlert);
}

export function agentStatus() {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = 'agent_heartbeat'`).get();
  const last = row ? Number(row.value) : null;
  return { last_heartbeat: last, stale: !last || Date.now() - last > AGENT_STALE_MS };
}

const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') {
      out.catch((err) => res.status(err.status || 500).json({ error: err.message }));
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// ── auth ──
router.post('/auth/login', wrap((req, res) => {
  const ip = req.ip;
  const wait = loginLimiter.retryAfterSeconds(ip);
  if (wait > 0) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: `Too many failed logins. Try again in ${Math.ceil(wait / 60)} min.` });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const result = authService.login(username.trim(), password);
  if (!result) {
    loginLimiter.fail(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  loginLimiter.reset(ip);
  res.json(result);
}));

router.get('/auth/me', (req, res) => res.json({ user: req.user }));

router.post('/auth/change-credentials', wrap((req, res) => {
  const { new_username, new_password, current_password } = req.body || {};
  try {
    const out = authService.changeCredentials(req.user, {
      newUsername: new_username, newPassword: new_password, currentPassword: current_password,
    }, req.token);
    res.json({ success: true, username: out.username });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

router.post('/auth/logout', (req, res) => {
  authService.logout(req.token);
  res.json({ success: true });
});

// ── health (public) ──
router.get('/health', (req, res) => {
  const agent = agentStatus();
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), agent });
});

// ── alerts ──
router.get('/alerts', wrap((req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  res.json({ alerts: recentAlerts(limit) });
}));

router.patch('/alerts/:id/status', wrap((req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid alert id' });
  if (!['active', 'acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'status must be active | acknowledged | resolved' });
  }
  const now = Date.now();
  const who = req.user.username;

  const result = transaction(() => {
    const a = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    if (!a) return { code: 404, error: 'Alert not found' };

    if (status === 'acknowledged') {
      if (a.state !== 'firing') return { code: 409, error: 'Only firing alerts can be acknowledged' };
      db.prepare('UPDATE alerts SET acked_by = ?, acked_at = ? WHERE id = ?').run(who, now, id);
    } else if (status === 'resolved') {
      if (a.state !== 'firing') return { code: 409, error: 'Alert is already resolved' };
      db.prepare(`UPDATE alerts SET state = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?`).run(now, who, id);
      db.prepare(`INSERT INTO notifications_outbox (alert_id, event, created_at, next_attempt_at) VALUES (?, 'resolved', ?, ?)`)
        .run(id, now, now);
    } else if (a.state === 'firing') {        // 'active' on a firing alert = un-acknowledge
      db.prepare('UPDATE alerts SET acked_by = NULL, acked_at = NULL WHERE id = ?').run(id);
    } else {                                  // 'active' on a resolved alert = reopen
      const clash = db.prepare(`SELECT id FROM alerts WHERE fingerprint = ? AND state = 'firing'`).get(a.fingerprint);
      if (clash) return { code: 409, error: `A newer alert #${clash.id} for the same rule/entity is already open` };
      db.prepare(`UPDATE alerts SET state = 'firing', resolved_at = NULL, resolved_by = NULL, acked_by = NULL,
                  acked_at = NULL, last_seen = ? WHERE id = ?`).run(now, id);
    }
    return { code: 200, alert: toApiAlert(db.prepare('SELECT * FROM alerts WHERE id = ?').get(id)) };
  });

  if (result.code !== 200) return res.status(result.code).json({ error: result.error });
  res.json({ success: true, alert: result.alert });
}));

router.delete('/alerts/purge', wrap((req, res) => {
  const r = db.prepare(`DELETE FROM alerts WHERE state = 'resolved'`).run();
  res.json({ success: true, deleted: Number(r.changes) });
}));

// ── metrics ──
router.get('/metrics/history', wrap((req, res) => {
  const entity = String(req.query.entity || 'local-host');
  const metric = String(req.query.metric || 'cpu_percent');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 1440);
  if (req.query.resolution === '1m') {
    const rows = db.prepare(`
      SELECT bucket_ts AS timestamp, avg_value AS metric_value, min_value, max_value
      FROM metrics_1m WHERE entity_id = ? AND metric_name = ? ORDER BY bucket_ts DESC LIMIT ?
    `).all(entity, metric, limit);
    return res.json({ data: rows.reverse(), resolution: '1m' });
  }
  const rows = db.prepare(`
    SELECT ts AS timestamp, metric_value, is_anomaly, lower_bound, upper_bound
    FROM metrics WHERE entity_id = ? AND metric_name = ? ORDER BY ts DESC LIMIT ?
  `).all(entity, metric, limit);
  res.json({ data: rows.reverse(), resolution: 'raw' });
}));

router.get('/filters', wrap((req, res) => {
  const since = Date.now() - 3_600_000;
  const entities = db.prepare(`SELECT DISTINCT entity_id, source FROM metrics WHERE ts >= ?`).all(since);
  const metrics = db.prepare(`SELECT DISTINCT metric_name FROM metrics WHERE ts >= ?`).all(since);
  res.json({
    entities: entities.map((e) => ({ id: e.entity_id, source: e.source })),
    metrics: metrics.map((m) => m.metric_name).sort(),
  });
}));

router.get('/services', wrap((req, res) => {
  const entities = db.prepare(`SELECT DISTINCT entity_id, source FROM metrics WHERE ts >= ?`).all(Date.now() - 5 * 60_000);
  const open = db.prepare(`SELECT entity_id, severity FROM alerts WHERE state = 'firing'`).all();
  res.json({
    services: entities.map((e) => {
      const mine = open.filter((a) => a.entity_id === e.entity_id);
      const status = mine.some((a) => a.severity === 'critical') ? 'critical'
        : mine.some((a) => a.severity === 'warning') ? 'warning' : 'healthy';
      return { id: e.entity_id, source: e.source, status, alertCount: mine.length };
    }),
    agent: agentStatus(),
  });
}));

// ── rules ──
const RULE_ID_RE = /^[a-zA-Z0-9_.:-]{1,64}$/;
const OPERATORS = ['>', '<', '>=', '<=', '=='];

function validateRule(body) {
  const r = body || {};
  const errors = [];
  const id = String(r.id ?? '').trim();
  if (!RULE_ID_RE.test(id)) errors.push('id: 1-64 chars, letters/digits/_ . : -');
  if (id.startsWith('anomaly:')) errors.push('id: the "anomaly:" prefix is reserved');
  const metric = String(r.metric_name ?? '').trim();
  if (!metric || metric.length > 200) errors.push('metric_name is required');
  if (!OPERATORS.includes(r.operator)) errors.push(`operator must be one of ${OPERATORS.join(' ')}`);
  const threshold = Number(r.threshold);
  if (!Number.isFinite(threshold)) errors.push('threshold must be a number');
  const duration = r.duration_seconds === undefined || r.duration_seconds === '' ? 60 : Number(r.duration_seconds);
  if (!Number.isInteger(duration) || duration < 0 || duration > 86400) errors.push('duration_seconds must be 0-86400');
  const severity = r.severity || 'warning';
  if (!['warning', 'critical'].includes(severity)) errors.push('severity must be warning | critical');
  const summary = String(r.summary_template || 'Threshold reached').slice(0, 300);
  return { errors, rule: { id, metric, operator: r.operator, threshold, duration, severity, summary } };
}

router.get('/rules', wrap((req, res) => {
  res.json({ rules: db.prepare('SELECT * FROM rules ORDER BY id').all() });
}));

router.post('/rules', wrap((req, res) => {
  const { errors, rule } = validateRule(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  db.prepare(`
    INSERT INTO rules (id, metric_name, operator, threshold, duration_seconds, severity, summary_template, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET metric_name = excluded.metric_name, operator = excluded.operator,
      threshold = excluded.threshold, duration_seconds = excluded.duration_seconds,
      severity = excluded.severity, summary_template = excluded.summary_template
  `).run(rule.id, rule.metric, rule.operator, rule.threshold, rule.duration, rule.severity, rule.summary);
  res.json({ success: true, rule: db.prepare('SELECT * FROM rules WHERE id = ?').get(rule.id) });
}));

router.patch('/rules/:id/toggle', wrap((req, res) => {
  const r = db.prepare('UPDATE rules SET is_active = 1 - is_active WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Rule not found' });
  res.json({ success: true, rule: db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id) });
}));

router.delete('/rules/:id', wrap((req, res) => {
  // Alert history is kept: the agent auto-resolves the rule's open alerts on
  // its next cycle (and sends the "resolved" notification).
  const r = db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Rule not found' });
  res.json({ success: true });
}));

// ── settings ──
const SETTINGS = {
  slack_webhook_url: { secret: true, validate: (v) => /^https:\/\/\S+$/.test(v) || 'must be an https:// URL' },
  smtp_host: { validate: (v) => /^[a-zA-Z0-9.-]{1,253}$/.test(v) || 'invalid hostname' },
  smtp_port: { validate: (v) => (Number.isInteger(+v) && +v > 0 && +v < 65536) || 'must be 1-65535' },
  smtp_user: { validate: (v) => v.length <= 254 || 'too long' },
  smtp_pass: { secret: true, validate: (v) => v.length <= 1024 || 'too long' },
  alert_email_to: { validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'invalid email' },
  quiet_hours_enabled: { validate: (v) => ['true', 'false'].includes(v) || 'must be true|false' },
  quiet_hours_start: { validate: (v) => (Number.isInteger(+v) && +v >= 0 && +v <= 23) || 'must be 0-23' },
  quiet_hours_end: { validate: (v) => (Number.isInteger(+v) && +v >= 0 && +v <= 23) || 'must be 0-23' },
  anomaly_detection_enabled: { validate: (v) => ['true', 'false'].includes(v) || 'must be true|false' },
};

router.get('/settings', wrap((req, res) => {
  const settings = {};
  const secrets_set = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (!SETTINGS[key]) continue;
    if (SETTINGS[key].secret) {
      secrets_set[key] = Boolean(value);
      settings[key] = '';          // secrets are write-only: never sent back
    } else {
      settings[key] = value;
    }
  }
  res.json({ settings, secrets_set });
}));

router.post('/settings', wrap((req, res) => {
  const body = req.body || {};
  const errors = [];
  const writes = [];
  for (const [key, raw] of Object.entries(body)) {
    const spec = SETTINGS[key];
    if (!spec) continue;                                   // ignore unknown keys
    if (raw === null) { writes.push([key, null]); continue; } // explicit clear
    const value = String(raw).trim();
    if (value === '') {
      if (spec.secret) continue;                           // blank secret = keep the stored one
      writes.push([key, null]);
      continue;
    }
    const ok = spec.validate(value);
    if (ok !== true) errors.push(`${key}: ${ok}`);
    else writes.push([key, value]);
  }
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  transaction(() => {
    for (const [key, value] of writes) {
      if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      else db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
    }
  });
  res.json({ success: true, message: 'Settings saved' });
}));

router.post('/test/slack', wrap(async (req, res) => {
  let url = req.body?.webhook_url ? String(req.body.webhook_url).trim() : '';
  if (!url) url = db.prepare(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`).get()?.value || process.env.SLACK_WEBHOOK_URL || '';
  if (!url) return res.status(400).json({ error: 'No Slack webhook configured' });
  if (!/^https:\/\/\S+$/.test(url)) return res.status(400).json({ error: 'Webhook must be an https:// URL' });
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `✅ SentinelOps test message (sent by ${req.user.username})` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return res.status(502).json({ error: `Slack answered ${r.status}: ${(await r.text()).slice(0, 200)}` });
    res.json({ success: true, message: 'Test message delivered to Slack' });
  } catch (err) {
    res.status(502).json({ error: `Could not reach Slack: ${err.message}` });
  }
}));

// ── notifications log (outbox) ──
router.get('/notifications', wrap((req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.alert_id, o.event, o.status, o.attempts, o.last_error, o.created_at, o.processed_at,
           a.rule_name, a.entity_id
    FROM notifications_outbox o JOIN alerts a ON a.id = o.alert_id
    ORDER BY o.id DESC LIMIT 100`).all();
  res.json({ notifications: rows });
}));

// ── docker ops ──
router.get('/containers/:id/logs', wrap(async (req, res) => {
  res.json({ logs: await dockerService.getLogs(req.params.id, req.query.tail) });
}));

router.post('/containers/:id/restart', wrap(async (req, res) => {
  const result = await dockerService.restartContainer(req.params.id);
  console.log(`[audit] container ${req.params.id} restarted by ${req.user.username}`);
  res.json(result);
}));

export default router;
