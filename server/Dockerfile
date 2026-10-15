# ── Stage 1: Build React TypeScript UI ──
FROM node:24-alpine AS ui-builder
WORKDIR /ui
COPY ui/package*.json ./
RUN npm install
COPY ui/ ./
RUN npm run build

# ── Stage 2: Node.js 24 Server ──
FROM node:24-alpine
WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/src ./src
COPY shared/ ./shared
COPY --from=ui-builder /ui/dist ./ui/dist

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/data/sentinelops.db

EXPOSE 4000

CMD ["node", "src/index.js"]