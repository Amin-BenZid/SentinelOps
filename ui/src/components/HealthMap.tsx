import React from 'react';
import { Server, Box, Globe, CheckCircle2, AlertTriangle, XCircle, MinusCircle, ChevronRight } from 'lucide-react';
import { ServiceHealth } from '../types';
import { formatValue, timeAgo } from '../utils/format';

interface HealthMapProps {
  services: ServiceHealth[];
  latestMetricValues: Record<string, number>;
  now: number;
  onOpenEntity?: (entityId: string, source: string) => void;
}

const STATUS = {
  healthy: { label: 'Healthy', icon: CheckCircle2, cls: 'st-healthy' },
  warning: { label: 'Warning', icon: AlertTriangle, cls: 'st-warning' },
  critical: { label: 'Critical', icon: XCircle, cls: 'st-critical' },
  stale: { label: 'No data', icon: MinusCircle, cls: 'st-stale' },
} as const;

const ORDER = { critical: 0, warning: 1, healthy: 2, stale: 3 } as const;

export const HealthMap: React.FC<HealthMapProps> = ({ services, latestMetricValues, now, onOpenEntity }) => {
  const sorted = [...services].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id));
  const counts = services.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {});

  return (
    <section className="gh-box" aria-label="Monitored entities">
      <div className="gh-box-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Server size={16} /> Monitored entities
        </span>
        <span className="health-summary">
          {(['critical', 'warning', 'healthy', 'stale'] as const).filter((k) => counts[k]).map((k) => (
            <span key={k} className={`summary-chip ${STATUS[k].cls}`}>{counts[k]} {STATUS[k].label.toLowerCase()}</span>
          ))}
        </span>
      </div>

      <div className="gh-box-body">
        {services.length === 0 ? (
          <p className="muted">Waiting for the first metrics from the agent…</p>
        ) : (
          <div className="entity-grid">
            {sorted.map((svc) => {
              const st = STATUS[svc.status];
              const Icon = st.icon;
              const isDocker = svc.source === 'docker';
              const cpu = latestMetricValues[`${svc.id}:${isDocker ? 'docker_cpu_percent' : 'cpu_percent'}`];
              const mem = latestMetricValues[`${svc.id}:${isDocker ? 'docker_memory_percent' : 'memory_percent'}`];
              const SourceIcon = isDocker ? Box : svc.source === 'prometheus' ? Globe : Server;
              const clickable = Boolean(onOpenEntity) && isDocker;
              return (
                <div
                  key={svc.id}
                  className={`entity-card ${st.cls} ${clickable ? 'clickable' : ''}`}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onOpenEntity!(svc.id, svc.source) : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onOpenEntity!(svc.id, svc.source); } : undefined}
                  title={clickable ? `Open logs and actions for ${svc.id}` : undefined}
                >
                  <div className="entity-top">
                    <span className="entity-source"><SourceIcon size={13} /> {svc.source}</span>
                    <span className="entity-status"><Icon size={14} /> {st.label}</span>
                  </div>
                  <div className="entity-name mono" title={svc.id}>{svc.id}</div>
                  <div className="entity-metrics mono">
                    {svc.status === 'stale' ? (
                      <span>last seen {timeAgo(svc.last_seen, now)}</span>
                    ) : (
                      <>
                        {cpu !== undefined && <span>CPU <b>{formatValue(cpu, 'cpu_percent')}</b></span>}
                        {mem !== undefined && <span>Mem <b>{formatValue(mem, 'memory_percent')}</b></span>}
                      </>
                    )}
                  </div>
                  <div className="entity-bottom">
                    <span className={svc.alertCount > 0 ? 'entity-alerts' : ''}>
                      {svc.alertCount > 0 ? `${svc.alertCount} firing` : svc.status === 'stale' ? 'not reporting' : 'no open alerts'}
                    </span>
                    {clickable && <span className="entity-link">Logs <ChevronRight size={13} /></span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
