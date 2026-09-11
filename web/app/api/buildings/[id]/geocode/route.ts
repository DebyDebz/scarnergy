import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { geocodeAddress } from '@/lib/geocode';

// POST /api/buildings/[id]/geocode — resolve the building's address to
// WGS84 coordinates via the keyless PDOK Locatieserver and cache them on the
// existing buildings.latitude/longitude columns (GAP W3 map). Like the BAG
// route: manual-button-only, the map itself only reads DB columns.

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const buildingRes = await (supabase.from('buildings') as any)
    .select('id, street, house_number, house_number_addition, postal_code, city')
    .eq('id', params.id)
    .single() as unknown as { data: {
      street: string; house_number: string; house_number_addition: string | null;
      postal_code: string; city: string;
    } | null };
  const b = buildingRes.data;
  if (!b) return NextResponse.json({ error: 'Building not found' }, { status: 404 });

  let point: { lat: number; lon: number } | null = null;
  try {
    point = await geocodeAddress(b.street, b.house_number, b.house_number_addition, b.postal_code, b.city);
  } catch {
    return NextResponse.json({ error: 'geocode_unavailable' }, { status: 502 });
  }
  if (!point) return NextResponse.json({ error: 'address_not_found' }, { status: 422 });

  const { error } = await (supabase.from('buildings') as any)
    .update({ latitude: point.lat, longitude: point.lon })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ latitude: point.lat, longitude: point.lon });
}
