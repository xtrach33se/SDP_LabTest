import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download, FileCode2, FolderTree } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useParams } from 'react-router-dom';
import { metricsApi } from '../api';
import FileExplorerTree from '../components/FileExplorerTree';
import MetricLabel from '../components/MetricLabel';
import { toast } from '../components/Toast';
import { useFilters } from '../context/FilterContext';
import { downloadCsv } from '../utils/csv';
import type { FileMetric } from '../types';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function MetricCard({ label, value, tone = 'text-white', queryTime }: { label: string; value: string; tone?: string; queryTime?: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-700"><MetricLabel>{label}</MetricLabel></p>{window.location.hostname === 'localhost' && queryTime != null && <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-400">{queryTime.toFixed(1)} ms</span>}</div>
      <p className={`mt-2 text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export default function FilesPage() {
  const repoId = Number(useParams().repoId);
  const { filters, setFilters } = useFilters();
  const [streamedFiles, setStreamedFiles] = useState<FileMetric[]>([]);
  const [streaming, setStreaming] = useState(true);
  const pathsQuery = useQuery({ queryKey: ['paths', repoId], queryFn: () => metricsApi.paths(repoId) });
  const directoriesQuery = useQuery({
    queryKey: ['directories', repoId, filters.authorEmail, filters.startDate, filters.endDate, filters.commitHashes],
    queryFn: () => metricsApi.directories(repoId, { ...filters, path: '' }),
  });

  useEffect(() => {
    const controller = new AbortController();
    setStreamedFiles([]);
    setStreaming(true);
    metricsApi.streamFiles(repoId, { ...filters, path: '' }, item => {
      setStreamedFiles(current => [...current, item]);
    }, controller.signal).catch(error => {
      if ((error as Error).name !== 'AbortError') toast.error(error instanceof Error ? error.message : 'Unable to stream file metrics.');
    }).finally(() => setStreaming(false));
    return () => controller.abort();
  }, [repoId, filters.authorEmail, filters.startDate, filters.endDate, filters.commitHashes]);

  const files = pathsQuery.data?.files ?? [];
  const directories = pathsQuery.data?.directories ?? [];
  const selectedPath = filters.path && (files.includes(filters.path) || directories.includes(filters.path))
    ? filters.path
    : '';
  const selectedType = files.includes(selectedPath) ? 'file' : selectedPath ? 'directory' : null;
  const scopedFilters = { ...filters, path: selectedPath };
  const metricQuery = useQuery({
    queryKey: ['object-metric', repoId, selectedPath, filters.authorEmail, filters.startDate, filters.endDate, filters.commitHashes],
    queryFn: () => selectedType === 'file'
      ? metricsApi.file(repoId, scopedFilters)
      : metricsApi.directory(repoId, scopedFilters),
    enabled: Boolean(selectedType),
  });
  const timelineQuery = useQuery({
    queryKey: ['object-timeline', repoId, selectedPath, filters.authorEmail, filters.startDate, filters.endDate, filters.commitHashes],
    queryFn: () => metricsApi.timeline(repoId, scopedFilters),
    enabled: Boolean(selectedType),
  });
  const childrenQuery = useQuery({
    queryKey: ['children', repoId, selectedPath, filters.authorEmail, filters.startDate, filters.endDate, filters.commitHashes],
    queryFn: () => metricsApi.children(repoId, scopedFilters),
    enabled: selectedType === 'directory',
  });

  const treeMetrics = useMemo(() => [
    ...streamedFiles,
    ...(directoriesQuery.data ?? []),
  ], [directoriesQuery.data, streamedFiles]);
  const metric = metricQuery.data;
  const breadcrumbs = selectedPath.split('/').filter(Boolean);

  function select(path: string) {
    setFilters(current => ({ ...current, path }));
  }

  if (pathsQuery.isLoading) return <div className="p-8"><div className="grid gap-4 xl:grid-cols-[340px_1fr]"><div className="h-[650px] animate-pulse rounded-2xl bg-white/[0.025]" /><div className="h-[650px] animate-pulse rounded-2xl bg-white/[0.025]" /></div></div>;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><FolderTree className="h-3.5 w-3.5" /> Object explorer</div><h1 className="text-2xl font-bold text-white">Files & directories</h1><p className="mt-1.5 text-sm text-slate-600">Inspect volatility, ownership, and change history at any path.</p></div>
        <button disabled={!streamedFiles.length} onClick={() => downloadCsv('rat-files.csv', streamedFiles.map(file => ({ path: file.path, linesAdded: file.linesAdded, linesRemoved: file.linesRemoved, growth: file.growth, churn: file.churn, modifications: file.modifications, modificationFrequency: file.modificationFrequency, churnRate: file.churnRate })))} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-400 disabled:opacity-30"><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4">
            <div><h2 className="section-title">Repository tree</h2><p className="section-subtitle">{files.length.toLocaleString()} tracked paths</p></div>
            {streaming && <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" title="Streaming metrics" />}
          </div>
          <FileExplorerTree files={files} metrics={treeMetrics} selectedPath={selectedPath} onSelect={select} />
        </aside>

        <main className="min-w-0 space-y-4">
          {!selectedPath ? (
            <section className="panel grid min-h-[600px] place-items-center p-10 text-center">
              <div><FileCode2 className="mx-auto h-10 w-10 text-slate-700" /><h2 className="mt-4 text-lg font-semibold text-slate-300">Select a path</h2><p className="mt-2 text-sm text-slate-600">Choose a file or directory from the virtualised tree.</p></div>
            </section>
          ) : (
            <>
              <section className="panel px-5 py-4">
                <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                  <button onClick={() => setFilters(current => ({ ...current, path: '' }))} className="hover:text-violet-300">repository</button>
                  {breadcrumbs.map((part, index) => {
                    const path = breadcrumbs.slice(0, index + 1).join('/');
                    return <span key={path} className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /><button onClick={() => select(path)} className={index === breadcrumbs.length - 1 ? 'font-mono text-violet-300' : 'font-mono hover:text-violet-300'}>{part}</button></span>;
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2"><span className="rounded-md border border-violet-400/15 bg-violet-400/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-300">{selectedType}</span><h2 className="truncate font-mono text-sm text-slate-200">{selectedPath}</h2></div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Lines added" value={compact.format(metric?.linesAdded ?? 0)} tone="text-emerald-400" queryTime={metric?.queryTimeMs} />
                <MetricCard label="Lines removed" value={compact.format(metric?.linesRemoved ?? 0)} tone="text-rose-400" queryTime={metric?.queryTimeMs} />
                <MetricCard label="Net growth" value={compact.format(metric?.growth ?? 0)} tone="text-cyan-300" queryTime={metric?.queryTimeMs} />
                <MetricCard label="Total churn" value={compact.format(metric?.churn ?? 0)} tone="text-violet-300" queryTime={metric?.queryTimeMs} />
                <MetricCard label="Modifications" value={(metric?.modifications ?? 0).toLocaleString()} queryTime={metric?.queryTimeMs} />
                <MetricCard label="Modification frequency" value={`${((metric?.modificationFrequency ?? 0) * 100).toFixed(2)}%`} queryTime={metric?.queryTimeMs} />
                <MetricCard label="Churn rate" value={(metric?.churnRate ?? 0).toFixed(2)} queryTime={metric?.queryTimeMs} />
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="panel p-5">
                  <h2 className="section-title">Change timeline</h2><p className="section-subtitle">Churn for the selected path over time</p>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timelineQuery.data ?? []}>
                        <defs><linearGradient id="fileChurn" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs>
                        <XAxis dataKey="timestamp" tickFormatter={value => new Date(value * 1000).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })} tick={{ fill: '#475569', fontSize: 10 }} minTickGap={35} />
                        <YAxis tick={{ fill: '#475569', fontSize: 10 }} width={42} />
                        <Tooltip labelFormatter={value => new Date(Number(value) * 1000).toLocaleDateString()} contentStyle={{ background: '#111722', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12 }} />
                        <Area type="monotone" dataKey="churn" stroke="#8b5cf6" fill="url(#fileChurn)" strokeWidth={1.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="panel overflow-hidden">
                  <div className="border-b border-white/[0.06] px-5 py-4"><h2 className="section-title">Author ownership</h2><p className="section-subtitle">Contribution share by churn</p></div>
                  <div className="max-h-72 overflow-auto divide-y divide-white/[0.045]">
                    {metric?.authors.map(author => <div key={`${author.email}-${author.name}`} className="px-5 py-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-300">{author.name}</p><p className="truncate font-mono text-[10px] text-slate-700">{author.email}</p></div><div className="text-right"><p className="text-xs font-semibold text-violet-300">{(author.ownership * 100).toFixed(1)}%</p><p className="text-[10px] text-slate-600">{author.modifications} changes · {compact.format(author.churn)} churn</p></div></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" style={{ width: `${Math.max(1, author.ownership * 100)}%` }} /></div></div>)}
                    {!metric?.authors.length && <p className="p-8 text-center text-xs text-slate-600">No author activity in this scope.</p>}
                  </div>
                </section>
              </div>

              {selectedType === 'directory' && (
                <section className="panel overflow-hidden">
                  <div className="border-b border-white/[0.06] px-5 py-4"><h2 className="section-title">Immediate children</h2><p className="section-subtitle">Files and subdirectories ranked by churn</p></div>
                  <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wider text-slate-700"><tr><th className="px-5 py-3">Path</th><th>Type</th><th>Added</th><th>Removed</th><th>Growth</th><th className="pr-5">Churn</th></tr></thead><tbody className="divide-y divide-white/[0.045]">{childrenQuery.data?.map(child => <tr key={child.path} onClick={() => select(child.path)} className="cursor-pointer hover:bg-white/[0.025]"><td className="px-5 py-3 font-mono text-slate-300">{child.name}</td><td className="text-slate-600">{child.type}</td><td className="text-emerald-400">+{child.linesAdded.toLocaleString()}</td><td className="text-rose-400">−{child.linesRemoved.toLocaleString()}</td><td className="text-slate-500">{child.linesAdded - child.linesRemoved}</td><td className="pr-5 font-semibold text-violet-300">{child.churn.toLocaleString()}</td></tr>)}</tbody></table></div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
