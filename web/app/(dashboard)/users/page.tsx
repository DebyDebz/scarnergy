import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { appsheetFind } from '@/lib/appsheet/client';
import { mapInspecteurRow, mapBedrijvenRow } from '@/lib/appsheet/mappers';
import { InviteUserForm } from '@/components/admin/InviteUserForm';
import { AppsheetInviteUserForm } from '@/components/admin/AppsheetInviteUserForm';
import { ToggleActiveButton } from '@/components/admin/ToggleActiveButton';
import { ChangeRoleButton } from '@/components/admin/ChangeRoleButton';
import { AppsheetChangeRoleButton } from '@/components/admin/AppsheetChangeRoleButton';
import { AppsheetToggleActiveButton } from '@/components/admin/AppsheetToggleActiveButton';
import { Users } from 'lucide-react';
import type { UserProfile, InspectionSession } from '@/lib/types';
import { fmtDate } from '@/lib/format';

export const revalidate = 0;

// AppSheet-sourced "users" = Inspecteurs, per docs/CONTACTPERSOON_.../
// APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §1. There's no AppSheet-side
// admin/service_role equivalent, so this list is legitimately shorter than
// ScanergyV2's — a different independently-maintained dataset, not a
// filtered view of the same one. Add/role-change/deactivate are all wired
// to the real API now (confirmed live: Inspecteurs Add/Delete/Edit are all
// clean — see AppsheetInviteUserForm.tsx and buildInspecteurEditRow).
async function AppsheetUsersPage() {
  const [inspecteursResult, bedrijvenResult] = await Promise.all([
    appsheetFind('Inspecteurs'),
    appsheetFind('Bedrijven'),
  ]);
  const rows = Array.isArray(inspecteursResult) ? inspecteursResult : [];
  const users = rows.map(mapInspecteurRow);
  // AppsheetChangeRoleButton needs Inspecteurs' own raw "Rol" value
  // (Inspecteur/Beheerder), not the ScanergyV2 role enum mapInspecteurRow
  // collapses it into.
  const rawRolById = new Map(rows.map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Rol'] ?? 'Inspecteur')]));
  const orgs = (Array.isArray(bedrijvenResult) ? bedrijvenResult : []).map(mapBedrijvenRow);
  const roleCount = (role: string) => users.filter(u => u.role === role).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {users.length} inspecteurs (AppSheet) ·{' '}
          {roleCount('supervisor')} beheerder · {roleCount('inspector')} inspecteur
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-indigo-600" />
          <h2 className="font-semibold text-gray-900 text-sm">Add user (AppSheet)</h2>
        </div>
        <AppsheetInviteUserForm orgs={orgs} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-gray-900 font-medium">{u.full_name}</td>
                <td className="px-5 py-3">
                  <AppsheetChangeRoleButton
                    inspecteurId={u.id}
                    currentRol={(rawRolById.get(u.id) as 'Inspecteur' | 'Beheerder') ?? 'Inspecteur'}
                  />
                </td>
                <td className="px-5 py-3">
                  <AppsheetToggleActiveButton inspecteurId={u.id} isActive={u.is_active} />
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400">No inspecteurs</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function UsersPage() {
  const source = await getServerDataSource();
  if (source === 'appsheet') return <AppsheetUsersPage />;

  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  const adminProfileResult = await supabase
    .from('user_profiles')
    .select('org_id')
    .eq('id', authUser!.id)
    .single() as unknown as { data: Pick<UserProfile, 'org_id'> | null };

  const orgId = adminProfileResult.data!.org_id;

  const [usersResult, sessionsResult] = await Promise.all([
    supabase.from('user_profiles').select('*').eq('org_id', orgId).order('full_name'),
    supabase.from('inspection_sessions').select('inspector_id, started_at').eq('org_id', orgId).eq('is_active', true).order('started_at', { ascending: false }),
  ]);

  const users = (usersResult as unknown as { data: UserProfile[] | null }).data ?? [];
  const sessions = (sessionsResult as unknown as { data: Pick<InspectionSession, 'inspector_id' | 'started_at'>[] | null }).data ?? [];

  const lastSession = (id: string) =>
    sessions.find(s => s.inspector_id === id)?.started_at;

  const roleCount = (role: string) => users.filter(u => u.role === role).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {users.length} users ·{' '}
          {roleCount('admin')} admin · {roleCount('supervisor')} supervisor · {roleCount('inspector')} inspector
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-indigo-600" />
          <h2 className="font-semibold text-gray-900 text-sm">Invite new user</h2>
        </div>
        <InviteUserForm orgId={orgId} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Last session</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-gray-900 font-medium">{u.full_name}</td>
                <td className="px-5 py-3">
                  <ChangeRoleButton userId={u.id} currentRole={u.role} />
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">
                  {lastSession(u.id)
                    ? fmtDate(lastSession(u.id))
                    : '—'}
                </td>
                <td className="px-5 py-3">
                  <ToggleActiveButton table="user_profiles" id={u.id} isActive={u.is_active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
