import { spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db';
import { IngestionProgress } from '../types';

// ─── Mailmap parsing ─────────────────────────────────────────────────────────

interface MailmapRule {
  canonicalName: string | null;
  canonicalEmail: string | null;
  fromName: string | null;
  fromEmail: string;
}

/**
 * Parse a .mailmap file into structured rules.
 * Supported forms:
 *   Proper Name <commit@email>
 *   <proper@email> <commit@email>
 *   Proper Name <proper@email> <commit@email>
 *   Proper Name <proper@email> Commit Name <commit@email>
 */
export function parseMailmap(content: string): MailmapRule[] {
  const rules: MailmapRule[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const emailMatches = [...line.matchAll(/<([^>]+)>/g)];
    const nameMatches = line.split(/<[^>]+>/).map(s => s.trim()).filter(Boolean);

    if (emailMatches.length === 2) {
      // "Proper Name <proper@email> Commit Name <commit@email>"
      // or "<proper@email> <commit@email>"
      rules.push({
        canonicalName: nameMatches[0] || null,
        canonicalEmail: emailMatches[0][1],
        fromName: nameMatches[1] || null,
        fromEmail: emailMatches[1][1],
      });
    } else if (emailMatches.length === 1) {
      const email = emailMatches[0][1];
      if (line.startsWith('<')) {
        // "<proper@email> <commit@email>" — but only one email means malformed, skip
        continue;
      }
      // "Proper Name <commit@email>"
      rules.push({
        canonicalName: nameMatches[0] || null,
        canonicalEmail: null,
        fromName: null,
        fromEmail: email,
      });
    }
  }
  return rules;
}

/**
 * Store mailmap rules in the database and return a resolver function.
 */
export function buildMailmapResolver(
  repoId: number,
  rules: MailmapRule[]
): (email: string, name: string) => { email: string; name: string } {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO mailmap_entries
      (repo_id, canonical_name, canonical_email, from_name, from_email)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rules: MailmapRule[]) => {
    for (const r of rules) {
      insert.run(repoId, r.canonicalName, r.canonicalEmail, r.fromName, r.fromEmail);
    }
  });
  insertMany(rules);

  return (email: string, name: string) => {
    // Find matching rule (most specific first: email + name match)
    let matched = rules.find(r => r.fromEmail === email && r.fromName === name);
    if (!matched) matched = rules.find(r => r.fromEmail === email);
    if (!matched) return { email, name };

    return {
      email: matched.canonicalEmail ?? email,
      name: matched.canonicalName ?? name,
    };
  };
}

// ─── Git log streaming parser ─────────────────────────────────────────────────

interface ParsedCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  message: string;
  diffs: { filePath: string; linesAdded: number; linesRemoved: number }[];
}

const COMMIT_SEP = '\x00COMMIT\x00';

/**
 * Stream-parse git log output into ParsedCommit objects.
 * Uses a custom separator to reliably split commits even when messages
 * contain blank lines.
 */
function streamGitLog(
  repoPath: string,
  onCommit: (commit: ParsedCommit) => void,
  onProgress?: (count: number) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Format: SEP hash \n author_name \n author_email \n unix_timestamp \n subject
    // Use Git's %xNN escapes so spawn never receives literal NUL bytes.
    const format = '%x00COMMIT%x00%H%x1f%an%x1f%ae%x1f%at%x1f%s';
    const args = [
      'log',
      `--format=${format}`,
      '--numstat',
      '--diff-filter=ACDMRT',
    ];

    const proc = spawn('git', args, { cwd: repoPath });
    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

    let buffer: string[] = [];
    let commitCount = 0;

    const flushBuffer = () => {
      if (!buffer.length) return;
      const raw = buffer.join('\n');
      buffer = [];

      // First line is the header (SEP was stripped by split)
      const [header, ...diffLines] = raw.split('\n');
      const parts = header.split('\x1f');
      if (parts.length < 5) return;

      const [hash, authorName, authorEmail, tsStr, message] = parts;
      const timestamp = parseInt(tsStr, 10);
      if (!hash || isNaN(timestamp)) return;

      const diffs: ParsedCommit['diffs'] = [];
      for (const line of diffLines) {
        if (!line.trim()) continue;
        const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (!match) continue;
        const added = match[1] === '-' ? 0 : parseInt(match[1], 10);
        const removed = match[2] === '-' ? 0 : parseInt(match[2], 10);
        // Resolve rename syntax: "old/path => new/path" or "prefix/{old => new}/suffix"
        let filePath = match[3];
        const renameMatch = filePath.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/);
        if (renameMatch) {
          filePath = (renameMatch[1] + renameMatch[3] + renameMatch[4]).replace('//', '/');
        } else if (filePath.includes(' => ')) {
          filePath = filePath.split(' => ')[1];
        }
        diffs.push({ filePath: filePath.trim(), linesAdded: added, linesRemoved: removed });
      }

      onCommit({ hash, authorName, authorEmail, timestamp, message, diffs });
      commitCount++;
      if (onProgress && commitCount % 500 === 0) onProgress(commitCount);
    };

    rl.on('line', (line: string) => {
      if (line.startsWith(COMMIT_SEP)) {
        flushBuffer();
        buffer.push(line.slice(COMMIT_SEP.length));
      } else {
        buffer.push(line);
      }
    });

    rl.on('close', () => {
      flushBuffer();
      resolve(commitCount);
    });

    proc.stderr.on('data', (data: Buffer) => {
      // Non-fatal: git may emit warnings about non-standard repos
      console.warn('[git log stderr]', data.toString().slice(0, 200));
    });

    proc.on('error', reject);
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a git repository at repoPath, store all commits and diffs in the
 * database, and return the new repository ID.
 */
export async function parseRepository(
  repoPath: string,
  repoName: string,
  repoUrl: string | null,
  onProgress?: (progress: IngestionProgress) => void
): Promise<number> {
  const db = getDb();

  // Insert repository record
  const repoResult = db.prepare(`
    INSERT INTO repositories (name, path, url, created_at)
    VALUES (?, ?, ?, ?)
  `).run(repoName, repoPath, repoUrl, Math.floor(Date.now() / 1000));
  const repoId = repoResult.lastInsertRowid as number;

  // Apply mailmap if present
  const mailmapPath = path.join(repoPath, '.mailmap');
  let resolve: (email: string, name: string) => { email: string; name: string } =
    (e, n) => ({ email: e, name: n });

  if (fs.existsSync(mailmapPath)) {
    const content = fs.readFileSync(mailmapPath, 'utf8');
    const rules = parseMailmap(content);
    resolve = buildMailmapResolver(repoId, rules);
  }

  emit(onProgress, { repoId, stage: 'parse', message: 'Counting commits…', current: 0, total: 0 });

  // Prepared statements for batch inserts
  const insertCommit = db.prepare(`
    INSERT OR IGNORE INTO commits
      (repo_id, hash, author_name, author_email, timestamp, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertDiff = db.prepare(`
    INSERT INTO file_diffs (commit_id, file_path, lines_added, lines_removed)
    VALUES (?, ?, ?, ?)
  `);

  // Buffer commits for batch inserts (transaction every 1000)
  const BATCH = 1000;
  let batch: ParsedCommit[] = [];
  let totalInserted = 0;

  const flushBatch = db.transaction((commits: ParsedCommit[]) => {
    for (const c of commits) {
      const { email, name } = resolve(c.authorEmail, c.authorName);
      const r = insertCommit.run(repoId, c.hash, name, email, c.timestamp, c.message);
      if (r.changes === 0) continue; // duplicate, skip diffs
      const commitId = r.lastInsertRowid as number;
      for (const d of c.diffs) {
        insertDiff.run(commitId, d.filePath, d.linesAdded, d.linesRemoved);
      }
    }
  });

  await streamGitLog(
    repoPath,
    (commit) => {
      batch.push(commit);
      if (batch.length >= BATCH) {
        flushBatch(batch);
        totalInserted += batch.length;
        batch = [];
        emit(onProgress, {
          repoId,
          stage: 'parse',
          message: `Parsed ${totalInserted} commits…`,
          current: totalInserted,
          total: 0,
        });
      }
    },
    (count) => {
      emit(onProgress, {
        repoId,
        stage: 'parse',
        message: `Parsed ${count} commits…`,
        current: count,
        total: 0,
      });
    }
  );

  if (batch.length > 0) {
    flushBatch(batch);
    totalInserted += batch.length;
  }

  emit(onProgress, {
    repoId,
    stage: 'done',
    message: `Done. Parsed ${totalInserted} commits.`,
    current: totalInserted,
    total: totalInserted,
  });

  return repoId;
}

function emit(
  cb: ((p: IngestionProgress) => void) | undefined,
  p: IngestionProgress
): void {
  if (cb) cb(p);
}
