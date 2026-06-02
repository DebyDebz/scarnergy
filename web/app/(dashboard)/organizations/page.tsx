import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { AddOrgForm } from '@/components/admin/AddOrgForm';
import { Building, MapPin, ChevronRight } from 'lucide-react';
import type { Organisation, UserProfile, BuildingSummary, Role } from '@/lib/types';

export const revalidate = 0;

type OrgWithCounts = Organisation & {
  user_profiles: { count: number }[];
  buildings: { count: number }[];
};

export default async function OrganizationsPage() {
  const supabase = await createClient();

  const [orgsResult, usersResult, buildingsResult] = await Promise.all([
    supabase
      .from('organisations')
      .select('*, user_profiles(count), buildings(count)')
      .order('name') as unknown as Promise<{ data: OrgWithCounts[] | null }>,
    (supabase.from('user_profiles') as any)
      .select('id, full_name, role')
      .in('role', ['supervisor', 'inspector'])
      .order('full_name') as Promise<{ data: Pick<UserProfile, 'id' | 'full_name' | 'role'>[] | null }>,
    (supabase.from('building_summary') as any)
      .select('id, reference_code, full_address')
      .order('full_address') as Promise<{ data: Pick<BuildingSummary, 'id' | 'reference_code' | 'full_address'>[] | null }>,
  ]);

  const orgs = orgsResult.data;
  const availableUsers = (usersResult.data ?? []).map(u => ({
    id: u.id,
    full_name: u.full_name,
    role: u.role as Role,
  }));
  const availableBuildings = (buildingsResult.data ?? []).map(b => ({
    id: b.id,
    reference_code: b.reference_code,
    full_address: b.full_address,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizations</h1>
          <p className="text-sm text-gray-500 mt-0.5">{orgs?.length ?? 0} organizations</p>
        </div>
      </div>

      <AddOrgForm availableUsers={availableUsers} availableBuildings={availableBuildings} />

      <div className="space-y-4">
        {(orgs ?? []).map(org => {
          const userCount = org.user_profiles?.[0]?.count ?? 0;
          const buildingCount = org.buildings?.[0]?.count ?? 0;
          const fullAddress = [org.address, org.postal_code, org.city].filter(Boolean).join(', ');

          return (
            <Link
              key={org.id}
              href={`/organizations/${org.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 rounded-lg p-2 shrink-0">
                    <Building className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">{org.name}</h2>
                    {fullAddress && (
                      <p className="text-xs text-gray-500 mt-0.5">{fullAddress}</p>
                    )}
                    {(org.latitude != null && org.longitude != null) && (
                      <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                        <MapPin className="w-3 h-3" />
                        {org.latitude.toFixed(5)}, {org.longitude.toFixed(5)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                  <span><span className="font-semibold text-gray-900">{userCount}</span> users</span>
                  <span><span className="font-semibold text-gray-900">{buildingCount}</span> buildings</span>
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors" />
                </div>
              </div>
            </Link>
          );
        })}
        {!orgs?.length && (
          <p className="text-sm text-gray-400 text-center py-8">No organizations</p>
        )}
      </div>
    </div>
  );
}
