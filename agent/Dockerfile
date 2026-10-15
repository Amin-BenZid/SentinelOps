FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (psutil requires gcc for compilation on slim images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY agent/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and config
COPY agent/ agent/
COPY shared/ shared/

ENV PYTHONUNBUFFERED=1
ENV DB_PATH=/data/sentinelops.db
ENV SCHEMA_PATH=/app/shared/schema.sql
ENV RULES_PATH=/app/agent/config/rules.yaml

CMD ["python", "-m", "agent.main"]