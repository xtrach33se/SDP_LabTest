import { Router, Request, Response } from 'express';
import { FilterOptions } from '../types';
import {
  computeFileMetrics,
  computeDirectoryMetrics,
  computeRepositoryMetrics,
  computeChildrenMetrics,
  computeAllDirectoryMetrics,
  resolveCommitIds,
  listAllFilePaths,
  listAllDirectoryPaths,
} from '../services/metrics';
import { getDb } from '../db';

const router = Router({ mergeParams: true });

// ─── Parse filter from query string ──────────────────────────────────────────

function parseFilter(query: Record<string, unknown>): FilterOptions {
  const filter: FilterOptions = {};

  if (typeof query.authorEmail === 'string') filter.authorEmail = query.authorEmail;
  if (typeof query.path === 'string') filter.path = query.path;
  if (typeof query.startDate === 'string') filter.startDate = query.startDate;
  if (typeof query.endDate === 'string') filter.endDate = query.endDate;

  if (query.commitHashes) {
    if (Array.isArray(query.commitHashes)) {
      filter.commitHashes = query.commitHashes as string[];
    } else if (typeof query.commitHashes === 'string') {
      filter.commitHashes = query.commitHashes.split(',');
    }
  }

  return filter;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/metrics/:repoId/repository
router.get('/repository', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const result = computeRepositoryMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/file?path=src/foo.ts
router.get('/file', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.path) return res.status(400).json({ error: 'path query param is required' });
    const result = computeFileMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/directory?path=src
router.get('/directory', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.path) return res.status(400).json({ error: 'path query param is required' });
    const result = computeDirectoryMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/children?path=src — immediate children breakdown
router.get('/children', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.path) return res.status(400).json({ error: 'path query param is required' });
    const result = computeChildrenMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/files — all files with their metrics (sorted by churn)
router.get('/files', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const { commitIds, setSize } = resolveCommitIds(repoId, filter);

    if (commitIds.length === 0) return res.json([]);

    const db = getDb();
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
    db.exec('DELETE FROM _cids');
    const ins = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
    const insMany = db.transaction((ids: number[]) => { for (const id of ids) ins.run(id); });
    insMany(commitIds);

    const rows = db.prepare(`
      SELECT
        fd.file_path,
        COALESCE(SUM(fd.lines_added),   0) AS linesAdded,
        COALESCE(SUM(fd.lines_removed), 0) AS linesRemoved,
        COUNT(DISTINCT CASE WHEN (fd.lines_added + fd.lines_removed) > 0
                            THEN fd.commit_id END) AS modifications
      FROM file_diffs fd
      INNER JOIN _cids ON _cids.id = fd.commit_id
      GROUP BY fd.file_path
      ORDER BY (SUM(fd.lines_added) + SUM(fd.lines_removed)) DESC
    `).all() as { file_path: string; linesAdded: number; linesRemoved: number; modifications: number }[];

    const result = rows.map(r => ({
      path: r.file_path,
      linesAdded: r.linesAdded,
      linesRemoved: r.linesRemoved,
      growth: r.linesAdded - r.linesRemoved,
      churn: r.linesAdded + r.linesRemoved,
      modifications: r.modifications,
      modificationFrequency: setSize > 0 ? r.modifications / setSize : 0,
      churnRate: setSize > 0 ? (r.linesAdded + r.linesRemoved) / setSize : 0,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/directories — all directories with filtered metrics
router.get('/directories', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    res.json(computeAllDirectoryMetrics(repoId, filter));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/authors — all canonical authors with totals
router.get('/authors', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const result = computeRepositoryMetrics(repoId, filter);

    // Total churn for ownership computation
    const totalChurn = result.churn;

    const authors = result.authors.map(a => ({
      email: a.email,
      name: a.name,
      modifications: a.modifications,
      churn: a.churn,
      linesAdded: a.linesAdded,
      linesRemoved: a.linesRemoved,
      ownership: totalChurn > 0 ? a.churn / totalChurn : 0,
    }));
    res.json(authors);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/commits — paginated commit list with filters
router.get('/commits', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const offset = (page - 1) * pageSize;

    const { commitIds, setSize } = resolveCommitIds(repoId, filter);
    if (commitIds.length === 0) return res.json({ commits: [], total: 0, page, pageSize });

    const db = getDb();
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
    db.exec('DELETE FROM _cids');
    const ins = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
    const insMany = db.transaction((ids: number[]) => { for (const id of ids) ins.run(id); });
    insMany(commitIds);

    let searchWhere = '';
    const searchParams: unknown[] = [];
    if (search) {
      searchWhere = "AND (c.message LIKE ? OR c.author_name LIKE ? OR c.author_email LIKE ?)";
      searchParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const total = (db.prepare(`
      SELECT COUNT(*) AS cnt FROM commits c
      INNER JOIN _cids ON _cids.id = c.id
      WHERE 1=1 ${searchWhere}
    `).get(...searchParams) as { cnt: number }).cnt;

    const rows = db.prepare(`
      SELECT
        c.hash, c.author_name, c.author_email, c.timestamp, c.message,
        COALESCE(SUM(fd.lines_added),   0) AS linesAdded,
        COALESCE(SUM(fd.lines_removed), 0) AS linesRemoved
      FROM commits c
      INNER JOIN _cids ON _cids.id = c.id
      LEFT JOIN file_diffs fd ON fd.commit_id = c.id
      WHERE 1=1 ${searchWhere}
      GROUP BY c.id
      ORDER BY c.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...searchParams, pageSize, offset);

    res.json({ commits: rows, total, page, pageSize, setSize });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/timeline — per-commit churn/growth time series
router.get('/timeline', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const { commitIds } = resolveCommitIds(repoId, filter);
    if (commitIds.length === 0) return res.json([]);

    const db = getDb();
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
    db.exec('DELETE FROM _cids');
    const ins = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
    const insMany = db.transaction((ids: number[]) => { for (const id of ids) ins.run(id); });
    insMany(commitIds);

    const rows = db.prepare(`
      SELECT
        c.hash,
        c.timestamp,
        COALESCE(SUM(fd.lines_added),   0) AS linesAdded,
        COALESCE(SUM(fd.lines_removed), 0) AS linesRemoved
      FROM commits c
      INNER JOIN _cids ON _cids.id = c.id
      LEFT  JOIN file_diffs fd ON fd.commit_id = c.id
      GROUP BY c.id
      ORDER BY c.timestamp ASC
    `).all() as { hash: string; timestamp: number; linesAdded: number; linesRemoved: number }[];

    const result = rows.map(r => ({
      hash: r.hash,
      timestamp: r.timestamp,
      linesAdded: r.linesAdded,
      linesRemoved: r.linesRemoved,
      growth: r.linesAdded - r.linesRemoved,
      churn: r.linesAdded + r.linesRemoved,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/metrics/:repoId/paths — all known file and directory paths
router.get('/paths', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const files = listAllFilePaths(repoId);
    const dirs = listAllDirectoryPaths(repoId);
    res.json({ files, directories: dirs });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
