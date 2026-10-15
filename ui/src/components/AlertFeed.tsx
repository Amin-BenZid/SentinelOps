import React, { useState, useMemo } from 'react';
import { 
  ShieldAlert, GitCommit, Camera, ChevronDown, ChevronRight, 
  AlertOctagon, CheckCheck, RotateCcw, Search, Terminal, Eye,
  Clock, FileText
} from 'lucide-react';
import { Alert, ProcessInfo } from '../types';
import { buildTimeline, generatePostMortemMarkdown, TimelineEvent } from '../utils/postMortemGenerator';

interface AlertFeedProps {
  alerts: Alert[];
  onRefreshAlerts?: () => void;
  onOpenTerminal?: (entityId: string) => void;
  onShowToast?: (text: string, type: 'success' | 'warning' | 'error') => void;
}

export const AlertFeed: React.FC<AlertFeedProps> = ({ 
  alerts, 
  onRefreshAlerts, 
  onOpenTerminal,
  onShowToast 
}) => {
  const [expandedCrimeId, setExpandedCrimeId] = useState<number | null>(null);
  const [expandedTimelineId, setExpandedTimelineId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'acknowledged' | 'resolved'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [isUpdating, setIsUpdating] = useState<number | null>(null);

  // Status mutation
  const handleUpdateStatus = async (alertId: number, newStatus: 'active' | 'acknowledged' | 'resolved') => {
    setIsUpdating(alertId);
    try {
      const res = await fetch(`/api/alerts/${alertId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        onShowToast?.(`Incident marked as ${newStatus}`, 'success');
        onRefreshAlerts?.();
      } else {
        onShowToast?.('Failed to update incident status', 'error');
      }
    } catch (err: any) {
      onShowToast?.(err.message, 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  // 1-Click Export Post-Mortem to Clipboard
  const handleCopyPostMortem = (alert: Alert) => {
    const md = generatePostMortemMarkdown(alert, alerts);
    navigator.clipboard.writeText(md);
    onShowToast?.(`Post-Mortem for ${alert.correlation_id || alert.rule_name} copied to clipboard!`, 'success');
  };

  // Instant filtering
  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      const matchesSearch = 
        a.rule_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.entity_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.summary.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'all' ? true : a.status === statusFilter;
      const matchesSeverity = severityFilter === 'all' ? true : a.severity === severityFilter;

      return matchesSearch && matchesStatus && matchesSeverity;
    });
  }, [alerts, searchQuery, statusFilter, severityFilter]);

  const activeCount = alerts.filter(a => a.status === 'active').length;

  return (
    <div className="gh-box">
      {/* Box Header */}
      <div className="gh-box-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldAlert size={16} color="var(--color-danger-fg)" /> Security & System Advisories
        </span>
        <span className={`gh-counter ${activeCount > 0 ? 'gh-badge-danger' : ''}`}>
          {activeCount} Active
        </span>
      </div>

      {/* Filter & Search Bar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-default)', display: 'flex', flexDirection: 'column', gap: 8, backgroundColor: 'var(--color-canvas-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} color="var(--color-fg-muted)" style={{ position: 'absolute', left: 8, top: 8 }} />
          <input
            type="text"
            placeholder="Filter by rule, container, or message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="gh-input"
            style={{ width: '100%', paddingLeft: 28, fontSize: '0.75rem', height: 28 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'active', 'acknowledged', 'resolved'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="gh-btn"
                style={{
                  padding: '1px 6px',
                  fontSize: '0.7rem',
                  textTransform: 'capitalize',
                  backgroundColor: statusFilter === s ? 'var(--color-accent-subtle)' : 'transparent',
                  borderColor: statusFilter === s ? 'var(--color-accent-fg)' : 'transparent',
                  color: statusFilter === s ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)'
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'critical', 'warning'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className="gh-btn"
                style={{
                  padding: '1px 6px',
                  fontSize: '0.7rem',
                  textTransform: 'capitalize',
                  backgroundColor: severityFilter === sev ? 'var(--color-btn-hover-bg)' : 'transparent',
                  color: severityFilter === sev ? 'var(--color-fg-default)' : 'var(--color-fg-subtle)'
                }}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Advisories List */}
      <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
        {filteredAlerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-fg-muted)' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 500 }}>No advisories match this criteria</p>
            <p style={{ fontSize: '0.72rem' }}>All systems within active operational thresholds.</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            let processes: ProcessInfo[] = [];
            if (alert.process_snapshot) {
              try {
                processes = JSON.parse(alert.process_snapshot);
              } catch (e) {}
            }
            const isCrimeExpanded = expandedCrimeId === alert.id;
            const isTimelineExpanded = expandedTimelineId === alert.id;
            const isResolved = alert.status === 'resolved';
            const isAcked = alert.status === 'acknowledged';

            const timelineEvents: TimelineEvent[] = isTimelineExpanded ? buildTimeline(alert, alerts) : [];

            return (
              <div
                key={alert.id}
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--color-border-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  opacity: isResolved ? 0.6 : 1,
                  backgroundColor: isAcked ? 'var(--color-accent-subtle)' : 'transparent',
                  transition: 'background-color 0.15s, opacity 0.15s'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertOctagon size={15} color={alert.severity === 'critical' ? 'var(--color-danger-fg)' : 'var(--color-attention-fg)'} />
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{alert.rule_name}</span>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>
                      on {alert.entity_id}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    <span className={`gh-badge ${alert.severity === 'critical' ? 'gh-badge-danger' : 'gh-badge-attention'}`}>
                      {alert.severity}
                    </span>
                    {alert.status !== 'active' && (
                      <span className="gh-badge" style={{ backgroundColor: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-default)' }}>
                        {alert.status}
                      </span>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <p style={{ fontSize: '0.8rem', color: 'var(--color-fg-muted)', margin: 0 }}>
                  {alert.summary}
                </p>

                {/* Correlation ID & Occurrences */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--color-fg-subtle)' }}>
                  <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <GitCommit size={12} /> {alert.correlation_id}
                  </span>
                  <span>Seen: <strong>{alert.hit_count}x</strong></span>
                </div>

                {/* ── ACTION TOOLBAR: SRE FLIGHT RECORDER & OPS ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--color-border-muted)' }}>
                  {/* Left: Forensic + Timeline + Post-Mortem */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {processes.length > 0 && (
                      <button
                        onClick={() => setExpandedCrimeId(isCrimeExpanded ? null : alert.id)}
                        className="gh-btn"
                        style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                      >
                        <Camera size={12} />
                        <span>Crime Scene ({processes.length})</span>
                        {isCrimeExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      </button>
                    )}

                    {/* Flight Recorder Timeline Button */}
                    <button
                      onClick={() => setExpandedTimelineId(isTimelineExpanded ? null : alert.id)}
                      className="gh-btn"
                      style={{
                        fontSize: '0.72rem',
                        padding: '2px 6px',
                        backgroundColor: isTimelineExpanded ? 'var(--color-accent-subtle)' : 'transparent',
                        color: isTimelineExpanded ? 'var(--color-accent-fg)' : 'var(--color-fg-default)'
                      }}
                    >
                      <Clock size={12} />
                      <span>Timeline</span>
                      {isTimelineExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>

                    {/* 1-Click Export Post-Mortem Markdown Button */}
                    <button
                      onClick={() => handleCopyPostMortem(alert)}
                      className="gh-btn"
                      style={{ fontSize: '0.72rem', padding: '2px 6px', color: '#10b981' }}
                      title="Copy GitHub-flavored Markdown Post-Mortem to clipboard"
                    >
                      <FileText size={12} />
                      <span>Post-Mortem (.md)</span>
                    </button>
                  </div>

                  {/* Right: Ops Terminal + Ack / Resolve Lifecycle */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {onOpenTerminal && (
                      <button
                        onClick={() => onOpenTerminal(alert.entity_id)}
                        className="gh-btn"
                        style={{ fontSize: '0.72rem', padding: '2px 6px', color: 'var(--color-accent-fg)' }}
                        title={`Open Ops terminal for ${alert.entity_id}`}
                      >
                        <Terminal size={11} />
                        <span>Terminal</span>
                      </button>
                    )}

                    {!isResolved ? (
                      <>
                        {!isAcked ? (
                          <button
                            disabled={isUpdating === alert.id}
                            onClick={() => handleUpdateStatus(alert.id, 'acknowledged')}
                            className="gh-btn"
                            style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                          >
                            <Eye size={11} /> Ack
                          </button>
                        ) : (
                          <button
                            disabled={isUpdating === alert.id}
                            onClick={() => handleUpdateStatus(alert.id, 'active')}
                            className="gh-btn"
                            style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                          >
                            Un-ack
                          </button>
                        )}

                        <button
                          disabled={isUpdating === alert.id}
                          onClick={() => handleUpdateStatus(alert.id, 'resolved')}
                          className="gh-btn"
                          style={{ fontSize: '0.72rem', padding: '2px 6px', color: 'var(--color-success-fg)' }}
                        >
                          <CheckCheck size={12} /> Resolve
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={isUpdating === alert.id}
                        onClick={() => handleUpdateStatus(alert.id, 'active')}
                        className="gh-btn"
                        style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                      >
                        <RotateCcw size={11} /> Reopen
                      </button>
                    )}
                  </div>
                </div>

                {/* ── VISUAL SRE CAUSALITY TIMELINE DRAWER ── */}
                {isTimelineExpanded && (
                  <div
                    style={{
                      marginTop: 8,
                      backgroundColor: 'var(--color-canvas-inset)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 6,
                      padding: '12px 14px'
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-fg-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={13} /> SRE Flight Recorder Causality Sequence
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 6, borderLeft: '2px solid var(--color-border-default)' }}>
                      {timelineEvents.map((ev, i) => (
                        <div key={i} style={{ position: 'relative', paddingLeft: 14 }}>
                          {/* Circle dot on the vertical line */}
                          <div
                            style={{
                              position: 'absolute',
                              left: -20,
                              top: 2,
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              backgroundColor:
                                ev.type === 'trigger'
                                  ? 'var(--color-danger-fg)'
                                  : ev.type === 'correlate'
                                  ? 'var(--color-accent-fg)'
                                  : ev.type === 'forensic'
                                  ? '#a371f7'
                                  : ev.type === 'resolve'
                                  ? 'var(--color-success-fg)'
                                  : 'var(--color-attention-fg)'
                            }}
                          />
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-fg-subtle)' }}>
                              {ev.time}
                            </span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-fg-default)' }}>
                              {ev.title}
                            </span>
                          </div>
                          <p style={{ fontSize: '0.72rem', color: 'var(--color-fg-muted)', margin: '2px 0 0 0' }}>
                            {ev.desc}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── FORENSIC PROCESS DRAWER ── */}
                {isCrimeExpanded && processes.length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      backgroundColor: 'var(--color-canvas-inset)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 6,
                      padding: 6,
                      overflowX: 'auto'
                    }}
                  >
                    <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse', textAlign: 'left' }} className="mono">
                      <thead>
                        <tr style={{ color: 'var(--color-fg-muted)', borderBottom: '1px solid var(--color-border-default)' }}>
                          <th style={{ padding: 3 }}>PID</th>
                          <th style={{ padding: 3 }}>Process</th>
                          <th style={{ padding: 3 }}>CPU%</th>
                          <th style={{ padding: 3 }}>RAM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {processes.map((p, idx) => (
                          <tr key={idx} style={{ color: idx === 0 ? 'var(--color-danger-fg)' : 'var(--color-fg-default)' }}>
                            <td style={{ padding: 3 }}>{p.pid}</td>
                            <td style={{ padding: 3, fontWeight: idx === 0 ? 600 : 400 }}>{p.name} {idx === 0 && '🚨'}</td>
                            <td style={{ padding: 3 }}>{p.cpu_percent}%</td>
                            <td style={{ padding: 3 }}>{p.memory_mb} MB</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};