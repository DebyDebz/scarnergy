'use client';

// App-wide data-source switch (AppSheet <-> ScanergyV2 toggle).
// See docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md — confirmed design
// constraint: this is a full data-source switch, each side reads its
// own store, no blended view. This is the first global client state
// the web app has (previously only the mobile app had a Zustand
// authStore) — a plain Context is enough for one app-wide enum value,
// no store library needed.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type DataSource = 'scanergy' | 'appsheet';

const STORAGE_KEY = 'scanergy:data-source';
const DEFAULT_SOURCE: DataSource = 'scanergy';

interface DataSourceContextValue {
  source: DataSource;
  setSource: (source: DataSource) => void;
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null);

function readStoredSource(): DataSource {
  if (typeof window === 'undefined') return DEFAULT_SOURCE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'appsheet' ? 'appsheet' : DEFAULT_SOURCE;
}

export function DataSourceProvider({ children }: { children: ReactNode }) {
  // Start at the default on both server and first client render to avoid
  // hydration mismatches, then sync from localStorage once mounted.
  const [source, setSourceState] = useState<DataSource>(DEFAULT_SOURCE);

  useEffect(() => {
    setSourceState(readStoredSource());
  }, []);

  function setSource(next: DataSource) {
    setSourceState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    // Also mirrored to a cookie so a future server component (e.g. a page
    // that still fetches server-side) can read the active source via
    // next/headers cookies() without needing a client round-trip.
    document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`;
  }

  return (
    <DataSourceContext.Provider value={{ source, setSource }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource(): DataSourceContextValue {
  const ctx = useContext(DataSourceContext);
  if (!ctx) throw new Error('useDataSource must be used within a DataSourceProvider');
  return ctx;
}
