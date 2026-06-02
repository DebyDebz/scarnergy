import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
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

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar role={(profileResult.data?.role ?? 'supervisor') as Role} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          fullName={profileResult.data?.full_name ?? user.email ?? 'User'}
          orgName={orgResult.data?.name ?? 'Organisation'}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
