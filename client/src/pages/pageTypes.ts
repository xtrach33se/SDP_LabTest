export interface IngestionProgress {
  repoId: number | null;
  stage: 'clone' | 'extract' | 'parse' | 'compute' | 'done' | 'error';
  message: string;
  current: number;
  total: number;
  code?: 'DUPLICATE_REPOSITORY' | 'INVALID_REPOSITORY' | 'INGESTION_FAILED';
  existingRepoId?: number;
}
