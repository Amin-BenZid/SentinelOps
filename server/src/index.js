import 'dotenv/config';
import http from 'node:http';
import { createApp } from './app.js';
import { setupWebSocket } from './websocket.js';
import { startOutboxWorker } from './services/outbox.js';
import { authService } from './services/auth.js';

const PORT = Number(process.env.PORT || 4000);
const app = createApp();
const server = http.createServer(app);
setupWebSocket(server);
startOutboxWorker();
setInterval(() => authService.purgeExpired(), 10 * 60_000).unref();

console.log(app.locals.staticPath ? `[*] Serving UI from ${app.locals.staticPath}` : '[!] ui/dist not found: API-only mode');

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[*] SentinelOps dashboard on http://0.0.0.0:${PORT} (WebSocket: /ws)`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
