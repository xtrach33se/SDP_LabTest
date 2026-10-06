import { useMemo, useState } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { ChevronRight, FileCode2, Folder, FolderOpen } from 'lucide-react';
import type { FileMetric } from '../types';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: TreeNode[];
}

interface VisibleNode extends TreeNode {
  depth: number;
}

interface Props {
  files: string[];
  metrics: FileMetric[];
  selectedPath: string;
  onSelect: (path: string, type: TreeNode['type']) => void;
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'directory', children: [] };
  for (const file of files) {
    const parts = file.split('/').filter(Boolean);
    let parent = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const type = index === parts.length - 1 ? 'file' : 'directory';
      let node = parent.children.find(child => child.name === part);
      if (!node) {
        node = { name: part, path, type, children: [] };
        parent.children.push(node);
      }
      parent = node;
    });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(node => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

export default function FileExplorerTree({ files, metrics, selectedPath, onSelect }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const metricMap = useMemo(() => new Map(metrics.map(metric => [metric.path, metric])), [metrics]);
  const maxChurn = Math.max(1, ...metrics.map(metric => metric.churn));

  const visible = useMemo(() => {
    const rows: VisibleNode[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        rows.push({ ...node, depth });
        if (node.type === 'directory' && expanded.has(node.path)) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return rows;
  }, [expanded, tree]);

  function toggle(node: VisibleNode) {
    if (node.type === 'directory') {
      setExpanded(current => {
        const next = new Set(current);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
    }
    onSelect(node.path, node.type);
  }

  function Row({ index, style }: ListChildComponentProps) {
    const node = visible[index];
    const metric = metricMap.get(node.path);
    const ratio = metric ? Math.min(1, metric.churn / maxChurn) : 0;
    const hue = 125 - ratio * 120;
    const open = expanded.has(node.path);
    return (
      <div style={style} className="px-2">
        <button
          onClick={() => toggle(node)}
          className={`flex h-[34px] w-full items-center gap-1.5 rounded-lg pr-2 text-left text-xs transition ${
            selectedPath === node.path
              ? 'bg-violet-500/15 text-violet-200'
              : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
          }`}
          style={{ paddingLeft: 8 + node.depth * 15 }}
          title={node.path}
        >
          {node.type === 'directory' ? (
            <>
              <ChevronRight className={`h-3 w-3 shrink-0 transition ${open ? 'rotate-90' : ''}`} />
              {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-violet-300" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
            </>
          ) : (
            <><span className="w-3" /><FileCode2 className="h-3.5 w-3.5 shrink-0 text-cyan-500/70" /></>
          )}
          <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
          {metric && (
            <span
              className="rounded-full border px-1.5 py-0.5 font-mono text-[9px]"
              style={{ color: `hsl(${hue} 72% 68%)`, borderColor: `hsl(${hue} 55% 35% / .45)`, background: `hsl(${hue} 55% 20% / .18)` }}
            >
              {new Intl.NumberFormat('en', { notation: 'compact' }).format(metric.churn)}
            </span>
          )}
        </button>
      </div>
    );
  }

  return visible.length ? (
    <FixedSizeList height={600} width="100%" itemCount={visible.length} itemSize={34} overscanCount={12}>
      {Row}
    </FixedSizeList>
  ) : (
    <p className="p-6 text-center text-xs text-slate-600">No files match this commit set.</p>
  );
}
