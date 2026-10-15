import React from 'react';
import { Server, Box, CheckCircle2, AlertTriangle, XCircle, Terminal } from 'lucide-react';
import { ServiceHealth } from '../types';

interface HealthMapProps {
  services: ServiceHealth[];
  onOpenTerminal?: (entityId: string) => void;
}

export const HealthMap: React.FC<HealthMapProps> = ({ services, onOpenTerminal }) => {
  return (
    <div className="gh-box">
      <div className="gh-box-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Server size={16} color="var(--color-fg-muted)" /> Monitored Infrastructure & Environments
        </span>
        <span className="gh-counter">{services.length} Active</span>
      </div>

      <div className="gh-box-body" style={{ padding: 12 }}>
        {services.length === 0 ? (
          <p style={{ color: 'var(--color-fg-muted)', fontSize: '0.85rem' }}>Probing infrastructure metrics...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {services.map((svc) => (
              <div
                key={svc.id}
                onClick={() => onOpenTerminal?.(svc.id)}
                title={`Click to open terminal & ops for ${svc.id}`}
                style={{
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 6,
                  padding: '10px 14px',
                  backgroundColor: 'var(--color-canvas-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, transform 0.1s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent-fg)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--color-border-default)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {svc.source}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Terminal size={12} color="var(--color-accent-fg)" />
                    {svc.status === 'healthy' && <CheckCircle2 size={14} color="var(--color-success-fg)" />}
                    {svc.status === 'warning' && <AlertTriangle size={14} color="var(--color-attention-fg)" />}
                    {svc.status === 'critical' && <XCircle size={14} color="var(--color-danger-fg)" />}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.875rem' }}>
                  {svc.source === 'docker' ? <Box size={15} color="var(--color-accent-fg)" /> : <Server size={15} color="var(--color-accent-fg)" />}
                  <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {svc.id}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>
                  <span>{svc.alertCount > 0 ? `${svc.alertCount} Issue(s)` : 'Passing checks'}</span>
                  <span style={{ color: 'var(--color-accent-fg)', fontWeight: 500 }}>Ops & Logs &rarr;</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};