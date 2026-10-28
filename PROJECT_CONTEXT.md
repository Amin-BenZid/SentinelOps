# SentinelOps — Project Context (Stage reference)

> Living reference for the internship (stage) project. Read this first before any work session.
> Last updated: 2026-10-28 · Version **v0.2** (all 16 review issues fixed, see §7; UI/UX redesign, see §7b)

---

## 1. What SentinelOps is

A **self-hosted, lightweight infrastructure monitoring & alerting platform** — an "AIOps-lite" alternative to Prometheus + Grafana + Alertmanager that runs with one `docker compose up`.

It:
1. **Collects** host metrics (CPU, RAM, disk, load), container metrics (CPU, RAM, network, restarts) and optionally any Prometheus exporter, every 5 s.
2. **Detects** problems with two pluggable detectors: **threshold rules** (with a `for` duration) and a **statistical anomaly detector** (robust z-score, median/MAD).
3. Runs every condition through an **alert state machine** `PENDING → FIRING → RESOLVED` (Prometheus model). Acknowledgement is a flag, not a state.
4. **Correlates** alerts on the same entity that start within 120 s into one incident (`inc-xxxxxxxx`).
5. Captures a **process snapshot** (top 5 processes, real CPU %) when an alert fires, and explains every alert from the detector's **evidence** ("Why?" panel).
6. **Notifies** through a **transactional outbox** → Slack / e-mail, with retries + exponential backoff, quiet hours, firing *and* resolved messages.
7. Shows everything in a **real-time React dashboard** (authenticated WebSocket): live entity health, metric charts with the anomaly detector's expected band, incidents grouped by correlation, an alert detail drawer (why / chart / timeline / processes / post-mortem), rules, settings, container logs/restart.

Lineage: concrete implementation of the earlier "Pulse" idea — phased roadmap, SQLite on purpose, AI progression **Rules → statistics/ML → LLM**, human-in-the-loop remediation.

---

## 2. Architecture (v0.2)

```
                          ┌──────────── sentinelops-dashboard (Node 24, Express, ws) ───────────┐
browser ──HTTPS/WS──►:4000│ securityHeaders → requireAuth (deny-by-default) → REST /api/*       │
                          │ WebSocket /ws?token=…  · outbox worker → Slack / SMTP               │
                          │ docker.js ──► docker-proxy-ops (logs + restart only) ──► docker.sock │
                          └───────────────┬─────────────────────────────────────────────────────┘
                                          │ users, sessions, rules, settings, alert operator columns
                         ┌────────────────▼─────────────────┐
                         │ SQLite (WAL) /data/sentinelops.db │  schema = shared/migrations/*.sql
                         └────────────────▲─────────────────┘
                                          │ metrics, metrics_1m, alerts, outbox, app_meta
┌──────────── sentinelops-agent (Python 3.11, asyncio, uid 1000, read-only FS) ────────────┐
│ collectors: host (/host/proc, /rootfs) · docker (parallel) · prometheus · process snapshot │
│ detectors : ThresholdDetector · AnomalyDetector   ──► Signals                              │
│ AlertManager (FSM) ──► alerts + outbox row in ONE transaction · correlator · retention     │
│ docker SDK ──► docker-proxy-ro (GET containers only) ──► docker.sock                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Design rules (the "why")
| Rule | What it fixes |
|---|---|
| **One schema definition**: numbered SQL files in `shared/migrations/`, applied by both services under `BEGIN IMMEDIATE`, recorded in `schema_version` | v0.1 had 3 places defining the schema → the `notified` column was never created |
| **One writer per column group**: agent = detection data; server = users/sessions/rules/settings + operator actions (ack, manual resolve) | race conditions, unclear ownership |
| **Transactional outbox**: alert change + notification row committed together; server worker delivers, retries, records status | lost / duplicated notifications, silent failures |
| **Alert FSM** with `for` duration, PENDING in memory only, `ux_alerts_open` unique index = max one open alert per rule+entity | noisy alerts, duplicates, ack bugs |
| **Detector interface** (`Signal`): AlertManager never knows which detector produced a signal | anomaly detector was unused; adding ML/LLM later = new detector only |
| **Deny-by-default API** with an explicit public allow-list (`POST /auth/login`, `GET /health`) | API was completely open |
| **Least-privilege Docker access** through two socket proxies on internal networks | dashboard had read-write `docker.sock` |
| **All timestamps = INTEGER epoch ms (UTC)**, formatted only in the UI | mixed timestamp formats |

---

## 3. Repository map

| Path | Role |
|---|---|
| `docker-compose.yml` | `volume-init` (chown volume), `docker-proxy-ro`, `docker-proxy-ops`, `agent`, `dashboard`; hardened (read-only FS, cap_drop ALL, no-new-privileges, non-root) |
| `.env.example` | every configurable variable, documented |
| `shared/migrations/001_init.sql` | **the** schema (also upgrades v0.1 databases) |
| `agent/main.py` | loop: sync rules → collect → detect → store → AlertManager → heartbeat → retention |
| `agent/collectors/host_collector.py` | psutil on host `/proc` + host `/` disk |
| `agent/collectors/docker_collector.py` | parallel `docker stats`-equivalent CPU %, mem %, net kB/s, restart count |
| `agent/collectors/prometheus_pull.py` | scrapes exporters (`PROMETHEUS_TARGETS`), allow-list (`PROMETHEUS_METRICS`), synthetic `up` |
| `agent/collectors/process_snapshot.py` | top-N processes with **real** CPU % (two-pass sampling) |
| `agent/engine/signals.py` | `Signal` dataclass + `Detector` protocol |
| `agent/engine/rules_evaluator.py` | `ThresholdDetector` + `load_rules_yaml` validation |
| `agent/engine/anomaly_detector.py` | robust z-score (median/MAD), annotates samples with bands |
| `agent/engine/alert_manager.py` | the state machine |
| `agent/engine/correlator.py` | incident grouping with time window |
| `agent/engine/deduper.py` | fingerprint = sha256(rule:entity)[:16] |
| `agent/engine/retention.py` | 1-min rollups + purge |
| `agent/db/migrate.py` · `sqlite_client.py` | migration runner · data access (transactions) |
| `agent/config/rules.yaml` | 5 default rules, seeded once |
| `agent/tests/` | 37 pytest tests |
| `server/src/index.js` · `app.js` | process bootstrap · Express app factory (testable) |
| `server/src/migrate.js` · `db.js` | Node migration runner · DB + first admin |
| `server/src/middleware/auth.js` | `requireAuth`, onboarding gate, security headers/CSP |
| `server/src/services/auth.js` · `passwords.js` | sessions (hashed, TTL, idle), login rate limiter · PBKDF2 + timing-safe compare |
| `server/src/services/outbox.js` · `notifier.js` | outbox worker · Slack/e-mail (escaped content) |
| `server/src/services/docker.js` | Docker API via proxy, id validation, TTY-safe log demux |
| `server/src/routes/api.js` | REST API (§5) |
| `server/src/websocket.js` | `/ws`, token checked before upgrade, re-validated each tick |
| `server/test/api.test.js` | 14 integration tests |
| `ui/src/api.ts` | wraps `fetch`: adds the Bearer token, logs out on 401 |
| `ui/src/App.tsx` | shell: session, WebSocket, header, tabs, overview layout, alert actions |
| `ui/src/components/HealthMap.tsx` | entity cards: status as text + icon + color, live CPU/Mem, "No data" for silent entities |
| `ui/src/components/MetricChart.tsx` | time series with time axis, expected band (anomaly detector), red anomaly dots, rule threshold line |
| `ui/src/components/CustomizableDashboard.tsx` | widgets (time series / compare entities / KPI vs rule), time range, editable layout |
| `ui/src/components/IncidentFeed.tsx` | alerts grouped by incident, filters, quick Ack/Resolve |
| `ui/src/components/AlertDrawer.tsx` | detail panel: Why it fired, metric chart, facts, Timeline, Processes, Post-mortem (copy/download) |
| `ui/src/utils/diagnosis.ts` | evidence-based "Why did this fire?" (replaces the fake AI diagnoser) |
| `ui/src/utils/postMortemGenerator.ts` | timeline/post-mortem from **real** timestamps |
| `ui/src/utils/format.ts` | time-ago, 24 h clock, units per metric |
| `.github/workflows/ci.yml` | tests + npm audit + UI build + image build + Trivy scan |
| `inspect_db.py` | debug: `python inspect_db.py [db]` |

---

## 4. Data model

All times are epoch **ms**.
- **metrics**(id, ts, source, entity_id, metric_name, metric_value, is_anomaly, z_score, lower_bound, upper_bound) — raw, 24 h
- **metrics_1m**(entity_id, metric_name, bucket_ts, source, avg/min/max_value, sample_count) — 7 d
- **alerts**(id, fingerprint, correlation_id, rule_name, detector, entity_id, metric_name, severity, summary, **state** firing|resolved, first_seen, fired_at, last_seen, resolved_at, resolved_by auto|user, hit_count, process_snapshot JSON, evidence JSON, acked_by, acked_at) — unique open alert per fingerprint; resolved kept 30 d
- **notifications_outbox**(id, alert_id, event firing|resolved, status pending|sent|failed|skipped|suppressed, attempts, next_attempt_at, last_error, created_at, processed_at)
- **rules**(id, metric_name, operator, threshold, duration_seconds, severity, summary_template, is_active)
- **settings**(key, value) — allow-listed keys; `slack_webhook_url`, `smtp_pass` are write-only
- **users**(id, username, password_hash, salt, must_change_password, created_at)
- **sessions**(token_hash, user_id, created_at, last_seen_at, expires_at)
- **app_meta**(key, value) — `agent_heartbeat`, `rules_seeded_at`
- **schema_version**(version, name, applied_at)

Metric names: `cpu_percent`, `memory_percent`, `disk_percent`, `load1` (host) · `docker_cpu_percent`, `docker_memory_percent`, `docker_net_rx_kbps`, `docker_net_tx_kbps`, `docker_restart_count` (containers) · `up` + allow-listed series (Prometheus).

---

## 5. REST API (`/api`, Bearer token required unless marked public)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | **public**, rate-limited (5 failures / 15 min / IP → 429) |
| GET | `/auth/me` | current user |
| POST | `/auth/change-credentials` | forced first change; later changes need `current_password` (min 8 chars) |
| POST | `/auth/logout` | revoke session |
| GET | `/health` | **public**: uptime + agent heartbeat (`stale` after 30 s) |
| GET | `/alerts?limit` | firing first, then latest |
| PATCH | `/alerts/:id/status` | `acknowledged` / `active` (un-ack or reopen) / `resolved` (writes outbox) |
| DELETE | `/alerts/purge` | delete resolved alerts |
| GET | `/metrics/history?entity&metric&range=15m\|1h\|6h\|24h\|7d` | raw samples with band (≤ 1 h) or 1-min rollups (> 1 h, recent minutes aggregated on the fly); legacy `limit` still works |
| GET | `/filters` · `/services` | entities/metrics seen in the last hour · health per entity (`stale` when silent 30 s+) + agent status |
| GET/POST | `/rules` · PATCH `/rules/:id/toggle` · DELETE `/rules/:id` | validated CRUD (history is kept on delete) |
| GET/POST | `/settings` | secrets never returned; blank secret = keep; `null` = clear |
| POST | `/test/slack` | test message (https only) |
| GET | `/notifications` | outbox log (delivery status, errors) |
| GET | `/containers/:id/logs?tail` · POST `/containers/:id/restart` | via socket proxy, audited |

WebSocket: `ws(s)://host/ws?token=<session token>` → `SNAPSHOT` then `TICK {latestMetrics, activeAlerts, services, agent}` every 2 s; closes with code 4401 when the session expires.

---

## 6. How to run

```bash
cp .env.example .env              # optional
docker compose up -d --build
docker compose logs dashboard | grep -A3 "Initial admin"   # first-run password (unless ADMIN_PASSWORD set)
# → http://localhost:4000
```
Local dev (Windows, no Docker) and tests: see `README.md`.

---

## 7. What was fixed in v0.2 (review of 2026-10-28)

| # | v0.1 issue | v0.2 fix |
|---|---|---|
| 1 | `alerts.notified` never created → no WS ticks, no notifications | single migration system + transactional outbox replaces the flag; WS tick errors are logged, not swallowed |
| 2 | `rules.yaml` never loaded | seeded once on first start (deleted rules stay deleted); `RULES_RESEED=true` = GitOps overwrite |
| 3 | `duration_seconds` ignored | PENDING state; fires only after the condition held for `for` seconds |
| 4 | AnomalyDetector unused | wired in as a detector (robust median/MAD z-score), toggle in Settings, bands stored per sample |
| 5 | correlator ignored its window | joins an open incident on the same entity only if it started within 120 s |
| 6 | acknowledged alerts stuck + duplicated | ack is a flag on a FIRING alert; DB unique index forbids duplicates |
| 7 | API had no auth | deny-by-default middleware, WS token check, onboarding gate for `must_change_password` |
| 8 | sessions never expire, admin/admin | hashed tokens, 12 h TTL + 2 h idle, logout revoke, rate limit, random/env initial password, min 8 chars |
| 9 | docker.sock read-write in dashboard | two docker-socket-proxies (read-only / logs+restart), internal networks, non-root read-only containers |
| 10 | disk % of the container, `/host/proc` not mounted | `/proc:/host/proc:ro`, `/:/rootfs:ro` |
| 11 | docker: memory only, sequential | parallel; CPU %, mem % (cache excluded), net kB/s, restart count — same formulas as `docker stats` |
| 12 | no retention | rollups + purge every 10 min |
| 13 | mixed timestamps | epoch ms everywhere |
| 14 | fake "AI diagnosis" | removed; "Why?" panel shows real detector evidence; timeline/post-mortem use real times |
| 15 | routes mounted twice | `app.js` factory, mounted once |
| 16 | no README/tests/CI/.env.example, empty prometheus collector | all added; Prometheus collector implemented |

Also found & fixed while testing: process snapshot always showed 0 % CPU (psutil first-call), Docker log demux broke on TTY containers, HTML injection in alert e-mails (now escaped), SSRF via arbitrary webhook URLs (https only), stale UI build.

Verified on 2026-10-28: 37 agent tests + 14 server tests pass, UI type-checks and builds, full run against a real Docker daemon (threshold alert with `for`, anomaly alert, correlation, auto-resolve, Slack outage + retry, container logs/restart), and the real v0.1 database upgrades cleanly. **Not verified here:** building the Docker images (no Docker Hub access in the test sandbox) — run `docker compose up --build` once and check §9.

## 7b. UI/UX redesign (v0.2, same day)

| Problem in v0.1 UI | Change |
|---|---|
| 7 equal-weight buttons on every alert card, wrapping on 3 lines | compact alert rows (only Ack / Resolve); click a row → **detail drawer** with tabs Overview (why it fired + metric chart + facts), Timeline, Processes, Post-mortem (copy / download .md) |
| incidents computed by the backend but invisible | feed **grouped by incident** (correlation id): severity, entity, number of alerts, start time; open incidents first |
| charts: no time axis, Y fixed 0–100 for every metric, anomaly band never drawn | `MetricChart`: real time axis (24 h clock), unit-aware Y axis, **shaded expected range** from the anomaly detector, red dots on anomalous samples, dashed rule threshold; **time range picker** 15m / 1h / 6h / 24h (rollups beyond 1 h) |
| useless default widgets (duplicate CPU KPI, one-slice donut, hard-coded "85 %" target) | defaults: Host CPU, Host memory (time series), **Containers by CPU** (compare entities, red when over the rule), **Host disk** KPI with a meter against the real rule threshold |
| health map never refreshed after login; stopped containers shown "Passing checks" for 5 min | entity list streamed over the WebSocket; **"No data"** status after 30 s of silence; live CPU/Mem on each card |
| status by color only, 0.7 rem grey text, fixed 2-column layout | text + icon + color for every status, min ~0.75 rem, keyboard focus rings, `aria` labels, Esc closes the drawer; responsive (1 column < 1100 px, incidents first on small screens) |
| gimmicky wording ("Security & System Advisories", "Crime Scene", fake breadcrumb) | plain ops vocabulary: Incidents, Processes, Timeline, Rules, Settings |

---

## 8. Roadmap

> Full product roadmap (v0.1 Core → v0.2 Intelligence → v0.3 AI Chat → v1.0 Full Platform → v2.0 Chaos & FinOps) with per-feature status: **`docs/ROADMAP.md`** (original: `docs/roadmap.html`). Note: against that roadmap the current code is **v0.1 Core complete + early v0.2**, although the code/UI label says "v0.2".

Stage-level phases:

- **A Stabilize** — ✅ done (v0.2)
- **B Secure (DevSecOps)** — ✅ done (v0.2). Next: HTTPS via reverse proxy (Caddy/Traefik), roles (admin/viewer)
- **C Intelligence** — ✅ layer 2 statistics (robust z-score). Next: Isolation Forest (scikit-learn) as a 3rd detector; optional LLM explanation (opt-in, human-in-the-loop)
- **D Collectors** — ✅ container CPU/net/restarts, Prometheus pull. Next: multi-host (agents push to `POST /api/ingest` with API keys; server owns the DB → PostgreSQL/TimescaleDB)
- **E Industrialize** — ✅ CI (tests, audit, build, Trivy). Next: push images to GHCR on tag, Terraform deployment on an Azure VM, optional Helm chart
- **F Evaluation** — ⬜ load tests, detection latency, false-positive rate threshold vs anomaly, footprint vs Prometheus+Grafana+Alertmanager

---

## 9. Manual test guide (v0.2)

Prerequisites: Docker Desktop running, in `D:\Stage\sentinelops`. Commands are PowerShell.

### 9.1 Start & first login
```powershell
copy .env.example .env            # optional: set TZ=Africa/Lagos
docker compose up -d --build
docker compose ps -a              # 4 services Up, volume-init Exited (0)
docker compose logs dashboard | Select-String -Context 0,3 "Initial admin"
```
Open http://localhost:4000 → log in with `admin` + the printed password → you must choose a new password (≥ 8 chars) → the header shows a green **Live** pill.
*If you upgraded an existing v0.1 volume, your old user/password, rules and settings are kept and no password is printed.*

### 9.2 Security
| Test | Expected |
|---|---|
| `curl.exe -i http://localhost:4000/api/settings` | `401` |
| `curl.exe -i http://localhost:4000/api/health` | `200` + `"agent":{"stale":false}` |
| Log out, type a wrong password 5× | 6th attempt: "Too many failed logins" (429) |
| Settings → save an SMTP password → reload page | field is empty with "•••••• saved" placeholder |
| `docker exec sentinelops-dashboard ls /var/run/docker.sock` | "No such file" — the socket is not mounted |
| `docker exec sentinelops-dashboard wget -qO- http://docker-proxy-ops:2375/images/json` | `403 Forbidden` from the proxy |
| `docker exec sentinelops-agent id` | `uid=1000` (non-root) |
| DevTools → Application → Local Storage → delete `sentinelops_token`, reload | back to login |

### 9.3 Threshold rule + `for` duration + notifications
1. Get a test webhook: open https://webhook.site, copy your unique URL → Settings → Slack Webhook → **Test Webhook** → message appears on webhook.site → **Save**.
2. **Rules** tab → create `demo_cpu`: metric `docker_cpu_percent`, `>` `40`, For `20` s, critical.
3. Start a CPU hog: `docker run -d --name cpu-hog --cpus 0.5 alpine sh -c "while :; do :; done"`
4. Expected: nothing for ~20 s (PENDING), then a critical incident on `cpu-hog` at the top of **Incidents**, the `cpu-hog` card turns red, the "Containers by CPU" bar turns red; webhook.site receives the 🚨 message with the top process (`sh` ≈ 50 % CPU).
5. Click the alert row → the detail drawer opens: **Why it fired** (observed vs threshold, held 20 s), the metric chart with the dashed rule line, **Timeline** (first observed → fired → snapshot), **Processes**, **Post-mortem** (Download .md).
6. **Acknowledge** → the row shows your name; the alert stays and does not duplicate.
7. `docker stop cpu-hog` → within ~5 s the alert moves to **Resolved** ("Auto-resolved"), webhook.site gets ✅ RESOLVED, and after 30 s the card shows **No data**.
8. Short blip: set For to 60 s, start and stop the hog after 15 s → **no** alert (dropped in PENDING).

### 9.4 Anomaly detection
1. `docker run -d --name calm alpine sleep 1d` and wait ~1 min (baseline = 10 samples).
2. `docker exec -d calm sh -c "while :; do :; done"`
3. Expected after ~15 s: warning `anomaly:docker_cpu_percent` on `calm`, badge **anomaly**; in the drawer, **Why it fired** shows the z-score and the chart shows the shaded expected range with red dots where the metric left it. It shares the incident id with any threshold alert on the same container. After ~1–2 min at the new level it auto-resolves (accepted as the new normal).
4. Settings → untick *Statistical Anomaly Detection* → Save → no new anomaly alerts.

### 9.5 Memory rule
`docker run -d --name mem-hog -m 100m python:3.11-slim python -c "x=bytearray(85*1024*1024); import time; time.sleep(3600)"` → `docker_memory_percent` > 90 → `docker_container_oom` fires after 30 s.

### 9.6 Notification retries (outbox)
Settings → Slack URL `https://hooks.slack.com/services/invalid` → Save → trigger 9.3 again → in DevTools console:
`fetch('/api/notifications').then(r=>r.json()).then(console.log)` → rows with `attempts` increasing and `last_error`, then `failed` after 5 attempts (~4 min: backoff 15 s, 30 s, 60 s, 120 s). Put the good URL back → new events are `sent`.

### 9.7 Container ops
Click a container card (or **Container logs** in the alert drawer) → logs appear → **Restart** → `docker compose logs dashboard | Select-String audit` shows who restarted it.

### 9.8 Rules-as-code
Delete `host_disk_full` in the UI → `docker compose restart agent` → it stays deleted. Then set `RULES_RESEED=true` in `.env` → `docker compose up -d agent` → the YAML rules are back (set it to false again).

### 9.9 Prometheus target down
`.env`: `PROMETHEUS_TARGETS=fake=http://nothing:9100/metrics` → `docker compose up -d agent` → rule `target_down`: metric `up`, `<`, `1`, For 10 → alert on `fake`.

### 9.10 UI checks
- Time range 15m / 1h / 6h / 24h changes every time-series widget (6h+ uses 1-minute averages).
- **Edit layout** → drag, resize, remove, **Add widget** (Time series / Compare / KPI) → reload: layout kept.
- Light theme (sun icon), narrow window (< 1100 px: one column, incidents first), keyboard: Tab to an alert row, Enter opens it, Esc closes.

### 9.11 Automated tests
```powershell
venv\Scripts\activate; pip install -r agent\requirements-dev.txt; python -m pytest -q   # 37 passed
cd server; npm install; npm test                                                      # 14 pass
cd ..\ui; npm install; npm run build
```

### Troubleshooting
- `agent` fails to start on Docker Desktop with a mount error on `/` or `/proc`: comment the two `/host/proc` and `/rootfs` lines in `docker-compose.yml` (the agent falls back to the container's view).
- **Agent offline** pill in the header: `docker compose logs agent`.
- `.env.example` was deleted from the repo (commit 7e215ea): create `.env` by hand if you need settings — all variables are listed in `docker-compose.yml`.
- Quiet hours use `TZ` from `.env`.

---

## 10. Final deliverables plan

### Rapport (report) — suggested outline
1. General introduction (context, problem, objectives)
2. Host organization & project context
3. State of the art: observability (metrics, logs, traces), Prometheus/Grafana/Alertmanager, Zabbix, Datadog, AIOps → comparison table → positioning
4. Requirements: actors, functional / non-functional requirements, use cases
5. Design: architecture (§2) and design rules, sequence diagrams (collection cycle, alert lifecycle, outbox delivery), DB schema (§4), alert state machine
6. Implementation: stack & justification, modules, screenshots
7. DevOps & security: Docker hardening, socket proxies, auth model, CI pipeline (Trivy), IaC
8. Tests & evaluation: unit/integration tests, the scenarios of §9, measured results (Phase F)
9. Conclusion & perspectives (multi-host, Isolation Forest, LLM, Kubernetes)

Good report material from v0.2: v0.1 → v0.2 review table (§7) as a "technical debt & refactoring" section; threshold vs anomaly comparison; mean/stdev vs median/MAD (the step-change experiment).

### Presentation — ~15–20 slides
Problem → objectives → existing solutions → architecture → alert lifecycle → **live demo** (§9.3 + §9.4: CPU hog → pending → incident → Slack → detail drawer with chart + band → auto-resolve) → security → CI/CD → results → limits & perspectives. Record a backup video of the demo.

---

## 11. Open questions (to fill in)
- [ ] Official stage subject / title (convention or cahier des charges)
- [ ] Host company, supervisors (academic + professional)
- [ ] Start/end dates, report deadline, defense date
- [ ] Report language & school template
- [ ] Which roadmap phases are mandatory for the jury

## 12. Work log
- 2026-10-28 — Full code review, this document created.
- 2026-10-28 — v0.2: fixed all 16 review issues (§7), added tests + CI + README + `.env.example`; verified end-to-end except image builds.
- 2026-10-28 — CI: npm audit failed on the pushed commit (old package.json had been restored locally); re-applied nodemailer 10.2.1 / express 4.22.3, added Dependabot. `.env.example` was deleted on GitHub (commit 7e215ea).
- 2026-10-28 — UI/UX redesign (§7b), verified in Chromium (dark, light, mobile width) against live data.
