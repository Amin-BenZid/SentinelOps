import { Alert, ProcessInfo } from '../types';

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
  const events: TimelineEvent[] = [];
  const firstSeen = new Date(alert.first_seen);
  const lastSeen = new Date(alert.last_seen);

  // 1. Initial Trigger
  events.push({
    time: firstSeen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    title: `Initial Threshold Breach: ${alert.rule_name}`,
    desc: alert.summary,
    type: 'trigger'
  });

  // 2. Correlation grouping
  if (alert.correlation_id) {
    const correlateTime = new Date(firstSeen.getTime() + 4000);
    events.push({
      time: correlateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      title: `Correlated Incident Cluster Created`,
      desc: `Unified under correlation ID [${alert.correlation_id}] on target entity ${alert.entity_id}.`,
      type: 'correlate'
    });
  }

  // 3. Sister Alerts in the same cluster
  sisterAlerts
    .filter((s) => s.id !== alert.id && s.correlation_id === alert.correlation_id)
    .forEach((sister) => {
      events.push({
        time: new Date(sister.first_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        title: `Cascading Impact: ${sister.rule_name}`,
        desc: sister.summary,
        type: 'trigger'
      });
    });

  // 4. Crime Scene Forensic Capture
  if (alert.process_snapshot) {
    try {
      const procs: ProcessInfo[] = JSON.parse(alert.process_snapshot);
      if (procs.length > 0) {
        const snapTime = new Date(firstSeen.getTime() + 6000);
        events.push({
          time: snapTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          title: `Crime Scene Forensic Snapshot Captured`,
          desc: `Identified top offending process: PID ${procs[0].pid} (${procs[0].name}) using ${procs[0].cpu_percent}% CPU / ${procs[0].memory_mb} MB RAM.`,
          type: 'forensic'
        });
      }
    } catch (e) {}
  }

  // 5. Operator status (Ack / Resolve)
  if (alert.status === 'acknowledged') {
    events.push({
      time: lastSeen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      title: `Acknowledged by On-Call Operator`,
      desc: `Investigation underway by engineering team.`,
      type: 'action'
    });
  } else if (alert.status === 'resolved') {
    events.push({
      time: lastSeen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      title: `Incident Resolved`,
      desc: `Telemetry returned to operating baseline. System recovered.`,
      type: 'resolve'
    });
  }

  return events;
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

  const durationSec = Math.max(
    5,
    Math.round((new Date(alert.last_seen).getTime() - new Date(alert.first_seen).getTime()) / 1000)
  );

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
| **Duration** | ~${durationSec} seconds |
| **Occurrences (Hit Count)** | ${alert.hit_count}x |
| **First Seen** | ${new Date(alert.first_seen).toUTCString()} |
| **Last Seen** | ${new Date(alert.last_seen).toUTCString()} |

---

## 1. Executive Summary
On ${new Date(alert.first_seen).toUTCString()}, an operational incident was detected on **${alert.entity_id}** triggered by threshold rule **${alert.rule_name}**. 
The incident generated **${alert.hit_count}** consecutive telemetry breaches with summary:
> "${alert.summary}"

---

## 2. Forensic Evidence (Crime Scene)
The following kernel processes were captured at the exact moment of threshold violation:

${processTable}

---

## 3. Incident Causality Timeline (Flight Recorder)
${timelineMd}

---

## 4. Root Cause Analysis & Remediation
- **Failure Mechanism**: High resource contention on entity \`${alert.entity_id}\` leading to threshold violation.
- **Immediate Action**: Inspect process execution logs or issue container restart via SentinelOps Ops console.
- **Action Items**:
  - [ ] Profile memory/CPU allocations in \`${processes[0]?.name || alert.entity_id}\`
  - [ ] Adjust Docker resource limits (\`--cpus\` or \`--memory\`)
  - [ ] Set up automated quiet-hour escalation rules in SentinelOps

---
_Generated automatically by SentinelOps v0.1 Flight Recorder Console._
`;
}