import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { metricsApi } from '../api';
import { useFilters } from '../context/FilterContext';

export default function TimelinePage() {
  const repoId = Number(useParams().repoId);
  const { filters } = useFilters();
  const { data = [], isLoading } = useQuery({ queryKey: ['timeline', repoId, filters], queryFn: () => metricsApi.timeline(repoId, filters) });
  const points = data.map(point => ({ ...point, date: new Date(point.timestamp * 1000).toLocaleDateString() }));
  if (isLoading) return <div className="p-8"><div className="h-[650px] animate-pulse rounded-2xl bg-white/[0.025]" /></div>;
  return <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8"><div className="mb-7"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><Activity className="h-3.5 w-3.5" /> Change history</div><h1 className="text-2xl font-bold text-white">Timeline</h1><p className="mt-1.5 text-sm text-slate-600">Per-commit growth and churn across the selected history.</p></div><section className="panel p-6"><div className="h-[580px]">{points.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}><defs><linearGradient id="timelineChurn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity={0.4} /><stop offset="1" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(255,255,255,.05)" /><XAxis dataKey="date" minTickGap={80} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#111722', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} /><Area type="monotone" dataKey="churn" stroke="#8b5cf6" fill="url(#timelineChurn)" strokeWidth={2} /><Area type="monotone" dataKey="growth" stroke="#22d3ee" fill="transparent" strokeWidth={1.5} /></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-slate-600">No timeline activity matches the current filters.</div>}</div></section></div>;
}
