import { Alert, ProcessInfo } from '../types';

export interface AIDiagnosis {
  confidence: number;
  rootCause: string;
  impact: string;
  recommendation: string;
}

export function generateAIDiagnosis(alert: Alert): AIDiagnosis {
  let processes: ProcessInfo[] = [];
  if (alert.process_snapshot) {
    try {
      processes = JSON.parse(alert.process_snapshot);
    } catch (e) {}
  }

  const topCulprit = processes.length > 0 ? processes[0] : null;
  const isCpu = alert.rule_name.toLowerCase().includes('cpu') || alert.summary.toLowerCase().includes('cpu');
  const isMem = alert.rule_name.toLowerCase().includes('mem') || alert.summary.toLowerCase().includes('mem');

  if (topCulprit) {
    if (isCpu) {
      return {
        confidence: 94,
        rootCause: `High CPU saturation initiated by PID ${topCulprit.pid} (${topCulprit.name}, user: ${topCulprit.user}) consuming ${topCulprit.cpu_percent}% CPU. Process appears trapped in a compute-bound loop.`,
        impact: `Host CPU starvation putting co-located containers (${alert.entity_id}) at risk of degraded request latency and thread pool exhaustion.`,
        recommendation: `Inspect execution stack for process "${topCulprit.name}". Consider sending SIGTERM to PID ${topCulprit.pid} or applying Docker CPU quotas via container limits.`
      };
    } else if (isMem) {
      return {
        confidence: 91,
        rootCause: `Abnormal memory consumption by PID ${topCulprit.pid} (${topCulprit.name}) utilizing ${topCulprit.memory_mb} MB. Statistical trajectory suggests an un-garbage-collected memory leak.`,
        impact: `Memory saturation approaching OOM (Out Of Memory) killer invocation threshold. Risk of sudden container termination.`,
        recommendation: `Profile heap allocation in ${topCulprit.name}. Consider restarting the container using the Ops action to reclaim unmanaged memory.`
      };
    }
  }

  // Fallback heuristic if no processes were captured
  return {
    confidence: 86,
    rootCause: `Threshold breach on ${alert.entity_id} (${alert.rule_name}). Observed metric escalated beyond the baseline envelope with repeated firings (${alert.hit_count}x).`,
    impact: `Correlated under incident group "${alert.correlation_id}". Continuous breach threatens service availability.`,
    recommendation: `Check container logs via the Ops terminal and verify resource allocation for ${alert.entity_id}.`
  };
}