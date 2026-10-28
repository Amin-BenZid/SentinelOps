# ── Stage 1: build the React UI ──
FROM node:24-alpine AS ui-builder
WORKDIR /ui
COPY ui/package*.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

# ── Stage 2: production dependencies ──
FROM node:24-alpine AS deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 3: minimal runtime ──
# Only `node` + the app. npm, npx, corepack and yarn ship in the base image but
# are never used at runtime, and their bundled dependencies are a frequent
# source of scanner findings, so they are removed.
FROM node:24-alpine
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data && chown node:node /data

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY shared/ ./shared
COPY --from=ui-builder /ui/dist ./ui/dist

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
