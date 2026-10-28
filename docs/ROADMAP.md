# SentinelOps — Product Roadmap (reference)

> Source: `sentinelops_RoadMap.html` (Amin's versioned roadmap), summarized 2026-10-28.
> Status column = what exists in the code on 2026-10-28 (see `PROJECT_CONTEXT.md` for details).
> ✅ done · 🟡 partial · ⬜ not started

**Vision:** open-source, self-hosted AIOps agent. One command (`docker compose up -d`) replaces wiring Prometheus + Grafana + Alertmanager, then grows into ML anomaly detection, AI chat, cost intelligence and chaos engineering.
**AI layers:** Rules (L1) → Isolation Forest ML (L2) → LLM root cause (L3). LLM always opt-in, read-only, never touches prod. Remediation = human-in-the-loop; auto-remediation only opt-in with strict safety model (v1.0).

---

## v0.1 ALPHA — Core (months 1–3)
Goal: best lightweight unified monitoring tool; first GitHub star, first contributor.

| Feature | Priority | Status |
|---|---|---|
| Universal metric collection: Prometheus, Docker API, push agent for bare servers (Linux/Windows) | MUST | 🟡 Prometheus pull ✅, Docker ✅, host agent ✅ (Python, not single binary); push mode ⬜ |
| Layer 1 rules engine — YAML thresholds, `cpu > 85% for 3min` | MUST | ✅ (YAML seed + UI, `for` duration) |
| Alert deduplication — fingerprinting + time-window bucketing | MUST | ✅ |
| Alert correlation — related alerts → one grouped event with a single severity score | MUST | 🟡 grouped per entity within 120 s ✅; cross-entity grouping + combined severity score ⬜ |
| React dashboard — health overview, alert feed, sparklines, events, mobile-responsive, Recharts | MUST | ✅ |
| Slack + email alerts, per-rule severity routing, quiet hours | MUST | 🟡 Slack/SMTP/quiet hours ✅; per-rule routing ⬜ |
| Docker Compose deploy, SQLite, no Redis/TimescaleDB | MUST | ✅ |
| Native CloudWatch support (boto3) | NICE | ⬜ |
| Basic log ingestion (tail + regex rules) | NICE | ⬜ |
| Webhook ingest API (HTTP POST JSON metrics) | NICE | ⬜ |

Tech: Python 3.11 asyncio/aiohttp agent · SQLite · Prometheus HTTP API · boto3 · Docker SDK · React+TS · Recharts · Node/Express · ws · Slack webhooks + Nodemailer · Docker Compose · GitHub Actions · **Trivy + CodeQL + GitLeaks** (Trivy ✅, CodeQL ⬜, GitLeaks ⬜).
Deliberately NOT in v0.1: ML/AI, LLM, incident management, auto-remediation, cost, predictions, chaos, K8s/Helm, on-call, Redis/TimescaleDB.

## v0.2 BETA — Intelligence (months 4–6)
Goal: ML that actually helps, safely.

| Feature | Priority | Status |
|---|---|---|
| Layer 2 — Isolation Forest ML, trains after 24 h baseline, separate sidecar process | MUST | 🟡 statistical layer (robust z-score/MAD) ✅ via pluggable `Detector`; Isolation Forest sidecar ⬜ |
| Human-in-the-loop remediation — AI suggests, human approves via Slack button | MUST | 🟡 manual container restart from dashboard (audited) ✅; suggestions + Slack interactive buttons ⬜ |
| Incident management — Open → In Progress → Resolved, timeline, MTTR/MTTD | MUST | 🟡 incidents (correlation), ack/resolve, timeline, post-mortem ✅; explicit lifecycle + MTTR/MTTD ⬜ |
| On-call rotation (YAML), auto-assign, escalation after N min | MUST | ⬜ |
| Kubernetes Helm chart, kube-state-metrics + cAdvisor, HPA-aware | MUST | ⬜ |
| Plugin system — `BasePlugin`; restart_pod, restart_container, notify_slack/email, run_script, webhook | MUST | ⬜ |
| Azure Monitor + GCP connectors | NICE | ⬜ |
| PostgreSQL upgrade path (+ optional TimescaleDB), Alembic | NICE | ⬜ (versioned SQL migrations exist) |
| Adaptive thresholds (seasonality) | NICE | ⬜ |

Tech: scikit-learn, joblib, Python sidecar, PostgreSQL/TimescaleDB, kube-state-metrics, cAdvisor, Helm, azure-mgmt-monitor, google-cloud-monitoring, Alembic.
HITL flow: ML detects (confidence 0.91) → Slack message with context + buttons [Restart Pod] [Rollback] [Dismiss] → engineer clicks → action executed, incident updated. Zero autonomous prod changes.

## v0.3 PUBLIC PREVIEW — AI Chat (months 7–9)
Goal: the demo that goes viral.

| Feature | Priority | Status |
|---|---|---|
| Layer 3 — LLM root cause (Ollama local / OpenAI / Anthropic via LiteLLM), opt-in, pre-aggregated context | MUST | ⬜ (evidence-based explanation ✅ as groundwork) |
| AI chat — plain-English questions, reads DB only, WebSocket streaming | MUST | ⬜ |
| Context memory of past incidents | MUST | ⬜ |
| Postmortem auto-draft by LLM, human-reviewed | MUST | 🟡 template post-mortem from real data ✅; LLM draft ⬜ |
| Change tracking (deploys, config, scaling) correlated with anomalies | MUST | ⬜ |
| Runbook integration (markdown folder) | NICE | ⬜ |
| Service topology map (NetworkX) | NICE | ⬜ |
| Docusaurus docs site on GitHub Pages | MUST | ⬜ (README ✅) |

Recommended model: llama3.1:8b via Ollama. Never send raw time series to the LLM: pre-aggregate (cpu now / 1 h avg / 24 h avg, last deploy, similar past incidents, open incidents).

## v1.0 STABLE — Full Platform (month 12)
Goal: public launch (Hacker News, Product Hunt, r/devops, r/selfhosted, Dev.to, 90-second demo video).

| Feature | Priority | Status |
|---|---|---|
| Cost intelligence basic — idle resources, rightsizing, cost anomalies (AWS/GCP/Azure billing APIs) | MUST | ⬜ |
| Predictive forecasting — Prophet, 14-day horizon ("disk full in ~6 days") | MUST | ⬜ |
| Auto-remediation opt-in — confidence ≥ 0.95 AND whitelisted AND enabled globally AND per rule AND not in quiet hours | MUST | ⬜ |
| LSTM anomaly detection (PyTorch sidecar) | NICE | ⬜ |
| Terraform modules for AWS/GCP/Azure | MUST | ⬜ |
| Budget forecasting | MUST | ⬜ |
| Full context memory (topology, deploys, config, runbooks) | NICE | ⬜ |
| Community plugin registry (`sentinelops plugin install pagerduty`) | MUST | ⬜ |

Whitelist: restart_pod, restart_container, scale_up, notify_slack. Always human-approved: apply_tf, rollback_deploy, block_ip, scale_down.

## v2.0 ENTERPRISE — Chaos & FinOps (month 18+)

| Feature | Priority | Status |
|---|---|---|
| Chaos engineering (LitmusChaos, Chaos Mesh) — verify detection time + remediation | MUST | ⬜ |
| Full FinOps engine (allocation per team, RI/spot advice, multi-cloud; replaces Kubecost) | MUST | ⬜ |
| Chaos experiment library (CPU stress, memory hog, pod kill, network delay, disk fill, node drain) | NICE | ⬜ |
| Multi-tenant + RBAC (Keycloak OIDC) | NICE | ⬜ |
| SLA/SLO tracking, error budgets (OpenSLO) | NICE | ⬜ |
| Advanced LLM agents (LangGraph) | OPTIONAL | ⬜ |
| Distributed tracing (OpenTelemetry, Jaeger/Tempo) | OPTIONAL | ⬜ |
| Mobile app (React Native) | OPTIONAL | ⬜ |

Rationale: chaos and FinOps only after detection is proven (12+ months of real incidents) — otherwise you can't trust the results.

---

## Where the code stands (2026-10-28)
- **v0.1 Core: essentially complete**, plus hardening beyond the roadmap (deny-by-default auth, socket proxies, transactional outbox, alert FSM, tests, CI with Trivy, Dependabot).
- **v0.2 started:** pluggable detector layer with a statistical anomaly detector, incident grouping/timeline/post-mortem, manual container ops.
- ⚠ Version label mismatch: the code/UI currently say **"v0.2"** (it was the internal refactor version). Against this roadmap, the current release is **v0.1 Core (complete)**. Decide which naming to use before the report/defense.

## Remaining v0.1 gaps (small, close the version cleanly)
1. Webhook ingest API (`POST /api/ingest`, API key) — also the base for push agents / multi-host.
2. Per-rule notification routing (channel per severity/rule).
3. Cross-entity correlation + incident severity score.
4. CodeQL + GitLeaks in CI.

## Candidate v0.2 items for the stage (highest value for a Cloud/DevOps jury)
- Isolation Forest sidecar as a third `Detector` (plugs into existing interface).
- Incident lifecycle with MTTD / MTTR metrics (feeds the evaluation chapter).
- Helm chart (+ Terraform from v1.0 for the Azure deployment / CD story).
- Human-in-the-loop suggestions (dashboard first; Slack buttons need a public URL + Slack app).
- Stretch / demo effect: v0.3 LLM explanation via Ollama, opt-in.
