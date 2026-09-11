'use client';

// Reference full-stack usage of the data-source toggle: this is the one
// entity (Contactpersoon / contacts) that now exists on BOTH sides, so it
// doubles as the worked example for how every other dual-sided entity
// should wire up client-side data fetching against the active source.
//
// Client component (not folded into the server-rendered building page)
// because the active DataSource lives in client state (localStorage) —
// see docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §3's loading/empty-state
// requirements, both handled below.

import { useEffect, useState } from 'react';
import { useDataSource } from '@/lib/dataSource/DataSourceContext';
import { getContactService, DataSourceBlockedError } from '@/lib/services';
import type { Contact } from '@/lib/types';

const ROLE_LABELS: Record<string, string> = {
  eigenaar: 'Eigenaar (owner)',
  huurder: 'Huurder (tenant)',
  beheerder: 'Beheerder (manager)',
  opdrachtgever: 'Opdrachtgever (client)',
};

type LoadState = 'loading' | 'ready' | 'blocked' | 'error';

export function BuildingContactCard({ buildingId }: { buildingId: string }) {
  const { source } = useDataSource();
  const [state, setState] = useState<LoadState>('loading');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getContactService(source)
      .listByBuilding(buildingId)
      .then(data => {
        if (cancelled) return;
        setContacts(data);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DataSourceBlockedError) {
          setMessage(err.message);
          setState('blocked');
        } else {
          setMessage(err instanceof Error ? err.message : 'Failed to load contacts');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, buildingId]);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">
          Contactpersoon
          <span className="ml-2 font-normal text-gray-400 text-sm">Building contact</span>
        </h2>
      </div>

      {state === 'loading' && (
        // AppSheet is a remote third-party call per request — don't reuse the
        // instant-feeling Supabase spinner for it (§3).
        <p className="px-5 py-6 text-sm text-gray-400">
          {source === 'appsheet' ? 'Loading from AppSheet (can be slower than ScanergyV2)…' : 'Loading…'}
        </p>
      )}

      {state === 'blocked' && (
        <div className="px-5 py-4 text-sm">
          <p className="text-amber-700 font-medium mb-1">AppSheet contacts unavailable</p>
          <p className="text-gray-500 text-xs">{message}</p>
        </div>
      )}

      {state === 'error' && <p className="px-5 py-6 text-sm text-red-600">{message}</p>}

      {state === 'ready' && contacts.length === 0 && (
        <p className="px-5 py-6 text-sm text-gray-400 text-center">No contact on file for this building</p>
      )}

      {state === 'ready' && contacts.length > 0 && (
        <div className="divide-y divide-gray-50">
          {contacts.map(c => (
            <div key={c.id} className="px-5 py-3 flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-gray-800">{c.full_name}</p>
                <p className="text-xs text-gray-500">{c.role ? ROLE_LABELS[c.role] ?? c.role : 'No role set'}</p>
                {c.notes && <p className="text-xs text-gray-400 mt-1">{c.notes}</p>}
              </div>
              <div className="text-right text-xs text-gray-600 space-y-0.5">
                {c.phone && <p>{c.phone}</p>}
                {c.email && <p className="text-indigo-600">{c.email}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
