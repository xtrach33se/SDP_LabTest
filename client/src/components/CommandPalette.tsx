import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Command, Search } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { repositoriesApi } from '../api';

export default function CommandPalette() {
  const navigate = useNavigate();
  const { repoId } = useParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { data: repositories = [] } = useQuery({ queryKey: ['repositories'], queryFn: repositoriesApi.list });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(value => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 0); }, [open]);

  const commands = useMemo(() => {
    const pages = repoId ? [
      ['Overview', `/repos/${repoId}`], ['Files', `/repos/${repoId}/files`], ['Authors', `/repos/${repoId}/authors`],
      ['Commits', `/repos/${repoId}/commits`], ['Timeline', `/repos/${repoId}/timeline`], ['Settings', `/repos/${repoId}/settings`],
    ] : [];
    return [
      ['All repositories', '/repos'], ['Add repository', '/repos/new'],
      ...pages,
      ...repositories.map(repo => [`Open ${repo.name}`, `/repos/${repo.id}`]),
    ].filter(([label]) => label.toLowerCase().includes(search.toLowerCase()));
  }, [repoId, repositories, search]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/70 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0e131d] shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4"><Search className="h-4 w-4 text-slate-600" /><input ref={input} value={search} onChange={event => setSearch(event.target.value)} className="h-14 flex-1 bg-transparent text-sm text-white outline-none" placeholder="Jump to a repository or page…" /><kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-600">Esc</kbd></div>
        <div className="max-h-80 overflow-auto p-2">
          {commands.map(([label, path]) => <button key={`${label}-${path}`} onClick={() => { navigate(path); setOpen(false); setSearch(''); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-400 hover:bg-violet-500/10 hover:text-violet-200"><Command className="h-4 w-4" />{label}</button>)}
          {!commands.length && <p className="p-6 text-center text-sm text-slate-600">No matching command.</p>}
        </div>
      </div>
    </div>
  );
}
