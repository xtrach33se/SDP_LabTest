import { parentPort, workerData } from 'worker_threads';
import {
  DuplicateRepositoryError,
  parseRepositoryInProcess,
} from '../services/gitParser';
import { AppError } from '../errors';

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
    code: error instanceof AppError ? error.code : undefined,
    status: error instanceof AppError ? error.status : undefined,
    existingRepoId: duplicate?.existingRepoId,
  });
});
