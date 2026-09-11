import { createClient } from '@/lib/supabase';
import type { Contact } from '@/lib/types';
import type { ContactService } from '../types';

export const scanergyContactService: ContactService = {
  async listByBuilding(buildingId) {
    const supabase = createClient();
    const { data } = await (supabase.from('contacts') as any)
      .select('*').eq('building_id', buildingId).order('full_name');
    return (data ?? []) as Contact[];
  },
  async get(id) {
    const supabase = createClient();
    const { data } = await (supabase.from('contacts') as any).select('*').eq('id', id).single();
    return (data ?? null) as Contact | null;
  },
};
