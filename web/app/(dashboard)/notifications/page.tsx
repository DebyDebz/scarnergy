import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { NotificationsList, type NotificationUser } from '@/components/admin/NotificationsList';
import { Bell } from 'lucide-react';
import type { UserProfile } from '@/lib/types';

export const revalidate = 0;

export default async function NotificationsPage() {
  const source = await getServerDataSource();

  if (source === 'appsheet') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">Signup request approvals</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Signup requests are a ScanergyV2 (Supabase) feature — switch data source to see them.
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const profileResult = await supabase
    .from('user_profiles')
    .select('org_id')
    .eq('id', user!.id)
    .single() as unknown as { data: Pick<UserProfile, 'org_id'> | null };

  const orgId = profileResult.data!.org_id;

  const [pendingResult, rejectedResult] = await Promise.all([
    supabase.from('user_profiles').select('id, full_name, created_at, status')
      .eq('org_id', orgId).eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('user_profiles').select('id, full_name, created_at, status')
      .eq('org_id', orgId).eq('status', 'rejected').order('created_at', { ascending: false }),
  ]);

  const pending = (pendingResult as unknown as { data: NotificationUser[] | null }).data ?? [];
  const rejected = (rejectedResult as unknown as { data: NotificationUser[] | null }).data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <Bell className="w-4.5 h-4.5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {pending.length} pending · {rejected.length} rejected — signup requests to join your organisation
          </p>
        </div>
      </div>

      <NotificationsList orgId={orgId} initialPending={pending} initialRejected={rejected} />
    </div>
  );
}
