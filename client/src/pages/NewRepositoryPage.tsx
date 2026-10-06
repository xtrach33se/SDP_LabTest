import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, GitFork, Loader2, UploadCloud } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { repositoriesApi } from '../api';
import type { IngestionProgress } from './pageTypes';

export default function NewRepositoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'url' | 'zip'>('url');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function watchJob(jobId: string) {
    const source = new EventSource(`/api/repositories/${jobId}/progress`);
    source.onmessage = event => {
      const next = JSON.parse(event.data) as IngestionProgress;
      setProgress(next);
      if (next.stage === 'done') {
        source.close();
        queryClient.invalidateQueries({ queryKey: ['repositories'] });
        setTimeout(() => navigate(`/repos/${next.repoId}`), 700);
      }
      if (next.stage === 'error') {
        source.close();
        setError(next.message);
      }
    };
    source.onerror = () => source.close();
  }

  async function submit() {
    setError('');
    setProgress({ repoId: null, stage: tab === 'url' ? 'clone' : 'extract', message: 'Starting analysis…', current: 0, total: 0 });
    try {
      const job = tab === 'url'
        ? await repositoriesApi.clone(url, name || url.split('/').pop()?.replace('.git', '') || 'Repository')
        : await repositoriesApi.upload(file!, name || file!.name.replace(/\.zip$/i, ''));
      watchJob(job.jobId);
    } catch (reason) {
      setProgress(null);
      setError(reason instanceof Error ? reason.message : 'Unable to start ingestion');
    }
  }

  const valid = tab === 'url' ? /^https?:\/\/.+|^git@.+/.test(url) : Boolean(file);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Link to="/repos" className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-200"><ArrowLeft className="h-4 w-4" /> Repositories</Link>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">Analyse a repository</h1>
        <p className="mt-2 text-sm text-slate-500">Import the complete Git history. Processing continues while you stay on this page.</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e131d] shadow-2xl shadow-black/20">
        {!progress ? (
          <>
            <div className="flex border-b border-white/[0.07] p-1.5">
              <button onClick={() => setTab('url')} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === 'url' ? 'bg-white/[0.07] text-white' : 'text-slate-600 hover:text-slate-300'}`}>Clone URL</button>
              <button onClick={() => setTab('zip')} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === 'zip' ? 'bg-white/[0.07] text-white' : 'text-slate-600 hover:text-slate-300'}`}>Upload ZIP</button>
            </div>
            <div className="p-6 sm:p-8">
              <label className="mb-2 block text-xs font-semibold text-slate-400">Repository name <span className="font-normal text-slate-700">(optional)</span></label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. redis" className="input mb-6 w-full" />

              {tab === 'url' ? (
                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-400">Remote Git URL</label>
                  <div className="relative"><GitFork className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-600" /><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/owner/repository.git" className="input w-full pl-10 font-mono" /></div>
                  <p className="mt-2 text-xs text-slate-700">A full-depth clone is used so every historical commit can be analysed.</p>
                </div>
              ) : (
                <button onClick={() => inputRef.current?.click()} className="group w-full rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.015] px-6 py-12 text-center transition hover:border-violet-400/35 hover:bg-violet-400/[0.03]">
                  <input ref={inputRef} type="file" accept=".zip" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                  <UploadCloud className="mx-auto h-8 w-8 text-slate-600 transition group-hover:text-violet-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-300">{file?.name ?? 'Choose a repository ZIP'}</p>
                  <p className="mt-1 text-xs text-slate-700">The archive must contain a .git directory</p>
                </button>
              )}

              {error && <p className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-300">{error}</p>}
              <button disabled={!valid} onClick={submit} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/15 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-30">Start analysis</button>
            </div>
          </>
        ) : (
          <div className="p-10 text-center sm:p-14">
            {progress.stage === 'done' ? <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" /> : <Loader2 className="mx-auto h-12 w-12 animate-spin text-violet-400" />}
            <h2 className="mt-5 text-xl font-semibold text-white">{progress.stage === 'done' ? 'Analysis complete' : 'Building repository insights'}</h2>
            <p className="mt-2 text-sm text-slate-500">{progress.message}</p>
            <div className="mx-auto mt-7 h-1.5 max-w-md overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500 ${progress.stage === 'done' ? 'w-full' : 'w-2/3 animate-pulse'}`} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
