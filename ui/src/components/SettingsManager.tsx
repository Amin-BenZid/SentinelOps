import React, { useState, useEffect } from 'react';
import { Bell, Mail, MessageSquare, Clock, Save, Send, Activity } from 'lucide-react';
import { AppSettings } from '../types';

export const SettingsManager: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>({
    slack_webhook_url: '',
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    alert_email_to: '',
    quiet_hours_enabled: 'false',
    quiet_hours_start: '22',
    quiet_hours_end: '7',
    anomaly_detection_enabled: 'true'
  });
  // secrets are write-only: the API only tells us whether one is stored
  const [secretsSet, setSecretsSet] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [testingSlack, setTestingSlack] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) setSettings((prev) => ({ ...prev, ...data.settings }));
        if (data.secrets_set) setSecretsSet(data.secrets_set);
      })
      .catch(() => {});
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ text: 'Saving settings...', isError: false });
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus({ text: 'Settings successfully saved and active!', isError: false });
          setSecretsSet((prev) => ({
            ...prev,
            ...(settings.slack_webhook_url ? { slack_webhook_url: true } : {}),
            ...(settings.smtp_pass ? { smtp_pass: true } : {})
          }));
          setSettings((prev) => ({ ...prev, slack_webhook_url: '', smtp_pass: '' }));
        } else {
          setStatus({ text: data.error || 'Failed to save settings', isError: true });
        }
        setTimeout(() => setStatus(null), 4000);
      })
      .catch((err) => setStatus({ text: err.message, isError: true }));
  };

  const handleTestSlack = async () => {
    if (!settings.slack_webhook_url && !secretsSet.slack_webhook_url) {
      setStatus({ text: 'Please enter a Slack Webhook URL first.', isError: true });
      return;
    }

    setTestingSlack(true);
    setStatus(null);

    try {
      const res = await fetch('/api/test/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // blank = use the stored (write-only) webhook
        body: JSON.stringify({ webhook_url: settings.slack_webhook_url || undefined })
      });
      const data = await res.json();

      if (res.ok) {
        setStatus({ text: 'Payload successfully received by Slack channel!', isError: false });
      } else {
        setStatus({ text: `Slack Error: ${data.error}`, isError: true });
      }
    } catch (err: any) {
      setStatus({ text: `Failed to reach server: ${err.message}`, isError: true });
    } finally {
      setTestingSlack(false);
    }
  };

  return (
    <div className="gh-box" style={{ maxWidth: 760 }}>
      <div className="gh-box-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bell size={16} /> Notifications & settings
        </span>
      </div>

      <div className="gh-box-body">
        {status && (
          <div style={{ color: status.isError ? 'var(--color-danger-fg)' : 'var(--color-success-fg)', fontWeight: 600, marginBottom: 16, fontSize: '0.875rem' }}>
            {status.text}
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Slack Webhook Section */}
          <div>
            <h3 style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MessageSquare size={16} color="var(--color-success-fg)" /> Slack Incoming Webhook
            </h3>
            <label style={labelStyle}>Webhook Payload URL</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="url"
                placeholder={secretsSet.slack_webhook_url ? '•••••• saved (type a new URL to replace)' : 'https://hooks.slack.com/services/T.../B.../...'}
                value={settings.slack_webhook_url || ''}
                onChange={(e) => setSettings({ ...settings, slack_webhook_url: e.target.value })}
                className="gh-input mono"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={handleTestSlack}
                disabled={testingSlack}
                className="gh-btn"
              >
                <Send size={13} /> {testingSlack ? 'Sending...' : 'Test Webhook'}
              </button>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-muted)' }} />

          {/* SMTP Email Alerts Section */}
          <div>
            <h3 style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Mail size={16} color="var(--color-accent-fg)" /> SMTP Mail Service
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>SMTP Host</label>
                <input
                  type="text"
                  placeholder="smtp.gmail.com"
                  value={settings.smtp_host || ''}
                  onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                  className="gh-input"
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>
              <div>
                <label style={labelStyle}>Port</label>
                <input
                  type="text"
                  placeholder="587"
                  value={settings.smtp_port || ''}
                  onChange={(e) => setSettings({ ...settings, smtp_port: e.target.value })}
                  className="gh-input mono"
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
              <div>
                <label style={labelStyle}>Username / Auth Email</label>
                <input
                  type="text"
                  placeholder="alerts@company.com"
                  value={settings.smtp_user || ''}
                  onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                  className="gh-input"
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>
              <div>
                <label style={labelStyle}>Password / App Secret</label>
                <input
                  type="password"
                  placeholder={secretsSet.smtp_pass ? '•••••• saved (leave blank to keep)' : 'App password'}
                  value={settings.smtp_pass || ''}
                  onChange={(e) => setSettings({ ...settings, smtp_pass: e.target.value })}
                  className="gh-input"
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>On-Call Recipient Email</label>
              <input
                type="email"
                placeholder="devops-oncall@company.com"
                value={settings.alert_email_to || ''}
                onChange={(e) => setSettings({ ...settings, alert_email_to: e.target.value })}
                className="gh-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-muted)' }} />

          {/* Quiet Hours */}
          <div>
            <h3 style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Clock size={16} color="var(--color-attention-fg)" /> Quiet Hours Policy
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="checkbox"
                id="qh"
                checked={settings.quiet_hours_enabled === 'true'}
                onChange={(e) => setSettings({ ...settings, quiet_hours_enabled: e.target.checked ? 'true' : 'false' })}
              />
              <label htmlFor="qh" style={{ fontSize: '0.85rem' }}>Suppress warning-level notifications during quiet hours</label>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div>
                <label style={labelStyle}>Start Hour (0-23)</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={settings.quiet_hours_start || '22'}
                  onChange={(e) => setSettings({ ...settings, quiet_hours_start: e.target.value })}
                  className="gh-input mono"
                  style={{ width: 80, marginTop: 4 }}
                />
              </div>
              <div>
                <label style={labelStyle}>End Hour (0-23)</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={settings.quiet_hours_end || '7'}
                  onChange={(e) => setSettings({ ...settings, quiet_hours_end: e.target.value })}
                  className="gh-input mono"
                  style={{ width: 80, marginTop: 4 }}
                />
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-muted)' }} />

          {/* Anomaly detection */}
          <div>
            <h3 style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Activity size={16} color="var(--color-accent-fg)" /> Statistical Anomaly Detection
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="anomaly"
                checked={settings.anomaly_detection_enabled !== 'false'}
                onChange={(e) => setSettings({ ...settings, anomaly_detection_enabled: e.target.checked ? 'true' : 'false' })}
              />
              <label htmlFor="anomaly" style={{ fontSize: '0.85rem' }}>
                Raise a warning when a metric leaves its rolling baseline (z-score), even without a threshold rule
              </label>
            </div>
          </div>

          <div>
            <button type="submit" className="gh-btn gh-btn-primary">
              <Save size={14} /> Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-fg-muted)',
  fontWeight: 600
};