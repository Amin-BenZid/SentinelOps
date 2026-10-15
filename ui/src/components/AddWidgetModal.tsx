import React, { useState } from 'react';
import { X, TrendingUp, BarChart2, PieChart as PieIcon, Hash } from 'lucide-react';
import { DashboardWidget, WidgetType } from '../types';

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (widget: DashboardWidget) => void;
  availableEntities: string[];
  availableMetrics: string[];
}

const PRESET_COLORS = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#f85149', '#0969da'];

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
      title: title.trim() || `${entity} · ${metric}`,
      type,
      entity,
      metric,
      width,
      color,
      unit: unit || '%'
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
          <span>Add Telemetry Widget</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-fg-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="gh-box-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Visualization Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 4 }}>
              {[
                { t: 'area' as WidgetType, label: 'Area', icon: TrendingUp },
                { t: 'bar' as WidgetType, label: 'Bar', icon: BarChart2 },
                { t: 'donut' as WidgetType, label: 'Donut', icon: PieIcon },
                { t: 'stat' as WidgetType, label: 'KPI', icon: Hash }
              ].map(({ t, label, icon: Icon }) => (
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
                  <span style={{ fontSize: '0.75rem' }}>{label}</span>
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
              <select value={entity} onChange={(e) => setEntity(e.target.value)} className="gh-select" style={{ width: '100%', marginTop: 4 }}>
                {availableEntities.map((ent) => (
                  <option key={ent} value={ent}>{ent}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Metric</label>
              <select value={metric} onChange={(e) => setMetric(e.target.value)} className="gh-select" style={{ width: '100%', marginTop: 4 }}>
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