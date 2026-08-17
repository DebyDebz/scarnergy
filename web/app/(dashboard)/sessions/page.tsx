import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { appsheetFind } from '@/lib/appsheet/client';
import { mapObjectenToSessionSummary, parseAppsheetDateTime } from '@/lib/appsheet/mappers';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { DeleteSessionButton } from '@/components/sessions/DeleteSessionButton';
import { AppsheetDeleteSessionButton } from '@/components/sessions/AppsheetDeleteSessionButton';
import { Search } from 'lucide-react';
import type { SessionSummary } from '@/lib/types';
import { fmtDateTimeFull } from '@/lib/format';

export const revalidate = 30;

interface Props {
  searchParams: { status?: string; q?: string };
}

const STATUSES = ['all', 'active', 'completed', 'paused', 'cancelled'];

export default async function SessionsPage({ searchParams }: Props) {
  const source = await getServerDataSource();
  const status = searchParams.status ?? 'all';
  const q = searchParams.q ?? '';

  if (source === 'appsheet') {
    const [objectenResult, inspecteursResult] = await Promise.all([
      appsheetFind('Objecten'),
      appsheetFind('Inspecteurs'),
    ]);
    const inspecteurNameById = new Map(
      (Array.isArray(inspecteursResult) ? inspecteursResult : [])
        .map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Inspecteur Naam'] ?? '')])
    );
    let sessions = (Array.isArray(objectenResult) ? objectenResult : [])
      .map((row: Record<string, unknown>) => mapObjectenToSessionSummary(row, inspecteurNameById));

    if (status !== 'all') sessions = sessions.filter(s => s.status === status);
    if (q) {
      const needle = q.toLowerCase();
      sessions = sessions.filter(s =>
        s.building_address.toLowerCase().includes(needle) ||
        s.inspector_name.toLowerCase().includes(needle)
      );
    }
    // started_at is AppSheet's raw "MM/DD/YYYY HH:mm:ss" display string —
    // not lexicographically sortable, has to go through a real Date parse.
    sessions.sort((a, b) =>
      (parseAppsheetDateTime(b.started_at)?.getTime() ?? 0) - (parseAppsheetDateTime(a.started_at)?.getTime() ?? 0)
    );

    return (
      <SessionsView
        sessions={sessions}
        status={status}
        q={q}
        source="appsheet"
      />
    );
  }

  const supabase = await createClient();

  let query = (supabase.from('session_summary') as unknown as ReturnType<typeof supabase.from>)
    .select('*')
    .order('started_at', { ascending: false });

  if (status !== 'all') query = (query as any).eq('status', status);
  if (q) query = (query as any).or(`building_address.ilike.%${q}%,inspector_name.ilike.%${q}%`);

  const result = await (query as any).limit(100) as unknown as { data: SessionSummary[] | null };
  const sessions = result.data;

  return (
    <SessionsView
      sessions={sessions ?? []}
      status={status}
      q={q}
      source="scanergy"
    />
  );
}

interface ViewProps {
  sessions: SessionSummary[];
  status: string;
  q: string;
  source: 'scanergy' | 'appsheet';
}

function SessionsView({ sessions, status, q, source }: ViewProps) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {sessions.length} sessions shown
          {source === 'appsheet' ? ' — from AppSheet (Objecten, one visit per building)' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1.5">
          {STATUSES.map(s => {
            const href = new URLSearchParams();
            if (s !== 'all') href.set('status', s);
            if (q) href.set('q', q);
            const hrefStr = href.toString() ? `?${href.toString()}` : '/sessions';
            return (
              <Link
                key={s}
                href={s === 'all' && !q ? '/sessions' : hrefStr}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  status === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s}
              </Link>
            );
          })}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <form>
            {status !== 'all' && <input type="hidden" name="status" value={status} />}
            <input
              name="q"
              defaultValue={q}
              placeholder="Search building, inspector…"
              className="pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
            />
          </form>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Code</th>
              <th className="px-5 py-3 font-medium">Building</th>
              <th className="px-5 py-3 font-medium">Inspector</th>
              <th className="px-5 py-3 font-medium">Started</th>
              <th className="px-5 py-3 font-medium">Measurements</th>
              <th className="px-5 py-3 font-medium">Anomalies</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sessions.map(s => (
              <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link
                    href={source === 'appsheet' ? `/buildings/${s.id}` : `/sessions/${s.id}`}
                    className="text-indigo-600 hover:underline font-medium"
                  >
                    {s.session_code}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-700">{s.building_address}, {s.building_city}</td>
                <td className="px-5 py-3 text-gray-600">{s.inspector_name}</td>
                <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                  {s.started_at ? fmtDateTimeFull(s.started_at) : '—'}
                </td>
                <td className="px-5 py-3 text-gray-700">{source === 'appsheet' ? '—' : s.total_measurements}</td>
                <td className="px-5 py-3">
                  {source === 'appsheet' ? (
                    <span className="text-gray-400">—</span>
                  ) : s.anomaly_count > 0 ? (
                    <span className="text-amber-600 font-medium">{s.anomaly_count}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <SessionStatusBadge status={s.status} />
                </td>
                <td className="px-5 py-3 text-right">
                  {source === 'appsheet'
                    ? <AppsheetDeleteSessionButton objectId={s.id} sessionCode={s.session_code} />
                    : <DeleteSessionButton sessionId={s.id} sessionCode={s.session_code} />}
                </td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-gray-400">No sessions</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
