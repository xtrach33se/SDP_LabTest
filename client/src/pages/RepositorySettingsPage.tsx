import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Save, Settings2, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { repositoriesApi } from '../api';
import { toast } from '../components/Toast';
import type { IngestionProgress } from './pageTypes';

export default function RepositorySettingsPage() {
  const repoId = Number(useParams().repoId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: repository } = useQuery({ queryKey: ['repository', repoId], queryFn: () => repositoriesApi.get(repoId) });
  const { data: stats, isLoading } = useQuery({ queryKey: ['repository-stats', repoId], queryFn: () => repositoriesApi.stats(repoId) });
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  useEffect(() => { if (repository) setName(repository.name); }, [repository]);

  const rename = useMutation({
    mutationFn: () => repositoriesApi.rename(repoId, name),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['repositories'] }); toast.success('Repository renamed.'); },
  });
  const remove = useMutation({
    mutationFn: () => repositoriesApi.remove(repoId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['repositories'] }); navigate('/repos'); toast.success('Repository deleted.'); },
  });

  async function reingest() {
    const { jobId } = await repositoriesApi.reingest(repoId);
    setProgress({ repoId: null, stage: 'clone', message: 'Refreshing repository history…', current: 0, total: 0 });
    const source = new EventSource(`/api/repositories/${jobId}/progress`);
    source.onmessage = event => {
      const next = JSON.parse(event.data) as IngestionProgress;
      setProgress(next);
      if (next.stage === 'done') {
        source.close();
        queryClient.invalidateQueries({ queryKey: ['repositories'] });
        toast.success('Repository re-ingested successfully.');
        navigate(`/repos/${next.repoId}`);
      } else if (next.stage === 'error') {
        source.close();
        toast.error(next.message);
      }
    };
  }

  const duration = stats?.ingestion_started_at && stats?.ingestion_completed_at
    ? `${stats.ingestion_completed_at - stats.ingestion_started_at}s`
    : 'Not recorded';

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-7"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><Settings2 className="h-3.5 w-3.5" /> Repository administration</div><h1 className="text-2xl font-bold text-white">Settings</h1><p className="mt-1.5 text-sm text-slate-600">Manage the repository index and inspect ingestion statistics.</p></div>
      {isLoading ? <div className="h-72 animate-pulse rounded-2xl bg-white/[0.025]" /> : <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-5 md:col-span-2"><label className="mb-2 block text-xs font-semibold text-slate-500">Repository name</label><div className="flex gap-2"><input className="input flex-1" value={name} onChange={event => setName(event.target.value)} /><button disabled={!name.trim() || rename.isPending} onClick={() => rename.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40"><Save className="h-4 w-4" /> Save</button></div></section>
        {[['Commits', stats?.commit_count], ['Tracked files', stats?.file_count], ['Author identities', stats?.author_count], ['Lines added', stats?.lines_added], ['Lines removed', stats?.lines_removed], ['Ingestion time', duration]].map(([label, value]) => <div key={String(label)} className="panel p-5"><p className="text-xs text-slate-600">{label}</p><p className="mt-2 text-2xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value ?? '—'}</p></div>)}
        <section className="panel p-5 md:col-span-2"><h2 className="section-title">Refresh analysis</h2><p className="mt-1 text-xs text-slate-600">{repository?.url ? 'Deep-clone the URL again and replace this index.' : 'ZIP imports must be uploaded again because the source archive is not retained.'}</p><button disabled={!repository?.url || Boolean(progress && !['done', 'error'].includes(progress.stage))} onClick={reingest} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 disabled:opacity-35"><RefreshCw className={`h-4 w-4 ${progress && !['done', 'error'].includes(progress.stage) ? 'animate-spin' : ''}`} /> {progress?.message ?? 'Re-ingest repository'}</button></section>
        <section className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.035] p-5 md:col-span-2"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-rose-400" /><div className="flex-1"><h2 className="font-semibold text-rose-200">Delete repository index</h2><p className="mt-1 text-xs text-rose-300/60">This permanently removes indexed commits, diffs, metrics, and author merges.</p></div><button onClick={() => window.confirm('Delete this repository index permanently?') && remove.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white"><Trash2 className="h-4 w-4" /> Delete</button></div></section>
      </div>}
    </div>
  );
}
