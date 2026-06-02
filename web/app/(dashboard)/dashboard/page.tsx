import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { RecentOrgsPanel } from '@/components/dashboard/RecentOrgsPanel';
import { Activity, Building2, TriangleAlert, Ruler } from 'lucide-react';
import type { SessionSummary } from '@/lib/types';

type OrgWithStats = {
  id: string;
  name: string;
  city: string;
  buildings: { count: number }[];
  inspection_sessions: { count: number }[];
};

export const revalidate = 60;

export default async function DashboardPage() {
  const supabase = await createClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: activeSessions },
    { count: totalBuildings },
    { count: anomalies7d },
    { count: measurementsToday },
    recentResult,
    recentOrgsResult,
  ] = await Promise.all([
    supabase.from('inspection_sessions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('buildings').select('*', { count: 'exact', head: true }),
    supabase.from('measurements').select('*', { count: 'exact', head: true }).eq('is_anomaly', true).gte('measured_at', sevenDaysAgo),
    supabase.from('measurements').select('*', { count: 'exact', head: true }).gte('measured_at', todayISO),
    supabase.from('session_summary').select('*').order('started_at', { ascending: false }).limit(10),
    supabase.from('organisations').select('*, buildings(count), inspection_sessions(count)').order('name').limit(6),
  ]);

  const recentSessions = (recentResult as unknown as { data: SessionSummary[] | null }).data;
  const recentOrgs = (recentOrgsResult as unknown as { data: OrgWithStats[] | null }).data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Platform overview</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Active sessions" value={activeSessions ?? 0} sub="right now" icon={Activity} color="indigo" />
        <KpiCard label="Total buildings" value={totalBuildings ?? 0} sub="in org" icon={Building2} color="emerald" />
        <KpiCard label="Anomalies (7d)" value={anomalies7d ?? 0} sub="last 7 days" icon={TriangleAlert} color="amber" />
        <KpiCard label="Measurements today" value={measurementsToday ?? 0} sub="since midnight" icon={Ruler} color="rose" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent sessions</h2>
          <Link href="/sessions" className="text-sm text-indigo-600 hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Building</th>
                <th className="px-5 py-3 font-medium">Inspector</th>
                <th className="px-5 py-3 font-medium">Started</th>
                <th className="px-5 py-3 font-medium">Measurements</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(recentSessions ?? []).map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link href={`/sessions/${s.id}`} className="text-indigo-600 hover:underline">
                      {s.session_code}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{s.building_address}</td>
                  <td className="px-5 py-3 text-gray-600">{s.inspector_name}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {new Date(s.started_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{s.total_measurements}</td>
                  <td className="px-5 py-3">
                    <SessionStatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
              {!recentSessions?.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-400 text-sm">No sessions yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent organizations</h2>
          <Link href="/organizations" className="text-sm text-indigo-600 hover:underline">View all</Link>
        </div>
        <RecentOrgsPanel orgs={recentOrgs} />
      </div>
    </div>
  );
}
