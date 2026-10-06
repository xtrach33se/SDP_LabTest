import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DEFAULT_DB_DIR = path.join(__dirname, '..', 'data');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.RAT_DB_PATH || path.join(DEFAULT_DB_DIR, 'rat.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      path        TEXT,
      url         TEXT,
      root_commit           TEXT,
      created_at            INTEGER NOT NULL,
      ingestion_started_at  INTEGER,
      ingestion_completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS commits (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id      INTEGER NOT NULL,
      hash         TEXT    NOT NULL,
      author_name  TEXT    NOT NULL,
      author_email TEXT    NOT NULL,
      timestamp    INTEGER NOT NULL,
      message      TEXT    NOT NULL DEFAULT '',
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
      UNIQUE(repo_id, hash)
    );

    CREATE TABLE IF NOT EXISTS file_diffs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id     INTEGER NOT NULL,
      file_path     TEXT    NOT NULL,
      lines_added   INTEGER NOT NULL DEFAULT 0,
      lines_removed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_stats (
      repo_id             INTEGER NOT NULL,
      file_path           TEXT    NOT NULL,
      total_added         INTEGER NOT NULL DEFAULT 0,
      total_removed       INTEGER NOT NULL DEFAULT 0,
      total_churn         INTEGER NOT NULL DEFAULT 0,
      total_modifications INTEGER NOT NULL DEFAULT 0,
      first_commit_ts     INTEGER NOT NULL,
      last_commit_ts      INTEGER NOT NULL,
      PRIMARY KEY (repo_id, file_path),
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS author_merges (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id         INTEGER NOT NULL,
      canonical_email TEXT    NOT NULL,
      canonical_name  TEXT    NOT NULL,
      merged_email    TEXT    NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
      UNIQUE(repo_id, merged_email)
    );

    CREATE TABLE IF NOT EXISTS mailmap_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id         INTEGER NOT NULL,
      canonical_name  TEXT,
      canonical_email TEXT,
      from_name       TEXT,
      from_email      TEXT    NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    -- Indexes for fast metric queries
    CREATE INDEX IF NOT EXISTS idx_commits_repo_id    ON commits(repo_id);
    CREATE INDEX IF NOT EXISTS idx_commits_timestamp  ON commits(repo_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_commits_author     ON commits(repo_id, author_email);
    CREATE INDEX IF NOT EXISTS idx_commits_hash       ON commits(repo_id, hash);
    CREATE INDEX IF NOT EXISTS idx_file_diffs_commit  ON file_diffs(commit_id);
    CREATE INDEX IF NOT EXISTS idx_file_diffs_path    ON file_diffs(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_diffs_path_commit ON file_diffs(file_path, commit_id);
    CREATE INDEX IF NOT EXISTS idx_file_stats_churn   ON file_stats(repo_id, total_churn DESC);
    CREATE INDEX IF NOT EXISTS idx_author_merges_repo ON author_merges(repo_id, merged_email);
  `);

  const repositoryColumns = db.pragma('table_info(repositories)') as { name: string }[];
  const migrations = [
    ['root_commit', 'TEXT'],
    ['ingestion_started_at', 'INTEGER'],
    ['ingestion_completed_at', 'INTEGER'],
  ] as const;
  for (const [column, type] of migrations) {
    if (!repositoryColumns.some(existing => existing.name === column)) {
      db.exec(`ALTER TABLE repositories ADD COLUMN ${column} ${type}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_repositories_root ON repositories(root_commit)');

  // One-time compatibility backfill for repositories imported before file_stats existed.
  const missingStats = db.prepare(`
    SELECT r.id
    FROM repositories r
    WHERE EXISTS (SELECT 1 FROM commits c WHERE c.repo_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM file_stats fs WHERE fs.repo_id = r.id)
  `).all() as { id: number }[];
  const backfill = db.prepare(`
    INSERT OR IGNORE INTO file_stats
      (repo_id, file_path, total_added, total_removed, total_churn,
       total_modifications, first_commit_ts, last_commit_ts)
    SELECT c.repo_id,
           fd.file_path,
           SUM(fd.lines_added),
           SUM(fd.lines_removed),
           SUM(fd.lines_added + fd.lines_removed),
           COUNT(DISTINCT CASE WHEN fd.lines_added + fd.lines_removed > 0 THEN c.id END),
           MIN(c.timestamp),
           MAX(c.timestamp)
    FROM file_diffs fd
    INNER JOIN commits c ON c.id = fd.commit_id
    WHERE c.repo_id = ?
    GROUP BY c.repo_id, fd.file_path
  `);
  db.transaction((repoIds: { id: number }[]) => {
    for (const repo of repoIds) backfill.run(repo.id);
  })(missingStats);
}

/** Close the active connection. Primarily used by deterministic tests. */
export function closeDb(): void {
  if (!_db) return;
  _db.close();
  _db = null;
}
