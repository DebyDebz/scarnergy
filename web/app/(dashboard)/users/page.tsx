import { createClient } from '@/lib/supabase-server';
import { InviteUserForm } from '@/components/admin/InviteUserForm';
import { ToggleActiveButton } from '@/components/admin/ToggleActiveButton';
import { ChangeRoleButton } from '@/components/admin/ChangeRoleButton';
import { Users } from 'lucide-react';
import type { UserProfile, InspectionSession } from '@/lib/types';

export const revalidate = 0;

export default async function UsersPage() {
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
    supabase.from('inspection_sessions').select('inspector_id, started_at').eq('org_id', orgId).order('started_at', { ascending: false }),
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
                    ? new Date(lastSession(u.id)!).toLocaleDateString('en-GB')
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
