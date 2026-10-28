/** All timestamps from the API are Unix epoch milliseconds (UTC). */
export type Timestamp = number;

export interface MetricPoint {
  entity_id: string;
  metric_name: string;
  metric_value: number;
  timestamp: Timestamp;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  cpu_percent: number;
  memory_mb: number;
}

/** Detector-specific explanation of why an alert fired. */
export interface AlertEvidence {
  detector?: 'threshold' | 'anomaly';
  metric?: string;
  observed?: number;
  // threshold
  operator?: string;
  threshold?: number;
  for_seconds?: number;
  // anomaly
  expected_mean?: number;
  stdev?: number;
  z_score?: number;
  k?: number;
  lower_bound?: number;
  upper_bound?: number;
  window?: number;
}

export interface Alert {
  id: number;
  fingerprint: string;
  correlation_id: string;
  rule_name: string;
  detector: 'threshold' | 'anomaly';
  entity_id: string;
  metric_name: string;
  severity: 'warning' | 'critical';
  summary: string;
  /** lifecycle state stored in the DB */
  state: 'firing' | 'resolved';
  /** UI status: firing+acked = acknowledged */
  status: 'active' | 'acknowledged' | 'resolved';
  first_seen: Timestamp;   // condition first true (pending start)
  fired_at: Timestamp;     // passed its `for` duration
  last_seen: Timestamp;
  resolved_at: Timestamp | null;
  resolved_by: string | null;   // 'auto' or a username
  acked_by: string | null;
  acked_at: Timestamp | null;
  hit_count: number;
  process_snapshot?: string;
  evidence: AlertEvidence;
}

export interface ServiceHealth {
  id: string;
  source: string;
  status: 'healthy' | 'warning' | 'critical' | 'stale';
  alertCount: number;
  last_seen?: Timestamp;
}

export interface MonitoringRule {
  id: string;
  metric_name: string;
  operator: string;
  threshold: number;
  duration_seconds: number;
  severity: 'warning' | 'critical';
  summary_template: string;
  is_active: number;
}

export interface AppSettings {
  slack_webhook_url?: string;
  smtp_host?: string;
  smtp_port?: string;
  smtp_user?: string;
  smtp_pass?: string;
  alert_email_to?: string;
  quiet_hours_enabled?: string;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  anomaly_detection_enabled?: string;
}

/** area = time series with anomaly band · bar = compare entities · stat = current value vs rule */
export type WidgetType = 'area' | 'bar' | 'stat';

export type TimeRange = '15m' | '1h' | '6h' | '24h';

export interface DashboardWidget {
  id: string;
  title: string;
  type: WidgetType;
  entity: string;
  metric: string;
  width: 'half' | 'full';
  color: string;
  unit: string;
}
export interface SeriesPoint {
  timestamp: Timestamp;
  metric_value: number;
  is_anomaly?: number;
  lower_bound?: number | null;
  upper_bound?: number | null;
  min_value?: number;
  max_value?: number;
}
