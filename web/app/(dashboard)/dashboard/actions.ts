'use server';

import { createClient } from '@/lib/supabase-server';
import type { RecentMeasurement } from '@/lib/types';

export async function getOrgMeasurements(orgId: string): Promise<RecentMeasurement[]> {
  const supabase = await createClient();

  const { data: sessions } = await supabase
    .from('inspection_sessions')
    .select('id')
    .eq('org_id', orgId);

  const sessionIds = (sessions as unknown as { id: string }[] | null)?.map(s => s.id) ?? [];
  if (!sessionIds.length) return [];

  const { data } = await supabase
    .from('recent_measurements')
    .select('*')
    .in('session_id', sessionIds)
    .order('measured_at', { ascending: false })
    .limit(20);

  return (data as unknown as RecentMeasurement[]) ?? [];
}
