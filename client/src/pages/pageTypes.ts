export interface IngestionProgress {
  repoId: number | null;
  stage: 'clone' | 'extract' | 'parse' | 'done' | 'error';
  message: string;
  current: number;
  total: number;
}
