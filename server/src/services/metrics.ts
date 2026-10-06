import * as crypto from 'crypto';
import { getDb } from '../db';
import { MetricResult, AuthorMetric, FilterOptions } from '../types';

type Db = ReturnType<typeof getDb>;

const directoryMetricCache = new Map<string, MetricResult>();
const MAX_DIRECTORY_CACHE_ENTRIES = 500;

export function clearMetricCache(repoId?: number): void {
  if (repoId == null) {
    directoryMetricCache.clear();
    return;
  }
  for (const key of directoryMetricCache.keys()) {
    if (key.startsWith(`${repoId}:`)) directoryMetricCache.delete(key);
  }
}

function rememberDirectoryMetric(key: string, result: MetricResult): void {
  if (directoryMetricCache.size >= MAX_DIRECTORY_CACHE_ENTRIES) {
    const oldest = directoryMetricCache.keys().next().value as string | undefined;
    if (oldest) directoryMetricCache.delete(oldest);
  }
  directoryMetricCache.set(key, result);
}

// ─── Commit set resolution ────────────────────────────────────────────────────

/**
 * Resolve a FilterOptions object into the concrete set of commit IDs
 * (internal DB IDs, not hashes) matching the filter for a given repo.
 *
 * Also returns the count of total commits in the set (|H|).
 */
export function resolveCommitIds(
  repoId: number,
  filter: FilterOptions
): { commitIds: number[]; setSize: number } {
  const db = getDb();
  const params: unknown[] = [repoId];
  let where = 'WHERE c.repo_id = ?';

  if (filter.commitHashes && filter.commitHashes.length > 0) {
    // Manual commit selection — split into chunks to stay within SQLite's
    // 999-variable limit.
    const hashes = filter.commitHashes;
    const ids: number[] = [];
    const CHUNK = 900;
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk = hashes.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id FROM commits WHERE repo_id = ? AND hash IN (${placeholders})`
        )
        .all(repoId, ...chunk) as { id: number }[];
      ids.push(...rows.map((r) => r.id));
    }
    return { commitIds: ids, setSize: ids.length };
  }

  if (filter.startDate) {
    where += ' AND c.timestamp >= ?';
    params.push(Math.floor(new Date(filter.startDate).getTime() / 1000));
  }
  if (filter.endDate) {
    where += ' AND c.timestamp <= ?';
    params.push(Math.floor(new Date(filter.endDate).getTime() / 1000));
  }
  if (filter.authorEmail) {
    const canonical = resolveCanonicalEmail(repoId, filter.authorEmail);
    // Include all emails that resolve to this canonical
    const aliasEmails = getAliasEmails(repoId, canonical);
    if (aliasEmails.length > 0) {
      const placeholders = aliasEmails.map(() => '?').join(',');
      where += ` AND c.author_email IN (${placeholders})`;
      params.push(...aliasEmails);
    } else {
      where += ' AND c.author_email = ?';
      params.push(canonical);
    }
  }

  const rows = db
    .prepare(`SELECT id FROM commits c ${where}`)
    .all(...params) as { id: number }[];

  const ids = rows.map((r) => r.id);
  return { commitIds: ids, setSize: ids.length };
}

// ─── Author merge resolution ──────────────────────────────────────────────────

/** Map a raw email to its canonical email using author_merges. */
export function resolveCanonicalEmail(repoId: number, email: string): string {
  const db = getDb();
  const seen = new Set<string>();
  let current = email;

  while (!seen.has(current)) {
    seen.add(current);
    const row = db
      .prepare(
        'SELECT canonical_email FROM author_merges WHERE repo_id = ? AND merged_email = ?'
      )
      .get(repoId, current) as { canonical_email: string } | undefined;
    if (!row || row.canonical_email === current) break;
    current = row.canonical_email;
  }

  return current;
}

/**
 * Return all raw emails that map to canonicalEmail (including itself),
 * so we can query by any of them.
 */
function getAliasEmails(repoId: number, canonicalEmail: string): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT canonical_email, merged_email FROM author_merges WHERE repo_id = ?')
    .all(repoId) as { canonical_email: string; merged_email: string }[];
  const aliases = new Set<string>([canonicalEmail]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (aliases.has(row.canonical_email) && !aliases.has(row.merged_email)) {
        aliases.add(row.merged_email);
        changed = true;
      }
    }
  }

  return [...aliases];
}

/** Return the canonical name for an email (falls back to the email itself). */
function resolveCanonicalName(repoId: number, email: string): string {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT canonical_name FROM author_merges WHERE repo_id = ? AND canonical_email = ? LIMIT 1'
    )
    .get(repoId, email) as { canonical_name: string } | undefined;
  if (row) return row.canonical_name;
  // Fall back to most recent commit name for this email
  const commitRow = db
    .prepare(
      `SELECT author_name FROM commits
       WHERE repo_id = ? AND author_email = ?
       ORDER BY timestamp DESC LIMIT 1`
    )
    .get(repoId, email) as { author_name: string } | undefined;
  return commitRow ? commitRow.author_name : email;
}

// ─── Core aggregation helpers ─────────────────────────────────────────────────

interface RawAgg {
  lines_added: number;
  lines_removed: number;
  modifications: number;
}

/**
 * Aggregate file_diffs for a given commit set and path condition.
 *
 * pathCondition: SQL fragment applied to fd.file_path (must use only
 * already-bound parameters; caller passes extra params in extraParams).
 */
function aggregate(
  db: Db,
  commitIds: number[],
  pathCondition: string,
  extraParams: unknown[]
): RawAgg {
  if (commitIds.length === 0) {
    return { lines_added: 0, lines_removed: 0, modifications: 0 };
  }

  // Insert commit IDs into a temp table to avoid the 999-variable limit and
  // enable efficient index usage.
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
  db.exec('DELETE FROM _cids');
  const insertCid = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
  const insertMany = db.transaction((ids: number[]) => {
    for (const id of ids) insertCid.run(id);
  });
  insertMany(commitIds);

  const sql = `
    SELECT
      COALESCE(SUM(fd.lines_added),   0) AS lines_added,
      COALESCE(SUM(fd.lines_removed), 0) AS lines_removed,
      COUNT(DISTINCT CASE WHEN (fd.lines_added + fd.lines_removed) > 0
                          THEN fd.commit_id END)        AS modifications
    FROM file_diffs fd
    INNER JOIN _cids ON _cids.id = fd.commit_id
    WHERE ${pathCondition}
  `;
  return db.prepare(sql).get(...extraParams) as RawAgg;
}

/** Per-author aggregation over the same commit set and path condition. */
interface AuthorRaw {
  canonical_email: string;
  canonical_name: string;
  lines_added: number;
  lines_removed: number;
  modifications: number;
}

function aggregateByAuthor(
  db: Db,
  repoId: number,
  commitIds: number[],
  pathCondition: string,
  extraParams: unknown[]
): AuthorRaw[] {
  if (commitIds.length === 0) return [];

  // _cids is already populated by aggregate()
  const sql = `
    SELECT
      COALESCE(am.canonical_email, c.author_email) AS canonical_email,
      COALESCE(am.canonical_name, c.author_name)   AS canonical_name,
      COALESCE(SUM(fd.lines_added),   0)           AS lines_added,
      COALESCE(SUM(fd.lines_removed), 0)           AS lines_removed,
      COUNT(DISTINCT CASE WHEN (fd.lines_added + fd.lines_removed) > 0
                          THEN fd.commit_id END)   AS modifications
    FROM file_diffs fd
    INNER JOIN _cids           ON _cids.id = fd.commit_id
    INNER JOIN commits c       ON c.id     = fd.commit_id
    LEFT  JOIN author_merges am
           ON am.repo_id      = c.repo_id
          AND am.merged_email = c.author_email
    WHERE c.repo_id = ? AND ${pathCondition}
    GROUP BY
      COALESCE(am.canonical_email, c.author_email),
      COALESCE(am.canonical_name, c.author_name)
    ORDER BY (SUM(fd.lines_added) + SUM(fd.lines_removed)) DESC
  `;
  return db.prepare(sql).all(repoId, ...extraParams) as AuthorRaw[];
}

// ─── Public metric functions ──────────────────────────────────────────────────

function buildResult(
  raw: RawAgg,
  authorRaws: AuthorRaw[],
  setSize: number,
  repoId: number
): MetricResult {
  const churn = raw.lines_added + raw.lines_removed;

  const authors: AuthorMetric[] = authorRaws.map((a) => {
    const aChurn = a.lines_added + a.lines_removed;
    return {
      email: a.canonical_email,
      name: a.canonical_name || resolveCanonicalName(repoId, a.canonical_email),
      linesAdded: a.lines_added,
      linesRemoved: a.lines_removed,
      modifications: a.modifications,
      churn: aChurn,
      ownership: churn > 0 ? aChurn / churn : 0,
    };
  });

  return {
    linesAdded: raw.lines_added,
    linesRemoved: raw.lines_removed,
    growth: raw.lines_added - raw.lines_removed,
    churn,
    modifications: raw.modifications,
    modificationFrequency: setSize > 0 ? raw.modifications / setSize : 0,
    churnRate: setSize > 0 ? churn / setSize : 0,
    authors,
  };
}

/**
 * Compute metrics for a single file path over a commit set.
 * Implements: l+_Ho, l-_Ho, δ_Ho, λ_Ho, n_Ho, η_Ho, ρ_Ho, and author metrics.
 */
export function computeFileMetrics(
  repoId: number,
  filter: FilterOptions
): MetricResult {
  if (!filter.path) throw new Error('path is required for file metrics');
  const db = getDb();
  const { commitIds, setSize } = resolveCommitIds(repoId, filter);

  const pathCond = 'fd.file_path = ?';
  const raw = aggregate(db, commitIds, pathCond, [filter.path]);
  const authors = aggregateByAuthor(db, repoId, commitIds, pathCond, [filter.path]);

  return buildResult(raw, authors, setSize, repoId);
}

/**
 * Compute metrics for a directory path over a commit set.
 * Directory metrics = sum over ALL files anywhere under dirPath (recursive),
 * which equals the sum of immediate children metrics by induction.
 */
export function computeDirectoryMetrics(
  repoId: number,
  filter: FilterOptions
): MetricResult {
  if (!filter.path) throw new Error('path is required for directory metrics');
  const db = getDb();
  const { commitIds, setSize } = resolveCommitIds(repoId, filter);
  const dirPath = filter.path.replace(/\/$/, '');
  const cacheKey = `${repoId}:${dirPath}:${commitSetHash(commitIds)}`;
  const cached = directoryMetricCache.get(cacheKey);
  if (cached) return cached;

  const prefix = dirPath + '/';
  const escapedPrefix = prefix.replace(/[%_\\]/g, '\\$&');
  const pathCond = "(fd.file_path = ? OR fd.file_path LIKE ? ESCAPE '\\')";
  const extraParams = [dirPath, escapedPrefix + '%'];

  const raw = aggregate(db, commitIds, pathCond, extraParams);
  const authors = aggregateByAuthor(db, repoId, commitIds, pathCond, extraParams);
  const result = buildResult(raw, authors, setSize, repoId);
  rememberDirectoryMetric(cacheKey, result);
  return result;
}

/**
 * Compute repository-level metrics (directory metrics on root "/").
 */
export function computeRepositoryMetrics(
  repoId: number,
  filter: FilterOptions
): MetricResult {
  const db = getDb();
  const { commitIds, setSize } = resolveCommitIds(repoId, filter);

  // Root = all files
  const pathCond = '1=1';
  const raw = aggregate(db, commitIds, pathCond, []);
  const authors = aggregateByAuthor(db, repoId, commitIds, pathCond, []);

  return buildResult(raw, authors, setSize, repoId);
}

// ─── Directory children breakdown ────────────────────────────────────────────

export interface ChildMetric {
  name: string;
  path: string;
  type: 'file' | 'directory';
  linesAdded: number;
  linesRemoved: number;
  growth: number;
  churn: number;
  modifications: number;
}

/**
 * Return per-immediate-child metrics for a directory over a commit set.
 * "Immediate child" = one path component deeper than dirPath.
 */
export function computeChildrenMetrics(
  repoId: number,
  filter: FilterOptions
): ChildMetric[] {
  if (!filter.path) throw new Error('path is required for children metrics');
  const db = getDb();
  const { commitIds } = resolveCommitIds(repoId, filter);
  if (commitIds.length === 0) return [];

  db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
  db.exec('DELETE FROM _cids');
  const insertCid = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
  const ins = db.transaction((ids: number[]) => { for (const id of ids) insertCid.run(id); });
  ins(commitIds);

  const dirPath = filter.path.replace(/\/$/, '');
  const prefix = dirPath + '/';
  const escapedPrefix = prefix.replace(/[%_\\]/g, '\\$&');

  // Pull all matching file diffs with their paths
  const rows = db.prepare(`
    SELECT fd.file_path,
           COALESCE(SUM(fd.lines_added),   0) AS la,
           COALESCE(SUM(fd.lines_removed), 0) AS lr,
           COUNT(DISTINCT CASE WHEN (fd.lines_added + fd.lines_removed) > 0
                               THEN fd.commit_id END) AS mods
    FROM file_diffs fd
    INNER JOIN _cids ON _cids.id = fd.commit_id
    WHERE fd.file_path LIKE ? ESCAPE '\\'
    GROUP BY fd.file_path
  `).all(escapedPrefix + '%') as { file_path: string; la: number; lr: number; mods: number }[];

  // Group into immediate children
  const childMap = new Map<string, ChildMetric>();

  for (const row of rows) {
    const relative = row.file_path.slice(prefix.length); // e.g. "src/foo.ts" or "src/bar/baz.ts"
    const slash = relative.indexOf('/');
    const isFile = slash === -1;
    const childName = isFile ? relative : relative.slice(0, slash);
    const childPath = prefix + childName;
    const type: 'file' | 'directory' = isFile ? 'file' : 'directory';

    const existing = childMap.get(childPath);
    if (existing) {
      existing.linesAdded += row.la;
      existing.linesRemoved += row.lr;
      existing.growth += row.la - row.lr;
      existing.churn += row.la + row.lr;
      existing.modifications += row.mods;
    } else {
      childMap.set(childPath, {
        name: childName,
        path: childPath,
        type,
        linesAdded: row.la,
        linesRemoved: row.lr,
        growth: row.la - row.lr,
        churn: row.la + row.lr,
        modifications: row.mods,
      });
    }
  }

  return [...childMap.values()].sort((a, b) => b.churn - a.churn);
}

// ─── Convenience: list all known file/directory paths ────────────────────────

export interface FileMetricSummary {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}

export function computeAllFileMetrics(
  repoId: number,
  filter: FilterOptions
): FileMetricSummary[] {
  const db = getDb();
  const unfiltered = !filter.authorEmail && !filter.startDate && !filter.endDate
    && !(filter.commitHashes?.length);

  if (unfiltered) {
    const commitCount = (db.prepare(
      'SELECT COUNT(*) AS count FROM commits WHERE repo_id = ?'
    ).get(repoId) as { count: number }).count;
    const rows = db.prepare(`
      SELECT file_path AS path,
             total_added AS linesAdded,
             total_removed AS linesRemoved,
             total_churn AS churn,
             total_modifications AS modifications
      FROM file_stats
      WHERE repo_id = ?
      ORDER BY total_churn DESC
    `).all(repoId) as {
      path: string;
      linesAdded: number;
      linesRemoved: number;
      churn: number;
      modifications: number;
    }[];
    if (rows.length || commitCount === 0) {
      return rows.map(row => ({
        ...row,
        growth: row.linesAdded - row.linesRemoved,
        modificationFrequency: commitCount > 0 ? row.modifications / commitCount : 0,
        churnRate: commitCount > 0 ? row.churn / commitCount : 0,
      }));
    }
  }

  const { commitIds, setSize } = resolveCommitIds(repoId, filter);
  if (!commitIds.length) return [];
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
  db.exec('DELETE FROM _cids');
  const insert = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
  db.transaction((ids: number[]) => {
    for (const id of ids) insert.run(id);
  })(commitIds);

  const rows = db.prepare(`
    SELECT fd.file_path AS path,
           SUM(fd.lines_added) AS linesAdded,
           SUM(fd.lines_removed) AS linesRemoved,
           COUNT(DISTINCT CASE WHEN fd.lines_added + fd.lines_removed > 0
                               THEN fd.commit_id END) AS modifications
    FROM file_diffs fd
    INNER JOIN _cids ON _cids.id = fd.commit_id
    GROUP BY fd.file_path
    ORDER BY SUM(fd.lines_added) + SUM(fd.lines_removed) DESC
  `).all() as {
    path: string;
    linesAdded: number;
    linesRemoved: number;
    modifications: number;
  }[];
  return rows.map(row => {
    const churn = row.linesAdded + row.linesRemoved;
    return {
      ...row,
      growth: row.linesAdded - row.linesRemoved,
      churn,
      modificationFrequency: setSize > 0 ? row.modifications / setSize : 0,
      churnRate: setSize > 0 ? churn / setSize : 0,
    };
  });
}

export interface DirectoryMetricSummary {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}

/** Compute every directory in one recursive SQL pass. */
export function computeAllDirectoryMetrics(
  repoId: number,
  filter: FilterOptions
): DirectoryMetricSummary[] {
  const db = getDb();
  const { commitIds, setSize } = resolveCommitIds(repoId, filter);
  if (commitIds.length === 0) return [];

  db.exec('CREATE TEMP TABLE IF NOT EXISTS _cids (id INTEGER PRIMARY KEY)');
  db.exec('DELETE FROM _cids');
  const insertCid = db.prepare('INSERT OR IGNORE INTO _cids (id) VALUES (?)');
  db.transaction((ids: number[]) => {
    for (const id of ids) insertCid.run(id);
  })(commitIds);

  const rows = db.prepare(`
    WITH RECURSIVE
    changes AS (
      SELECT fd.commit_id, fd.file_path,
             SUM(fd.lines_added) AS added,
             SUM(fd.lines_removed) AS removed
      FROM file_diffs fd
      INNER JOIN _cids ON _cids.id = fd.commit_id
      GROUP BY fd.commit_id, fd.file_path
    ),
    dirs(commit_id, dir_path, rest, added, removed) AS (
      SELECT commit_id,
             substr(file_path, 1, instr(file_path, '/') - 1),
             substr(file_path, instr(file_path, '/') + 1),
             added, removed
      FROM changes
      WHERE instr(file_path, '/') > 0
      UNION ALL
      SELECT commit_id,
             dir_path || '/' || substr(rest, 1, instr(rest, '/') - 1),
             substr(rest, instr(rest, '/') + 1),
             added, removed
      FROM dirs
      WHERE instr(rest, '/') > 0
    )
    SELECT dir_path AS path,
           SUM(added) AS linesAdded,
           SUM(removed) AS linesRemoved,
           COUNT(DISTINCT CASE WHEN added + removed > 0 THEN commit_id END) AS modifications
    FROM dirs
    GROUP BY dir_path
    ORDER BY SUM(added) + SUM(removed) DESC
  `).all() as { path: string; linesAdded: number; linesRemoved: number; modifications: number }[];

  return rows.map(row => ({
    path: row.path,
    linesAdded: row.linesAdded,
    linesRemoved: row.linesRemoved,
    growth: row.linesAdded - row.linesRemoved,
    churn: row.linesAdded + row.linesRemoved,
    modifications: row.modifications,
    modificationFrequency: setSize > 0 ? row.modifications / setSize : 0,
    churnRate: setSize > 0 ? (row.linesAdded + row.linesRemoved) / setSize : 0,
  }));
}

export function listAllFilePaths(repoId: number): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT fd.file_path
    FROM file_diffs fd
    INNER JOIN commits c ON c.id = fd.commit_id
    WHERE c.repo_id = ?
    ORDER BY fd.file_path
  `).all(repoId) as { file_path: string }[];
  return rows.map((r) => r.file_path);
}

export function listAllDirectoryPaths(repoId: number): string[] {
  const files = listAllFilePaths(repoId);
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return [...dirs].sort();
}

// ─── Cache key helper (unused in hot path, available for future caching) ──────

export function commitSetHash(ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b).join(',');
  return crypto.createHash('md5').update(sorted).digest('hex');
}
