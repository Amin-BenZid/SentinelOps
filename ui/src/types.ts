export interface MetricPoint {
  entity_id: string;
  metric_name: string;
  metric_value: number;
  timestamp: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  cpu_percent: number;
  memory_mb: number;
}

export interface Alert {
  id: number;
  fingerprint: string;
  correlation_id: string;
  rule_name: string;
  entity_id: string;
  severity: 'warning' | 'critical';
  summary: string;
  // Updated status to include 'acknowledged'
  status: 'active' | 'acknowledged' | 'resolved';
  first_seen: string;
  last_seen: string;
  hit_count: number;
  process_snapshot?: string;
}

export interface ServiceHealth {
  id: string;
  source: string;
  status: 'healthy' | 'warning' | 'critical';
  alertCount: number;
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
}

export type WidgetType = 'area' | 'bar' | 'donut' | 'stat';

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