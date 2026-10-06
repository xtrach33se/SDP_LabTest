import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronsUpDown,
  Clock3,
  Code2,
  FileCode2,
  GitCommitHorizontal,
  Menu,
  Plus,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { repositoriesApi } from '../api';
import { FilterProvider } from '../context/FilterContext';
import FilterBar from './FilterBar';

const nav = [
  { label: 'Overview', icon: BarChart3, suffix: '' },
  { label: 'Files', icon: FileCode2, suffix: '/files' },
  { label: 'Authors', icon: Users, suffix: '/authors' },
  { label: 'Commits', icon: GitCommitHorizontal, suffix: '/commits' },
  { label: 'Timeline', icon: Clock3, suffix: '/timeline' },
];

export default function Layout() {
  const { repoId } = useParams();
  const id = Number(repoId);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: repositories = [] } = useQuery({ queryKey: ['repositories'], queryFn: repositoriesApi.list });
  const current = repositories.find(repo => repo.id === id);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-white/[0.07] bg-[#0a0d14]">
      <Link to="/repos" className="flex h-20 items-center gap-3 border-b border-white/[0.07] px-6">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-lg shadow-violet-500/20">
          <Code2 className="h-5 w-5 text-white" />
        </span>
        <span>
          <span className="block text-lg font-bold tracking-tight text-white">RepoLens</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Analysis tool</span>
        </span>
      </Link>

      <div className="px-4 pt-5">
        <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Workspace</p>
        <Link to="/repos" className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-3 text-sm text-slate-300 transition hover:border-violet-500/30 hover:bg-violet-500/5">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.65)]" />
            <span className="truncate">{current?.name ?? 'Select repository'}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-slate-600" />
        </Link>
      </div>

      {repoId && (
        <nav className="mt-6 space-y-1 px-3">
          {nav.map(item => {
            const to = `/repos/${repoId}${item.suffix}`;
            return (
              <NavLink
                key={item.label}
                to={to}
                end={!item.suffix}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-violet-500/12 text-violet-300' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      )}

      <div className="mt-auto p-4">
        <Link to="/repos/new" className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-violet-100">
          <Plus className="h-4 w-4" /> Add repository
        </Link>
        <div className="mt-4 flex items-center justify-between px-1 text-[11px] text-slate-700">
          <span className="flex items-center gap-1.5"><Activity className="h-3 w-3" /> Engine online</span>
          <Settings2 className="h-3.5 w-3.5" />
        </div>
      </div>
    </aside>
  );

  return (
    <FilterProvider>
      <div className="min-h-screen bg-[#080b12] text-slate-100">
        <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button aria-label="Close navigation" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <div className="relative h-full w-64">{sidebar}</div>
            <button className="absolute right-5 top-5 rounded-lg border border-white/10 bg-slate-900 p-2" onClick={() => setMobileOpen(false)}><X className="h-5 w-5" /></button>
          </div>
        )}

        <div className="lg:pl-64">
          <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#080b12]/90 backdrop-blur-xl">
            <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
              <button className="rounded-lg p-2 text-slate-400 lg:hidden" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-200">{current?.name ?? 'Repository workspace'}</p>
                <p className="text-xs text-slate-600">{current ? `${current.commit_count.toLocaleString()} commits indexed` : 'Choose a repository to begin'}</p>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-1.5 text-xs font-medium text-emerald-300 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live analysis
              </div>
            </div>
            {repoId && <FilterBar repoId={id} />}
          </header>
          <main className="min-h-[calc(100vh-4rem)]"><Outlet /></main>
        </div>
      </div>
    </FilterProvider>
  );
}
