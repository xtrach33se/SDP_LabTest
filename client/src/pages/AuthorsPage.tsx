import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitMerge, MailCheck, Trash2, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { authorsApi } from '../api';

export default function AuthorsPage() {
  const repoId = Number(useParams().repoId);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [canonicalName, setCanonicalName] = useState('');
  const [canonicalEmail, setCanonicalEmail] = useState('');
  const { data: authors = [], isLoading } = useQuery({ queryKey: ['raw-authors', repoId], queryFn: () => authorsApi.raw(repoId) });
  const { data: merges = [] } = useQuery({ queryKey: ['author-merges', repoId], queryFn: () => authorsApi.merges(repoId) });

  const groups = useMemo(() => {
    const map = new Map<string, typeof merges>();
    merges.forEach(merge => map.set(merge.canonical_email, [...(map.get(merge.canonical_email) ?? []), merge]));
    return [...map.entries()];
  }, [merges]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['raw-authors', repoId] }),
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-300"><Users className="h-3.5 w-3.5" /> Identity management</div><h1 className="text-2xl font-bold tracking-tight text-white">Authors</h1><p className="mt-1.5 text-sm text-slate-600">Consolidate alternate emails into accurate ownership identities.</p></div>
        <button onClick={() => mailmapMutation.mutate()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-violet-400/30 hover:text-white"><MailCheck className="h-4 w-4 text-violet-300" /> Apply .mailmap</button>
      </div>

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
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-500">Canonical name</label><input className="input mb-4 w-full" value={canonicalName} onChange={e => setCanonicalName(e.target.value)} placeholder="Full name" />
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-500">Canonical email</label><input className="input w-full" value={canonicalEmail} onChange={e => setCanonicalEmail(e.target.value)} placeholder="name@example.com" />
            <button disabled={selected.length < 2 || !canonicalEmail || !canonicalName || mergeMutation.isPending} onClick={() => mergeMutation.mutate()} className="mt-5 w-full rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-30">{mergeMutation.isPending ? 'Merging…' : 'Create merge group'}</button>
          </section>

          <section className="panel overflow-hidden"><div className="border-b border-white/[0.06] px-5 py-4"><h2 className="section-title">Merge groups</h2><p className="section-subtitle">{groups.length} canonical identities</p></div><div className="max-h-80 overflow-auto p-2">{groups.map(([email, rules]) => <div key={email} className="mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><p className="truncate text-xs font-semibold text-slate-300">{rules[0].canonical_name}</p><p className="truncate font-mono text-[10px] text-slate-600">{email}</p><div className="mt-2 space-y-1">{rules.filter(rule => rule.merged_email !== email).map(rule => <div key={rule.id} className="flex items-center gap-2 rounded-md bg-black/15 px-2 py-1.5"><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">{rule.merged_email}</span><button aria-label="Remove merge" onClick={() => removeMutation.mutate(rule.id)} className="text-slate-700 hover:text-rose-400"><Trash2 className="h-3 w-3" /></button></div>)}</div></div>)}{!groups.length && <p className="p-7 text-center text-xs text-slate-600">No manual merge groups yet.</p>}</div></section>
        </div>
      </div>
    </div>
  );
}
