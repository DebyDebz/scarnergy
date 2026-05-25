import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { name, address, city, postal_code, latitude, longitude, user_ids, building_ids } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
  }

  const supabase = await createServiceClient();

  const { data, error } = await (supabase.from('organisations') as any)
    .insert({
      name: name.trim(),
      address: address?.trim() || null,
      city: city?.trim() || null,
      postal_code: postal_code?.trim() || null,
      latitude: latitude !== '' && latitude != null ? parseFloat(latitude) : null,
      longitude: longitude !== '' && longitude != null ? parseFloat(longitude) : null,
      settings: {},
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orgId = data.id;

  if (Array.isArray(user_ids) && user_ids.length > 0) {
    const { error: userErr } = await (supabase.from('user_profiles') as any)
      .update({ org_id: orgId })
      .in('id', user_ids);
    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
  }

  if (Array.isArray(building_ids) && building_ids.length > 0) {
    const { error: bldErr } = await (supabase.from('buildings') as any)
      .update({ org_id: orgId })
      .in('id', building_ids);
    if (bldErr) return NextResponse.json({ error: bldErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: orgId });
}
