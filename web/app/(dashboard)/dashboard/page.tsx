import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { appsheetFind } from '@/lib/appsheet/client';
import { mapBedrijvenRow, mapObjectenToSessionSummary, parseAppsheetDateTime } from '@/lib/appsheet/mappers';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { RecentOrgsPanel } from '@/components/dashboard/RecentOrgsPanel';
import { Activity, Building2, TriangleAlert, Ruler } from 'lucide-react';
import type { SessionSummary } from '@/lib/types';
import { fmtDateTime } from '@/lib/format';

type OrgWithStats = {
  id: string;
  name: string;
  city: string;
  buildings: { count: number }[];
  inspection_sessions: { count: number }[];
};

// Must be 0, not a positive interval: this page reads the data-source cookie
// (getServerDataSource()) and OpenNext's Cloudflare incremental cache keys
// on URL only, not on cookies — a positive revalidate window caches the
// rendered response for whichever source happened to render it, and every
// visitor gets that stale source until the window expires (see the
// organizations page, which hit this same bug first).
export const revalidate = 0;

// AppSheet-sourced dashboard mirrors the Scanergy KPI layout with real
// AppSheet-backed numbers: active sessions and total buildings both derive
// from Objecten (same active/completed status logic as the /sessions
// page), measurements today comes from the real Metingen table. Anomalies
// has no AppSheet equivalent (Metingen carries no anomaly flag) — shown as
// "—" rather than a fabricated 0. Recent sessions reuses the same
// Objecten-as-pseudo-session mapping the /sessions page already relies on,
// rendered in the identical table used by Scanergy mode (rows link to
// /buildings/[id] since there's no separate session record).
async function AppsheetDashboardPage() {
  const [bedrijvenResult, objectenResult, inspecteursResult, metingenResult] = await Promise.all([
    appsheetFind('Bedrijven'),
    appsheetFind('Objecten'),
    appsheetFind('Inspecteurs'),
    appsheetFind('Metingen'),
  ]);
  const orgs = (Array.isArray(bedrijvenResult) ? bedrijvenResult : []).map(mapBedrijvenRow);
  const totalBuildings = Array.isArray(objectenResult) ? objectenResult.length : 0;

  const inspecteurNameById = new Map(
    (Array.isArray(inspecteursResult) ? inspecteursResult : [])
      .map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Inspecteur Naam'] ?? '')])
  );
  const allSessions = (Array.isArray(objectenResult) ? objectenResult : [])
    .map((row: Record<string, unknown>) => mapObjectenToSessionSummary(row, inspecteurNameById));
  const activeSessions = allSessions.filter(s => s.status === 'active').length;
  const recentSessions = [...allSessions]
    .sort((a, b) =>
      (parseAppsheetDateTime(b.started_at)?.getTime() ?? 0) - (parseAppsheetDateTime(a.started_at)?.getTime() ?? 0)
    )
    .slice(0, 10);

  const todayISODate = new Date().toISOString().slice(0, 10);
  const measurementsToday = (Array.isArray(metingenResult) ? metingenResult : [])
    .filter((r: Record<string, unknown>) => parseAppsheetDateTime(r['Tijdstip'])?.toISOString().slice(0, 10) === todayISODate)
    .length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Platform overview — AppSheet source active</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Active sessions" value={activeSessions} sub="right now" icon={Activity} color="indigo" />
        <KpiCard label="Total buildings" value={totalBuildings} sub="Objecten" icon={Building2} color="emerald" />
        <KpiCard label="Anomalies (7d)" value="—" sub="not available" icon={TriangleAlert} color="amber" />
        <KpiCard label="Measurements today" value={measurementsToday} sub="Metingen" icon={Ruler} color="rose" />
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
              {recentSessions.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link href={`/buildings/${s.id}`} className="text-indigo-600 hover:underline">
                      {s.session_code}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{s.building_address}</td>
                  <td className="px-5 py-3 text-gray-600">{s.inspector_name}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {s.started_at ? fmtDateTime(s.started_at) : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-700">—</td>
                  <td className="px-5 py-3">
                    <SessionStatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
              {!recentSessions.length && (
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
          <h2 className="font-semibold text-gray-900">Organizations</h2>
          <Link href="/organizations" className="text-sm text-indigo-600 hover:underline">View all</Link>
        </div>
        <div className="divide-y divide-gray-50">
          {orgs.map(org => (
            <Link
              key={org.id}
              href={`/organizations/${org.id}`}
              className="block px-5 py-3 text-sm text-gray-800 hover:bg-gray-50 hover:text-indigo-600 transition-colors"
            >
              {org.name}
            </Link>
          ))}
          {!orgs.length && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No organizations</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const source = await getServerDataSource();
  if (source === 'appsheet') return <AppsheetDashboardPage />;

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
    supabase.from('inspection_sessions').select('*', { count: 'exact', head: true }).eq('status', 'active').eq('is_active', true),
    supabase.from('buildings').select('*', { count: 'exact', head: true }).eq('is_active', true),
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
                    {fmtDateTime(s.started_at)}
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
