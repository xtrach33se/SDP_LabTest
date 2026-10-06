import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const workspace = path.resolve(__dirname, '..');
const cacheDir = path.join(workspace, '.verification-repos');
const dataDir = path.join(workspace, '.verification');
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
process.env.RAT_DB_PATH = path.join(dataDir, 'metrics.db');

import { ingestPath } from '../server/src/services/ingestor';
import { computeAllFileMetrics, computeFileMetrics, computeRepositoryMetrics } from '../server/src/services/metrics';
import { getDb } from '../server/src/db';

interface Target {
  name: 'cJSON' | 'Redis' | 'Git';
  url: string;
  commit: string;
  focusFile: string;
}

const targets: Target[] = [
  { name: 'cJSON', url: 'https://github.com/DaveGamble/cJSON.git', commit: '6d9f2443ab07', focusFile: 'cJSON.c' },
  { name: 'Redis', url: 'https://github.com/redis/redis.git', commit: 'b540ca49cba8', focusFile: 'src/server.c' },
  { name: 'Git', url: 'https://github.com/git/git.git', commit: '5a7d1e8045ce', focusFile: 'diff.c' },
];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function ensureClone(target: Target): { repoPath: string; hash: string } {
  const repoPath = path.join(cacheDir, target.name.toLowerCase());
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    console.log(`Cloning ${target.name}…`);
    execFileSync('git', ['clone', target.url, repoPath], { stdio: 'inherit' });
  } else {
    console.log(`Refreshing cached ${target.name} clone…`);
    git(repoPath, ['fetch', '--all', '--tags', '--prune']);
  }
  const hash = git(repoPath, ['rev-parse', target.commit]);
  git(repoPath, ['checkout', '--detach', hash]);
  return { repoPath, hash };
}

async function verify(target: Target) {
  const { repoPath, hash } = ensureClone(target);
  console.log(`\nIngesting ${target.name} at ${hash.slice(0, 12)}…`);
  const repoId = await ingestPath(repoPath, `${target.name} verification`, target.url, progress => {
    if (progress.stage !== 'parse' || progress.current % 5000 === 0) console.log(progress.message);
  }, true);

  const repository = computeRepositoryMetrics(repoId, {});
  const files = computeAllFileMetrics(repoId, {}).slice(0, 5);
  const focus = computeFileMetrics(repoId, { path: target.focusFile });

  console.log(`\n${target.name} repository metrics`);
  console.table([{
    commit: hash.slice(0, 12),
    linesAdded: repository.linesAdded,
    linesRemoved: repository.linesRemoved,
    growth: repository.growth,
    churn: repository.churn,
    modifications: repository.modifications,
  }]);
  console.log(`${target.name} top five files by churn`);
  console.table(files.map(file => ({
    path: file.path,
    added: file.linesAdded,
    removed: file.linesRemoved,
    growth: file.growth,
    churn: file.churn,
    modifications: file.modifications,
  })));
  console.log(`${target.name} top three authors`);
  console.table(repository.authors.slice(0, 3).map(author => ({
    author: `${author.name} <${author.email}>`,
    churn: author.churn,
    ownershipPercent: Number((author.ownership * 100).toFixed(3)),
  })));
  console.log(`${target.name} focus file: ${target.focusFile}`);
  console.table([{
    modifications: focus.modifications,
    modificationFrequency: focus.modificationFrequency,
    churn: focus.churn,
    churnRate: focus.churnRate,
  }]);

  if (target.name === 'cJSON') {
    const expected = { linesAdded: 46_377, linesRemoved: 11_211, growth: 35_166, churn: 57_588 };
    for (const [key, value] of Object.entries(expected)) {
      if (repository[key as keyof typeof expected] !== value) {
        throw new Error(`cJSON ${key} mismatch: expected ${value}, received ${repository[key as keyof typeof expected]}`);
      }
    }
    console.log('✓ cJSON repository totals match the supplied reference CSV exactly.');
  }
}

async function main() {
  const requested = process.argv.find(argument => argument.startsWith('--repo='))?.split('=')[1]?.toLowerCase();
  const selected = requested ? targets.filter(target => target.name.toLowerCase() === requested) : targets;
  if (!selected.length) throw new Error(`Unknown repository "${requested}". Use cjson, redis, or git.`);
  for (const target of selected) await verify(target);
  const count = (getDb().prepare('SELECT COUNT(*) AS count FROM repositories').get() as { count: number }).count;
  console.log(`\nVerification complete. ${count} repository index(es) are available in ${process.env.RAT_DB_PATH}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
