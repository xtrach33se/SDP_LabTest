import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getDb } from '../db';
import { ingestZip, ingestUrl } from '../services/ingestor';
import { IngestionProgress } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// In-memory SSE progress store: jobId → list of SSE clients
const progressClients = new Map<string, Response[]>();
const progressStore = new Map<string, IngestionProgress>();

function broadcastProgress(jobId: string, p: IngestionProgress): void {
  progressStore.set(jobId, p);
  const clients = progressClients.get(jobId) ?? [];
  const data = `data: ${JSON.stringify(p)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { /* client disconnected */ }
  }
  if (p.stage === 'done' || p.stage === 'error') {
    clients.forEach(r => { try { r.end(); } catch { /* */ } });
    progressClients.delete(jobId);
  }
}

// GET /api/repositories — list all repositories
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const repos = db.prepare(`
    SELECT r.*, COUNT(c.id) AS commit_count
    FROM repositories r
    LEFT JOIN commits c ON c.repo_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(repos);
});

// POST /api/repositories/upload — ingest a ZIP file
router.post('/upload', upload.single('repo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const name = (req.body.name as string) || req.file.originalname.replace(/\.zip$/i, '');
    const jobId = `zip-${Date.now()}`;
    res.json({ jobId });

    ingestZip(req.file.buffer, name, (p) => broadcastProgress(jobId, p)).catch((err) =>
      broadcastProgress(jobId, {
        repoId: null, stage: 'error',
        message: (err as Error).message, current: 0, total: 0,
      })
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/repositories/clone — ingest a remote URL
router.post('/clone', async (req: Request, res: Response) => {
  try {
    const { url, name } = req.body as { url?: string; name?: string };
    if (!url) return res.status(400).json({ error: 'url is required' });
    const repoName = name || url.split('/').pop()?.replace(/\.git$/, '') || 'repo';
    const jobId = `clone-${Date.now()}`;
    res.json({ jobId });

    ingestUrl(url, repoName, (p) => broadcastProgress(jobId, p)).catch((err) =>
      broadcastProgress(jobId, {
        repoId: null, stage: 'error',
        message: (err as Error).message, current: 0, total: 0,
      })
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/repositories/:id — get a single repository
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const repo = db.prepare(`
    SELECT r.*, COUNT(c.id) AS commit_count
    FROM repositories r
    LEFT JOIN commits c ON c.repo_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(Number(req.params.id));
  if (!repo) return res.status(404).json({ error: 'Repository not found' });
  res.json(repo);
});

// DELETE /api/repositories/:id — remove a repository and all its data
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/repositories/:jobId/progress — SSE stream for ingestion progress
router.get('/:jobId/progress', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send any cached progress immediately
  const cached = progressStore.get(jobId);
  if (cached) res.write(`data: ${JSON.stringify(cached)}\n\n`);

  if (!progressClients.has(jobId)) progressClients.set(jobId, []);
  progressClients.get(jobId)!.push(res);

  req.on('close', () => {
    const list = progressClients.get(jobId) ?? [];
    const idx = list.indexOf(res);
    if (idx !== -1) list.splice(idx, 1);
  });
});

export default router;
