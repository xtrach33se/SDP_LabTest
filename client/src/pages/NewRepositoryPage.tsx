import { useRef, useState } from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, GitFork, Loader2, RotateCcw, UploadCloud } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { repositoriesApi } from '../api';
import type { IngestionProgress } from './pageTypes';

const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const gitUrlPattern = /^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i;

export default function NewRepositoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'url' | 'zip'>('url');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [error, setError] = useState('');
  const [duplicateRepoId, setDuplicateRepoId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function chooseFile(next: File | null) {
    setError('');
    if (!next) return setFile(null);
    if (!/\.zip$/i.test(next.name)) {
      setFile(null);
      return setError('Only .zip repository archives are supported.');
    }
    if (next.size > MAX_ZIP_BYTES) {
      setFile(null);
      return setError('The ZIP exceeds the 500 MB upload limit.');
    }
    setFile(next);
    if (!name.trim()) setName(next.name.replace(/\.zip$/i, ''));
  }

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
        setDuplicateRepoId(next.existingRepoId ?? null);
      }
    };
    source.onerror = () => {
      source.close();
      setError(current => current || 'The progress connection was interrupted. You can retry safely.');
    };
  }

  async function submit(force = false) {
    setError('');
    setDuplicateRepoId(null);
    setUploadPercent(0);
    setProgress({ repoId: null, stage: tab === 'url' ? 'clone' : 'extract', message: tab === 'url' ? 'Starting deep clone…' : 'Uploading archive…', current: 0, total: 0 });
    try {
      const job = tab === 'url'
        ? await repositoriesApi.clone(url.trim(), name.trim() || url.split('/').pop()?.replace(/\.git$/i, '') || 'Repository', force)
        : await repositoriesApi.upload(file!, name.trim() || file!.name.replace(/\.zip$/i, ''), force, setUploadPercent);
      watchJob(job.jobId);
    } catch (reason) {
      const body = axios.isAxiosError(reason)
        ? reason.response?.data as { error?: string; code?: string; existingRepoId?: number } | undefined
        : undefined;
      setError(body?.error || (reason instanceof Error ? reason.message : 'Unable to start ingestion.'));
      setDuplicateRepoId(body?.existingRepoId ?? null);
      setProgress({
        repoId: null,
        stage: 'error',
        message: body?.error || 'Unable to start ingestion.',
        current: 0,
        total: 0,
        code: (body?.code as IngestionProgress['code']) ?? 'INGESTION_FAILED',
        existingRepoId: body?.existingRepoId,
      });
    }
  }

  const urlError = url.length > 0 && !gitUrlPattern.test(url.trim())
    ? 'Use an HTTPS, SSH, or git@ repository URL.'
    : '';
  const valid = tab === 'url' ? gitUrlPattern.test(url.trim()) : Boolean(file);
  const percentage = progress?.stage === 'done' ? 100
    : progress?.stage === 'compute' ? 96
      : progress?.total ? Math.min(94, Math.round((progress.current / progress.total) * 94))
        : tab === 'zip' && uploadPercent < 100 ? Math.round(uploadPercent * 0.15)
          : 18;
  const stageLabel = progress?.stage === 'clone' ? 'Cloning complete history'
    : progress?.stage === 'extract' ? (uploadPercent < 100 ? `Uploading archive · ${uploadPercent}%` : 'Extracting repository')
      : progress?.stage === 'parse' ? 'Parsing commits'
        : progress?.stage === 'compute' ? 'Computing metrics'
          : progress?.stage === 'done' ? 'Analysis complete'
            : 'Import failed';

  function reset() {
    setProgress(null);
    setError('');
    setDuplicateRepoId(null);
    setUploadPercent(0);
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Link to="/repos" className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-200"><ArrowLeft className="h-4 w-4" /> Repositories</Link>
      <div className="mb-8"><h1 className="text-3xl font-bold tracking-tight text-white">Analyse a repository</h1><p className="mt-2 text-sm text-slate-500">Import a complete Git history from an archive or remote URL.</p></div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e131d] shadow-2xl shadow-black/20">
        {!progress ? (
          <>
            <div className="flex border-b border-white/[0.07] p-1.5">
              <button onClick={() => { setTab('url'); setError(''); }} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === 'url' ? 'bg-white/[0.07] text-white' : 'text-slate-600 hover:text-slate-300'}`}>Clone URL</button>
              <button onClick={() => { setTab('zip'); setError(''); }} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === 'zip' ? 'bg-white/[0.07] text-white' : 'text-slate-600 hover:text-slate-300'}`}>Upload ZIP</button>
            </div>
            <div className="p-6 sm:p-8">
              <label className="mb-2 block text-xs font-semibold text-slate-400">Repository name <span className="font-normal text-slate-700">(optional)</span></label>
              <input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. redis" className="input mb-6 w-full" />
              {tab === 'url' ? (
                <div><label className="mb-2 block text-xs font-semibold text-slate-400">Remote Git URL</label><div className="relative"><GitFork className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-600" /><input value={url} onChange={event => { setUrl(event.target.value); setError(''); }} placeholder="https://github.com/owner/repository.git" className={`input w-full pl-10 font-mono ${urlError ? 'border-rose-400/40' : ''}`} /></div>{urlError ? <p className="mt-2 text-xs text-rose-300">{urlError}</p> : <p className="mt-2 text-xs text-slate-700">A full-depth clone is used so every historical commit can be analysed.</p>}</div>
              ) : (
                <button
                  onClick={() => inputRef.current?.click()}
                  onDragOver={event => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0] ?? null); }}
                  className={`group w-full rounded-2xl border border-dashed px-6 py-12 text-center transition ${dragging ? 'border-violet-400 bg-violet-400/[0.06]' : 'border-white/[0.12] bg-white/[0.015] hover:border-violet-400/35 hover:bg-violet-400/[0.03]'}`}
                >
                  <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
                  <UploadCloud className="mx-auto h-8 w-8 text-slate-600 transition group-hover:text-violet-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-300">{file?.name ?? 'Drop a repository ZIP or click to browse'}</p>
                  <p className="mt-1 text-xs text-slate-700">Maximum 500 MB · archive must contain a .git directory</p>
                </button>
              )}
              {error && <p className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-300">{error}</p>}
              <button disabled={!valid || Boolean(urlError)} onClick={() => submit()} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/15 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-30">{tab === 'url' ? 'Clone & analyse' : 'Upload & analyse'}</button>
            </div>
          </>
        ) : (
          <div className="p-10 text-center sm:p-14">
            {progress.stage === 'done' ? <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" /> : progress.stage === 'error' ? <AlertTriangle className="mx-auto h-12 w-12 text-rose-400" /> : <Loader2 className="mx-auto h-12 w-12 animate-spin text-violet-400" />}
            <h2 className="mt-5 text-xl font-semibold text-white">{stageLabel}</h2>
            <p className={`mt-2 text-sm ${progress.stage === 'error' ? 'text-rose-300' : 'text-slate-500'}`}>{error || progress.message}</p>
            {progress.stage !== 'error' && <><div className="mx-auto mt-7 h-2 max-w-md overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500" style={{ width: `${percentage}%` }} /></div><p className="mt-2 font-mono text-[10px] text-slate-700">{percentage}%</p></>}
            {progress.stage === 'error' && <div className="mt-7 flex flex-wrap justify-center gap-2"><button onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2.5 text-sm font-semibold text-slate-300"><RotateCcw className="h-4 w-4" /> Try again</button>{duplicateRepoId && <><button onClick={() => navigate(`/repos/${duplicateRepoId}`)} className="rounded-xl border border-violet-400/25 px-4 py-2.5 text-sm font-semibold text-violet-300">Open existing</button><button onClick={() => submit(true)} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white">Re-import</button></>}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
