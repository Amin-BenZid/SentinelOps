import { Alert, ProcessInfo } from '../types';
import { clock } from './format';

export interface Explanation {
  headline: string;
  details: string[];
}

const fmt = (n: number | undefined, digits = 1) =>
  n === undefined || n === null || Number.isNaN(n) ? '?' : Number(n).toFixed(digits).replace(/\.0+$/, '');

/**
 * Explains an alert from the evidence the detector actually computed.
 * No invented confidence scores: every line is a measured fact.
 */
export function explainAlert(alert: Alert): Explanation {
  const ev = alert.evidence || {};
  const details: string[] = [];
  let headline: string;

  if (ev.detector === 'anomaly') {
    headline = `Statistical anomaly on ${ev.metric}: ${fmt(ev.observed)} vs expected ${fmt(ev.expected_mean)} ± ${fmt(ev.stdev)}`;
    details.push(`z-score ${fmt(ev.z_score, 2)} (fires when |z| > ${fmt(ev.k)}), computed over the last ${ev.window ?? '?'} samples.`);
    details.push(`Expected band: ${fmt(ev.lower_bound)} – ${fmt(ev.upper_bound)}.`);
  } else if (ev.detector === 'threshold') {
    headline = `${ev.metric} = ${fmt(ev.observed)} ${ev.operator} ${fmt(ev.threshold)} (rule ${alert.rule_name})`;
    if (ev.for_seconds) details.push(`Condition held for ${ev.for_seconds}s before firing (pending period).`);
  } else {
    headline = alert.summary;
  }

  const firedAfter = Math.round((alert.fired_at - alert.first_seen) / 1000);
  if (firedAfter > 0) details.push(`First breach at ${clock(alert.first_seen)}, fired ${firedAfter}s later.`);
  details.push(`Breach observed on ${alert.hit_count} evaluation cycle(s).`);

  let procs: ProcessInfo[] = [];
  try { procs = JSON.parse(alert.process_snapshot || '[]'); } catch { /* ignore */ }
  if (procs.length > 0) {
    const top = procs[0];
    details.push(`Top process at fire time: ${top.name} (PID ${top.pid}) – ${top.cpu_percent}% CPU, ${top.memory_mb} MB RAM.`);
  }
  return { headline, details };
}
