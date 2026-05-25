import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profileResult = await (supabase.from('user_profiles') as any)
    .select('org_id, role')
    .eq('id', user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  if (!profileResult.data || profileResult.data.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { reference_code, street, house_number, postal_code, city, building_type, construction_year, gross_floor_area_m2 } = body;

  if (!reference_code || !street || !house_number || !postal_code || !city || !building_type || !construction_year || !gross_floor_area_m2) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }

  const { data, error } = await (supabase.from('buildings') as any).insert({
    org_id: profileResult.data.org_id,
    reference_code,
    street,
    house_number,
    postal_code,
    city,
    building_type,
    construction_year: Number(construction_year),
    gross_floor_area_m2: Number(gross_floor_area_m2),
  }).select('id').single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
