import { Router, Request, Response } from 'express';
import { getDb } from '../db';

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
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/authors/:repoId/canonical — canonical authors after merging
router.get('/canonical', (req: Request, res: Response) => {
  try {
    const repoId = Number(req.params.repoId);
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        COALESCE(am.canonical_email, c.author_email) AS canonical_email,
        COALESCE(am.canonical_name,  c.author_name)  AS canonical_name,
        COUNT(DISTINCT c.id)                         AS commit_count
      FROM commits c
      LEFT JOIN author_merges am
             ON am.repo_id      = c.repo_id
            AND am.merged_email = c.author_email
      WHERE c.repo_id = ?
      GROUP BY
        COALESCE(am.canonical_email, c.author_email),
        COALESCE(am.canonical_name, c.author_name)
      ORDER BY commit_count DESC
    `).all(repoId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
    res.json({ ok: true, merged: mergedEmails.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/authors/:repoId/merge/:id — remove a manual merge entry
router.delete('/merge/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM author_merges WHERE id = ? AND repo_id = ?')
      .run(Number(req.params.id), Number(req.params.repoId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
    res.status(500).json({ error: (err as Error).message });
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
    res.json({ ok: true, applied });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
