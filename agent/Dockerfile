# ── Stage 1: build dependencies into an isolated virtualenv ──
FROM python:3.11-slim AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc python3-dev \
 && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY agent/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 # packaging tools are only needed to install, never at runtime
 && pip uninstall -y pip setuptools wheel

# ── Stage 2: minimal runtime ──
# No compiler, and no pip / setuptools / wheel: they are not needed to run the
# agent and were the source of the HIGH CVEs Trivy reported (vendored
# jaraco.context and wheel inside setuptools).
FROM python:3.11-slim
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && python -m pip uninstall -y setuptools wheel pip \
 && useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin sentinel \
 && mkdir -p /data && chown 1000:1000 /data

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY agent/ agent/
COPY shared/ shared/

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DB_PATH=/data/sentinelops.db \
    MIGRATIONS_DIR=/app/shared/migrations \
    RULES_PATH=/app/agent/config/rules.yaml \
    HOST_PROC=/host/proc \
    HOST_ROOT=/rootfs

# Non-root. Host data is read through read-only mounts (/host/proc, /rootfs)
# and Docker through a read-only socket proxy, so no privileges are needed.
USER 1000:1000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import sqlite3,time,os;c=sqlite3.connect(os.environ['DB_PATH']);v=c.execute(\"select value from app_meta where key='agent_heartbeat'\").fetchone();raise SystemExit(0 if v and time.time()*1000-int(v[0])<60000 else 1)"]

CMD ["python", "-m", "agent.main"]
