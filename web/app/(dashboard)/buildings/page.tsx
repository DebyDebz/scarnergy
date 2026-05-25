import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { Search, Plus } from 'lucide-react';
import type { BuildingSummary, UserProfile } from '@/lib/types';

export const revalidate = 60;

interface Props {
  searchParams: { q?: string };
}

export default async function BuildingsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const q = searchParams.q ?? '';

  const { data: { user } } = await supabase.auth.getUser();
  const profileResult = await (supabase.from('user_profiles') as any)
    .select('role')
    .eq('id', user!.id)
    .single() as unknown as { data: Pick<UserProfile, 'role'> | null };
  const isAdmin = profileResult.data?.role === 'admin';

  let query = supabase.from('building_summary').select('*').order('city');
  if (q) query = query.or(`reference_code.ilike.%${q}%,street.ilike.%${q}%,city.ilike.%${q}%`);

  const result = await query as unknown as { data: BuildingSummary[] | null };
  const buildings = result.data;

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
                <td className="px-5 py-3 text-gray-500">{b.construction_year}</td>
                <td className="px-5 py-3 text-gray-700">{b.zone_count}</td>
                <td className="px-5 py-3 text-gray-700">{b.element_count}</td>
                <td className="px-5 py-3 text-gray-700">{b.session_count}</td>
                <td className="px-5 py-3 text-gray-500">
                  {b.last_inspection_at
                    ? new Date(b.last_inspection_at).toLocaleDateString('en-GB')
                    : '—'}
                </td>
                <td className="px-5 py-3">
                  <EnergyLabelBadge label={b.latest_energy_label} />
                </td>
              </tr>
            ))}
            {!buildings?.length && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-gray-400">No buildings found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
