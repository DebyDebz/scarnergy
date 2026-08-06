'use client';

// App-wide toggle + always-visible active-source indicator, per
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §3: "not optional polish,
// it's the main thing preventing the fragmentation problem this whole
// toggle exists to manage during the transition window."
//
// Lives in the persistent header (TopBar) rather than a per-page control
// or a dedicated settings page — there's no existing /settings route in
// this dashboard, and every screen needs to agree on the same source, so
// the always-on header is the one place guaranteed to be visible
// regardless of which page the user is on.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDataSource, type DataSource } from '@/lib/dataSource/DataSourceContext';

const OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'scanergy', label: 'ScanergyV2' },
  { value: 'appsheet', label: 'AppSheet' },
];

type HealthState = 'idle' | 'checking' | 'ok' | 'error';

export function DataSourceToggle() {
  const { source, setSource } = useDataSource();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Server components (buildings/organizations/dashboard/sessions/
  // measurements/users lists) read the active source from a cookie (see
  // lib/dataSource/serverSource.ts) and only re-run on the next request —
  // flipping the toggle alone doesn't re-fetch them. router.refresh()
  // re-runs the current route's server components against the
  // now-updated cookie without a full page reload. Wrapped in
  // useTransition so the admin gets a visible "switching…" state instead
  // of the toggle looking unresponsive while those server components
  // re-fetch (AppSheet in particular can be noticeably slower).
  function handleSelect(next: DataSource) {
    if (next === source) return;
    setSource(next);
    startTransition(() => {
      router.refresh();
    });
  }
  // ScanergyV2 reads straight from the DB the rest of this dashboard already
  // trusts, so it doesn't need a live check. AppSheet is a real third-party
  // API call — the pill's color alone (amber vs. emerald) only ever meant
  // "which source is selected," not "is it actually reachable," which was a
  // real point of confusion. This adds the connectivity check the color
  // couldn't provide, via GET /api/appsheet/health.
  const [health, setHealth] = useState<HealthState>('idle');
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'appsheet') {
      setHealth('idle');
      return;
    }
    let cancelled = false;
    setHealth('checking');
    fetch('/api/appsheet/health')
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.ok) {
          setHealth('ok');
        } else {
          setHealth('error');
          setHealthError(body.error ?? `Health check failed (${res.status})`);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setHealth('error');
        setHealthError(err instanceof Error ? err.message : 'Health check failed');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium transition-opacity ${
          isPending ? 'opacity-60' : ''
        }`}
      >
        {OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            disabled={isPending}
            aria-pressed={source === opt.value}
            className={`px-2.5 py-1 rounded-md transition-colors disabled:cursor-wait ${
              source === opt.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {isPending && (
        <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" aria-label="Switching data source…" />
      )}
      <span
        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
          source === 'appsheet'
            ? health === 'error'
              ? 'bg-red-100 text-red-800'
              : health === 'ok'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-gray-100 text-gray-600'
            : 'bg-blue-100 text-blue-800'
        }`}
        title={
          source === 'appsheet'
            ? health === 'ok'
              ? 'Reading from AppSheet — connection verified'
              : health === 'error'
              ? `AppSheet connection failed: ${healthError}`
              : 'Reading from AppSheet — checking connection…'
            : 'Reading from ScanergyV2 (Supabase) — each source is independent, data is not merged'
        }
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            source === 'appsheet'
              ? health === 'error'
                ? 'bg-red-500'
                : health === 'ok'
                ? 'bg-emerald-500'
                : 'bg-gray-400 animate-pulse'
              : 'bg-blue-500'
          }`}
        />
        {source === 'appsheet' ? 'AppSheet source ' : 'ScanergyV2 source '}
      </span>
    </div>
  );
}
