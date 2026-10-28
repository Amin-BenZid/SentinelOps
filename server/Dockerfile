# ── Stage 1: build the React UI ──
FROM node:24-alpine AS ui-builder
WORKDIR /ui
COPY ui/package*.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

# ── Stage 2: production server ──
FROM node:24-alpine
WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/src ./src
COPY shared/ ./shared
COPY --from=ui-builder /ui/dist ./ui/dist

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/sentinelops.db \
    MIGRATIONS_DIR=/app/shared/migrations

# official image ships an unprivileged "node" user (uid 1000)
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
