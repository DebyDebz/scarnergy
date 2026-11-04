import { createClient } from '@/lib/supabase';
import type { Organisation } from '@/lib/types';
import type { OrganisationService } from '../types';

export const scanergyOrganisationService: OrganisationService = {
  async list() {
    const supabase = createClient();
    const { data } = await supabase.from('organisations').select('*').order('name');
    return (data ?? []) as unknown as Organisation[];
  },
  async get(id) {
    const supabase = createClient();
    const { data } = await supabase.from('organisations').select('*').eq('id', id).single();
    return (data ?? null) as unknown as Organisation | null;
  },
};
