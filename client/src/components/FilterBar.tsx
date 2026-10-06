import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Check, Filter, GitCommitHorizontal, Search, X } from 'lucide-react';
import { metricsApi } from '../api';
import { useFilters } from '../context/FilterContext';

export default function FilterBar({ repoId }: { repoId: number }) {
  const { filters, setFilters, clearFilters, activeCount } = useFilters();
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [commitSearch, setCommitSearch] = useState('');
  const { data: authors = [] } = useQuery({
    queryKey: ['authors-metrics', repoId],
    queryFn: () => metricsApi.authors(repoId, { authorEmail: '', path: '', startDate: '', endDate: '', commitHashes: [] }),
  });
  const { data: paths } = useQuery({ queryKey: ['paths', repoId], queryFn: () => metricsApi.paths(repoId) });
  const { data: commitData } = useQuery({
    queryKey: ['commit-options', repoId, commitSearch],
    queryFn: () => metricsApi.commits(repoId, { authorEmail: '', path: '', startDate: '', endDate: '', commitHashes: [] }, 1, 50, commitSearch),
    enabled: commitsOpen,
  });

  const allPaths = useMemo(() => [...(paths?.directories ?? []), ...(paths?.files ?? [])], [paths]);
  const field = 'h-9 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-xs text-slate-300 outline-none transition placeholder:text-slate-700 hover:border-white/[0.14] focus:border-violet-400/50 focus:bg-violet-400/[0.04]';

  function toggleCommit(hash: string) {
    setFilters(current => ({
      ...current,
      commitHashes: current.commitHashes.includes(hash)
        ? current.commitHashes.filter(item => item !== hash)
        : [...current.commitHashes, hash],
    }));
  }

  return (
    <div className="border-t border-white/[0.045] px-4 py-2.5 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
        <div className="flex shrink-0 items-center gap-2 pr-1 text-xs font-semibold text-slate-500">
          <Filter className="h-3.5 w-3.5" /> Filters
          {activeCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[10px] text-white">{activeCount}</span>}
        </div>

        <select
          aria-label="Filter by author"
          value={filters.authorEmail}
          onChange={event => setFilters(current => ({ ...current, authorEmail: event.target.value }))}
          className={`${field} max-w-48`}
        >
          <option value="">All authors</option>
          {authors.map(author => <option key={`${author.email}-${author.name}`} value={author.email}>{author.name}</option>)}
        </select>

        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-600" />
          <input
            aria-label="Filter by path"
            list="repo-paths"
            value={filters.path}
            onChange={event => setFilters(current => ({ ...current, path: event.target.value }))}
            placeholder="File or directory"
            className={`${field} w-44 pl-8`}
          />
          <datalist id="repo-paths">{allPaths.slice(0, 2000).map(path => <option key={path} value={path} />)}</datalist>
        </div>

        <div className="relative shrink-0">
          <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-600" />
          <input aria-label="Start date" type="date" value={filters.startDate} onChange={event => setFilters(current => ({ ...current, startDate: event.target.value }))} className={`${field} w-36 pl-8`} />
        </div>
        <span className="text-xs text-slate-700">to</span>
        <input aria-label="End date" type="date" value={filters.endDate} onChange={event => setFilters(current => ({ ...current, endDate: event.target.value }))} className={`${field} w-32`} />

        <div className="relative shrink-0">
          <button onClick={() => setCommitsOpen(open => !open)} className={`${field} flex items-center gap-2`}>
            <GitCommitHorizontal className="h-3.5 w-3.5 text-slate-500" />
            {filters.commitHashes.length ? `${filters.commitHashes.length} commits` : 'Select commits'}
          </button>
          {commitsOpen && (
            <div className="absolute right-0 top-11 z-50 w-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#111620] shadow-2xl shadow-black/50">
              <div className="border-b border-white/[0.07] p-3">
                <input autoFocus value={commitSearch} onChange={e => setCommitSearch(e.target.value)} placeholder="Search hash, message, or author…" className={`${field} w-full`} />
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {commitData?.commits.map(commit => {
                  const selected = filters.commitHashes.includes(commit.hash);
                  return (
                    <button key={commit.hash} onClick={() => toggleCommit(commit.hash)} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.05]">
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${selected ? 'border-violet-400 bg-violet-500' : 'border-slate-700'}`}>{selected && <Check className="h-3 w-3" />}</span>
                      <span className="min-w-0"><span className="block truncate text-xs text-slate-300">{commit.message || 'No commit message'}</span><span className="font-mono text-[10px] text-slate-600">{commit.hash.slice(0, 8)} · {commit.author_name}</span></span>
                    </button>
                  );
                })}
                {!commitData?.commits.length && <p className="p-6 text-center text-xs text-slate-600">No matching commits</p>}
              </div>
              <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2">
                <button onClick={() => setFilters(current => ({ ...current, commitHashes: [] }))} className="text-xs text-slate-500 hover:text-slate-300">Clear selection</button>
                <button onClick={() => setCommitsOpen(false)} className="rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white">Done</button>
              </div>
            </div>
          )}
        </div>

        {activeCount > 0 && <button onClick={clearFilters} className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-xs text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>
    </div>
  );
}
