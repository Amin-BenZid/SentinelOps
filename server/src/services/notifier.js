import nodemailer from 'nodemailer';
import db from '../db.js';

export class NotifierService {
  getSetting(key, fallbackEnv) {
    try {
      if (db) {
        const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
        if (row && row.value && row.value.trim() !== '') return row.value.trim();
      }
    } catch (e) {}
    return process.env[fallbackEnv] || null;
  }

  isQuietHours() {
    const enabled = this.getSetting('quiet_hours_enabled', 'QUIET_HOURS_ENABLED');
    if (enabled !== 'true' && enabled !== '1') return false;

    const start = parseInt(this.getSetting('quiet_hours_start', 'QUIET_HOURS_START') || '22', 10);
    const end = parseInt(this.getSetting('quiet_hours_end', 'QUIET_HOURS_END') || '7', 10);
    const currentHour = new Date().getHours();

    if (start > end) {
      return currentHour >= start || currentHour < end;
    }
    return currentHour >= start && currentHour < end;
  }

  parseCrimeScene(snapshotJson) {
    if (!snapshotJson) return [];
    try {
      const parsed = JSON.parse(snapshotJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  async dispatch(alert) {
    await this.sendSlack(alert);
    await this.sendEmail(alert);
  }

  async sendSlack(alert) {
    const slackUrl = this.getSetting('slack_webhook_url', 'SLACK_WEBHOOK_URL');

    if (!slackUrl) {
      console.log(`[NOTIFIER DEV] Slack Webhook not configured. Alert: ${alert.summary}`);
      return;
    }

    if (alert.severity === 'warning' && this.isQuietHours()) {
      console.log(`[NOTIFIER] Quiet hours active: suppressed Slack warning for ${alert.rule_name}`);
      return;
    }

    // Parse Crime Scene processes
    const procs = this.parseCrimeScene(alert.process_snapshot);
    let crimeSceneText = 'No snapshot captured';
    if (procs.length > 0) {
      crimeSceneText = procs
        .slice(0, 3)
        .map((p, i) => `${i === 0 ? '🚨 ' : '• '}PID ${p.pid} (${p.name}): CPU ${p.cpu_percent}% | RAM ${p.memory_mb} MB`)
        .join('\n');
    }

    // High-compatibility Slack payload (works with all Slack workspaces)
    const payload = {
      text: `🚨 *SentinelOps Alert: ${alert.severity.toUpperCase()}* on \`${alert.entity_id}\`\n*Rule:* ${alert.rule_name}\n*Summary:* ${alert.summary}\n*Correlation ID:* \`${alert.correlation_id || 'N/A'}\` (Seen: ${alert.hit_count}x)\n\n*📸 Crime Scene Forensics:*\n\`\`\`${crimeSceneText}\`\`\``
    };

    try {
      const res = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const responseBody = await res.text();
      if (!res.ok) {
        console.error(`[!] Slack API rejected payload (${res.status}): ${responseBody}`);
      } else {
        console.log(`[NOTIFIER] ✅ Slack notification delivered successfully for ${alert.rule_name}`);
      }
    } catch (err) {
      console.error('[!] Slack network dispatch failed:', err.message);
    }
  }

  async sendEmail(alert) {
    const smtpHost = this.getSetting('smtp_host', 'SMTP_HOST');
    const smtpPort = parseInt(this.getSetting('smtp_port', 'SMTP_PORT') || '587', 10);
    const smtpUser = this.getSetting('smtp_user', 'SMTP_USER');
    const smtpPass = this.getSetting('smtp_pass', 'SMTP_PASS');
    const recipient = this.getSetting('alert_email_to', 'ALERT_EMAIL_TO');

    if (!smtpHost || !smtpUser || !recipient) {
      console.log(`[NOTIFIER DEV] SMTP not fully configured. Email skipped for ${alert.rule_name}`);
      return;
    }

    if (alert.severity === 'warning' && this.isQuietHours()) {
      console.log(`[NOTIFIER] Quiet hours active: suppressed Email warning for ${alert.rule_name}`);
      return;
    }

    // Format Crime Scene as an HTML Table for Email
    const procs = this.parseCrimeScene(alert.process_snapshot);
    let crimeSceneHtml = '<p style="color: #6b7280; font-size: 13px;">No process snapshot captured.</p>';
    
    if (procs.length > 0) {
      const rows = procs.map((p, idx) => `
        <tr style="background-color: ${idx === 0 ? '#fee2e2' : '#ffffff'}; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 6px 10px; font-family: monospace;">${p.pid}</td>
          <td style="padding: 6px 10px; font-weight: ${idx === 0 ? 'bold' : 'normal'}; font-family: monospace;">${p.name} ${idx === 0 ? '🚨' : ''}</td>
          <td style="padding: 6px 10px; font-family: monospace;">${p.cpu_percent}%</td>
          <td style="padding: 6px 10px; font-family: monospace;">${p.memory_mb} MB</td>
          <td style="padding: 6px 10px; color: #6b7280;">${p.user}</td>
        </tr>
      `).join('');

      crimeSceneHtml = `
        <h3 style="margin-top: 16px; margin-bottom: 8px; font-size: 14px; color: #1f2937;">📸 Crime Scene Process Snapshot (Top Culprits)</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; border: 1px solid #e5e7eb;">
          <thead>
            <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb; color: #4b5563;">
              <th style="padding: 6px 10px;">PID</th>
              <th style="padding: 6px 10px;">Process Name</th>
              <th style="padding: 6px 10px;">CPU %</th>
              <th style="padding: 6px 10px;">RAM</th>
              <th style="padding: 6px 10px;">User</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: `"SentinelOps Alerting" <${smtpUser}>`,
        to: recipient,
        subject: `[${alert.severity.toUpperCase()}] SentinelOps: ${alert.rule_name} on ${alert.entity_id}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; background-color: #f3f4f6;">
            <div style="max-width: 620px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border-left: 6px solid ${alert.severity === 'critical' ? '#ef4444' : '#f59e0b'}; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <h2 style="margin-top: 0; color: #111827; font-size: 18px;">Incident: ${alert.rule_name}</h2>
              <p style="margin: 4px 0; color: #374151;"><strong>Entity:</strong> ${alert.entity_id}</p>
              <p style="margin: 4px 0; color: #374151;"><strong>Severity:</strong> <span style="text-transform: uppercase; font-weight: bold; color: ${alert.severity === 'critical' ? '#ef4444' : '#f59e0b'};">${alert.severity}</span></p>
              <p style="margin: 4px 0; color: #374151;"><strong>Correlation ID:</strong> <code>${alert.correlation_id || 'N/A'}</code></p>
              <p style="margin: 4px 0; color: #374151;"><strong>Summary:</strong> ${alert.summary}</p>
              <p style="margin: 4px 0; color: #374151;"><strong>Total Occurrences:</strong> ${alert.hit_count}x</p>
              
              ${crimeSceneHtml}

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
              <p style="font-size: 11px; color: #9ca3af; margin: 0;">Dispatched automatically by SentinelOps v0.1 Core Engine.</p>
            </div>
          </div>
        `
      });
      console.log(`[NOTIFIER] Sent email alert with Crime Scene to ${recipient}`);
    } catch (err) {
      console.error('[!] SMTP dispatch failed:', err.message);
    }
  }
}

export const notifier = new NotifierService();