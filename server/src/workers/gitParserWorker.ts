import { parentPort, workerData } from 'worker_threads';
import {
  DuplicateRepositoryError,
  parseRepositoryInProcess,
} from '../services/gitParser';

interface WorkerInput {
  repoPath: string;
  repoName: string;
  repoUrl: string | null;
  force: boolean;
}

const input = workerData as WorkerInput;

parseRepositoryInProcess(
  input.repoPath,
  input.repoName,
  input.repoUrl,
  progress => parentPort?.postMessage({ type: 'progress', progress }),
  { force: input.force, useWorker: false }
).then(repoId => {
  parentPort?.postMessage({ type: 'result', repoId });
}).catch((error: unknown) => {
  const duplicate = error instanceof DuplicateRepositoryError ? error : null;
  parentPort?.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : 'Git parser worker failed',
    code: duplicate?.code,
    existingRepoId: duplicate?.existingRepoId,
  });
});
