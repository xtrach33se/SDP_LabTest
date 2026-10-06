import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, GitCommitHorizontal, Search } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { metricsApi } from '../api';
import { useFilters } from '../context/FilterContext';

export default function CommitsPage() {
  const repoId = Number(useParams().repoId);
  const { filters, setFilters } = useFilters();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(filters.commitHashes);
  const { data, isLoading } = useQuery({ queryKey: ['commits', repoId, filters, page, search], queryFn: () => metricsApi.commits(repoId, filters.commitHashes.length ? { ...filters, commitHashes: [] } : filters, page, 50, search) });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  function toggle(hash: string) { setLocalSelected(current => current.includes(hash) ? current.filter(item => item !== hash) : [...current, hash]); }
  function selectVisible() { setLocalSelected(current => [...new Set([...current, ...(data?.commits.map(commit => commit.hash) ?? [])])]); }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><GitCommitHorizontal className="h-3.5 w-3.5" /> History explorer</div><h1 className="text-2xl font-bold text-white">Commits</h1><p className="mt-1.5 text-sm text-slate-600">Build a precise commit set for every metric view.</p></div><div className="flex gap-2"><button onClick={selectVisible} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white">Select visible</button><button onClick={() => setFilters(current => ({ ...current, commitHashes: localSelected }))} disabled={!localSelected.length} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-30">Use {localSelected.length} selected</button></div></div>
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4"><div className="relative max-w-md flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-600" /><input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input h-9 w-full pl-9" placeholder="Search message, author, or email…" /></div><span className="text-xs text-slate-600">{data?.total.toLocaleString() ?? 0} commits</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="border-b border-white/[0.05] text-[10px] uppercase tracking-wider text-slate-700"><tr><th className="w-12 px-5 py-3" /><th className="px-3 py-3">Commit</th><th className="px-3 py-3">Message</th><th className="px-3 py-3">Author</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Added</th><th className="px-5 py-3">Removed</th></tr></thead><tbody className="divide-y divide-white/[0.045]">{data?.commits.map(commit => { const selected = localSelected.includes(commit.hash); return <tr key={commit.hash} onClick={() => toggle(commit.hash)} className="cursor-pointer hover:bg-white/[0.025]"><td className="px-5 py-3.5"><span className={`grid h-4 w-4 place-items-center rounded border ${selected ? 'border-violet-400 bg-violet-500' : 'border-slate-700'}`}>{selected && <Check className="h-3 w-3" />}</span></td><td className="px-3 py-3.5 font-mono text-violet-300">{commit.hash.slice(0, 8)}</td><td className="max-w-md truncate px-3 py-3.5 text-slate-300">{commit.message || 'No commit message'}</td><td className="px-3 py-3.5 text-slate-500">{commit.author_name}</td><td className="whitespace-nowrap px-3 py-3.5 text-slate-600">{new Date(commit.timestamp * 1000).toLocaleDateString()}</td><td className="px-3 py-3.5 font-mono text-emerald-400">+{commit.linesAdded.toLocaleString()}</td><td className="px-5 py-3.5 font-mono text-rose-400">−{commit.linesRemoved.toLocaleString()}</td></tr>; })}</tbody></table></div>
        {isLoading && <p className="p-8 text-center text-sm text-slate-600">Loading commit history…</p>}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-4"><span className="text-xs text-slate-600">Page {page} of {pages}</span><div className="flex gap-1"><button disabled={page === 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border border-white/[0.07] p-2 text-slate-500 disabled:opacity-20"><ChevronLeft className="h-4 w-4" /></button><button disabled={page === pages} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-white/[0.07] p-2 text-slate-500 disabled:opacity-20"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>
    </div>
  );
}
