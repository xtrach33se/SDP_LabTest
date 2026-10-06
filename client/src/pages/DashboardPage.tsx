import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  FileCode2,
  Folder,
  GitCommitHorizontal,
  MoveRight,
  Orbit,
  Users,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { metricsApi } from '../api';
import MetricLabel from '../components/MetricLabel';
import { useFilters } from '../context/FilterContext';
import type { FileMetric, TimelinePoint } from '../types';

const palette = ['#8b5cf6', '#22d3ee', '#34d399', '#f59e0b', '#f472b6', '#60a5fa', '#fb7185'];
const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function aggregateTimeline(points: TimelinePoint[], unit: 'day' | 'week' | 'month') {
  const map = new Map<string, { date: string; added: number; removed: number; growth: number; churn: number }>();
  for (const point of points) {
    const date = new Date(point.timestamp * 1000);
    if (unit === 'week') date.setDate(date.getDate() - date.getDay());
    const key = unit === 'month'
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : date.toISOString().slice(0, 10);
    const current = map.get(key) ?? { date: key, added: 0, removed: 0, growth: 0, churn: 0 };
    current.added += point.linesAdded;
    current.removed += point.linesRemoved;
    current.growth += point.growth;
    current.churn += point.churn;
    map.set(key, current);
  }
  return [...map.values()];
}

function Card({ label, value, detail, tone = 'violet', icon: Icon, queryTime }: { label: string; value: string; detail: string; tone?: 'violet' | 'cyan' | 'green' | 'rose'; icon: typeof Zap; queryTime?: number }) {
  const tones = {
    violet: 'text-violet-300 bg-violet-400/[0.08] border-violet-400/15',
    cyan: 'text-cyan-300 bg-cyan-400/[0.08] border-cyan-400/15',
    green: 'text-emerald-300 bg-emerald-400/[0.08] border-emerald-400/15',
    rose: 'text-rose-300 bg-rose-400/[0.08] border-rose-400/15',
  };
  return (
    <div className="panel group p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-slate-500"><MetricLabel>{label}</MetricLabel></span>
        <div className="flex items-center gap-2">{window.location.hostname === 'localhost' && queryTime != null && <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-400">{queryTime.toFixed(1)} ms</span>}<span className={`grid h-8 w-8 place-items-center rounded-lg border ${tones[tone]}`}><Icon className="h-4 w-4" /></span></div>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-white">{value}</p>
      <p className="mt-1 truncate text-[11px] text-slate-600">{detail}</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#111722]/95 p-3 shadow-2xl backdrop-blur">
      <p className="mb-2 text-xs font-semibold text-slate-300">{label}</p>
      {payload.map(item => <div key={item.name} className="flex min-w-32 items-center justify-between gap-5 text-[11px]"><span style={{ color: item.color }}>{item.name}</span><span className="font-mono text-slate-300">{number.format(item.value)}</span></div>)}
    </div>
  );
}

export default function DashboardPage() {
  const repoId = Number(useParams().repoId);
  const { filters } = useFilters();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');

  const pathsQuery = useQuery({ queryKey: ['paths', repoId], queryFn: () => metricsApi.paths(repoId) });
  const metricQuery = useQuery({
    queryKey: ['metric', repoId, filters],
    queryFn: () => {
      if (!filters.path) return metricsApi.repository(repoId, filters);
      return pathsQuery.data?.files.includes(filters.path)
        ? metricsApi.file(repoId, filters)
        : metricsApi.directory(repoId, filters);
    },
    enabled: !filters.path || Boolean(pathsQuery.data),
  });
  const filesQuery = useQuery({ queryKey: ['files', repoId, filters], queryFn: () => metricsApi.files(repoId, filters) });
  const dirsQuery = useQuery({ queryKey: ['directories', repoId, filters], queryFn: () => metricsApi.directories(repoId, filters) });
  const timelineQuery = useQuery({ queryKey: ['timeline', repoId, filters], queryFn: () => metricsApi.timeline(repoId, filters) });
  const commitsQuery = useQuery({ queryKey: ['commit-count', repoId, filters], queryFn: () => metricsApi.commits(repoId, filters, 1, 1) });

  const metric = metricQuery.data;
  const files = filesQuery.data ?? [];
  const directories = dirsQuery.data ?? [];
  const timeline = timelineQuery.data ?? [];
  const chartData = useMemo(() => aggregateTimeline(timeline, period), [timeline, period]);
  const topAuthor = metric?.authors[0];
  const topFile = [...files].sort((a, b) => b.churnRate - a.churnRate)[0];
  const isLoading = metricQuery.isLoading || filesQuery.isLoading;
  const failed = metricQuery.error || filesQuery.error || timelineQuery.error;

  const dailyChurn = useMemo(() => {
    const map = new Map<string, number>();
    timeline.forEach(point => {
      const day = new Date(point.timestamp * 1000).toISOString().slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + point.churn);
    });
    const end = new Date();
    return Array.from({ length: 112 }, (_, i) => {
      const day = new Date(end);
      day.setDate(day.getDate() - (111 - i));
      const key = day.toISOString().slice(0, 10);
      return { date: key, churn: map.get(key) ?? 0 };
    });
  }, [timeline]);
  const maxDay = Math.max(1, ...dailyChurn.map(day => day.churn));

  if (isLoading) return <DashboardSkeleton />;
  if (failed) return <div className="p-8"><div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-6 text-sm text-rose-300">Unable to load repository metrics. Confirm the server is running and the repository finished indexing.</div></div>;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><Orbit className="h-3.5 w-3.5" /> Repository intelligence</div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Engineering overview</h1>
          <p className="mt-1.5 text-sm text-slate-600">{filters.path ? `Scoped to ${filters.path}` : 'A complete view of code movement, ownership, and volatility.'}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-400" /> {commitsQuery.data?.total.toLocaleString() ?? 0} commits in current scope</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <Card label="Commits" value={number.format(commitsQuery.data?.total ?? 0)} detail="Selected commit set" icon={GitCommitHorizontal} queryTime={metric?.queryTimeMs} />
        <Card label="Lines added" value={`+${number.format(metric?.linesAdded ?? 0)}`} detail="Across all changes" tone="green" icon={ArrowUpRight} queryTime={metric?.queryTimeMs} />
        <Card label="Lines removed" value={`−${number.format(metric?.linesRemoved ?? 0)}`} detail="Across all changes" tone="rose" icon={ArrowDownRight} queryTime={metric?.queryTimeMs} />
        <Card label="Net growth" value={number.format(metric?.growth ?? 0)} detail="Added minus removed" tone="cyan" icon={MoveRight} queryTime={metric?.queryTimeMs} />
        <Card label="Total churn" value={number.format(metric?.churn ?? 0)} detail="Code movement volume" icon={Zap} queryTime={metric?.queryTimeMs} />
        <Card label="Top author" value={topAuthor?.name ?? '—'} detail={topAuthor ? `${(topAuthor.ownership * 100).toFixed(1)}% ownership` : 'No activity'} tone="cyan" icon={Users} queryTime={metric?.queryTimeMs} />
        <Card label="Most volatile" value={topFile?.path.split('/').pop() ?? '—'} detail={topFile ? `${number.format(topFile.churnRate)} lines / commit` : 'No files'} tone="rose" icon={FileCode2} queryTime={metric?.queryTimeMs} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.8fr)]">
        <section className="panel min-w-0 p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div><h2 className="section-title">Change velocity</h2><p className="section-subtitle">Added and removed lines over time</p></div>
            <div className="flex rounded-lg border border-white/[0.07] bg-black/15 p-1">
              {(['day', 'week', 'month'] as const).map(item => <button key={item} onClick={() => setPeriod(item)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize ${period === item ? 'bg-white/[0.08] text-slate-200' : 'text-slate-600 hover:text-slate-300'}`}>{item}</button>)}
            </div>
          </div>
          <div className="h-[310px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="added" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.3} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient>
                  <linearGradient id="removed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fb7185" stopOpacity={0.22} /><stop offset="100%" stopColor="#fb7185" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,.045)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={45} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={value => number.format(value)} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="added" name="Added" stroke="#34d399" fill="url(#added)" strokeWidth={2} />
                <Area type="monotone" dataKey="removed" name="Removed" stroke="#fb7185" fill="url(#removed)" strokeWidth={2} />
                <Area type="monotone" dataKey="growth" name="Net growth" stroke="#22d3ee" fill="transparent" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <h2 className="section-title">Code ownership</h2>
          <p className="section-subtitle">Share of churn by author</p>
          <div className="relative mt-1 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={(metric?.authors ?? []).slice(0, 7)} dataKey="churn" nameKey="name" innerRadius={58} outerRadius={78} paddingAngle={3}>{(metric?.authors ?? []).slice(0, 7).map((author, index) => <Cell key={`${author.email}-${author.name}`} fill={palette[index % palette.length]} />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><p className="text-xl font-bold text-white">{number.format(metric?.churn ?? 0)}</p><p className="text-[10px] uppercase tracking-wider text-slate-600">churn</p></div></div>
          </div>
          <div className="space-y-2.5">
            {(metric?.authors ?? []).slice(0, 5).map((author, index) => <div key={`${author.email}-${author.name}`} className="flex items-center gap-2.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: palette[index % palette.length] }} /><span className="min-w-0 flex-1 truncate text-slate-400">{author.name}</span><span className="font-mono text-slate-500">{(author.ownership * 100).toFixed(1)}%</span></div>)}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(350px,.65fr)]">
        <section className="panel overflow-hidden">
          <div className="flex items-end justify-between border-b border-white/[0.06] px-5 py-5 sm:px-6"><div><h2 className="section-title">High-churn files</h2><p className="section-subtitle">Files receiving the most code movement</p></div><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-700">Top 8</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-b border-white/[0.05] text-[10px] uppercase tracking-wider text-slate-700"><tr><th className="px-6 py-3 font-semibold">Path</th><th className="px-3 py-3 font-semibold">Added</th><th className="px-3 py-3 font-semibold">Removed</th><th className="px-3 py-3 font-semibold">Growth</th><th className="px-3 py-3 font-semibold">Churn</th><th className="px-6 py-3 font-semibold">Frequency</th></tr></thead>
              <tbody className="divide-y divide-white/[0.045]">{files.slice(0, 8).map(file => <tr key={file.path} className="transition hover:bg-white/[0.025]"><td className="max-w-xs truncate px-6 py-3.5 font-mono text-slate-300">{file.path}</td><td className="px-3 py-3.5 font-mono text-emerald-400">+{number.format(file.linesAdded)}</td><td className="px-3 py-3.5 font-mono text-rose-400">−{number.format(file.linesRemoved)}</td><td className="px-3 py-3.5 font-mono text-slate-400">{number.format(file.growth)}</td><td className="px-3 py-3.5 font-mono text-violet-300">{number.format(file.churn)}</td><td className="px-6 py-3.5 text-slate-500">{(file.modificationFrequency * 100).toFixed(1)}%</td></tr>)}</tbody>
            </table>
          </div>
          {!files.length && <p className="p-10 text-center text-sm text-slate-600">No file changes match the active filters.</p>}
        </section>

        <section className="panel p-5 sm:p-6">
          <h2 className="section-title">Directory hotspots</h2><p className="section-subtitle">Churn intensity across the tree</p>
          <DirectoryTree directories={directories} />
          {!directories.length && <p className="py-10 text-center text-sm text-slate-600">No directories in this scope.</p>}
        </section>
      </div>

      <section className="panel mt-4 p-5 sm:p-6">
        <div className="flex items-end justify-between"><div><h2 className="section-title">Activity pulse</h2><p className="section-subtitle">Daily churn across the last sixteen weeks</p></div><span className="text-[10px] text-slate-700">Less&nbsp;&nbsp;·&nbsp;&nbsp;More</span></div>
        <div className="mt-5 grid grid-flow-col grid-rows-7 gap-1.5 overflow-x-auto pb-1">
          {dailyChurn.map(day => {
            const intensity = day.churn / maxDay;
            const color = day.churn === 0 ? 'rgba(255,255,255,.035)' : `rgba(139,92,246,${0.2 + intensity * 0.8})`;
            return <div key={day.date} title={`${day.date}: ${day.churn.toLocaleString()} churn`} className="h-3.5 w-3.5 rounded-[3px] ring-1 ring-inset ring-white/[0.025]" style={{ backgroundColor: color }} />;
          })}
        </div>
      </section>
    </div>
  );
}

function DirectoryTree({ directories }: { directories: FileMetric[] }) {
  const roots = directories.filter(dir => !dir.path.includes('/'));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.slice(0, 4).map(dir => dir.path)));
  const maxChurn = Math.max(1, ...directories.map(dir => dir.churn));
  const byParent = new Map<string, FileMetric[]>();

  directories.forEach(dir => {
    const index = dir.path.lastIndexOf('/');
    const parent = index === -1 ? '' : dir.path.slice(0, index);
    byParent.set(parent, [...(byParent.get(parent) ?? []), dir]);
  });
  byParent.forEach(children => children.sort((a, b) => b.churn - a.churn));

  const toggle = (path: string) => setExpanded(current => {
    const next = new Set(current);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const render = (dir: FileMetric, depth: number): JSX.Element => {
    const children = byParent.get(dir.path) ?? [];
    const open = expanded.has(dir.path);
    const intensity = Math.max(0.15, dir.churn / maxChurn);
    return (
      <div key={dir.path}>
        <button onClick={() => children.length && toggle(dir.path)} className="group flex w-full items-center gap-2 rounded-lg py-1.5 pr-1 text-left hover:bg-white/[0.025]" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
          <span className={`text-[10px] text-slate-700 transition ${open ? 'rotate-90' : ''}`}>{children.length ? '▶' : '·'}</span>
          <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: `rgba(139,92,246,${0.35 + intensity * 0.65})` }} />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400 group-hover:text-slate-200">{dir.path.split('/').pop()}</span>
          <span className="font-mono text-[10px] text-slate-600">{number.format(dir.churn)}</span>
        </button>
        {open && children.map(child => render(child, depth + 1))}
      </div>
    );
  };

  return <div className="mt-4 max-h-64 overflow-auto">{(byParent.get('') ?? roots).slice(0, 12).map(dir => render(dir, 0))}</div>;
}

function DashboardSkeleton() {
  return <div className="p-8"><div className="mb-7 h-16 w-72 animate-pulse rounded-xl bg-white/[0.035]" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.025]" />)}</div><div className="mt-4 h-96 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.025]" /></div>;
}
