import React, { useEffect, useMemo, useState } from 'react';
import { X, Eye, CheckCheck, RotateCcw, Terminal, Copy, Download, Check } from 'lucide-react';
import { Alert, ProcessInfo, SeriesPoint } from '../types';
import { explainAlert } from '../utils/diagnosis';
import { buildTimeline, generatePostMortemMarkdown } from '../utils/postMortemGenerator';
import { clock, duration, timeAgo } from '../utils/format';
import { MetricChart } from './MetricChart';
import { SeverityPill } from './IncidentFeed';

type Tab = 'overview' | 'timeline' | 'processes' | 'postmortem';

interface AlertDrawerProps {
  alert: Alert | null;
  allAlerts: Alert[];
  now: number;
  busy: boolean;
  isContainer: boolean;
  onClose: () => void;
  onUpdateStatus: (alert: Alert, status: 'active' | 'acknowledged' | 'resolved') => void;
  onOpenContainer: (entity: string) => void;
  onToast: (text: string, type?: 'success' | 'warning' | 'error') => void;
}

export const AlertDrawer: React.FC<AlertDrawerProps> = ({
  alert, allAlerts, now, busy, isContainer, onClose, onUpdateStatus, onOpenContainer, onToast
}) => {
  const [tab, setTab] = useState<Tab>('overview');
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setTab('overview'); }, [alert?.id]);

  // metric context: the last hour of the alert's metric, with its expected band
  useEffect(() => {
    if (!alert) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/metrics/history?entity=${encodeURIComponent(alert.entity_id)}&metric=${encodeURIComponent(alert.metric_name)}&range=1h`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setSeries(d.data || []); })
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [alert?.id, alert?.entity_id, alert?.metric_name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const processes: ProcessInfo[] = useMemo(() => {
    try { return JSON.parse(alert?.process_snapshot || '[]'); } catch { return []; }
  }, [alert?.process_snapshot]);

  if (!alert) return null;

  const explanation = explainAlert(alert);
  const timeline = buildTimeline(alert, allAlerts);
  const postMortem = generatePostMortemMarkdown(alert, allAlerts);
  const firing = alert.state === 'firing';
  const threshold = alert.evidence?.detector === 'threshold' ? alert.evidence.threshold ?? null : null;

  const copyPostMortem = async () => {
    try {
      await navigator.clipboard.writeText(postMortem);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onToast('Clipboard not available — use Download instead', 'warning');
    }
  };

  const downloadPostMortem = () => {
    const blob = new Blob([postMortem], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `postmortem-${alert.correlation_id || alert.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const facts: [string, React.ReactNode][] = [
    ['Incident', <span className="mono">{alert.correlation_id}</span>],
    ['Detector', alert.detector === 'anomaly' ? 'Statistical anomaly' : 'Threshold rule'],
    ['Metric', <span className="mono">{alert.metric_name}</span>],
    ['First breach', `${clock(alert.first_seen)} (${timeAgo(alert.first_seen, now)})`],
    ['Fired', clock(alert.fired_at)],
    [firing ? 'Open for' : 'Lasted', duration(alert.first_seen, alert.resolved_at ?? now)],
    ['Evaluations in breach', String(alert.hit_count)],
    ['Acknowledged', alert.acked_by ? `${alert.acked_by} at ${clock(alert.acked_at!)}` : '—'],
    ['Resolved', alert.resolved_at ? `${alert.resolved_by === 'auto' ? 'automatically' : alert.resolved_by} at ${clock(alert.resolved_at)}` : '—'],
  ];

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Alert ${alert.rule_name}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <SeverityPill severity={alert.severity} muted={!firing} />
              <span className={`gh-badge ${firing ? (alert.acked_by ? 'badge-accent' : 'gh-badge-danger') : 'badge-neutral'}`}>
                {firing ? (alert.acked_by ? 'Acknowledged' : 'Firing') : 'Resolved'}
              </span>
            </div>
            <h2 className="drawer-title mono">{alert.rule_name}</h2>
            <div className="muted">on <span className="mono">{alert.entity_id}</span></div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        </header>

        <div className="drawer-actions">
          {firing && !alert.acked_by && (
            <button className="gh-btn" disabled={busy} onClick={() => onUpdateStatus(alert, 'acknowledged')}><Eye size={14} /> Acknowledge</button>
          )}
          {firing && alert.acked_by && (
            <button className="gh-btn" disabled={busy} onClick={() => onUpdateStatus(alert, 'active')}>Remove acknowledgement</button>
          )}
          {firing && (
            <button className="gh-btn gh-btn-primary" disabled={busy} onClick={() => onUpdateStatus(alert, 'resolved')}><CheckCheck size={14} /> Resolve</button>
          )}
          {!firing && (
            <button className="gh-btn" disabled={busy} onClick={() => onUpdateStatus(alert, 'active')}><RotateCcw size={14} /> Reopen</button>
          )}
          {isContainer && (
            <button className="gh-btn" onClick={() => onOpenContainer(alert.entity_id)}><Terminal size={14} /> Container logs</button>
          )}
        </div>

        <nav className="drawer-tabs" role="tablist">
          {([
            ['overview', 'Overview'],
            ['timeline', 'Timeline'],
            ['processes', `Processes${processes.length ? ` (${processes.length})` : ''}`],
            ['postmortem', 'Post-mortem'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="drawer-body">
          {tab === 'overview' && (
            <>
              <section className="panel">
                <h3>Why it fired</h3>
                <p className="why-headline">{explanation.headline}</p>
                <ul className="why-list">{explanation.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </section>

              <section className="panel">
                <h3>{alert.metric_name} · last hour</h3>
                <MetricChart data={series} metric={alert.metric_name} color="#2f81f7" height={170} threshold={threshold} />
                <p className="muted small" style={{ marginTop: 6 }}>
                  Shaded area = expected range learned by the anomaly detector · red dots = anomalous samples
                  {threshold !== null ? ' · dashed line = rule threshold' : ''}
                </p>
              </section>

              <section className="panel">
                <h3>Details</h3>
                <dl className="facts">
                  {facts.map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </section>
            </>
          )}

          {tab === 'timeline' && (
            <ol className="timeline">
              {timeline.map((ev, i) => (
                <li key={i} className={`tl-${ev.type}`}>
                  <span className="tl-time mono">{ev.time}</span>
                  <div>
                    <div className="tl-title">{ev.title}</div>
                    <div className="muted">{ev.desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {tab === 'processes' && (
            processes.length === 0 ? (
              <p className="muted">No process snapshot was captured for this alert.</p>
            ) : (
              <>
                <p className="muted small" style={{ marginBottom: 8 }}>Top processes on the host when the alert fired ({clock(alert.fired_at)}).</p>
                <table className="data-table mono">
                  <thead><tr><th>PID</th><th>Process</th><th>User</th><th className="num">CPU</th><th className="num">RAM</th></tr></thead>
                  <tbody>
                    {processes.map((p, i) => (
                      <tr key={p.pid} className={i === 0 ? 'top-row' : ''}>
                        <td>{p.pid}</td><td>{p.name}</td><td>{p.user}</td>
                        <td className="num">{p.cpu_percent}%</td><td className="num">{p.memory_mb} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          )}

          {tab === 'postmortem' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className="gh-btn" onClick={copyPostMortem}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy markdown'}</button>
                <button className="gh-btn" onClick={downloadPostMortem}><Download size={14} /> Download .md</button>
              </div>
              <pre className="md-preview">{postMortem}</pre>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
