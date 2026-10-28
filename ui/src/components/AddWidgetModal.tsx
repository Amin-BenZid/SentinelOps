import React, { useState } from 'react';
import { X, TrendingUp, BarChart2, Hash } from 'lucide-react';
import { metricMeta } from '../utils/format';
import { DashboardWidget, WidgetType } from '../types';

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (widget: DashboardWidget) => void;
  availableEntities: string[];
  availableMetrics: string[];
}

const PRESET_COLORS = ['#2f81f7', '#3fb950', '#d29922', '#a371f7', '#db61a2', '#39c5cf'];

export const AddWidgetModal: React.FC<AddWidgetModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  availableEntities,
  availableMetrics
}) => {
  const [type, setType] = useState<WidgetType>('area');
  const [title, setTitle] = useState('');
  const [entity, setEntity] = useState(availableEntities[0] || 'local-host');
  const [metric, setMetric] = useState(availableMetrics[0] || 'cpu_percent');
  const [width, setWidth] = useState<'half' | 'full'>('half');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [unit, setUnit] = useState('%');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newWidget: DashboardWidget = {
      id: `w_${Date.now()}`,
      title: title.trim() || (type === 'bar' ? `${metricMeta(metric).label} by entity` : `${entity} · ${metricMeta(metric).label}`),
      type,
      entity: type === 'bar' ? '*' : entity,
      metric,
      width,
      color,
      unit: unit || metricMeta(metric).unit
    };
    onAdd(newWidget);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        className="gh-box"
        style={{
          maxWidth: 500,
          width: '100%',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          marginBottom: 0
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gh-box-header">
          <span>Add widget</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--color-fg-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="gh-box-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Visualization Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
              {[
                { t: 'area' as WidgetType, label: 'Time series', hint: 'one entity, with expected range', icon: TrendingUp },
                { t: 'bar' as WidgetType, label: 'Compare', hint: 'latest value on every entity', icon: BarChart2 },
                { t: 'stat' as WidgetType, label: 'KPI', hint: 'current value vs rule', icon: Hash }
              ].map(({ t, label, hint, icon: Icon }) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="gh-btn"
                  style={{
                    backgroundColor: type === t ? 'var(--color-accent-subtle)' : 'var(--color-canvas-subtle)',
                    borderColor: type === t ? 'var(--color-accent-fg)' : 'var(--color-border-default)',
                    color: type === t ? 'var(--color-accent-fg)' : 'var(--color-fg-default)',
                    flexDirection: 'column',
                    padding: 8,
                    gap: 4
                  }}
                >
                  <Icon size={18} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{label}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-fg-muted)', fontWeight: 400, textAlign: 'center' }}>{hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Widget Title</label>
            <input
              type="text"
              placeholder="e.g. CPU Utilization Peak"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="gh-input"
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Entity</label>
              <select value={type === 'bar' ? '*' : entity} disabled={type === 'bar'} onChange={(e) => setEntity(e.target.value)} className="gh-select" style={{ width: '100%', marginTop: 4 }}>
                {type === 'bar' && <option value="*">all entities</option>}
                {availableEntities.map((ent) => (
                  <option key={ent} value={ent}>{ent}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Metric</label>
              <select value={metric} onChange={(e) => { setMetric(e.target.value); setUnit(metricMeta(e.target.value).unit); }} className="gh-select" style={{ width: '100%', marginTop: 4 }}>
                {availableMetrics.map((met) => (
                  <option key={met} value={met}>{met}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Width</label>
              <select value={width} onChange={(e) => setWidth(e.target.value as 'half' | 'full')} className="gh-select" style={{ width: '100%', marginTop: 4 }}>
                <option value="half">Half (1 col)</option>
                <option value="full">Full (2 col)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <input
                type="text"
                placeholder="%"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="gh-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Accent Color</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    backgroundColor: c,
                    border: color === c ? '3px solid var(--color-fg-default)' : '2px solid transparent',
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} className="gh-btn">Cancel</button>
            <button type="submit" className="gh-btn gh-btn-primary">Add Widget</button>
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