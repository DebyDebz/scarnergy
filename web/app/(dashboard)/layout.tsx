import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
import { DataSourceProvider } from '@/lib/dataSource/DataSourceContext';
import type { PendingUser } from '@/components/nav/NotificationBell';
import type { Role, UserProfile, Organisation } from '@/lib/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const profileResult = await supabase
    .from('user_profiles')
    .select('full_name, role, org_id')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<UserProfile, 'full_name' | 'role' | 'org_id'> | null };

  const orgResult = await supabase
    .from('organisations')
    .select('name')
    .eq('id', profileResult.data?.org_id ?? '')
    .single() as unknown as { data: Pick<Organisation, 'name'> | null };

  // Pending-signup notifications are a ScanergyV2 (Supabase) concept only —
  // AppSheet-sourced Inspecteurs have no equivalent request-to-join flow —
  // and only admins can approve/reject, so only fetch for them.
  let pendingUsers: PendingUser[] | undefined;
  const source = await getServerDataSource();
  if (source !== 'appsheet' && profileResult.data?.role === 'admin') {
    const pendingResult = await supabase
      .from('user_profiles')
      .select('id, full_name, created_at')
      .eq('org_id', profileResult.data.org_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }) as unknown as { data: PendingUser[] | null };
    pendingUsers = pendingResult.data ?? [];
  }

  return (
    <DataSourceProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar role={(profileResult.data?.role ?? 'supervisor') as Role} pendingCount={pendingUsers?.length ?? 0} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar
            fullName={profileResult.data?.full_name ?? user.email ?? 'User'}
            orgName={orgResult.data?.name ?? 'Organisation'}
            orgId={profileResult.data?.org_id}
            pendingUsers={pendingUsers}
          />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </DataSourceProvider>
  );
}
