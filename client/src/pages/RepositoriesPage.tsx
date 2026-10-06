import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FolderGit2, GitBranch, Plus, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { repositoriesApi } from '../api';

export default function RepositoriesPage() {
  const { data: repositories = [], isLoading, isError } = useQuery({ queryKey: ['repositories'], queryFn: repositoriesApi.list });

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/15 bg-violet-400/[0.06] px-3 py-1 text-xs font-semibold text-violet-300"><Sparkles className="h-3 w-3" /> Engineering intelligence</div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Repository workspace</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Explore ownership, code churn, growth, and team activity across every commit.</p>
        </div>
        <Link to="/repos/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"><Plus className="h-4 w-4" /> Add repository</Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map(i => <div key={i} className="h-44 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]" />)}</div>
      ) : isError ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-8 text-center text-sm text-rose-300">The repository list could not be loaded. Check that the API server is running.</div>
      ) : repositories.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {repositories.map(repo => (
            <Link key={repo.id} to={`/repos/${repo.id}`} className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.045] to-transparent p-6 transition duration-300 hover:-translate-y-0.5 hover:border-violet-400/25 hover:shadow-2xl hover:shadow-violet-950/20">
              <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-violet-500/[0.06] blur-2xl transition group-hover:bg-violet-500/10" />
              <div className="relative flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-violet-300"><FolderGit2 className="h-5 w-5" /></span>
                <ArrowRight className="h-5 w-5 -translate-x-1 text-slate-700 opacity-0 transition group-hover:translate-x-0 group-hover:text-violet-300 group-hover:opacity-100" />
              </div>
              <h2 className="relative mt-5 truncate text-lg font-semibold text-slate-100">{repo.name}</h2>
              <p className="relative mt-1 truncate text-xs text-slate-600">{repo.url || 'Uploaded repository'}</p>
              <div className="relative mt-5 flex items-center gap-5 border-t border-white/[0.06] pt-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> {repo.commit_count.toLocaleString()} commits</span>
                <span>Indexed {new Date(repo.created_at * 1000).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/[0.1] bg-white/[0.018] px-6 py-20 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-violet-400/20 bg-violet-400/[0.07] text-violet-300"><FolderGit2 className="h-7 w-7" /></span>
          <h2 className="mt-5 text-lg font-semibold text-slate-200">Your analysis workspace is empty</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">Clone a remote Git URL or upload a repository ZIP containing its .git history.</p>
          <Link to="/repos/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-violet-100"><Plus className="h-4 w-4" /> Analyse your first repository</Link>
        </div>
      )}
    </div>
  );
}
