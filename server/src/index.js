import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import { setupWebSocket } from './websocket.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// 1. API Endpoints
app.use('/api', apiRoutes);

// Catch-all for undefined API routes (Guarantees pure JSON, NEVER HTML)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// 1. API Endpoints
app.use('/api', apiRoutes);

// 2. Resolve Static Path for UI (Handles both Docker & Local Windows Dev)
const dockerStaticPath = path.resolve(__dirname, '../ui/dist');    // Inside Docker: /app/ui/dist
const localStaticPath = path.resolve(__dirname, '../../ui/dist');  // Local dev: sentinelops/ui/dist

let staticPath = null;
if (fs.existsSync(dockerStaticPath)) {
  staticPath = dockerStaticPath;
} else if (fs.existsSync(localStaticPath)) {
  staticPath = localStaticPath;
}

if (staticPath) {
  console.log(`[*] Serving production UI from: ${staticPath}`);
  app.use(express.static(staticPath));

  // SPA Catch-all: serve index.html for React Router, but keep /api as 404 JSON
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  console.log('[!] Production UI build (ui/dist) not found.');
  console.log('[*] Running in API-only mode on port ' + PORT);
}

// 3. Bind HTTP and WebSocket Servers
const server = http.createServer(app);
setupWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[🚀] SentinelOps Console ready at http://0.0.0.0:${PORT}`);
  console.log(`[⚡] WebSocket stream available on port ${PORT}`);
});