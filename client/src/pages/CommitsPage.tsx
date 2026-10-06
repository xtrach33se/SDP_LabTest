import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import { Check, ChevronDown, ChevronLeft, ChevronRight, FileCode2, GitCommitHorizontal, Search } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { metricsApi } from '../api';
import { useFilters } from '../context/FilterContext';
import type { CommitRow } from '../types';

interface RowData {
  commits: CommitRow[];
  expandedHash: string;
  selected: string[];
  repoId: number;
  onExpand: (hash: string, index: number) => void;
  onToggle: (hash: string) => void;
}

function CommitListRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const commit = data.commits[index];
  const expanded = data.expandedHash === commit.hash;
  const selected = data.selected.includes(commit.hash);
  const filesQuery = useQuery({
    queryKey: ['commit-files', data.repoId, commit.hash],
    queryFn: () => metricsApi.commitFiles(data.repoId, commit.hash),
    enabled: expanded,
  });
  return (
    <div style={style} className="px-2 pb-1">
      <div className={`h-full overflow-hidden rounded-xl border transition ${expanded ? 'border-violet-400/20 bg-violet-400/[0.035]' : 'border-transparent hover:bg-white/[0.025]'}`}>
        <div onClick={() => data.onExpand(commit.hash, index)} className="grid h-16 cursor-pointer grid-cols-[36px_92px_minmax(220px,1fr)_150px_105px_70px_70px_24px] items-center gap-2 px-3 text-xs">
          <button onClick={event => { event.stopPropagation(); data.onToggle(commit.hash); }} className={`grid h-4 w-4 place-items-center rounded border ${selected ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-700'}`}>{selected && <Check className="h-3 w-3" />}</button>
          <span className="font-mono text-violet-300">{commit.hash.slice(0, 8)}</span>
          <span className="truncate text-slate-300">{commit.message || 'No commit message'}</span>
          <span className="truncate text-slate-500" title={commit.author_email}>{commit.author_name}</span>
          <span className="whitespace-nowrap text-slate-600">{new Date(commit.timestamp * 1000).toLocaleDateString()}</span>
          <span className="font-mono text-emerald-400">+{commit.linesAdded.toLocaleString()}</span>
          <span className="font-mono text-rose-400">−{commit.linesRemoved.toLocaleString()}</span>
          <ChevronDown className={`h-4 w-4 text-slate-600 transition ${expanded ? 'rotate-180 text-violet-300' : ''}`} />
        </div>
        {expanded && (
          <div className="h-[214px] border-t border-white/[0.05] px-4 py-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Changed files</p><p className="text-[10px] text-slate-700">{filesQuery.data?.length ?? 0} paths · {(commit.linesAdded + commit.linesRemoved).toLocaleString()} churn</p></div>
            <div className="h-40 overflow-auto rounded-lg border border-white/[0.05] bg-black/10">
              {filesQuery.isLoading ? <p className="p-5 text-xs text-slate-600">Loading file breakdown…</p> : filesQuery.data?.map(file => <div key={file.path} className="grid grid-cols-[minmax(0,1fr)_70px_70px_70px] gap-2 border-b border-white/[0.04] px-3 py-2 text-[11px]"><span className="flex min-w-0 items-center gap-2 truncate font-mono text-slate-400"><FileCode2 className="h-3 w-3 shrink-0 text-slate-700" />{file.path}</span><span className="text-right text-emerald-400">+{file.linesAdded}</span><span className="text-right text-rose-400">−{file.linesRemoved}</span><span className="text-right text-violet-300">{file.churn}</span></div>)}
              {!filesQuery.isLoading && !filesQuery.data?.length && <p className="p-5 text-xs text-slate-600">No file changes recorded for this commit.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommitsPage() {
  const repoId = Number(useParams().repoId);
  const { filters, setFilters } = useFilters();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(filters.commitHashes);
  const [expandedHash, setExpandedHash] = useState('');
  const listRef = useRef<VariableSizeList<RowData>>(null);
  const browserFilters = filters.commitHashes.length ? { ...filters, commitHashes: [] } : filters;
  const { data, isLoading } = useQuery({
    queryKey: ['commits', repoId, browserFilters, page, search],
    queryFn: () => metricsApi.commits(repoId, browserFilters, page, 50, search),
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  useEffect(() => setLocalSelected(filters.commitHashes), [filters.commitHashes]);
  useEffect(() => listRef.current?.resetAfterIndex(0), [expandedHash]);

  function toggle(hash: string) {
    setLocalSelected(current => current.includes(hash) ? current.filter(item => item !== hash) : [...current, hash]);
  }
  function selectVisible() {
    setLocalSelected(current => [...new Set([...current, ...(data?.commits.map(commit => commit.hash) ?? [])])]);
  }
  function expand(hash: string, index: number) {
    setExpandedHash(current => current === hash ? '' : hash);
    listRef.current?.resetAfterIndex(index);
  }

  const rowData: RowData = {
    commits: data?.commits ?? [],
    expandedHash,
    selected: localSelected,
    repoId,
    onExpand: expand,
    onToggle: toggle,
  };

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><GitCommitHorizontal className="h-3.5 w-3.5" /> History explorer</div><h1 className="text-2xl font-bold text-white">Commits</h1><p className="mt-1.5 text-sm text-slate-600">Search, inspect file-level diffs, and build a precise commit set.</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={selectVisible} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white">Select visible</button>{localSelected.length > 0 && <button onClick={() => setLocalSelected([])} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-500 hover:text-white">Clear selection</button>}<button onClick={() => setFilters(current => ({ ...current, commitHashes: localSelected }))} disabled={!localSelected.length} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-30">Use {localSelected.length} selected</button></div>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4"><div className="relative max-w-md flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-600" /><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="input h-9 w-full pl-9" placeholder="Search message, author, or email…" /></div><span className="text-xs text-slate-600">{data?.total.toLocaleString() ?? 0} commits</span></div>
        <div className="grid grid-cols-[36px_92px_minmax(220px,1fr)_150px_105px_70px_70px_24px] gap-2 border-b border-white/[0.05] px-5 py-3 text-[10px] uppercase tracking-wider text-slate-700"><span /><span>Commit</span><span>Message</span><span>Author</span><span>Date</span><span>Added</span><span>Removed</span><span /></div>
        {isLoading ? <p className="p-12 text-center text-sm text-slate-600">Loading commit history…</p> : (
          <VariableSizeList
            ref={listRef}
            height={Math.min(650, Math.max(160, (data?.commits.length ?? 0) * 65))}
            width="100%"
            itemCount={data?.commits.length ?? 0}
            itemSize={index => data?.commits[index]?.hash === expandedHash ? 280 : 65}
            itemData={rowData}
            overscanCount={6}
          >
            {CommitListRow}
          </VariableSizeList>
        )}
        {!isLoading && !data?.commits.length && <p className="p-12 text-center text-sm text-slate-600">No commits match this search.</p>}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-4"><span className="text-xs text-slate-600">Page {page} of {pages}</span><div className="flex gap-1"><button disabled={page === 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border border-white/[0.07] p-2 text-slate-500 disabled:opacity-20"><ChevronLeft className="h-4 w-4" /></button><button disabled={page === pages} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-white/[0.07] p-2 text-slate-500 disabled:opacity-20"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>
    </div>
  );
}
