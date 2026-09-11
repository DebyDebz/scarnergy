import { createClient } from '@/lib/supabase';
import type { Building } from '@/lib/types';
import type { BuildingService } from '../types';

export const scanergyBuildingService: BuildingService = {
  async list(orgId) {
    const supabase = createClient();
    const { data } = await (supabase.from('buildings') as any)
      .select('*').eq('org_id', orgId).order('reference_code');
    return (data ?? []) as Building[];
  },
  async get(id) {
    const supabase = createClient();
    const { data } = await (supabase.from('buildings') as any).select('*').eq('id', id).single();
    return (data ?? null) as Building | null;
  },
};
