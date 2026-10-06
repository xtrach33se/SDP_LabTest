import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Filters } from '../types';

const emptyFilters: Filters = {
  authorEmail: '',
  path: '',
  startDate: '',
  endDate: '',
  commitHashes: [],
};

interface FilterContextValue {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  clearFilters: () => void;
  activeCount: number;
}

const FilterContext = createContext<FilterContextValue | null>(null);
const filterKeys = ['authorEmail', 'path', 'startDate', 'endDate', 'commitHashes'] as const;

function fromSearch(params: URLSearchParams): Filters | null {
  if (!filterKeys.some(key => params.has(key))) return null;
  return {
    authorEmail: params.get('authorEmail') ?? '',
    path: params.get('path') ?? '',
    startDate: params.get('startDate') ?? '',
    endDate: params.get('endDate') ?? '',
    commitHashes: (params.get('commitHashes') ?? '').split(',').filter(Boolean),
  };
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const { repoId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const storageKey = `rat-filters-${repoId ?? 'global'}`;
  const searchKey = searchParams.toString();
  const [filters, setFilters] = useState<Filters>(() => {
    const shared = fromSearch(searchParams);
    if (shared) return shared;
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '') as Filters;
    } catch {
      return emptyFilters;
    }
  });

  const previousStorageKey = useRef(storageKey);
  const previousSearchKey = useRef(searchKey);

  useEffect(() => {
    const repositoryChanged = previousStorageKey.current !== storageKey;
    const searchChanged = previousSearchKey.current !== searchKey;
    previousStorageKey.current = storageKey;
    previousSearchKey.current = searchKey;
    if (!repositoryChanged && !searchChanged) return;

    const shared = fromSearch(searchParams);
    if (shared) return setFilters(shared);
    if (searchChanged && !repositoryChanged) return setFilters(emptyFilters);
    try {
      const saved = localStorage.getItem(storageKey);
      setFilters(saved ? JSON.parse(saved) as Filters : emptyFilters);
    } catch {
      setFilters(emptyFilters);
    }
  }, [storageKey, searchKey, searchParams]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(filters));
    const params = new URLSearchParams();
    if (filters.authorEmail) params.set('authorEmail', filters.authorEmail);
    if (filters.path) params.set('path', filters.path);
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.commitHashes.length) params.set('commitHashes', filters.commitHashes.join(','));
    if (params.toString() !== searchParams.toString()) setSearchParams(params, { replace: true });
  }, [filters, storageKey, searchParams, setSearchParams]);

  const value = useMemo(() => ({
    filters,
    setFilters,
    clearFilters: () => setFilters(emptyFilters),
    activeCount: [filters.authorEmail, filters.path, filters.startDate, filters.endDate, filters.commitHashes.length].filter(Boolean).length,
  }), [filters]);

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (!context) throw new Error('useFilters must be used inside FilterProvider');
  return context;
}
