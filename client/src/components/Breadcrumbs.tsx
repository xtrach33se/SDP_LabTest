import { ChevronRight, Home } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';

const labels: Record<string, string> = {
  files: 'Files', authors: 'Authors', commits: 'Commits', timeline: 'Timeline', settings: 'Settings', new: 'Add repository',
};

export default function Breadcrumbs({ repoName }: { repoName?: string }) {
  const { repoId } = useParams();
  const location = useLocation();
  const finalSegment = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const page = labels[finalSegment];
  return (
    <nav aria-label="Breadcrumb" className="flex h-9 items-center gap-1 border-b border-white/[0.05] px-4 text-[11px] text-slate-600 sm:px-6 lg:px-8">
      <Link to="/repos" className="inline-flex items-center gap-1 hover:text-violet-300"><Home className="h-3 w-3" /> Repositories</Link>
      {repoId && <><ChevronRight className="h-3 w-3" /><Link to={`/repos/${repoId}`} className="max-w-48 truncate hover:text-violet-300">{repoName ?? `Repository ${repoId}`}</Link></>}
      {page && page !== repoName && <><ChevronRight className="h-3 w-3" /><span className="text-slate-400">{page}</span></>}
    </nav>
  );
}
