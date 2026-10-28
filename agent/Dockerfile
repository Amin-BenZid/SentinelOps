FROM python:3.11-slim

WORKDIR /app

# psutil needs a compiler on slim images; removed again in the same layer
COPY agent/requirements.txt requirements.txt
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc python3-dev \
 && pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y gcc python3-dev && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin sentinel \
 && mkdir -p /data && chown 1000:1000 /data

COPY agent/ agent/
COPY shared/ shared/

ENV PYTHONUNBUFFERED=1 \
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
