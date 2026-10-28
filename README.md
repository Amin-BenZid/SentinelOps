# SentinelOps

Self-hosted infrastructure monitoring and alerting in one `docker compose up`:
host and container metrics, threshold rules **and** statistical anomaly
detection, a proper alert lifecycle, Slack/e-mail notifications with a process
snapshot, and a real-time dashboard.

```
browser ──► dashboard :4000 (Node/Express + React) ──► docker-proxy-ops ──► docker.sock  (logs, restart)
                 │  REST + WebSocket, auth, outbox worker
                 ▼
          SQLite (WAL, versioned schema)  ◄── agent (Python) ──► docker-proxy-ro ──► docker.sock (read-only)
                                                 collectors → detectors → alert state machine
```

## Features

| | |
|---|---|
| **Collectors** | host CPU / RAM / disk / load, container CPU / RAM / network / restarts (parallel), any Prometheus exporter |
| **Detectors** | threshold rules (with `for` duration) and a robust z-score anomaly detector (median/MAD) behind one `Detector` interface |
| **Alert lifecycle** | `PENDING → FIRING → RESOLVED`, acknowledgement as a flag, one open alert per rule+entity enforced by a unique index, incident correlation within a time window |
| **Forensics** | top-5 processes captured at fire time; "Why?" panel built from the detector's own evidence; post-mortem export |
| **Notifications** | transactional outbox → Slack / SMTP, retries with exponential backoff, quiet hours for warnings, firing + resolved messages |
| **Security** | deny-by-default API, hashed session tokens with TTL + idle timeout, login rate limiting, no default password, write-only secrets, CSP + security headers, Docker socket only through least-privilege proxies, non-root read-only containers |
| **Data** | epoch-ms timestamps, raw data 24 h + 1-minute rollups 7 d, automatic purge |

## Quick start

Requires Docker (Desktop on Windows/macOS) and Python 3.8+.

```bash
./sen run            # Linux / macOS / EC2      (Windows: sen run)
```

`sen` builds the images, starts the stack, waits until the dashboard **and** the agent are healthy, then prints:

```
✔ SentinelOps is ready   in 94s
  Dashboard   http://localhost:4000
  Login       admin / <generated password>  (change it at first login)
```

| Command | |
|---|---|
| `sen run [--public] [--port N] [--no-build]` | build + start + wait until ready (`--public` on a server) |
| `sen status` | containers, dashboard and agent health |
| `sen logs [agent\|dashboard]` | follow logs |
| `sen password` | show the initial admin password |
| `sen stop` / `sen restart` / `sen update` | stop (data kept) / restart / `git pull` + run |

Plain Docker Compose still works: `docker compose up -d --build`.

## Local development (no Docker)

```bash
# 1. agent  (from the repo root)
python -m venv venv && venv\Scripts\activate        # Linux/macOS: source venv/bin/activate
pip install -r agent/requirements-dev.txt
python -m agent.main                                  # uses data/sentinelops.db

# 2. server (Node >= 22.13)
cd server && npm install && npm run dev               # http://localhost:4000

# 3. UI with hot reload
cd ui && npm install && npm run dev                   # http://localhost:3000 (proxies /api and /ws)
#    or build once so the server serves it on :4000:
cd ui && npm run build
```

## Tests

```bash
python -m pytest -q            # agent: migrations, alert state machine, detectors, retention, parsers
cd server && npm test          # API: auth, rate limit, sessions, settings, rules, lifecycle, outbox, websocket
cd ui && npm run build         # type-check + build
```

CI (`.github/workflows/ci.yml`) runs all three, `npm audit`, builds both images and scans them with Trivy.

## Configuration

All variables are documented in [`.env.example`](.env.example). Rules are seeded
from [`agent/config/rules.yaml`](agent/config/rules.yaml) on first start, then
managed in the UI (`RULES_RESEED=true` re-applies the YAML).

## Project layout

```
agent/        Python collector + detection engine
  collectors/   host, docker, prometheus, process snapshot
  engine/       signals, threshold + anomaly detectors, alert_manager (FSM), correlator, retention
  db/           migration runner + data access
  tests/
server/       Node API, WebSocket, auth, outbox worker
  src/          app.js, routes/, middleware/, services/
  test/
ui/           React + TypeScript dashboard
shared/migrations/   the single schema definition used by both services
```

See [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) for design decisions and the project roadmap.
