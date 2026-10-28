import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { GripVertical, Trash2, Maximize2, Minimize2, Plus, RotateCcw } from 'lucide-react';
import { DashboardWidget, MonitoringRule, SeriesPoint, TimeRange } from '../types';
import { AddWidgetModal } from './AddWidgetModal';
import { MetricChart } from './MetricChart';
import { formatValue, metricMeta } from '../utils/format';

interface CustomizableDashboardProps {
  isEditMode: boolean;
  availableEntities: string[];
  availableMetrics: string[];
  latestMetricValues: Record<string, number>;
  range: TimeRange;
}

const STORAGE_KEY = 'sentinelops_dashboard_layout_v2';
const REFRESH_MS = 10_000;

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'w_cpu', title: 'Host CPU', type: 'area', entity: 'local-host', metric: 'cpu_percent', width: 'half', color: '#2f81f7', unit: '%' },
  { id: 'w_ram', title: 'Host memory', type: 'area', entity: 'local-host', metric: 'memory_percent', width: 'half', color: '#3fb950', unit: '%' },
  { id: 'w_top_cpu', title: 'Containers by CPU', type: 'bar', entity: '*', metric: 'docker_cpu_percent', width: 'half', color: '#a371f7', unit: '%' },
  { id: 'w_disk', title: 'Host disk', type: 'stat', entity: 'local-host', metric: 'disk_percent', width: 'half', color: '#d29922', unit: '%' },
];

function loadWidgets(): DashboardWidget[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DashboardWidget[];
      // v0.1 'donut' widgets showed one meaningless slice -> show them as an entity comparison
      return parsed.map((w) => ((w.type as string) === 'donut' ? { ...w, type: 'bar' } : w));
    }
  } catch (e) { /* ignore corrupted layout */ }
  return DEFAULT_WIDGETS;
}

export const CustomizableDashboard: React.FC<CustomizableDashboardProps> = ({
  isEditMode,
  availableEntities,
  availableMetrics,
  latestMetricValues,
  range
}) => {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(loadWidgets);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [series, setSeries] = useState<Record<string, SeriesPoint[]>>({});
  const [rules, setRules] = useState<MonitoringRule[]>([]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets)); } catch (e) { /* storage unavailable */ }
  }, [widgets]);

  // active rules -> threshold lines / KPI targets
  useEffect(() => {
    fetch('/api/rules').then((r) => r.json()).then((d) => setRules(d.rules || [])).catch(() => {});
  }, []);

  // time series for area widgets, refreshed every 10 s (includes the anomaly band)
  const seriesKeys = useMemo(
    () => Array.from(new Set(widgets.filter((w) => w.type === 'area').map((w) => `${w.entity}|${w.metric}`))),
    [widgets]
  );
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      seriesKeys.forEach((key) => {
        const [entity, metric] = key.split('|');
        fetch(`/api/metrics/history?entity=${encodeURIComponent(entity)}&metric=${encodeURIComponent(metric)}&range=${range}`)
          .then((r) => r.json())
          .then((d) => { if (!cancelled && d.data) setSeries((prev) => ({ ...prev, [key]: d.data })); })
          .catch(() => {});
      });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [seriesKeys, range]);

  const thresholdFor = (metric: string) => {
    const r = rules.find((x) => x.is_active && x.metric_name === metric && (x.operator === '>' || x.operator === '>='));
    return r ? Number(r.threshold) : null;
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIdx === null || draggedIdx === targetIndex) return;
    const updated = [...widgets];
    const [moved] = updated.splice(draggedIdx, 1);
    updated.splice(targetIndex, 0, moved);
    setWidgets(updated);
    setDraggedIdx(null);
  };

  const handleReset = () => {
    if (confirm('Reset the dashboard to the default layout?')) setWidgets(DEFAULT_WIDGETS);
  };

  return (
    <div>
      {isEditMode && (
        <div className="edit-banner">
          <span><strong>Editing layout</strong> — drag cards to reorder, resize or remove them, or add a widget.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setIsModalOpen(true)} className="gh-btn gh-btn-primary">
              <Plus size={14} /> Add widget
            </button>
            <button onClick={handleReset} className="gh-btn">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>
      )}

      <div className="widget-grid">
        {widgets.map((widget, index) => {
          const meta = metricMeta(widget.metric);
          const latest = latestMetricValues[`${widget.entity}:${widget.metric}`];
          const threshold = thresholdFor(widget.metric);

          // entity comparison for bar widgets: latest value of this metric on every entity
          const compare = widget.type === 'bar'
            ? Object.entries(latestMetricValues)
                .filter(([k]) => k.endsWith(`:${widget.metric}`))
                .map(([k, v]) => ({ name: k.slice(0, k.length - widget.metric.length - 1), value: v }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 8)
            : [];

          return (
            <div
              key={widget.id}
              draggable={isEditMode}
              onDragStart={() => setDraggedIdx(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className={`gh-box widget ${widget.width === 'full' ? 'widget-full' : ''} ${isEditMode ? 'widget-editing' : ''}`}
              style={{ opacity: draggedIdx === index ? 0.35 : 1 }}
            >
              <div className="gh-box-header widget-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {isEditMode && <GripVertical size={16} color="var(--color-fg-muted)" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="widget-title">{widget.title}</div>
                    <div className="widget-sub mono">
                      {widget.type === 'bar' ? 'all entities' : widget.entity} · {widget.metric}
                    </div>
                  </div>
                </div>

                {isEditMode ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setWidgets((p) => p.map((w) => (w.id === widget.id ? { ...w, width: w.width === 'half' ? 'full' : 'half' } : w)))}
                      className="gh-btn" style={{ padding: 4 }} aria-label="Toggle width"
                    >
                      {widget.width === 'full' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </button>
                    <button onClick={() => setWidgets((p) => p.filter((w) => w.id !== widget.id))} className="gh-btn gh-btn-danger" style={{ padding: 4 }} aria-label="Remove widget">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : widget.type !== 'bar' ? (
                  <span className="widget-value mono" style={{ color: widget.color }}>{formatValue(latest, widget.metric)}</span>
                ) : null}
              </div>

              <div className="widget-body">
                {widget.type === 'area' && (
                  <MetricChart
                    data={series[`${widget.entity}|${widget.metric}`] || []}
                    metric={widget.metric}
                    color={widget.color}
                    threshold={threshold}
                  />
                )}

                {widget.type === 'bar' && (
                  compare.length === 0 ? (
                    <div className="empty-chart" style={{ height: 150 }}>No entity reports {widget.metric}</div>
                  ) : (
                    <div style={{ width: '100%', height: 150 }}>
                      <ResponsiveContainer>
                        <BarChart data={compare} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" domain={meta.percent ? [0, 100] : [0, 'auto']} tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }} stroke="var(--color-border-default)" />
                          <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--color-fg-default)', fontSize: 11 }} stroke="var(--color-border-default)" />
                          <Tooltip
                            cursor={{ fill: 'var(--color-accent-subtle)' }}
                            content={({ active, payload }) =>
                              active && payload && payload.length ? (
                                <div className="chart-tooltip">
                                  <div className="mono">{(payload[0].payload as any).name}</div>
                                  <div style={{ fontWeight: 600 }}>{formatValue(payload[0].value as number, widget.metric)}</div>
                                </div>
                              ) : null
                            }
                          />
                          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                            {compare.map((c) => (
                              <Cell key={c.name} fill={threshold !== null && c.value > threshold ? 'var(--color-danger-fg)' : widget.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )
                )}

                {widget.type === 'stat' && (() => {
                  const breached = threshold !== null && latest !== undefined && latest > threshold;
                  return (
                    <div className="stat">
                      <div className="stat-value mono" style={{ color: breached ? 'var(--color-danger-fg)' : widget.color }}>
                        {formatValue(latest, widget.metric)}
                      </div>
                      {meta.percent && latest !== undefined && (
                        <div className="stat-meter" aria-hidden="true">
                          <div style={{ width: `${Math.min(100, latest)}%`, background: breached ? 'var(--color-danger-fg)' : widget.color }} />
                          {threshold !== null && <span style={{ left: `${Math.min(100, threshold)}%` }} />}
                        </div>
                      )}
                      <div className="stat-caption">
                        {threshold === null
                          ? 'No active rule on this metric'
                          : breached
                            ? `Above rule threshold (${formatValue(threshold, widget.metric)})`
                            : `Below rule threshold (${formatValue(threshold, widget.metric)})`}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      <AddWidgetModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={(w) => setWidgets((prev) => [...prev, w])}
        availableEntities={availableEntities}
        availableMetrics={availableMetrics}
      />
    </div>
  );
};
