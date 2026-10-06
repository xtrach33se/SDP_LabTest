export interface Repository {
  id: number;
  name: string;
  path: string | null;
  url: string | null;
  created_at: number;
  commit_count: number;
}

export interface AuthorMetric {
  email: string;
  name: string;
  linesAdded: number;
  linesRemoved: number;
  modifications: number;
  churn: number;
  ownership: number;
}

export interface MetricResult {
  linesAdded: number;
  linesRemoved: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
  authors: AuthorMetric[];
}

export interface FileMetric extends Omit<MetricResult, 'authors'> {
  path: string;
}

export interface TimelinePoint {
  hash: string;
  timestamp: number;
  linesAdded: number;
  linesRemoved: number;
  growth: number;
  churn: number;
}

export interface CommitRow {
  hash: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  message: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface CommitResponse {
  commits: CommitRow[];
  total: number;
  page: number;
  pageSize: number;
  setSize: number;
}

export interface PathResponse {
  files: string[];
  directories: string[];
}

export interface RawAuthor {
  raw_email: string;
  raw_name: string;
  canonical_email: string;
  canonical_name: string;
  commit_count: number;
}

export interface AuthorMerge {
  id: number;
  repo_id: number;
  canonical_email: string;
  canonical_name: string;
  merged_email: string;
}

export interface Filters {
  authorEmail: string;
  path: string;
  startDate: string;
  endDate: string;
  commitHashes: string[];
}
