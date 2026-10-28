import nodemailer from 'nodemailer';
import db from '../db.js';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Slack mrkdwn: neutralise <!channel>-style mentions and links coming from data
const escapeSlack = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class NotifierService {
  getSetting(key, fallbackEnv) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && row.value && row.value.trim() !== '') return row.value.trim();
    return process.env[fallbackEnv] || null;
  }

  isQuietHours(date = new Date()) {
    const enabled = this.getSetting('quiet_hours_enabled', 'QUIET_HOURS_ENABLED');
    if (enabled !== 'true' && enabled !== '1') return false;
    const start = parseInt(this.getSetting('quiet_hours_start', 'QUIET_HOURS_START') || '22', 10);
    const end = parseInt(this.getSetting('quiet_hours_end', 'QUIET_HOURS_END') || '7', 10);
    const h = date.getHours(); // container local time: set TZ in .env
    return start > end ? (h >= start || h < end) : (h >= start && h < end);
  }

  parseSnapshot(json) {
    try {
      const parsed = JSON.parse(json || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  /**
   * Delivers one outbox event to every configured channel.
   * Returns 'sent' | 'skipped' (no channel configured) | 'suppressed' (quiet hours).
   * Throws if a configured channel fails, so the outbox worker retries
   * (delivery is at-least-once).
   */
  async dispatch(alert, event) {
    if (alert.severity === 'warning' && this.isQuietHours()) return 'suppressed';
    const results = [];
    const errors = [];
    for (const send of [this.sendSlack.bind(this), this.sendEmail.bind(this)]) {
      try { results.push(await send(alert, event)); } catch (e) { errors.push(e.message); }
    }
    if (errors.length) throw new Error(errors.join(' | '));
    return results.includes('sent') ? 'sent' : 'skipped';
  }

  async sendSlack(alert, event) {
    const url = this.getSetting('slack_webhook_url', 'SLACK_WEBHOOK_URL');
    if (!url) return 'skipped';

    let text;
    if (event === 'resolved') {
      const by = alert.resolved_by === 'auto' ? 'automatically (metric back to normal)' : `manually by ${escapeSlack(alert.resolved_by)}`;
      const mins = Math.max(1, Math.round(((alert.resolved_at || Date.now()) - alert.first_seen) / 60000));
      text = `✅ *RESOLVED* \`${escapeSlack(alert.rule_name)}\` on \`${escapeSlack(alert.entity_id)}\` — ${by}, after ~${mins} min\n` +
             `*Incident:* \`${escapeSlack(alert.correlation_id)}\``;
    } else {
      const procs = this.parseSnapshot(alert.process_snapshot).slice(0, 3);
      const forensics = procs.length
        ? procs.map((p, i) => `${i === 0 ? '🚨' : '•'} PID ${p.pid} (${escapeSlack(p.name)}): CPU ${p.cpu_percent}% | RAM ${p.memory_mb} MB`).join('\n')
        : 'No snapshot captured';
      text = `🚨 *${escapeSlack(alert.severity.toUpperCase())}* \`${escapeSlack(alert.rule_name)}\` on \`${escapeSlack(alert.entity_id)}\`\n` +
             `*Summary:* ${escapeSlack(alert.summary)}\n` +
             `*Incident:* \`${escapeSlack(alert.correlation_id)}\` · detector: ${escapeSlack(alert.detector)}\n\n` +
             `*Top processes at fire time:*\n\`\`\`${forensics}\`\`\``;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Slack ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return 'sent';
  }

  async sendEmail(alert, event) {
    const host = this.getSetting('smtp_host', 'SMTP_HOST');
    const port = parseInt(this.getSetting('smtp_port', 'SMTP_PORT') || '587', 10);
    const user = this.getSetting('smtp_user', 'SMTP_USER');
    const pass = this.getSetting('smtp_pass', 'SMTP_PASS');
    const to = this.getSetting('alert_email_to', 'ALERT_EMAIL_TO');
    if (!host || !user || !to) return 'skipped';

    const color = event === 'resolved' ? '#16a34a' : alert.severity === 'critical' ? '#ef4444' : '#f59e0b';
    const procs = this.parseSnapshot(alert.process_snapshot);
    const table = procs.length && event === 'firing'
      ? `<h3 style="font-size:14px">Top processes at fire time</h3>
         <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:monospace">
           <tr style="text-align:left;background:#f9fafb"><th>PID</th><th>Process</th><th>CPU %</th><th>RAM</th><th>User</th></tr>
           ${procs.map((p) => `<tr><td>${escapeHtml(p.pid)}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.cpu_percent)}%</td><td>${escapeHtml(p.memory_mb)} MB</td><td>${escapeHtml(p.user)}</td></tr>`).join('')}
         </table>`
      : '';
    const title = event === 'resolved' ? `RESOLVED: ${alert.rule_name}` : `${alert.severity.toUpperCase()}: ${alert.rule_name}`;

    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465, auth: { user, pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    await transporter.sendMail({
      from: `"SentinelOps" <${user}>`,
      to,
      subject: `[SentinelOps] ${title} on ${alert.entity_id}`,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;padding:20px;background:#f3f4f6">
        <div style="max-width:620px;margin:auto;background:#fff;padding:24px;border-radius:8px;border-left:6px solid ${color}">
          <h2 style="margin-top:0;font-size:18px">${escapeHtml(title)}</h2>
          <p><b>Entity:</b> ${escapeHtml(alert.entity_id)}</p>
          <p><b>Incident:</b> <code>${escapeHtml(alert.correlation_id)}</code></p>
          <p><b>Summary:</b> ${escapeHtml(alert.summary)}</p>
          ${event === 'resolved' ? `<p><b>Resolved by:</b> ${escapeHtml(alert.resolved_by)}</p>` : ''}
          ${table}
          <hr style="border:none;border-top:1px solid #e5e7eb"/>
          <p style="font-size:11px;color:#9ca3af">Sent by SentinelOps</p>
        </div></div>`,
    });
    return 'sent';
  }
}

export const notifier = new NotifierService();
export { escapeHtml };
