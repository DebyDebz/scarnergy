import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { Search } from 'lucide-react';
import type { SessionSummary } from '@/lib/types';

export const revalidate = 30;

interface Props {
  searchParams: { status?: string; q?: string };
}

const STATUSES = ['all', 'active', 'completed', 'paused', 'cancelled'];

export default async function SessionsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const status = searchParams.status ?? 'all';
  const q = searchParams.q ?? '';

  let query = (supabase.from('session_summary') as unknown as ReturnType<typeof supabase.from>)
    .select('*')
    .order('started_at', { ascending: false });

  if (status !== 'all') query = (query as any).eq('status', status);
  if (q) query = (query as any).or(`building_address.ilike.%${q}%,inspector_name.ilike.%${q}%`);

  const result = await (query as any).limit(100) as unknown as { data: SessionSummary[] | null };
  const sessions = result.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <p className="text-sm text-gray-500 mt-0.5">{sessions?.length ?? 0} sessions shown</p>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(sessions ?? []).map(s => (
              <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link href={`/sessions/${s.id}`} className="text-indigo-600 hover:underline font-medium">
                    {s.session_code}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-700">{s.building_address}, {s.building_city}</td>
                <td className="px-5 py-3 text-gray-600">{s.inspector_name}</td>
                <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                  {new Date(s.started_at).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="px-5 py-3 text-gray-700">{s.total_measurements}</td>
                <td className="px-5 py-3">
                  {s.anomaly_count > 0 ? (
                    <span className="text-amber-600 font-medium">{s.anomaly_count}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <SessionStatusBadge status={s.status} />
                </td>
              </tr>
            ))}
            {!sessions?.length && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-gray-400">No sessions</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
