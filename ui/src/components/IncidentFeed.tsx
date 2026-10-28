import React, { useMemo, useState } from 'react';
import { Search, ChevronRight, CheckCheck, Eye, Layers } from 'lucide-react';
import { Alert } from '../types';
import { SEVERITY_RANK, timeAgo } from '../utils/format';

type StatusFilter = 'open' | 'acknowledged' | 'resolved' | 'all';
type SeverityFilter = 'all' | 'critical' | 'warning';

interface IncidentFeedProps {
  alerts: Alert[];
  now: number;
  selectedId: number | null;
  busyId: number | null;
  onSelect: (alert: Alert) => void;
  onUpdateStatus: (alert: Alert, status: 'active' | 'acknowledged' | 'resolved') => void;
}

interface Incident {
  id: string;
  entity: string;
  alerts: Alert[];
  open: boolean;
  severity: 'critical' | 'warning';
  started: number;
  lastSeen: number;
}

export function groupIncidents(alerts: Alert[]): Incident[] {
  const map = new Map<string, Alert[]>();
  for (const a of alerts) {
    const key = a.correlation_id || `alert-${a.id}`;
    map.set(key, [...(map.get(key) || []), a]);
  }
  const incidents: Incident[] = Array.from(map.entries()).map(([id, list]) => {
    const sorted = [...list].sort((a, b) => (b.state === 'firing' ? 1 : 0) - (a.state === 'firing' ? 1 : 0)
      || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.first_seen - b.first_seen);
    const open = list.some((a) => a.state === 'firing');
    const pool = open ? list.filter((a) => a.state === 'firing') : list;
    return {
      id,
      entity: list[0].entity_id,
      alerts: sorted,
      open,
      severity: pool.some((a) => a.severity === 'critical') ? 'critical' : 'warning',
      started: Math.min(...list.map((a) => a.first_seen)),
      lastSeen: Math.max(...list.map((a) => a.last_seen)),
    };
  });
  return incidents.sort((a, b) => Number(b.open) - Number(a.open)
    || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.lastSeen - a.lastSeen);
}

const StatusBadge: React.FC<{ alert: Alert }> = ({ alert }) => {
  if (alert.state === 'resolved') {
    return (
      <span className="gh-badge badge-neutral">
        {alert.resolved_by === 'auto' ? 'Auto-resolved' : `Resolved by ${alert.resolved_by}`}
      </span>
    );
  }
  if (alert.acked_by) return <span className="gh-badge badge-accent"><Eye size={11} /> {alert.acked_by}</span>;
  return <span className="gh-badge gh-badge-danger">Firing</span>;
};

export const SeverityPill: React.FC<{ severity: 'critical' | 'warning'; muted?: boolean }> = ({ severity, muted }) => (
  <span className={`sev-pill sev-${severity} ${muted ? 'sev-muted' : ''}`}>
    <span className="sev-dot" aria-hidden="true" />
    {severity === 'critical' ? 'Critical' : 'Warning'}
  </span>
);

export const IncidentFeed: React.FC<IncidentFeedProps> = ({ alerts, now, selectedId, busyId, onSelect, onUpdateStatus }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  const counts = useMemo(() => ({
    open: alerts.filter((a) => a.state === 'firing').length,
    acknowledged: alerts.filter((a) => a.state === 'firing' && a.acked_by).length,
    resolved: alerts.filter((a) => a.state === 'resolved').length,
    all: alerts.length,
  }), [alerts]);

  const incidents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = alerts.filter((a) => {
      if (status === 'open' && a.state !== 'firing') return false;
      if (status === 'acknowledged' && !(a.state === 'firing' && a.acked_by)) return false;
      if (status === 'resolved' && a.state !== 'resolved') return false;
      if (severity !== 'all' && a.severity !== severity) return false;
      if (!q) return true;
      return [a.rule_name, a.entity_id, a.summary, a.correlation_id].some((f) => f?.toLowerCase().includes(q));
    });
    return groupIncidents(visible);
  }, [alerts, query, status, severity]);

  return (
    <section className="gh-box" aria-label="Incidents">
      <div className="gh-box-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Layers size={16} /> Incidents
        </span>
        <span className={`gh-badge ${counts.open > 0 ? 'gh-badge-danger' : 'gh-badge-success'}`}>
          {counts.open > 0 ? `${counts.open} firing` : 'All clear'}
        </span>
      </div>

      <div className="feed-toolbar">
        <div className="search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search rule, entity, message, incident id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="gh-input"
            aria-label="Search incidents"
          />
        </div>
        <div className="toolbar-row">
          <div className="segmented" role="tablist" aria-label="Status filter">
            {(['open', 'acknowledged', 'resolved', 'all'] as StatusFilter[]).map((s) => (
              <button key={s} role="tab" aria-selected={status === s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Firing' : s[0].toUpperCase() + s.slice(1)} <span className="count">{counts[s]}</span>
              </button>
            ))}
          </div>
          <select className="gh-select select-sm" value={severity} onChange={(e) => setSeverity(e.target.value as SeverityFilter)} aria-label="Severity filter">
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
          </select>
        </div>
      </div>

      <div className="feed-list">
        {incidents.length === 0 ? (
          <div className="empty">
            <CheckCheck size={22} color="var(--color-success-fg)" />
            <p>{status === 'open' ? 'Nothing is firing.' : 'No incidents match these filters.'}</p>
            <p className="muted">{status === 'open' ? 'Every monitored entity is within its rules and baseline.' : 'Try another status or clear the search.'}</p>
          </div>
        ) : (
          incidents.map((inc) => (
            <div key={inc.id} className={`incident ${inc.open ? 'incident-open' : 'incident-closed'} sev-border-${inc.severity}`}>
              <div className="incident-head">
                <SeverityPill severity={inc.severity} muted={!inc.open} />
                <span className="mono incident-entity">{inc.entity}</span>
                {inc.alerts.length > 1 && <span className="gh-counter">{inc.alerts.length} alerts</span>}
                <span className="muted incident-meta" title={new Date(inc.started).toLocaleString()}>
                  {inc.open ? `started ${timeAgo(inc.started, now)}` : `ended ${timeAgo(inc.lastSeen, now)}`}
                </span>
              </div>

              {inc.alerts.map((a) => (
                <div
                  key={a.id}
                  className={`alert-row ${selectedId === a.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(a)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a); } }}
                  aria-label={`Open details for ${a.rule_name} on ${a.entity_id}`}
                >
                  <div className="alert-row-main">
                    <div className="alert-row-title">
                      <span className="mono">{a.rule_name}</span>
                      {a.detector === 'anomaly' && <span className="gh-badge badge-neutral">anomaly</span>}
                    </div>
                    <div className="alert-row-summary">{a.summary}</div>
                  </div>
                  <div className="alert-row-side">
                    <div className="alert-row-status">
                      <StatusBadge alert={a} />
                      <span className="muted small">{timeAgo(a.state === 'resolved' ? a.resolved_at : a.fired_at, now)}</span>
                    </div>
                    {a.state === 'firing' && (
                      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                        {!a.acked_by && (
                          <button className="gh-btn btn-xs" disabled={busyId === a.id} onClick={() => onUpdateStatus(a, 'acknowledged')}>
                            Ack
                          </button>
                        )}
                        <button className="gh-btn btn-xs" disabled={busyId === a.id} onClick={() => onUpdateStatus(a, 'resolved')}>
                          Resolve
                        </button>
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} className="row-chevron" aria-hidden="true" />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
};
