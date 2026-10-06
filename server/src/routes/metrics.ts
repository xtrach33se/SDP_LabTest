import { Router, Request, Response } from 'express';
import { FilterOptions } from '../types';
import {
  computeFileMetrics,
  computeDirectoryMetrics,
  computeRepositoryMetrics,
  computeChildrenMetrics,
  computeAllDirectoryMetrics,
  computeAllFileMetrics,
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
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/file?path=src/foo.ts
router.get('/file', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.path) return res.status(400).json({ error: 'path query param is required', code: 'PATH_REQUIRED' });
    const result = computeFileMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/directory?path=src
router.get('/directory', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.path) return res.status(400).json({ error: 'path query param is required', code: 'PATH_REQUIRED' });
    const result = computeDirectoryMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/children?path=src — immediate children breakdown
router.get('/children', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.path) return res.status(400).json({ error: 'path query param is required', code: 'PATH_REQUIRED' });
    const result = computeChildrenMetrics(repoId, filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/files — all files, optionally streamed as NDJSON
router.get('/files', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const result = computeAllFileMetrics(repoId, filter);
    if (req.query.stream === '1') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.flushHeaders();
      for (const metric of result) res.write(`${JSON.stringify(metric)}\n`);
      return res.end();
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/directories — all directories with filtered metrics
router.get('/directories', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    res.json(computeAllDirectoryMetrics(repoId, filter));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
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
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/commits/:hash/files — per-file commit breakdown
router.get('/commits/:hash/files', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT fd.file_path AS path,
             fd.lines_added AS linesAdded,
             fd.lines_removed AS linesRemoved,
             fd.lines_added + fd.lines_removed AS churn
      FROM file_diffs fd
      INNER JOIN commits c ON c.id = fd.commit_id
      WHERE c.repo_id = ? AND c.hash = ?
      ORDER BY churn DESC, fd.file_path
    `).all(Number(req.params.repoId), req.params.hash);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/author-analytics?authorEmail=...
router.get('/author-analytics', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!filter.authorEmail) return res.status(400).json({ error: 'authorEmail is required', code: 'AUTHOR_REQUIRED' });
    const { commitIds } = resolveCommitIds(repoId, filter);
    if (!commitIds.length) return res.json({ weekly: [], topFiles: [] });

    const db = getDb();
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
    db.exec('DELETE FROM _cids');
    const insert = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
    db.transaction((ids: number[]) => { for (const id of ids) insert.run(id); })(commitIds);

    const weekly = db.prepare(`
      SELECT strftime('%Y-%W', c.timestamp, 'unixepoch') AS week,
             COUNT(DISTINCT c.id) AS commits,
             COALESCE(SUM(fd.lines_added + fd.lines_removed), 0) AS churn
      FROM commits c
      INNER JOIN _cids ON _cids.id = c.id
      LEFT JOIN file_diffs fd ON fd.commit_id = c.id
      GROUP BY week
      ORDER BY week
    `).all();
    const authorFiles = db.prepare(`
      SELECT fd.file_path AS path,
             SUM(fd.lines_added + fd.lines_removed) AS churn,
             COUNT(DISTINCT fd.commit_id) AS modifications
      FROM file_diffs fd
      INNER JOIN _cids ON _cids.id = fd.commit_id
      GROUP BY fd.file_path
      ORDER BY churn DESC
      LIMIT 10
    `).all() as { path: string; churn: number; modifications: number }[];
    const totals = computeAllFileMetrics(repoId, { ...filter, authorEmail: undefined });
    const totalByPath = new Map(totals.map(row => [row.path, row.churn]));
    const topFiles = authorFiles.map(row => ({
      ...row,
      totalChurn: totalByPath.get(row.path) ?? row.churn,
      otherChurn: Math.max(0, (totalByPath.get(row.path) ?? row.churn) - row.churn),
      ownership: (totalByPath.get(row.path) ?? 0) > 0
        ? row.churn / (totalByPath.get(row.path) ?? row.churn)
        : 0,
    }));
    res.json({ weekly, topFiles });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

// GET /api/metrics/:repoId/commits — paginated commit list with filters
router.get('/commits', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const filter = parseFilter(req.query as Record<string, unknown>);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(10_000, Math.max(1, Number(req.query.pageSize) || 50));
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
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
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

    let pathWhere = '';
    const pathParams: unknown[] = [];
    if (filter.path) {
      const exactFile = db.prepare(`
        SELECT 1 FROM file_diffs fd
        INNER JOIN commits c ON c.id = fd.commit_id
        WHERE c.repo_id = ? AND fd.file_path = ? LIMIT 1
      `).get(repoId, filter.path);
      if (exactFile) {
        pathWhere = 'WHERE fd.file_path = ?';
        pathParams.push(filter.path);
      } else {
        const escaped = `${filter.path.replace(/\/$/, '')}/`.replace(/[%_\\]/g, '\\$&');
        pathWhere = "WHERE fd.file_path LIKE ? ESCAPE '\\'";
        pathParams.push(`${escaped}%`);
      }
    }

    const rows = db.prepare(`
      SELECT
        c.hash,
        c.timestamp,
        COALESCE(SUM(fd.lines_added),   0) AS linesAdded,
        COALESCE(SUM(fd.lines_removed), 0) AS linesRemoved
      FROM commits c
      INNER JOIN _cids ON _cids.id = c.id
      LEFT JOIN file_diffs fd ON fd.commit_id = c.id
      ${pathWhere}
      GROUP BY c.id
      ORDER BY c.timestamp ASC
    `).all(...pathParams) as { hash: string; timestamp: number; linesAdded: number; linesRemoved: number }[];

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
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
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
    res.status(500).json({ error: (err as Error).message, code: 'METRICS_ERROR' });
  }
});

export default router;
