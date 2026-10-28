import React from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts';
import { SeriesPoint } from '../types';
import { clock, clockShort, formatValue, metricMeta } from '../utils/format';

interface MetricChartProps {
  data: SeriesPoint[];
  metric: string;
  color: string;
  height?: number;
  /** threshold of an active rule on this metric, drawn as a dashed line */
  threshold?: number | null;
  showBand?: boolean;
}

interface Row {
  t: number;
  value: number;
  band: [number, number] | null;
  anomaly: boolean;
}

/**
 * Time series with the anomaly detector's expected band (shaded), anomalous
 * samples as red dots, an optional rule threshold, and a real time axis.
 */
export const MetricChart: React.FC<MetricChartProps> = ({ data, metric, color, height = 150, threshold, showBand = true }) => {
  const meta = metricMeta(metric);
  // percentages can't leave 0–100, so the expected band is clipped to that range
  const clip = (v: number) => (meta.percent ? Math.min(100, Math.max(0, v)) : Math.max(0, v));
  const rows: Row[] = data.map((p) => ({
    t: Number(p.timestamp),
    value: p.metric_value,
    band:
      showBand && p.lower_bound !== null && p.lower_bound !== undefined && p.upper_bound !== null && p.upper_bound !== undefined
        ? [clip(p.lower_bound), clip(p.upper_bound)]
        : null,
    anomaly: Boolean(p.is_anomaly),
  }));
  const hasBand = rows.some((r) => r.band);

  if (rows.length === 0) {
    return (
      <div className="empty-chart" style={{ height }}>
        No data in this time range yet
      </div>
    );
  }

  // short windows need seconds, otherwise every tick reads the same minute
  const spanMs = rows[rows.length - 1].t - rows[0].t;
  const tick = (ms: number) => (spanMs < 10 * 60_000 ? clock(ms) : clockShort(ms));

  const yDomain: [number | string, number | string] = meta.percent ? [0, 100] : [0, 'auto'];

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`fill-${metric}-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={tick}
            tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
            stroke="var(--color-border-default)"
            minTickGap={50}
          />
          <YAxis
            domain={yDomain}
            allowDataOverflow={meta.percent}
            ticks={meta.percent ? [0, 25, 50, 75, 100] : undefined}
            tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
            stroke="var(--color-border-default)"
            width={46}
            tickFormatter={(v: number) => (meta.unit === '%' ? `${v}%` : `${v}`)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const r = payload[0].payload as Row;
              return (
                <div className="chart-tooltip">
                  <div className="mono muted">{clock(r.t)}</div>
                  <div style={{ fontWeight: 600 }}>{formatValue(r.value, metric)}</div>
                  {r.band && (
                    <div className="muted">
                      expected {formatValue(r.band[0], metric)} – {formatValue(r.band[1], metric)}
                    </div>
                  )}
                  {r.anomaly && <div style={{ color: 'var(--color-danger-fg)', fontWeight: 600 }}>anomaly</div>}
                </div>
              );
            }}
          />
          {hasBand && (
            <Area
              dataKey="band"
              stroke="none"
              fill="var(--color-fg-muted)"
              fillOpacity={0.12}
              isAnimationActive={false}
              connectNulls
              name="Expected range"
            />
          )}
          {threshold !== null && threshold !== undefined && (
            <ReferenceLine
              y={threshold}
              stroke="var(--color-danger-fg)"
              strokeDasharray="4 4"
              label={{ value: `rule ${formatValue(threshold, metric)}`, position: 'insideTopLeft', fill: 'var(--color-danger-fg)', fontSize: 10 }}
            />
          )}
          <Area
            dataKey="value"
            stroke="none"
            fill={`url(#fill-${metric}-${color.replace('#', '')})`}
            isAnimationActive={false}
          />
          <Line
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: any) => {
              const { cx, cy, payload, index } = props;
              if (!payload?.anomaly || cx === undefined || cy === undefined) return <g key={index} />;
              return <circle key={index} cx={cx} cy={cy} r={3.5} fill="var(--color-danger-fg)" stroke="var(--color-canvas-default)" strokeWidth={1} />;
            }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
