import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useParams } from 'react-router-dom';
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

export function FilterProvider({ children }: { children: ReactNode }) {
  const { repoId } = useParams();
  const storageKey = `rat-filters-${repoId ?? 'global'}`;
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '') as Filters;
    } catch {
      return emptyFilters;
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setFilters(saved ? JSON.parse(saved) as Filters : emptyFilters);
    } catch {
      setFilters(emptyFilters);
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(filters));
  }, [filters, storageKey]);

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
