import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface MetricSparklineProps {
  title: string;
  unit: string;
  color: string;
  data: { timestamp: number | string; metric_value: number }[];
}

export const MetricSparkline: React.FC<MetricSparklineProps> = ({ title, unit, color, data }) => {
  const formattedData = data.map((d) => ({
    time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    value: Number(d.metric_value.toFixed(1))
  }));

  const currentValue = data.length > 0 ? data[data.length - 1].metric_value.toFixed(1) : '0';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{title}</h3>
        <span style={{ fontSize: '1.25rem', fontWeight: 700, color }}>
          {currentValue} {unit}
        </span>
      </div>
      <div style={{ width: '100%', height: 140 }}>
        <ResponsiveContainer>
          <AreaChart data={formattedData}>
            <defs>
              <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              contentStyle={{ background: '#111827', borderColor: '#374151', borderRadius: 6, fontSize: '0.75rem' }}
              formatter={(val: number) => [`${val} ${unit}`, 'Value']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#grad-${title})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};