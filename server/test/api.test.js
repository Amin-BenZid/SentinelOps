// Integration tests: real Express app + real SQLite file (temp dir).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ADMIN_PASSWORD = 'initial-pass-123';
process.env.LOGIN_MAX_FAILURES = '3';

const { createApp } = await import('../src/app.js');
const { setupWebSocket } = await import('../src/websocket.js');
const { default: db } = await import('../src/db.js');
const { loginLimiter } = await import('../src/services/auth.js');
const { processOutboxOnce } = await import('../src/services/outbox.js');

let server; let base; let token;

async function call(method, url, { body, auth = token } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json, headers: res.headers };
}

function insertAlert(fields = {}) {
  const now = Date.now();
  const a = { fingerprint: 'fp1', correlation_id: 'inc-1', rule_name: 'host_high_cpu', detector: 'threshold',
    entity_id: 'local-host', metric_name: 'cpu_percent', severity: 'critical', summary: 'cpu high',
    state: 'firing', first_seen: now - 60000, fired_at: now, last_seen: now, ...fields };
  const r = db.prepare(`INSERT INTO alerts (fingerprint, correlation_id, rule_name, detector, entity_id, metric_name,
     severity, summary, state, first_seen, fired_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(a.fingerprint, a.correlation_id, a.rule_name, a.detector, a.entity_id, a.metric_name, a.severity,
         a.summary, a.state, a.first_seen, a.fired_at, a.last_seen);
  return Number(r.lastInsertRowid);
}

before(async () => {
  server = http.createServer(createApp());
  setupWebSocket(server, 200);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('health is public and reports agent status', async () => {
  const r = await call('GET', '/health', { auth: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.agent.stale, true);
});

test('every other endpoint is denied without a session', async () => {
  for (const [m, u] of [['GET', '/alerts'], ['GET', '/settings'], ['GET', '/rules'], ['POST', '/containers/x/restart'],
                        ['DELETE', '/alerts/purge'], ['GET', '/metrics/history'], ['GET', '/does-not-exist']]) {
    const r = await call(m, u, { auth: null });
    assert.equal(r.status, 401, `${m} ${u}`);
  }
  const forged = await call('GET', '/alerts', { auth: 'a'.repeat(64) });
  assert.equal(forged.status, 401);
});

test('login works, wrong password is rejected, brute force is rate limited', async () => {
  loginLimiter._clear();
  for (let i = 0; i < 3; i++) {
    assert.equal((await call('POST', '/auth/login', { auth: null, body: { username: 'admin', password: 'nope' } })).status, 401);
  }
  const blocked = await call('POST', '/auth/login', { auth: null, body: { username: 'admin', password: 'initial-pass-123' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  loginLimiter._clear();
  const ok = await call('POST', '/auth/login', { auth: null, body: { username: 'admin', password: 'initial-pass-123' } });
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^[a-f0-9]{64}$/);
  token = ok.body.token;
  // the token itself is never stored, only its hash
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE token_hash = ?').get(token).c, 0);
});

test('a user flagged must_change_password can only reach onboarding routes', async () => {
  db.prepare('UPDATE users SET must_change_password = 1').run();
  assert.equal((await call('GET', '/alerts')).status, 403);
  assert.equal((await call('GET', '/auth/me')).status, 200);
  const weak = await call('POST', '/auth/change-credentials', { body: { new_username: 'admin', new_password: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await call('POST', '/auth/change-credentials', { body: { new_username: 'amin', new_password: 'a-much-better-pass' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/alerts')).status, 200);
  // later changes must confirm the current password
  const noCurrent = await call('POST', '/auth/change-credentials', { body: { new_password: 'another-pass-456' } });
  assert.equal(noCurrent.status, 403);
});

test('expired sessions are rejected', async () => {
  const r = await call('POST', '/auth/login', { auth: null, body: { username: 'amin', password: 'a-much-better-pass' } });
  const t = r.body.token;
  db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE username = ?) AND created_at = (SELECT MAX(created_at) FROM sessions)')
    .run(Date.now() - 1, 'amin');
  assert.equal((await call('GET', '/alerts', { auth: t })).status, 401);
});

test('logout revokes the token', async () => {
  const r = await call('POST', '/auth/login', { auth: null, body: { username: 'amin', password: 'a-much-better-pass' } });
  const t = r.body.token;
  assert.equal((await call('POST', '/auth/logout', { auth: t })).status, 200);
  assert.equal((await call('GET', '/alerts', { auth: t })).status, 401);
});

test('secrets are write-only and blank keeps the stored value', async () => {
  let r = await call('POST', '/settings', { body: { slack_webhook_url: 'https://hooks.slack.com/services/T/B/x', smtp_pass: 's3cret', smtp_host: 'smtp.example.com' } });
  assert.equal(r.status, 200);
  r = await call('GET', '/settings');
  assert.equal(r.body.settings.slack_webhook_url, '');
  assert.equal(r.body.settings.smtp_pass, '');
  assert.equal(r.body.settings.smtp_host, 'smtp.example.com');
  assert.deepEqual(r.body.secrets_set, { slack_webhook_url: true, smtp_pass: true });
  await call('POST', '/settings', { body: { smtp_pass: '', smtp_host: 'smtp2.example.com' } });
  assert.equal(db.prepare(`SELECT value FROM settings WHERE key='smtp_pass'`).get().value, 's3cret');
  const bad = await call('POST', '/settings', { body: { slack_webhook_url: 'http://169.254.169.254/latest', smtp_port: '99999' } });
  assert.equal(bad.status, 400);
  db.prepare('DELETE FROM settings').run();
});

test('rules are validated', async () => {
  assert.equal((await call('POST', '/rules', { body: { id: 'x y', metric_name: 'cpu', operator: '>', threshold: 1 } })).status, 400);
  assert.equal((await call('POST', '/rules', { body: { id: 'r1', metric_name: 'cpu', operator: 'DROP', threshold: 1 } })).status, 400);
  assert.equal((await call('POST', '/rules', { body: { id: 'anomaly:x', metric_name: 'cpu', operator: '>', threshold: 1 } })).status, 400);
  const ok = await call('POST', '/rules', { body: { id: 'r1', metric_name: 'cpu_percent', operator: '>=', threshold: '90', duration_seconds: 30, severity: 'critical' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rule.threshold, 90);
  assert.equal((await call('PATCH', '/rules/r1/toggle')).body.rule.is_active, 0);
  assert.equal((await call('DELETE', '/rules/r1')).status, 200);
  assert.equal((await call('DELETE', '/rules/r1')).status, 404);
});

test('ack / unack / manual resolve / reopen follow the lifecycle', async () => {
  const id = insertAlert();
  let r = await call('PATCH', `/alerts/${id}/status`, { body: { status: 'acknowledged' } });
  assert.equal(r.body.alert.status, 'acknowledged');
  assert.equal(r.body.alert.state, 'firing');
  assert.equal(r.body.alert.acked_by, 'amin');

  r = await call('PATCH', `/alerts/${id}/status`, { body: { status: 'active' } });
  assert.equal(r.body.alert.status, 'active');

  r = await call('PATCH', `/alerts/${id}/status`, { body: { status: 'resolved' } });
  assert.equal(r.body.alert.state, 'resolved');
  assert.equal(r.body.alert.resolved_by, 'amin');
  const ev = db.prepare('SELECT event FROM notifications_outbox WHERE alert_id = ?').all(id).map((x) => x.event);
  assert.deepEqual(ev, ['resolved']);

  // a newer open alert with the same fingerprint blocks reopening
  const newer = insertAlert();
  assert.equal((await call('PATCH', `/alerts/${id}/status`, { body: { status: 'active' } })).status, 409);
  db.prepare('DELETE FROM alerts WHERE id = ?').run(newer);
  r = await call('PATCH', `/alerts/${id}/status`, { body: { status: 'active' } });
  assert.equal(r.body.alert.state, 'firing');
  db.prepare('DELETE FROM alerts').run();
});

test('outbox: failed delivery is retried with backoff, then marked sent', async () => {
  const id = insertAlert({ fingerprint: 'fp-outbox' });
  const now = Date.now();
  db.prepare(`INSERT INTO notifications_outbox (alert_id, event, created_at, next_attempt_at) VALUES (?, 'firing', ?, ?)`).run(id, now, now);

  await processOutboxOnce(now, { dispatch: async () => { throw new Error('slack down'); } });
  let row = db.prepare('SELECT * FROM notifications_outbox').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.ok(row.next_attempt_at > now);
  assert.match(row.last_error, /slack down/);

  // not due yet -> untouched
  await processOutboxOnce(now, { dispatch: async () => 'sent' });
  assert.equal(db.prepare('SELECT attempts FROM notifications_outbox').get().attempts, 1);

  const seen = [];
  await processOutboxOnce(row.next_attempt_at, { dispatch: async (a, e) => { seen.push([a.rule_name, e]); return 'sent'; } });
  row = db.prepare('SELECT * FROM notifications_outbox').get();
  assert.equal(row.status, 'sent');
  assert.deepEqual(seen, [['host_high_cpu', 'firing']]);
  db.prepare('DELETE FROM alerts').run();
});

test('websocket rejects missing/invalid tokens and streams to valid sessions', async () => {
  const wsBase = base.replace('http', 'ws').replace('/api', '/ws');
  const rejected = await new Promise((resolve) => {
    const ws = new WebSocket(wsBase);
    ws.on('unexpected-response', (_, res) => resolve(res.statusCode));
    ws.on('open', () => resolve('opened'));
    ws.on('error', () => {});
  });
  assert.equal(rejected, 401);

  insertAlert({ fingerprint: 'fp-ws' });
  const msg = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}?token=${token}`);
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'TICK') { ws.close(); resolve(m); } });
    ws.on('error', reject);
  });
  assert.equal(msg.activeAlerts[0].status, 'active');
  assert.ok('agent' in msg);
  db.prepare('DELETE FROM alerts').run();
});

test('container ids are validated before reaching Docker', async () => {
  const r = await call('GET', '/containers/..%2F..%2Fimages/logs');
  assert.equal(r.status, 400);
});

test('security headers are set', async () => {
  const r = await call('GET', '/health', { auth: null });
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});
