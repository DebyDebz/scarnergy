import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { appsheetFind } from '@/lib/appsheet/client';
import { mapObjectenRow, objectenSessionStatus, countRelatedIds } from '@/lib/appsheet/mappers';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { DeleteBuildingButton } from '@/components/buildings/DeleteBuildingButton';
import { AppsheetDeleteBuildingButton } from '@/components/buildings/AppsheetDeleteBuildingButton';
import { Search, Plus } from 'lucide-react';
import type { BuildingSummary, UserProfile } from '@/lib/types';
import { fmtDate } from '@/lib/format';

// Must be 0 — see the identical fix + rationale on the dashboard page
// (app/(dashboard)/dashboard/page.tsx): a positive revalidate window lets
// OpenNext's Cloudflare incremental cache serve a stale data source to
// every visitor, since it keys on URL only, not on the source cookie.
export const revalidate = 0;

interface Props {
  searchParams: { q?: string };
}

// AppSheet has no energy-label equivalent at all, so that stays defaulted.
// Zone/element counts come straight off the Objecten row's own "Related X"
// ref-list columns (countRelatedIds — no extra Find call needed), and
// session/last-inspected reuse the same pseudo-session model the AppSheet
// Sessions page already established: every Objecten row IS one session
// (objectenSessionStatus), so session_count is always 1 here.
function toBuildingSummary(row: Record<string, unknown>, bagRow: Record<string, unknown> | undefined): BuildingSummary {
  const building = mapObjectenRow(row, bagRow);
  const { completedAt } = objectenSessionStatus(row);
  return {
    ...building,
    full_address: building.address_unresolved
      ? 'Address not yet resolved'
      : `${building.street} ${building.house_number}, ${building.postal_code} ${building.city}`.trim(),
    zone_count: countRelatedIds(row['Related Verdiepingen']),
    element_count: countRelatedIds(row['Related Gevels']) + countRelatedIds(row['Related Dakens'])
      + countRelatedIds(row['Related Vloerens']) + countRelatedIds(row['Related Installaties']),
    session_count: 1,
    last_inspection_at: completedAt,
    latest_energy_label: null,
  };
}

export default async function BuildingsPage({ searchParams }: Props) {
  const q = searchParams.q ?? '';
  const source = await getServerDataSource();

  // Admin-ness is a ScanergyV2 (Supabase) concept regardless of which data
  // source is active — the logged-in user's role always comes from here.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const profileResult = await (supabase.from('user_profiles') as any)
    .select('role')
    .eq('id', user!.id)
    .single() as unknown as { data: Pick<UserProfile, 'role'> | null };
  const isAdmin = profileResult.data?.role === 'admin';

  if (source === 'appsheet') {
    const [objectenResult, bagResult] = await Promise.all([
      appsheetFind('Objecten'),
      appsheetFind('BAG Data'),
    ]);
    const bagByObjectId = new Map(
      (Array.isArray(bagResult) ? bagResult : []).map((r: Record<string, unknown>) => [String(r['Object ID']), r])
    );
    let buildings = (Array.isArray(objectenResult) ? objectenResult : [])
      .map((row: Record<string, unknown>) => toBuildingSummary(row, bagByObjectId.get(String(row['Object ID']))));
    if (q) {
      const needle = q.toLowerCase();
      buildings = buildings.filter(b =>
        b.reference_code.toLowerCase().includes(needle) ||
        b.street.toLowerCase().includes(needle) ||
        b.city.toLowerCase().includes(needle)
      );
    }
    return <BuildingsTable buildings={buildings} q={q} isAdmin={isAdmin} source={source} />;
  }

  let query = supabase.from('building_summary').select('*').order('city');
  if (q) query = query.or(`reference_code.ilike.%${q}%,street.ilike.%${q}%,city.ilike.%${q}%`);

  const result = await query as unknown as { data: BuildingSummary[] | null };
  const buildings = result.data;

  return <BuildingsTable buildings={buildings} q={q} isAdmin={isAdmin} source={source} />;
}

interface TableProps {
  buildings: BuildingSummary[] | null;
  q: string;
  isAdmin: boolean;
  source: 'scanergy' | 'appsheet';
}

function BuildingsTable({ buildings, q, isAdmin, source }: TableProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Buildings</h1>
          <p className="text-sm text-gray-500 mt-0.5">{buildings?.length ?? 0} buildings</p>
        </div>
        {isAdmin && (
          <Link
            href="/buildings/new"
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add building
          </Link>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <form>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search address, code, city…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Address</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Year</th>
              <th className="px-5 py-3 font-medium">Zones</th>
              <th className="px-5 py-3 font-medium">Elements</th>
              <th className="px-5 py-3 font-medium">Sessions</th>
              <th className="px-5 py-3 font-medium">Last inspected</th>
              <th className="px-5 py-3 font-medium">Label</th>
              {isAdmin && <th className="px-5 py-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(buildings ?? []).map(b => (
              <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link href={`/buildings/${b.id}`} className="text-indigo-600 hover:underline font-medium">
                    {b.reference_code}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-700">{b.full_address}</td>
                <td className="px-5 py-3 text-gray-500 capitalize">{b.building_type}</td>
                <td className="px-5 py-3 text-gray-500">{b.construction_year || '—'}</td>
                <td className="px-5 py-3 text-gray-700">{b.zone_count}</td>
                <td className="px-5 py-3 text-gray-700">{b.element_count}</td>
                <td className="px-5 py-3 text-gray-700">{b.session_count}</td>
                <td className="px-5 py-3 text-gray-500">
                  {b.last_inspection_at
                    ? fmtDate(b.last_inspection_at)
                    : '—'}
                </td>
                <td className="px-5 py-3">
                  <EnergyLabelBadge label={b.latest_energy_label} />
                </td>
                {isAdmin && (
                  <td className="px-5 py-3 text-right">
                    {source === 'appsheet'
                      ? <AppsheetDeleteBuildingButton id={b.id} label={b.reference_code} />
                      : <DeleteBuildingButton id={b.id} label={b.reference_code} />}
                  </td>
                )}
              </tr>
            ))}
            {!buildings?.length && (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="px-5 py-8 text-center text-gray-400">No buildings found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
