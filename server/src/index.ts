import express from 'express';
import cors from 'cors';
import path from 'path';
import { getDb } from './db';
import repositoriesRouter from './routes/repositories';
import metricsRouter from './routes/metrics';
import authorsRouter from './routes/authors';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/repositories', repositoriesRouter);
app.use('/api/metrics/:repoId', metricsRouter);
app.use('/api/authors/:repoId', authorsRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
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
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled error]', err.message);
  res.status(500).json({ error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
getDb(); // initialise DB schema on startup
app.listen(PORT, () => {
  console.log(`RAT server running on http://localhost:${PORT}`);
});

export default app;
