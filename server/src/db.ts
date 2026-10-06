import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'rat.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
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
      path       TEXT,
      url        TEXT,
      created_at INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_author_merges_repo ON author_merges(repo_id, merged_email);
  `);
}
