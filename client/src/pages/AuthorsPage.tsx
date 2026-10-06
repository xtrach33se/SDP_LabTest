import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, ChevronDown, Download, GitMerge, MailCheck, Trash2, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { authorsApi, metricsApi } from '../api';
import { useFilters } from '../context/FilterContext';
import { downloadCsv } from '../utils/csv';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export default function AuthorsPage() {
  const repoId = Number(useParams().repoId);
  const queryClient = useQueryClient();
  const { filters, setFilters } = useFilters();
  const [selected, setSelected] = useState<string[]>([]);
  const [canonicalName, setCanonicalName] = useState('');
  const [canonicalEmail, setCanonicalEmail] = useState('');
  const [expandedAuthor, setExpandedAuthor] = useState('');
  const { data: authors = [], isLoading } = useQuery({ queryKey: ['raw-authors', repoId], queryFn: () => authorsApi.raw(repoId) });
  const { data: canonical = [] } = useQuery({ queryKey: ['canonical-authors', repoId], queryFn: () => authorsApi.canonical(repoId) });
  const { data: merges = [] } = useQuery({ queryKey: ['author-merges', repoId], queryFn: () => authorsApi.merges(repoId) });
  const analyticsQuery = useQuery({
    queryKey: ['author-analytics', repoId, filters],
    queryFn: () => metricsApi.authorAnalytics(repoId, filters),
    enabled: Boolean(filters.authorEmail),
  });

  const groups = useMemo(() => {
    const map = new Map<string, typeof merges>();
    merges.forEach(merge => map.set(merge.canonical_email, [...(map.get(merge.canonical_email) ?? []), merge]));
    return [...map.entries()];
  }, [merges]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['raw-authors', repoId] }),
    queryClient.invalidateQueries({ queryKey: ['canonical-authors', repoId] }),
    queryClient.invalidateQueries({ queryKey: ['author-merges', repoId] }),
    queryClient.invalidateQueries({ queryKey: ['authors-metrics', repoId] }),
    queryClient.invalidateQueries({ queryKey: ['metric', repoId] }),
  ]);
  const mergeMutation = useMutation({
    mutationFn: () => authorsApi.merge(repoId, canonicalEmail, canonicalName, selected),
    onSuccess: async () => { setSelected([]); setCanonicalName(''); setCanonicalEmail(''); await refresh(); },
  });
  const removeMutation = useMutation({ mutationFn: (id: number) => authorsApi.removeMerge(repoId, id), onSuccess: refresh });
  const mailmapMutation = useMutation({ mutationFn: () => authorsApi.applyMailmap(repoId), onSuccess: refresh });

  function toggle(email: string, name: string) {
    setSelected(current => {
      const next = current.includes(email) ? current.filter(item => item !== email) : [...current, email];
      if (!canonicalEmail && !current.includes(email)) { setCanonicalEmail(email); setCanonicalName(name); }
      return next;
    });
  }

  const activeAuthor = canonical.find(author => author.canonical_email === filters.authorEmail);
  const analytics = analyticsQuery.data;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><Users className="h-3.5 w-3.5" /> Ownership intelligence</div><h1 className="text-2xl font-bold tracking-tight text-white">Authors</h1><p className="mt-1.5 text-sm text-slate-600">Compare canonical contributors and consolidate alternate identities.</p></div>
        <div className="flex gap-2"><button onClick={() => downloadCsv('rat-authors.csv', canonical.map(author => ({ name: author.canonical_name, email: author.canonical_email, commits: author.commit_count, churn: author.total_churn, ownedFiles: author.owned_files_count })))} disabled={!canonical.length} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2.5 text-sm font-semibold text-slate-400 disabled:opacity-30"><Download className="h-4 w-4" /> Export CSV</button><button onClick={() => mailmapMutation.mutate()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-violet-400/30 hover:text-white"><MailCheck className="h-4 w-4 text-violet-300" /> Apply .mailmap</button></div>
      </div>

      <section className="panel mb-4 overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4"><h2 className="section-title">Canonical authors</h2><p className="section-subtitle">Select an author to compare their contribution against everyone else</p></div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px] divide-y divide-white/[0.045]">
            {isLoading ? Array.from({ length: 5 }, (_, index) => <div key={index} className="mx-5 my-2 h-14 animate-pulse rounded-xl bg-white/[0.025]" />) : canonical.map(author => {
              const key = `${author.canonical_email}-${author.canonical_name}`;
              const expanded = expandedAuthor === key;
              const identities = authors.filter(raw => raw.canonical_email === author.canonical_email && raw.canonical_name === author.canonical_name);
              return <div key={key} className={filters.authorEmail === author.canonical_email ? 'bg-violet-500/[0.045]' : ''}><button onClick={() => { setExpandedAuthor(expanded ? '' : key); setFilters(current => ({ ...current, authorEmail: author.canonical_email })); }} className="grid w-full grid-cols-[minmax(220px,1fr)_130px_130px_120px_24px] items-center gap-3 px-5 py-3.5 text-left text-xs hover:bg-white/[0.025]"><span><span className="block font-semibold text-slate-300">{author.canonical_name}</span><span className="font-mono text-[10px] text-slate-700">{author.canonical_email}</span></span><span className="text-slate-500">{author.commit_count.toLocaleString()} commits</span><span className="font-semibold text-violet-300">{compact.format(author.total_churn)} churn</span><span className="text-slate-500">{author.owned_files_count.toLocaleString()} owned files</span><ChevronDown className={`h-4 w-4 text-slate-600 transition ${expanded ? 'rotate-180' : ''}`} /></button>{expanded && <div className="border-t border-white/[0.04] bg-black/10 px-8 py-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-700">Merged raw identities</p><div className="flex flex-wrap gap-2">{identities.map(identity => <span key={`${identity.raw_email}-${identity.raw_name}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-slate-500">{identity.raw_name} · <span className="font-mono">{identity.raw_email}</span></span>)}</div></div>}</div>;
            })}
          </div>
        </div>
      </section>

      {activeAuthor && (
        <section className="mb-4 grid gap-4 xl:grid-cols-2">
          <div className="panel p-5"><h2 className="section-title">Weekly activity · {activeAuthor.canonical_name}</h2><p className="section-subtitle">Commit frequency across the selected period</p><div className="mt-4 h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={analytics?.weekly ?? []}><CartesianGrid stroke="rgba(255,255,255,.04)" vertical={false} /><XAxis dataKey="week" tick={{ fill: '#475569', fontSize: 10 }} minTickGap={25} /><YAxis tick={{ fill: '#475569', fontSize: 10 }} width={35} /><Tooltip contentStyle={{ background: '#111722', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12 }} /><Line type="monotone" dataKey="commits" stroke="#22d3ee" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></div>
          <div className="panel p-5"><h2 className="section-title">Top-file comparison</h2><p className="section-subtitle">Selected author’s churn against all other authors</p><div className="mt-4 h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics?.topFiles ?? []} layout="vertical" margin={{ left: 12 }}><CartesianGrid stroke="rgba(255,255,255,.04)" horizontal={false} /><XAxis type="number" tick={{ fill: '#475569', fontSize: 10 }} /><YAxis type="category" dataKey="path" width={120} tick={{ fill: '#64748b', fontSize: 9 }} tickFormatter={value => String(value).split('/').pop() ?? String(value)} /><Tooltip contentStyle={{ background: '#111722', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12 }} /><Bar dataKey="churn" name="Selected author" stackId="churn" fill="#8b5cf6" /><Bar dataKey="otherChurn" name="All others" stackId="churn" fill="#334155" /></BarChart></ResponsiveContainer></div></div>
          <div className="panel overflow-hidden xl:col-span-2"><div className="border-b border-white/[0.06] px-5 py-4"><h2 className="section-title">Top files by ownership</h2></div><div className="grid gap-2 p-4 md:grid-cols-2">{analytics?.topFiles.map(file => <div key={file.path} className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3"><div className="flex justify-between gap-3"><span className="truncate font-mono text-[11px] text-slate-400">{file.path}</span><span className="text-xs font-semibold text-cyan-300">{(file.ownership * 100).toFixed(1)}%</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.05]"><div className="h-full bg-cyan-400" style={{ width: `${file.ownership * 100}%` }} /></div></div>)}</div></div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,.7fr)]">
        <section className="panel overflow-hidden">
          <div className="border-b border-white/[0.06] px-5 py-5"><h2 className="section-title">Detected identities</h2><p className="section-subtitle">Select two or more identities to merge</p></div>
          <div className="max-h-[620px] overflow-auto">
            {isLoading ? <div className="p-8 text-sm text-slate-600">Loading authors…</div> : authors.map(author => {
              const checked = selected.includes(author.raw_email);
              const merged = author.raw_email !== author.canonical_email;
              return <button key={`${author.raw_email}-${author.raw_name}`} onClick={() => toggle(author.raw_email, author.raw_name)} className="flex w-full items-center gap-3 border-b border-white/[0.045] px-5 py-3.5 text-left transition hover:bg-white/[0.025]"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-700'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-xs font-bold text-violet-300">{author.raw_name.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-300">{author.raw_name}</span><span className="block truncate font-mono text-[11px] text-slate-600">{author.raw_email}</span></span>{merged && <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.06] px-2 py-1 text-[10px] font-semibold text-cyan-300">Merged</span>}<span className="w-20 text-right text-xs text-slate-600">{author.commit_count.toLocaleString()} commits</span></button>;
            })}
          </div>
        </section>

        <div className="space-y-4">
          <section className="panel p-5">
            <div className="mb-5 flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-lg border border-violet-400/15 bg-violet-400/[0.07] text-violet-300"><GitMerge className="h-4 w-4" /></span><div><h2 className="section-title">Merge selected</h2><p className="text-[11px] text-slate-600">{selected.length} identities selected</p></div></div>
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-500">Canonical name</label><input className="input mb-4 w-full" value={canonicalName} onChange={event => setCanonicalName(event.target.value)} placeholder="Full name" />
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-500">Canonical email</label><input className="input w-full" value={canonicalEmail} onChange={event => setCanonicalEmail(event.target.value)} placeholder="name@example.com" />
            <button disabled={selected.length < 2 || !canonicalEmail || !canonicalName || mergeMutation.isPending} onClick={() => mergeMutation.mutate()} className="mt-5 w-full rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-30">{mergeMutation.isPending ? 'Merging…' : 'Create merge group'}</button>
          </section>
          <section className="panel overflow-hidden"><div className="border-b border-white/[0.06] px-5 py-4"><h2 className="section-title">Merge groups</h2><p className="section-subtitle">{groups.length} canonical identities</p></div><div className="max-h-80 overflow-auto p-2">{groups.map(([email, rules]) => <div key={email} className="mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><p className="truncate text-xs font-semibold text-slate-300">{rules[0].canonical_name}</p><p className="truncate font-mono text-[10px] text-slate-600">{email}</p><div className="mt-2 space-y-1">{rules.filter(rule => rule.merged_email !== email).map(rule => <div key={rule.id} className="flex items-center gap-2 rounded-md bg-black/15 px-2 py-1.5"><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">{rule.merged_email}</span><button aria-label="Remove merge" onClick={() => removeMutation.mutate(rule.id)} className="text-slate-700 hover:text-rose-400"><Trash2 className="h-3 w-3" /></button></div>)}</div></div>)}{!groups.length && <p className="p-7 text-center text-xs text-slate-600">No manual merge groups yet.</p>}</div></section>
        </div>
      </div>
    </div>
  );
}
