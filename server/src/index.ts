import express from 'express';
import cors from 'cors';
import path from 'path';
import { performance } from 'node:perf_hooks';
import { getDb } from './db';
import repositoriesRouter from './routes/repositories';
import metricsRouter from './routes/metrics';
import authorsRouter from './routes/authors';
import { AppError, errorDetails } from './errors';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use((_req, res, next) => {
  const started = performance.now();
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    res.setHeader('X-Query-Time-Ms', (performance.now() - started).toFixed(2));
    return sendJson(body);
  }) as typeof res.json;
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/repositories', repositoriesRouter);
app.use('/api/metrics/:repoId', metricsRouter);
app.use('/api/authors/:repoId', authorsRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use('/api', (_req, _res, next) => {
  next(new AppError('API endpoint not found.', 'NOT_FOUND', 404));
});

// ─── Serve built frontend in production ───────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const details = errorDetails(err);
  if (details.status >= 500) console.error('[unhandled error]', err);
  res.status(details.status).json({ error: details.message, code: details.code });
});

// ─── Start ────────────────────────────────────────────────────────────────────
getDb(); // initialise DB schema on startup
app.listen(PORT, () => {
  console.log(`RAT server running on http://localhost:${PORT}`);
});

export default app;
