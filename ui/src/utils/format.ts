// Small presentation helpers shared by every view.

export function timeAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function duration(fromMs: number, toMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// 24-hour clock everywhere: compact and unambiguous in an ops tool
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const clockShort = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export interface MetricMeta {
  label: string;
  unit: string;
  percent: boolean;
}

const META: Record<string, MetricMeta> = {
  cpu_percent: { label: 'CPU', unit: '%', percent: true },
  memory_percent: { label: 'Memory', unit: '%', percent: true },
  disk_percent: { label: 'Disk', unit: '%', percent: true },
  load1: { label: 'Load (1m)', unit: '', percent: false },
  docker_cpu_percent: { label: 'CPU', unit: '%', percent: true },
  docker_memory_percent: { label: 'Memory', unit: '%', percent: true },
  docker_net_rx_kbps: { label: 'Net in', unit: 'kB/s', percent: false },
  docker_net_tx_kbps: { label: 'Net out', unit: 'kB/s', percent: false },
  docker_restart_count: { label: 'Restarts', unit: '', percent: false },
  up: { label: 'Up', unit: '', percent: false },
};

export function metricMeta(name: string): MetricMeta {
  return META[name] || { label: name, unit: '', percent: name.endsWith('_percent') };
}

export function formatValue(v: number | null | undefined, metric: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const { unit } = metricMeta(metric);
  const digits = Math.abs(v) >= 100 ? 0 : 1;
  return `${v.toFixed(digits)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;
}

export const SEVERITY_RANK: Record<string, number> = { critical: 2, warning: 1 };
