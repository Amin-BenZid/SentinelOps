import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import apiRoutes from './routes/api.js';
import { securityHeaders } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use(securityHeaders);
  // Same-origin by default. Only enable CORS for an explicit dev origin.
  if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', apiRoutes);
  app.all('/api/*', (req, res) => res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` }));

  const staticPath = [path.resolve(__dirname, '../ui/dist'), path.resolve(__dirname, '../../ui/dist')]
    .find((p) => fs.existsSync(p));
  if (staticPath) {
    app.use(express.static(staticPath, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(path.join(staticPath, 'index.html')));
    app.locals.staticPath = staticPath;
  }

  // JSON body parse errors etc. -> JSON, never an HTML stack trace
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : 'Internal error' });
  });
  return app;
}
