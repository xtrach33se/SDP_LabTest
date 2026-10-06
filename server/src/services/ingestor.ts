import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import { simpleGit } from 'simple-git';
import unzipper from 'unzipper';
import { parseRepository } from './gitParser';
import { IngestionProgress } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a unique temp directory under the OS temp folder. */
function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rat-${prefix}-`));
}

/** Recursively delete a directory, ignoring errors. */
function rmDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Walk a directory tree and find the first directory that contains a `.git`
 * sub-directory (i.e. the git working tree root).
 */
function findGitRoot(dir: string, depth = 0): string | null {
  if (depth > 4) return null;
  const gitDir = path.join(dir, '.git');
  if (fs.existsSync(gitDir)) return dir;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const found = findGitRoot(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  } catch {
    // unreadable dir
  }
  return null;
}

// ─── ZIP ingestion ────────────────────────────────────────────────────────────

/**
 * Extract a zip buffer that contains a git repository (must include a .git
 * directory), parse the repo, store all data in SQLite, and return the new
 * repository ID.
 */
export async function ingestZip(
  zipBuffer: Buffer,
  repoName: string,
  onProgress?: (p: IngestionProgress) => void,
  force = false
): Promise<number> {
  const tmpDir = mkTempDir('zip');
  try {
    emit(onProgress, {
      repoId: null,
      stage: 'extract',
      message: 'Extracting zip…',
      current: 0,
      total: 0,
    });

    await extractZip(zipBuffer, tmpDir);

    const gitRoot = findGitRoot(tmpDir);
    if (!gitRoot) {
      throw new Error(
        'No .git directory found inside the zip file. ' +
          'Please upload a zip of a full git repository.'
      );
    }

    const repoId = await parseRepository(gitRoot, repoName, null, onProgress, { force });
    return repoId;
  } finally {
    rmDir(tmpDir);
  }
}

/** Pipe a buffer through unzipper into a target directory. */
function extractZip(buffer: Buffer, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = unzipper.Extract({ path: targetDir });
    stream.on('finish', resolve);
    stream.on('error', reject);

    const readable = new Readable();
    readable._read = () => {};
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

// ─── URL ingestion ────────────────────────────────────────────────────────────

/**
 * Deep-clone a remote git repository, parse it, store all data in SQLite,
 * and return the new repository ID.
 */
export async function ingestUrl(
  url: string,
  repoName: string,
  onProgress?: (p: IngestionProgress) => void,
  force = false
): Promise<number> {
  const tmpDir = mkTempDir('clone');
  try {
    emit(onProgress, {
      repoId: null,
      stage: 'clone',
      message: `Cloning ${url}…`,
      current: 0,
      total: 0,
    });

    const git = simpleGit();
    await git.clone(url, tmpDir, ['--no-local']);

    const repoId = await parseRepository(tmpDir, repoName, url, onProgress, { force });
    return repoId;
  } finally {
    rmDir(tmpDir);
  }
}

function emit(
  cb: ((p: IngestionProgress) => void) | undefined,
  p: IngestionProgress
): void {
  if (cb) cb(p);
}
