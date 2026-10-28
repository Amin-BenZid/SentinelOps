import { Alert, ProcessInfo } from '../types';
import { clock } from './format';

export interface TimelineEvent {
  time: string;
  title: string;
  desc: string;
  type: 'trigger' | 'correlate' | 'forensic' | 'action' | 'resolve';
}

/**
 * Builds a chronological causality story for an incident
 */
export function buildTimeline(alert: Alert, sisterAlerts: Alert[] = []): TimelineEvent[] {
  const events: (TimelineEvent & { at: number })[] = [];
  const t = clock;
  const push = (at: number, title: string, desc: string, type: TimelineEvent['type']) =>
    events.push({ at, time: t(at), title, desc, type });

  // 1. Condition first observed (start of the pending period)
  push(alert.first_seen, `Condition first observed: ${alert.rule_name}`, alert.summary, 'trigger');

  // 2. Fired (after its `for` duration) + incident grouping + forensic snapshot (taken at fire time)
  const pendingSec = Math.round((alert.fired_at - alert.first_seen) / 1000);
  push(alert.fired_at, 'Alert fired',
    `${pendingSec > 0 ? `Condition held for ${pendingSec}s. ` : ''}Grouped under incident ${alert.correlation_id} on ${alert.entity_id}.`,
    'correlate');

  if (alert.process_snapshot) {
    try {
      const procs: ProcessInfo[] = JSON.parse(alert.process_snapshot);
      if (procs.length > 0) {
        push(alert.fired_at, 'Process snapshot captured',
          `Top process: PID ${procs[0].pid} (${procs[0].name}) at ${procs[0].cpu_percent}% CPU / ${procs[0].memory_mb} MB RAM.`,
          'forensic');
      }
    } catch (e) {}
  }

  // 3. Other alerts of the same incident
  sisterAlerts
    .filter((s) => s.id !== alert.id && s.correlation_id === alert.correlation_id)
    .forEach((s) => push(s.fired_at, `Related alert: ${s.rule_name}`, s.summary, 'trigger'));

  // 4. Operator acknowledgement
  if (alert.acked_at) {
    push(alert.acked_at, `Acknowledged by ${alert.acked_by}`, 'An operator took ownership of the incident.', 'action');
  }

  // 5. Resolution
  if (alert.state === 'resolved' && alert.resolved_at) {
    push(alert.resolved_at,
      alert.resolved_by === 'auto' ? 'Resolved automatically' : `Resolved manually by ${alert.resolved_by}`,
      alert.resolved_by === 'auto' ? 'The metric returned below the rule condition.' : 'Closed by an operator from the console.',
      'resolve');
  }

  return events.sort((a, b) => a.at - b.at).map(({ at, ...e }) => e);
}

/**
 * Exports formatted GitHub-flavored Markdown Post-Mortem ready for GitHub/Jira
 */
export function generatePostMortemMarkdown(alert: Alert, sisterAlerts: Alert[] = []): string {
  const events = buildTimeline(alert, sisterAlerts);
  let processes: ProcessInfo[] = [];
  if (alert.process_snapshot) {
    try {
      processes = JSON.parse(alert.process_snapshot);
    } catch (e) {}
  }

  const endMs = alert.resolved_at ?? Date.now();
  const durationSec = Math.max(0, Math.round((endMs - alert.first_seen) / 1000));

  let processTable = '| PID | Process Name | CPU % | RAM (MB) | User |\n|---|---|---|---|---|\n';
  if (processes.length > 0) {
    processes.forEach((p, idx) => {
      processTable += `| **${p.pid}** | **${p.name}** ${idx === 0 ? '🚨' : ''} | ${p.cpu_percent}% | ${p.memory_mb} | \`${p.user}\` |\n`;
    });
  } else {
    processTable = '_No forensic process table captured._\n';
  }

  let timelineMd = '';
  events.forEach((ev) => {
    timelineMd += `- **\`${ev.time}\`** — **${ev.title}**: ${ev.desc}\n`;
  });

  return `# 🚨 Incident Post-Mortem: ${alert.correlation_id || alert.rule_name}

| Attribute | Value |
|---|---|
| **Incident ID** | \`${alert.correlation_id || 'N/A'}\` |
| **Primary Rule** | \`${alert.rule_name}\` |
| **Target Entity** | \`${alert.entity_id}\` |
| **Severity** | **${alert.severity.toUpperCase()}** |
| **Status** | **${alert.status.toUpperCase()}** |
| **Duration** | ${durationSec} seconds${alert.state === 'resolved' ? '' : ' (still open)'} |
| **Occurrences (Hit Count)** | ${alert.hit_count}x |
| **First Seen** | ${new Date(alert.first_seen).toUTCString()} |
| **Last Seen** | ${new Date(alert.last_seen).toUTCString()} |
| **Resolved** | ${alert.resolved_at ? `${new Date(alert.resolved_at).toUTCString()} (${alert.resolved_by})` : '—'} |
| **Detector** | ${alert.detector} |

---

## 1. Executive Summary
On ${new Date(alert.first_seen).toUTCString()}, an operational incident was detected on **${alert.entity_id}** triggered by **${alert.rule_name}** (${alert.detector} detector). 
The condition was observed on **${alert.hit_count}** evaluation cycles. Summary:
> "${alert.summary}"

---

## 2. Process snapshot at fire time
Top processes on the host when the alert fired:

${processTable}

---

## 3. Timeline
${timelineMd}

---

## 4. Follow-ups (to be completed by the on-call engineer)
- **Root cause**: _to be written_ (evidence: ${alert.summary})
- **Action Items**:
  - [ ] Profile memory/CPU allocations in \`${processes[0]?.name || alert.entity_id}\`
  - [ ] Adjust Docker resource limits (\`--cpus\` or \`--memory\`)
  - [ ] Set up automated quiet-hour escalation rules in SentinelOps

---
_Generated by SentinelOps v0.2 from recorded alert data._
`;
}