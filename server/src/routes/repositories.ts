import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getDb } from '../db';
import { ingestZip, ingestUrl } from '../services/ingestor';
import { IngestionProgress } from '../types';
import { DuplicateRepositoryError } from '../services/gitParser';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, /\.zip$/i.test(file.originalname));
  },
});

function normaliseUrl(value: string): string {
  return value.trim().replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase();
}

function isGitUrl(value: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(value.trim());
}

function ingestionFailure(error: unknown): IngestionProgress {
  const duplicate = error instanceof DuplicateRepositoryError ? error : null;
  return {
    repoId: null,
    stage: 'error',
    message: error instanceof Error ? error.message : 'Repository ingestion failed.',
    current: 0,
    total: 0,
    code: duplicate ? 'DUPLICATE_REPOSITORY' : 'INGESTION_FAILED',
    existingRepoId: duplicate?.existingRepoId,
  };
}

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
    if (!req.file) return res.status(400).json({ error: 'Choose a valid .zip repository archive.' });
    const name = String(req.body.name || req.file.originalname.replace(/\.zip$/i, '')).trim();
    const force = req.body.force === 'true';
    const jobId = `zip-${Date.now()}`;
    res.json({ jobId });

    ingestZip(req.file.buffer, name, p => broadcastProgress(jobId, p), force).catch(error =>
      broadcastProgress(jobId, ingestionFailure(error))
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/repositories/clone — ingest a remote URL
router.post('/clone', async (req: Request, res: Response) => {
  try {
    const { url, name, force = false } = req.body as { url?: string; name?: string; force?: boolean };
    if (!url || !isGitUrl(url)) {
      return res.status(400).json({ error: 'Enter a valid HTTPS, SSH, or git@ repository URL.' });
    }

    const db = getDb();
    const existing = (db.prepare('SELECT id, url FROM repositories WHERE url IS NOT NULL').all() as {
      id: number;
      url: string;
    }[]).find(repo => normaliseUrl(repo.url) === normaliseUrl(url));
    if (existing && !force) {
      return res.status(409).json({
        error: 'This repository URL has already been imported.',
        code: 'DUPLICATE_REPOSITORY',
        existingRepoId: existing.id,
      });
    }

    const repoName = name?.trim() || url.split('/').pop()?.replace(/\.git$/, '') || 'repo';
    const jobId = `clone-${Date.now()}`;
    res.json({ jobId });

    ingestUrl(url.trim(), repoName, p => broadcastProgress(jobId, p), force).catch(error =>
      broadcastProgress(jobId, ingestionFailure(error))
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
