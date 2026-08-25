import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { Server } from 'http';
import type { ErrorRequestHandler } from 'express';

import pool from './config/db';
import requestId from './middleware/requestId';
import auditRoutes from './routes/audit.routes';

const app = express();
app.set('trust proxy', 1);

app.use(requestId);

app.use(
  cors(
    process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
      ? { origin: process.env.CORS_ORIGIN.split(',') }
      : {},
  ),
);

app.use(express.json({ limit: '2mb' }));

app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  auditRoutes,
);
// Also mounted bare so the app's sink can post to `${baseURL}/logs`
// whether or not its baseURL already ends in /api.
app.use(auditRoutes);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

// app.use((_req, res) => {
//   res.status(404).json({ error: 'Not found' });
// });

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { type } = (err ?? {}) as { type?: string };

  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  console.error(`[${req.requestId}]`, err);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(errorHandler);

const port = Number(process.env.PORT || 8080);
const server: Server = app.listen(port, () => {
  console.log(`AuditServer listening on :${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
