import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import { GripVertical, Trash2, Maximize2, Minimize2, Plus, RotateCcw } from 'lucide-react';
import { DashboardWidget } from '../types';
import { AddWidgetModal } from './AddWidgetModal';

interface CustomizableDashboardProps {
  isEditMode: boolean;
  availableEntities: string[];
  availableMetrics: string[];
  latestMetricValues: Record<string, number>;
  theme: 'dark' | 'light';
}

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'w_cpu', title: 'Host CPU Utilization', type: 'area', entity: 'local-host', metric: 'cpu_percent', width: 'half', color: '#1f6feb', unit: '%' },
  { id: 'w_ram', title: 'Host Memory Usage', type: 'area', entity: 'local-host', metric: 'memory_percent', width: 'half', color: '#238636', unit: '%' },
  { id: 'w_kpi_cpu', title: 'Current CPU Load', type: 'stat', entity: 'local-host', metric: 'cpu_percent', width: 'half', color: '#d29922', unit: '%' },
  { id: 'w_dist', title: 'Resource Breakdown by Entity', type: 'donut', entity: 'local-host', metric: 'memory_percent', width: 'half', color: '#8957e5', unit: '%' }
];

export const CustomizableDashboard: React.FC<CustomizableDashboardProps> = ({
  isEditMode,
  availableEntities,
  availableMetrics,
  latestMetricValues,
  theme
}) => {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(() => {
    const saved = localStorage.getItem('sentinelops_dashboard_layout');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_WIDGETS;
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [widgetHistories, setWidgetHistories] = useState<Record<string, { timestamp: number | string; metric_value: number }[]>>({});

  useEffect(() => {
    localStorage.setItem('sentinelops_dashboard_layout', JSON.stringify(widgets));
  }, [widgets]);

  // Initial REST fetch
  useEffect(() => {
    widgets.forEach((w) => {
      fetch(`/api/metrics/history?entity=${w.entity}&metric=${w.metric}&limit=30`)
        .then((res) => res.json())
        .then((resData) => {
          if (resData.data) {
            setWidgetHistories((prev) => ({ ...prev, [w.id]: resData.data }));
          }
        })
        .catch(() => {});
    });
  }, [widgets]);

  // Real-time tick update
  useEffect(() => {
    widgets.forEach((w) => {
      const key = `${w.entity}:${w.metric}`;
      if (latestMetricValues[key] !== undefined) {
        setWidgetHistories((prev) => {
          const current = prev[w.id] || [];
          return {
            ...prev,
            [w.id]: [
              ...current.slice(-29),
              {
                timestamp: Date.now(),
                metric_value: latestMetricValues[key]
              }
            ]
          };
        });
      }
    });
  }, [latestMetricValues, widgets]);

  const handleDragStart = (index: number) => {
    setDraggedIdx(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIdx === null || draggedIdx === targetIndex) return;
    const updated = [...widgets];
    const [moved] = updated.splice(draggedIdx, 1);
    updated.splice(targetIndex, 0, moved);
    setWidgets(updated);
    setDraggedIdx(null);
  };

  const handleToggleWidth = (id: string) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, width: w.width === 'half' ? 'full' : 'half' } : w))
    );
  };

  const handleDeleteWidget = (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  };

  const handleReset = () => {
    if (confirm('Reset dashboard to default GitHub layout?')) {
      setWidgets(DEFAULT_WIDGETS);
    }
  };

  const tooltipBg = theme === 'dark' ? '#161b22' : '#ffffff';
  const tooltipBorder = theme === 'dark' ? '#30363d' : '#d0d7de';
  const tooltipText = theme === 'dark' ? '#e6edf3' : '#1f2328';

  return (
    <div>
      {/* GitHub Edit Banner */}
      {isEditMode && (
        <div
          style={{
            backgroundColor: 'var(--color-accent-subtle)',
            border: '1px dashed var(--color-accent-fg)',
            borderRadius: 6,
            padding: '10px 16px',
            marginBottom: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12
          }}
        >
          <div style={{ fontSize: '0.85rem', color: 'var(--color-fg-default)' }}>
            <strong>Customizing Layout:</strong> Drag cards to rearrange, toggle full/half span, or append telemetry widgets.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setIsModalOpen(true)} className="gh-btn gh-btn-primary">
              <Plus size={14} /> Add Widget
            </button>
            <button onClick={handleReset} className="gh-btn">
              <RotateCcw size={14} /> Reset Layout
            </button>
          </div>
        </div>
      )}

      {/* Grid of Widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {widgets.map((widget, index) => {
          const history = widgetHistories[widget.id] || [];
          const currentVal = history.length > 0 ? history[history.length - 1].metric_value : 0;

          return (
            <div
              key={widget.id}
              draggable={isEditMode}
              onDragStart={() => handleDragStart(index)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(index)}
              className="gh-box"
              style={{
                gridColumn: widget.width === 'full' ? 'span 2' : 'span 1',
                border: `1px solid ${isEditMode ? 'var(--color-accent-fg)' : 'var(--color-border-default)'}`,
                cursor: isEditMode ? 'grab' : 'default',
                opacity: draggedIdx === index ? 0.35 : 1,
                marginBottom: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: 220
              }}
            >
              {/* Header */}
              <div className="gh-box-header" style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isEditMode && <GripVertical size={16} color="var(--color-fg-muted)" />}
                  <div>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{widget.title}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)', marginLeft: 8 }} className="mono">
                      {widget.entity} · {widget.metric}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isEditMode ? (
                    <>
                      <button onClick={() => handleToggleWidth(widget.id)} className="gh-btn" style={{ padding: 4 }}>
                        {widget.width === 'full' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                      </button>
                      <button onClick={() => handleDeleteWidget(widget.id)} className="gh-btn gh-btn-danger" style={{ padding: 4 }}>
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <span className="mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: widget.color }}>
                      {currentVal.toFixed(1)} {widget.unit}
                    </span>
                  )}
                </div>
              </div>

              {/* Chart Body */}
              <div style={{ padding: 12, height: 140, width: '100%' }}>
                {widget.type === 'area' && (
                  <ResponsiveContainer>
                    <AreaChart data={history.map((h) => ({ time: new Date(h.timestamp).toLocaleTimeString(), val: h.metric_value }))}>
                      <defs>
                        <linearGradient id={`grad_${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={widget.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={widget.color} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="time" hide />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip
                        contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: 6, color: tooltipText, fontSize: '0.75rem' }}
                        formatter={(val: number) => [`${Number(val).toFixed(1)} ${widget.unit}`, 'Telemetry']}
                      />
                      <Area type="monotone" dataKey="val" stroke={widget.color} strokeWidth={2} fill={`url(#grad_${widget.id})`} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}

                {widget.type === 'bar' && (
                  <ResponsiveContainer>
                    <BarChart data={history.slice(-10).map((h, i) => ({ step: `#${i + 1}`, val: h.metric_value }))}>
                      <XAxis dataKey="step" hide />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip
                        contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: 6, color: tooltipText, fontSize: '0.75rem' }}
                        formatter={(val: number) => [`${Number(val).toFixed(1)} ${widget.unit}`, 'Value']}
                      />
                      <Bar dataKey="val" fill={widget.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {widget.type === 'donut' && (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Used', value: currentVal },
                          { name: 'Available', value: Math.max(0, 100 - currentVal) }
                        ]}
                        innerRadius={36}
                        outerRadius={50}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        <Cell fill={widget.color} />
                        <Cell fill="var(--color-border-default)" />
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: 6, color: tooltipText, fontSize: '0.75rem' }}
                        formatter={(val: number) => [`${Number(val).toFixed(1)} ${widget.unit}`, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}

                {widget.type === 'stat' && (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="mono" style={{ fontSize: '2.5rem', fontWeight: 800, color: widget.color }}>
                      {currentVal.toFixed(1)} <span style={{ fontSize: '1.2rem', fontWeight: 500 }}>{widget.unit}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)', marginTop: 4 }}>
                      Target limit: 85% · Status: {currentVal > 85 ? '🚨 Breached' : 'Passing checks'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AddWidgetModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={(newWidget) => setWidgets((prev) => [...prev, newWidget])}
        availableEntities={availableEntities}
        availableMetrics={availableMetrics}
      />
    </div>
  );
};