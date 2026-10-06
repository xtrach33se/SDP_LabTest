import { spawn } from 'child_process';
import { Worker } from 'worker_threads';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db';
import { IngestionProgress } from '../types';

interface MailmapRule {
  canonicalName: string | null;
  canonicalEmail: string | null;
  fromName: string | null;
  fromEmail: string;
}

export interface ParseRepositoryOptions {
  force?: boolean;
  useWorker?: boolean;
}

export class DuplicateRepositoryError extends Error {
  readonly code = 'DUPLICATE_REPOSITORY';

  constructor(readonly existingRepoId: number) {
    super(`This Git history is already indexed as repository ${existingRepoId}.`);
    this.name = 'DuplicateRepositoryError';
  }
}

export function parseMailmap(content: string): MailmapRule[] {
  const rules: MailmapRule[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const emailMatches = [...line.matchAll(/<([^>]+)>/g)];
    const nameMatches = line.split(/<[^>]+>/).map(value => value.trim()).filter(Boolean);

    if (emailMatches.length === 2) {
      rules.push({
        canonicalName: nameMatches[0] || null,
        canonicalEmail: emailMatches[0][1],
        fromName: nameMatches[1] || null,
        fromEmail: emailMatches[1][1],
      });
    } else if (emailMatches.length === 1 && !line.startsWith('<')) {
      rules.push({
        canonicalName: nameMatches[0] || null,
        canonicalEmail: null,
        fromName: null,
        fromEmail: emailMatches[0][1],
      });
    }
  }
  return rules;
}

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
  db.transaction((items: MailmapRule[]) => {
    for (const rule of items) {
      insert.run(repoId, rule.canonicalName, rule.canonicalEmail, rule.fromName, rule.fromEmail);
    }
  })(rules);

  return (email: string, name: string) => {
    const matched = rules.find(rule => rule.fromEmail === email && rule.fromName === name)
      ?? rules.find(rule => rule.fromEmail === email);
    if (!matched) return { email, name };
    return {
      email: matched.canonicalEmail ?? email,
      name: matched.canonicalName ?? name,
    };
  };
}

interface ParsedCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  message: string;
  diffs: { filePath: string; linesAdded: number; linesRemoved: number }[];
}

const COMMIT_SEP = '\x00COMMIT\x00';

function readGitValue(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: repoPath });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8').trim());
      else reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `git exited with code ${code}`));
    });
  });
}

function streamGitLog(
  repoPath: string,
  onCommit: (commit: ParsedCommit) => void,
  onProgress?: (count: number) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const format = '%x00COMMIT%x00%H%x1f%an%x1f%ae%x1f%at%x1f%s';
    const proc = spawn('git', [
      'log',
      `--format=${format}`,
      '--numstat',
      '--diff-filter=ACDMRT',
    ], { cwd: repoPath });
    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

    let buffer: string[] = [];
    let commitCount = 0;
    let stderr = '';

    const flushBuffer = () => {
      if (!buffer.length) return;
      const [header, ...diffLines] = buffer.join('\n').split('\n');
      buffer = [];
      const parts = header.split('\x1f');
      if (parts.length < 5) return;

      const [hash, authorName, authorEmail, tsStr, message] = parts;
      const timestamp = Number.parseInt(tsStr, 10);
      if (!hash || Number.isNaN(timestamp)) return;

      const diffs: ParsedCommit['diffs'] = [];
      for (const line of diffLines) {
        const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (!match) continue;
        const linesAdded = match[1] === '-' ? 0 : Number.parseInt(match[1], 10);
        const linesRemoved = match[2] === '-' ? 0 : Number.parseInt(match[2], 10);
        let filePath = match[3];
        const renameMatch = filePath.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/);
        if (renameMatch) {
          filePath = `${renameMatch[1]}${renameMatch[3]}${renameMatch[4]}`.replace('//', '/');
        } else if (filePath.includes(' => ')) {
          filePath = filePath.split(' => ')[1];
        }
        diffs.push({ filePath: filePath.trim(), linesAdded, linesRemoved });
      }

      onCommit({ hash, authorName, authorEmail, timestamp, message, diffs });
      commitCount += 1;
      if (onProgress && commitCount % 500 === 0) onProgress(commitCount);
    };

    rl.on('line', line => {
      if (line.startsWith(COMMIT_SEP)) {
        flushBuffer();
        buffer.push(line.slice(COMMIT_SEP.length));
      } else {
        buffer.push(line);
      }
    });
    rl.on('close', flushBuffer);
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(commitCount);
      else reject(new Error(stderr.trim() || `git log exited with code ${code}`));
    });
  });
}

export async function parseRepositoryInProcess(
  repoPath: string,
  repoName: string,
  repoUrl: string | null,
  onProgress?: (progress: IngestionProgress) => void,
  options: ParseRepositoryOptions = {}
): Promise<number> {
  const db = getDb();
  const [rootOutput, countOutput] = await Promise.all([
    readGitValue(repoPath, ['rev-list', '--max-parents=0', 'HEAD']),
    readGitValue(repoPath, ['rev-list', '--count', 'HEAD']),
  ]);
  const rootCommit = rootOutput.split('\n').filter(Boolean).sort()[0];
  const totalCommits = Number.parseInt(countOutput, 10) || 0;
  if (!rootCommit) throw new Error('The repository has no readable root commit.');

  const rootDuplicate = db.prepare(
    'SELECT id FROM repositories WHERE root_commit = ? LIMIT 1'
  ).get(rootCommit) as { id: number } | undefined;
  const urlDuplicate = repoUrl
    ? (db.prepare('SELECT id, url FROM repositories WHERE url IS NOT NULL').all() as {
        id: number;
        url: string;
      }[]).find(repo => repo.url.trim().replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase()
        === repoUrl.trim().replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase())
    : undefined;
  const duplicate = rootDuplicate ?? urlDuplicate;
  if (duplicate && !options.force) throw new DuplicateRepositoryError(duplicate.id);
  if (duplicate && options.force) {
    db.prepare('DELETE FROM repositories WHERE id = ?').run(duplicate.id);
  }

  const repoResult = db.prepare(`
    INSERT INTO repositories (name, path, url, root_commit, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(repoName, repoPath, repoUrl, rootCommit, Math.floor(Date.now() / 1000));
  const repoId = Number(repoResult.lastInsertRowid);

  const mailmapPath = path.join(repoPath, '.mailmap');
  let resolveAuthor = (email: string, name: string) => ({ email, name });
  if (fs.existsSync(mailmapPath)) {
    resolveAuthor = buildMailmapResolver(repoId, parseMailmap(fs.readFileSync(mailmapPath, 'utf8')));
  }

  emit(onProgress, {
    repoId,
    stage: 'parse',
    message: `Parsing commits (0 / ${totalCommits.toLocaleString()})…`,
    current: 0,
    total: totalCommits,
  });

  const insertCommit = db.prepare(`
    INSERT OR IGNORE INTO commits
      (repo_id, hash, author_name, author_email, timestamp, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertDiff = db.prepare(`
    INSERT INTO file_diffs (commit_id, file_path, lines_added, lines_removed)
    VALUES (?, ?, ?, ?)
  `);
  const updateFileStat = db.prepare(`
    INSERT INTO file_stats
      (repo_id, file_path, total_added, total_removed, total_churn,
       total_modifications, first_commit_ts, last_commit_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id, file_path) DO UPDATE SET
      total_added = total_added + excluded.total_added,
      total_removed = total_removed + excluded.total_removed,
      total_churn = total_churn + excluded.total_churn,
      total_modifications = total_modifications + excluded.total_modifications,
      first_commit_ts = MIN(first_commit_ts, excluded.first_commit_ts),
      last_commit_ts = MAX(last_commit_ts, excluded.last_commit_ts)
  `);

  const BATCH = 1000;
  let batch: ParsedCommit[] = [];
  let totalInserted = 0;
  const flushBatch = db.transaction((commits: ParsedCommit[]) => {
    for (const commit of commits) {
      const author = resolveAuthor(commit.authorEmail, commit.authorName);
      const result = insertCommit.run(
        repoId,
        commit.hash,
        author.name,
        author.email,
        commit.timestamp,
        commit.message
      );
      if (result.changes === 0) continue;
      const commitId = Number(result.lastInsertRowid);
      for (const diff of commit.diffs) {
        insertDiff.run(commitId, diff.filePath, diff.linesAdded, diff.linesRemoved);
        const churn = diff.linesAdded + diff.linesRemoved;
        updateFileStat.run(
          repoId,
          diff.filePath,
          diff.linesAdded,
          diff.linesRemoved,
          churn,
          churn > 0 ? 1 : 0,
          commit.timestamp,
          commit.timestamp
        );
      }
    }
  });

  try {
    await streamGitLog(
      repoPath,
      commit => {
        batch.push(commit);
        if (batch.length >= BATCH) {
          flushBatch(batch);
          totalInserted += batch.length;
          batch = [];
          emit(onProgress, {
            repoId,
            stage: 'parse',
            message: `Parsing commits (${totalInserted.toLocaleString()} / ${totalCommits.toLocaleString()})…`,
            current: totalInserted,
            total: totalCommits,
          });
        }
      },
      count => emit(onProgress, {
        repoId,
        stage: 'parse',
        message: `Parsing commits (${count.toLocaleString()} / ${totalCommits.toLocaleString()})…`,
        current: count,
        total: totalCommits,
      })
    );

    if (batch.length) {
      flushBatch(batch);
      totalInserted += batch.length;
    }

    emit(onProgress, {
      repoId,
      stage: 'compute',
      message: 'Finalising precomputed file metrics…',
      current: totalInserted,
      total: totalCommits,
    });
    db.pragma('optimize');
    emit(onProgress, {
      repoId,
      stage: 'done',
      message: `Done. Parsed ${totalInserted.toLocaleString()} commits.`,
      current: totalInserted,
      total: totalCommits,
    });
    return repoId;
  } catch (error) {
    db.prepare('DELETE FROM repositories WHERE id = ?').run(repoId);
    throw error;
  }
}

export function parseRepository(
  repoPath: string,
  repoName: string,
  repoUrl: string | null,
  onProgress?: (progress: IngestionProgress) => void,
  options: ParseRepositoryOptions = {}
): Promise<number> {
  const workerPath = path.join(__dirname, '..', 'workers', 'gitParserWorker.js');
  if (options.useWorker !== false && fs.existsSync(workerPath)) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: { repoPath, repoName, repoUrl, force: options.force === true },
      });
      worker.on('message', (message: {
        type: 'progress' | 'result' | 'error';
        progress?: IngestionProgress;
        repoId?: number;
        error?: string;
        code?: string;
        existingRepoId?: number;
      }) => {
        if (message.type === 'progress' && message.progress) onProgress?.(message.progress);
        if (message.type === 'result' && message.repoId != null) resolve(message.repoId);
        if (message.type === 'error') {
          const error = message.code === 'DUPLICATE_REPOSITORY' && message.existingRepoId
            ? new DuplicateRepositoryError(message.existingRepoId)
            : new Error(message.error || 'Git parser worker failed');
          reject(error);
        }
      });
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Git parser worker exited with code ${code}`));
      });
    });
  }
  return parseRepositoryInProcess(repoPath, repoName, repoUrl, onProgress, options);
}

function emit(
  callback: ((progress: IngestionProgress) => void) | undefined,
  progress: IngestionProgress
): void {
  callback?.(progress);
}
