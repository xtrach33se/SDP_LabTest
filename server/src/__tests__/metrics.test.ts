import fs from 'fs';
import os from 'os';
import path from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { closeDb, getDb } from '../db';
import { parseRepositoryInProcess } from '../services/gitParser';
import {
  computeDirectoryMetrics,
  computeFileMetrics,
  computeRepositoryMetrics,
} from '../services/metrics';

let root = '';
let repoId = 0;
let git: SimpleGit;
const hashes: string[] = [];

async function identity(name: string, email: string) {
  await git.raw(['config', 'user.name', name]);
  await git.raw(['config', 'user.email', email]);
}

async function commit(message: string, file?: string, content?: string) {
  if (file && content != null) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    await git.add(file);
    await git.commit(message);
  } else {
    await git.raw(['commit', '--allow-empty', '-m', message]);
  }
  hashes.push((await git.revparse(['HEAD'])).trim());
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-metrics-test-'));
  process.env.RAT_DB_PATH = path.join(root, 'rat-test.db');
  git = simpleGit(root);
  await git.init();

  await identity('Alice Example', 'alice@example.test');
  await commit('create root file', 'root.txt', 'one\ntwo\nthree\n');
  await commit('create nested file', 'src/nested/a.txt', 'a\nb\n');

  await identity('Bob Example', 'bob@example.test');
  await commit('extend root file', 'root.txt', 'one\ntwo\nthree\nfour\nfive\n');
  await commit('intentional empty commit');

  await identity('Alice Alias', 'ally@example.test');
  await commit('extend nested file', 'src/nested/a.txt', 'a\nb\nc\n');

  repoId = await parseRepositoryInProcess(root, 'synthetic-five-commit', null, undefined, { useWorker: false });
});

afterAll(() => {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test('computes exact repository and commit-set metrics including an empty commit', () => {
  const all = computeRepositoryMetrics(repoId, {});
  expect(all).toMatchObject({
    linesAdded: 8,
    linesRemoved: 0,
    growth: 8,
    churn: 8,
    modifications: 4,
    modificationFrequency: 0.8,
    churnRate: 1.6,
  });

  const selected = computeRepositoryMetrics(repoId, { commitHashes: [hashes[0], hashes[2]] });
  expect(selected).toMatchObject({
    linesAdded: 5,
    linesRemoved: 0,
    growth: 5,
    churn: 5,
    modifications: 2,
    modificationFrequency: 1,
    churnRate: 2.5,
  });
});

test('computes exact file and nested-directory metrics', () => {
  expect(computeFileMetrics(repoId, { path: 'root.txt' })).toMatchObject({
    linesAdded: 5,
    linesRemoved: 0,
    growth: 5,
    churn: 5,
    modifications: 2,
    modificationFrequency: 0.4,
    churnRate: 1,
  });

  expect(computeDirectoryMetrics(repoId, { path: 'src' })).toMatchObject({
    linesAdded: 3,
    linesRemoved: 0,
    growth: 3,
    churn: 3,
    modifications: 2,
    modificationFrequency: 0.4,
    churnRate: 0.6,
  });
});

test('rejects empty repositories with a structured error', async () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-empty-test-'));
  try {
    await simpleGit(emptyRoot).init();
    await expect(
      parseRepositoryInProcess(emptyRoot, 'empty-repository', null, undefined, { useWorker: false })
    ).rejects.toMatchObject({ code: 'EMPTY_REPOSITORY', status: 400 });
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('manual author merge changes ownership and preserves exact totals', () => {
  getDb().prepare(`
    INSERT INTO author_merges (repo_id, canonical_email, canonical_name, merged_email)
    VALUES (?, ?, ?, ?)
  `).run(repoId, 'alice@example.test', 'Alice Example', 'ally@example.test');

  const result = computeRepositoryMetrics(repoId, {});
  const alice = result.authors.find(author => author.email === 'alice@example.test');
  const bob = result.authors.find(author => author.email === 'bob@example.test');
  expect(alice).toMatchObject({ modifications: 3, churn: 6, ownership: 0.75 });
  expect(bob).toMatchObject({ modifications: 1, churn: 2, ownership: 0.25 });
});
