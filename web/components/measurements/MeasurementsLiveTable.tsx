'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import type { RecentMeasurement } from '@/lib/types';

const POLL_INTERVAL_MS = 10_000;

interface Props {
  initialMeasurements: RecentMeasurement[];
}

export function MeasurementsLiveTable({ initialMeasurements }: Props) {
  const [liveRows, setLiveRows] = useState<RecentMeasurement[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [polling, setPolling] = useState(false);

  // Track the most recent measured_at we know about so each poll only fetches newer rows
  const latestAtRef = useRef<string>(
    initialMeasurements[0]?.measured_at ?? new Date().toISOString()
  );
  // Track all known IDs so we never show duplicates
  const knownIdsRef = useRef<Set<string>>(new Set(initialMeasurements.map(m => m.id)));

  const markFresh = useCallback((id: string) => {
    setFreshIds(prev => { const n = new Set(prev); n.add(id); return n; });
    setTimeout(() => {
      setFreshIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }, 8000);
  }, []);

  useEffect(() => {
    const supabase = createClient();

    const poll = async () => {
      setPolling(true);
      try {
        const { data, error } = await (supabase.from('recent_measurements') as any)
          .select('*')
          .gt('measured_at', latestAtRef.current)
          .order('measured_at', { ascending: false })
          .limit(20);

        if (error) {
          console.warn('[MeasurementsLive] poll error:', error.message);
          return;
        }
        if (!data?.length) return;

        const newRows = (data as RecentMeasurement[]).filter(
          r => !knownIdsRef.current.has(r.id)
        );
        if (!newRows.length) return;

        // Update bookmarks
        newRows.forEach(r => knownIdsRef.current.add(r.id));
        // latestAtRef advances to the newest row (data is DESC so [0] is newest)
        latestAtRef.current = (data as RecentMeasurement[])[0].measured_at;

        setLiveRows(prev => [...newRows, ...prev]);
        newRows.forEach(r => markFresh(r.id));
      } finally {
        setPolling(false);
      }
    };

    // Immediate first poll so page feels responsive on open
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [markFresh]);

  // Live rows that aren't already in the server-rendered list
  const initIds = new Set(initialMeasurements.map(m => m.id));
  const dedupedLive = liveRows.filter(r => !initIds.has(r.id));
  const rows = [...dedupedLive, ...initialMeasurements];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
          <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${polling ? 'animate-ping' : 'animate-pulse'}`} />
          Live · refreshes every {POLL_INTERVAL_MS / 1000}s
        </span>
        {dedupedLive.length > 0 && (
          <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">
            +{dedupedLive.length} new since load
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Value</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Element</th>
              <th className="px-5 py-3 font-medium">Zone</th>
              <th className="px-5 py-3 font-medium">Building</th>
              <th className="px-5 py-3 font-medium">Device</th>
              <th className="px-5 py-3 font-medium">Session</th>
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(m => {
              const isNew = freshIds.has(m.id);
              return (
                <tr
                  key={m.id}
                  className={
                    isNew
                      ? 'bg-emerald-50 border-l-2 border-emerald-400'
                      : m.is_anomaly
                        ? 'bg-amber-50'
                        : 'hover:bg-gray-50 transition-colors'
                  }
                >
                  <td className="px-5 py-3 font-mono font-bold text-gray-900">
                    {Math.round(m.value_mm)} mm
                    {isNew && (
                      <span className="ml-2 text-[10px] font-semibold text-emerald-600 bg-emerald-100 rounded px-1 py-0.5 align-middle">
                        NEW
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500 capitalize">{m.measurement_type ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-700">{m.element_name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{m.zone_name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-700">{m.building_address}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs font-mono">{m.device_nickname ?? '—'}</td>
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link href={`/sessions/${m.session_id}`} className="text-indigo-600 hover:underline">
                      session →
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-400 whitespace-nowrap text-xs">
                    {new Date(m.measured_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-5 py-3">
                    {m.is_anomaly && (
                      <span className="text-xs bg-amber-100 text-amber-600 rounded px-1.5 py-0.5 font-medium">⚠ ANOMALY</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center text-gray-400">No measurements found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
