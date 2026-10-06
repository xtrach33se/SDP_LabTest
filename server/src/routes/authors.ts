import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { clearMetricCache } from '../services/metrics';

const router = Router({ mergeParams: true });

// GET /api/authors/:repoId — all raw authors before merging
router.get('/', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        c.author_email                              AS raw_email,
        c.author_name                               AS raw_name,
        COALESCE(am.canonical_email, c.author_email) AS canonical_email,
        COALESCE(am.canonical_name,  c.author_name)  AS canonical_name,
        COUNT(DISTINCT c.id)                        AS commit_count
      FROM commits c
      LEFT JOIN author_merges am
             ON am.repo_id      = c.repo_id
            AND am.merged_email = c.author_email
      WHERE c.repo_id = ?
      GROUP BY c.author_email, c.author_name
      ORDER BY commit_count DESC
    `).all(repoId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'AUTHORS_ERROR' });
  }
});

// GET /api/authors/:repoId/canonical — canonical authors after merging
router.get('/canonical', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const db = getDb();
    const rows = db.prepare(`
      WITH identity_diffs AS (
        SELECT c.id AS commit_id,
               COALESCE(am.canonical_email, c.author_email) AS canonical_email,
               COALESCE(am.canonical_name, c.author_name) AS canonical_name,
               fd.file_path,
               COALESCE(fd.lines_added + fd.lines_removed, 0) AS churn
        FROM commits c
        LEFT JOIN author_merges am
               ON am.repo_id = c.repo_id
              AND am.merged_email = c.author_email
        LEFT JOIN file_diffs fd ON fd.commit_id = c.id
        WHERE c.repo_id = ?
      ),
      totals AS (
        SELECT canonical_email, canonical_name,
               COUNT(DISTINCT commit_id) AS commit_count,
               SUM(churn) AS total_churn
        FROM identity_diffs
        GROUP BY canonical_email, canonical_name
      ),
      file_ranks AS (
        SELECT canonical_email, canonical_name, file_path,
               ROW_NUMBER() OVER (
                 PARTITION BY file_path
                 ORDER BY SUM(churn) DESC
               ) AS owner_rank
        FROM identity_diffs
        WHERE file_path IS NOT NULL
        GROUP BY canonical_email, canonical_name, file_path
      ),
      owned AS (
        SELECT canonical_email, canonical_name, COUNT(*) AS owned_files_count
        FROM file_ranks
        WHERE owner_rank = 1
        GROUP BY canonical_email, canonical_name
      )
      SELECT totals.canonical_email,
             totals.canonical_name,
             totals.commit_count,
             totals.total_churn,
             COALESCE(owned.owned_files_count, 0) AS owned_files_count
      FROM totals
      LEFT JOIN owned USING (canonical_email, canonical_name)
      ORDER BY totals.total_churn DESC
    `).all(repoId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'AUTHORS_ERROR' });
  }
});

// POST /api/authors/:repoId/merge — manually merge emails into a canonical identity
router.post('/merge', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const { canonicalEmail, canonicalName, mergedEmails } = req.body as {
      canonicalEmail?: string;
      canonicalName?: string;
      mergedEmails?: string[];
    };
    if (!canonicalEmail || !canonicalName || !Array.isArray(mergedEmails)) {
      return res.status(400).json({ error: 'canonicalEmail, canonicalName, mergedEmails[] required' });
    }

    const db = getDb();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO author_merges
        (repo_id, canonical_email, canonical_name, merged_email)
      VALUES (?, ?, ?, ?)
    `);
    const insertAll = db.transaction((emails: string[]) => {
      const identities = [...new Set([...emails, canonicalEmail])];
      const placeholders = identities.map(() => '?').join(',');

      // Flatten existing groups so metrics only need one canonical lookup.
      db.prepare(`
        UPDATE author_merges
        SET canonical_email = ?, canonical_name = ?
        WHERE repo_id = ? AND canonical_email IN (${placeholders})
      `).run(canonicalEmail, canonicalName, repoId, ...identities);

      for (const email of identities) {
        insert.run(repoId, canonicalEmail, canonicalName, email);
      }
    });
    insertAll(mergedEmails);
    clearMetricCache(repoId);
    res.json({ ok: true, merged: mergedEmails.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'AUTHORS_ERROR' });
  }
});

// DELETE /api/authors/:repoId/merge/:id — remove a manual merge entry
router.delete('/merge/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const repoId = Number(req.params.repoId);
    db.prepare('DELETE FROM author_merges WHERE id = ? AND repo_id = ?')
      .run(Number(req.params.id), repoId);
    clearMetricCache(repoId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'AUTHORS_ERROR' });
  }
});

// GET /api/authors/:repoId/merges — list all current merge rules
router.get('/merges', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM author_merges WHERE repo_id = ? ORDER BY canonical_email
    `).all(repoId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'AUTHORS_ERROR' });
  }
});

// POST /api/authors/:repoId/apply-mailmap — re-sync mailmap from DB entries
router.post('/apply-mailmap', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const db = getDb();

    const entries = db.prepare(`
      SELECT * FROM mailmap_entries WHERE repo_id = ?
    `).all(repoId) as {
      canonical_name: string | null;
      canonical_email: string | null;
      from_name: string | null;
      from_email: string;
    }[];

    if (entries.length === 0) {
      return res.json({ ok: true, applied: 0 });
    }

    const insert = db.prepare(`
      INSERT OR REPLACE INTO author_merges
        (repo_id, canonical_email, canonical_name, merged_email)
      VALUES (?, ?, ?, ?)
    `);
    const applyAll = db.transaction(() => {
      let count = 0;
      for (const e of entries) {
        if (!e.canonical_email) continue;
        insert.run(repoId, e.canonical_email, e.canonical_name ?? e.canonical_email, e.from_email);
        count++;
      }
      return count;
    });

    const applied = applyAll();
    clearMetricCache(repoId);
    res.json({ ok: true, applied });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'AUTHORS_ERROR' });
  }
});

export default router;
