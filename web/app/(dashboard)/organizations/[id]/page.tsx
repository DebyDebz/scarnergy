import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { ArrowLeft, Building2, MapPin, Users, Mail, Phone } from 'lucide-react';
import type { Organisation, UserProfile, BuildingSummary } from '@/lib/types';

export const revalidate = 0;

interface Props {
  params: { id: string };
}

const ROLE_COLORS: Record<string, string> = {
  admin:      'bg-purple-100 text-purple-700',
  supervisor: 'bg-indigo-100 text-indigo-700',
  inspector:  'bg-emerald-100 text-emerald-700',
};

export default async function OrgDetailPage({ params }: Props) {
  const supabase = await createClient();

  const [orgResult, usersResult, buildingsResult] = await Promise.all([
    (supabase.from('organisations') as any)
      .select('*')
      .eq('id', params.id)
      .single() as Promise<{ data: Organisation | null }>,
    (supabase.from('user_profiles') as any)
      .select('id, full_name, role, is_active')
      .eq('org_id', params.id)
      .order('role')
      .order('full_name') as Promise<{ data: Pick<UserProfile, 'id' | 'full_name' | 'role' | 'is_active'>[] | null }>,
    (supabase.from('building_summary') as any)
      .select('id, reference_code, full_address, building_type, construction_year, zone_count, element_count, session_count, last_inspection_at, latest_energy_label')
      .eq('org_id', params.id)
      .order('full_address') as Promise<{ data: Pick<BuildingSummary, 'id' | 'reference_code' | 'full_address' | 'building_type' | 'construction_year' | 'zone_count' | 'element_count' | 'session_count' | 'last_inspection_at' | 'latest_energy_label'>[] | null }>,
  ]);

  const org = orgResult.data;
  if (!org) notFound();

  const users     = usersResult.data ?? [];
  const buildings = buildingsResult.data ?? [];

  const fullAddress = [org.address, org.postal_code, org.city].filter(Boolean).join(', ');

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Back + header */}
      <div>
        <Link href="/organizations" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Organizations
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 rounded-xl p-2.5 shrink-0">
              <Building2 className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
              {fullAddress && (
                <p className="text-sm text-gray-500 mt-0.5">{fullAddress}</p>
              )}
              {org.latitude != null && org.longitude != null && (
                <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                  <MapPin className="w-3 h-3" />
                  {org.latitude.toFixed(5)}, {org.longitude.toFixed(5)}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-5 text-sm text-gray-500 shrink-0">
            <span><span className="font-semibold text-gray-900">{users.length}</span> users</span>
            <span><span className="font-semibold text-gray-900">{buildings.length}</span> buildings</span>
          </div>
        </div>
      </div>

      {/* Users */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Users</h2>
          <span className="ml-auto text-xs text-gray-400">{users.length}</span>
        </div>
        {users.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900">{u.full_name}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">No users in this organization</p>
        )}
      </div>

      {/* Buildings */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Buildings</h2>
          <span className="ml-auto text-xs text-gray-400">{buildings.length}</span>
        </div>
        {buildings.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-5 py-3 font-medium">Reference</th>
                <th className="px-5 py-3 font-medium">Address</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Year</th>
                <th className="px-5 py-3 font-medium">Zones</th>
                <th className="px-5 py-3 font-medium">Sessions</th>
                <th className="px-5 py-3 font-medium">Last inspected</th>
                <th className="px-5 py-3 font-medium">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {buildings.map(b => (
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
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">No buildings in this organization</p>
        )}
      </div>

    </div>
  );
}
