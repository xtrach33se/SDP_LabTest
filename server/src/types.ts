// Shared TypeScript types across the RAT server

export interface Repository {
  id: number;
  name: string;
  path: string | null;
  url: string | null;
  created_at: number;
  commit_count?: number;
}

export interface Commit {
  id: number;
  repo_id: number;
  hash: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  message: string;
}

export interface FileDiff {
  id: number;
  commit_id: number;
  file_path: string;
  lines_added: number;
  lines_removed: number;
}

export interface AuthorMerge {
  id: number;
  repo_id: number;
  canonical_email: string;
  canonical_name: string;
  merged_email: string;
}

export interface MailmapEntry {
  id: number;
  repo_id: number;
  canonical_name: string | null;
  canonical_email: string | null;
  from_name: string | null;
  from_email: string;
}

// Metric result for a file, directory, or repository over a commit set
export interface MetricResult {
  linesAdded: number;
  linesRemoved: number;
  growth: number;       // linesAdded - linesRemoved
  churn: number;        // linesAdded + linesRemoved
  modifications: number;           // n_Ho: count of commits with churn > 0
  modificationFrequency: number;   // eta_Ho: modifications / |H|
  churnRate: number;               // rho_Ho: churn / |H|
  authors: AuthorMetric[];
}

export interface AuthorMetric {
  email: string;         // canonical email
  name: string;          // canonical name
  linesAdded: number;
  linesRemoved: number;
  modifications: number; // n_Hoa
  churn: number;         // lambda_Hoa
  ownership: number;     // c_Hoa (fraction 0..1)
}

// Input filters passed to all metric queries
export interface FilterOptions {
  authorEmail?: string;
  path?: string;
  startDate?: string;   // ISO 8601
  endDate?: string;     // ISO 8601
  commitHashes?: string[];
}

// Progress event emitted during ingestion
export interface IngestionProgress {
  repoId: number | null;
  stage: 'clone' | 'extract' | 'parse' | 'compute' | 'done' | 'error';
  message: string;
  current: number;
  total: number;
  code?: 'DUPLICATE_REPOSITORY' | 'INVALID_REPOSITORY' | 'INVALID_ZIP' | 'UNREACHABLE_URL' | 'GIT_CLONE_FAILED' | 'EMPTY_REPOSITORY' | 'INGESTION_FAILED';
  existingRepoId?: number;
}
