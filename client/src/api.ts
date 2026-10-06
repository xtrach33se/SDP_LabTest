import axios from 'axios';
import type {
  AuthorAnalytics,
  AuthorMerge,
  AuthorMetric,
  CanonicalAuthor,
  ChildMetric,
  CommitFileDiff,
  CommitResponse,
  FileMetric,
  Filters,
  MetricResult,
  PathResponse,
  RawAuthor,
  Repository,
  TimelinePoint,
} from './types';

export const api = axios.create({ baseURL: '/api' });

export function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.authorEmail) params.set('authorEmail', filters.authorEmail);
  if (filters.path) params.set('path', filters.path);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.commitHashes.length) params.set('commitHashes', filters.commitHashes.join(','));
  return params;
}

export const repositoriesApi = {
  list: () => api.get<Repository[]>('/repositories').then(r => r.data),
  get: (id: number) => api.get<Repository>(`/repositories/${id}`).then(r => r.data),
  remove: (id: number) => api.delete(`/repositories/${id}`).then(r => r.data),
  clone: (url: string, name: string, force = false) => api.post<{ jobId: string }>('/repositories/clone', { url, name, force }).then(r => r.data),
  upload: (file: File, name: string, force = false, onProgress?: (percent: number) => void) => {
    const body = new FormData();
    body.append('repo', file);
    body.append('name', name);
    body.append('force', String(force));
    return api.post<{ jobId: string }>('/repositories/upload', body, {
      onUploadProgress: event => {
        if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
      },
    }).then(r => r.data);
  },
};

export const metricsApi = {
  repository: (id: number, filters: Filters) => api.get<MetricResult>(`/metrics/${id}/repository`, { params: filterParams(filters) }).then(r => r.data),
  file: (id: number, filters: Filters) => api.get<MetricResult>(`/metrics/${id}/file`, { params: filterParams(filters) }).then(r => r.data),
  directory: (id: number, filters: Filters) => api.get<MetricResult>(`/metrics/${id}/directory`, { params: filterParams(filters) }).then(r => r.data),
  files: (id: number, filters: Filters) => api.get<FileMetric[]>(`/metrics/${id}/files`, { params: filterParams(filters) }).then(r => r.data),
  directories: (id: number, filters: Filters) => api.get<FileMetric[]>(`/metrics/${id}/directories`, { params: filterParams(filters) }).then(r => r.data),
  children: (id: number, filters: Filters) => api.get<ChildMetric[]>(`/metrics/${id}/children`, { params: filterParams(filters) }).then(r => r.data),
  authors: (id: number, filters: Filters) => api.get<AuthorMetric[]>(`/metrics/${id}/authors`, { params: filterParams(filters) }).then(r => r.data),
  authorAnalytics: (id: number, filters: Filters) => api.get<AuthorAnalytics>(`/metrics/${id}/author-analytics`, { params: filterParams(filters) }).then(r => r.data),
  timeline: (id: number, filters: Filters) => api.get<TimelinePoint[]>(`/metrics/${id}/timeline`, { params: filterParams(filters) }).then(r => r.data),
  commits: (id: number, filters: Filters, page = 1, pageSize = 50, search = '') => api.get<CommitResponse>(`/metrics/${id}/commits`, {
    params: { ...Object.fromEntries(filterParams(filters)), page, pageSize, search },
  }).then(r => r.data),
  commitFiles: (id: number, hash: string) => api.get<CommitFileDiff[]>(`/metrics/${id}/commits/${hash}/files`).then(r => r.data),
  paths: (id: number) => api.get<PathResponse>(`/metrics/${id}/paths`).then(r => r.data),
  streamFiles: async (
    id: number,
    filters: Filters,
    onItem: (item: FileMetric) => void,
    signal?: AbortSignal
  ) => {
    const params = filterParams(filters);
    params.set('stream', '1');
    const response = await fetch(`/api/metrics/${id}/files?${params.toString()}`, { signal });
    if (!response.ok || !response.body) throw new Error('Unable to stream file metrics.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onItem(JSON.parse(line) as FileMetric);
      }
      if (done) break;
    }
    if (pending.trim()) onItem(JSON.parse(pending) as FileMetric);
  },
};

export const authorsApi = {
  raw: (id: number) => api.get<RawAuthor[]>(`/authors/${id}`).then(r => r.data),
  canonical: (id: number) => api.get<CanonicalAuthor[]>(`/authors/${id}/canonical`).then(r => r.data),
  merges: (id: number) => api.get<AuthorMerge[]>(`/authors/${id}/merges`).then(r => r.data),
  merge: (id: number, canonicalEmail: string, canonicalName: string, mergedEmails: string[]) =>
    api.post(`/authors/${id}/merge`, { canonicalEmail, canonicalName, mergedEmails }).then(r => r.data),
  removeMerge: (repoId: number, mergeId: number) => api.delete(`/authors/${repoId}/merge/${mergeId}`).then(r => r.data),
  applyMailmap: (id: number) => api.post<{ ok: boolean; applied: number }>(`/authors/${id}/apply-mailmap`).then(r => r.data),
};
