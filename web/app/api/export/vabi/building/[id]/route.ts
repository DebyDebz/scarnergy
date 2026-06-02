import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildVabiXml } from '@/lib/vabiXml';
import type { BuildingElement, Opening, Zone } from '@/lib/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const buildingId = params.id;

  // Fetch building, org, and most-recent completed session (for surveyor metadata)
  const [buildingRes, orgRes, sessionRes] = await Promise.all([
    (supabase.from('buildings') as any).select('*').eq('id', buildingId).single(),
    (supabase.from('organisations') as any).select('name').single(),
    (supabase.from('session_summary') as any)
      .select('inspector_name, started_at, building_address, building_city')
      .eq('building_id', buildingId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  const building = buildingRes.data;
  if (!building) return NextResponse.json({ error: 'Building not found' }, { status: 404 });

  const org     = orgRes.data     ?? {};
  const session = sessionRes.data ?? {
    inspector_name:   '—',
    started_at:       null,
    building_address: building.street ? `${building.street} ${building.house_number}` : buildingId,
    building_city:    building.city ?? '',
  };

  // Zones, elements, openings
  const zonesRes = await (supabase.from('zones') as any)
    .select('*')
    .eq('building_id', buildingId)
    .eq('is_active', true)
    .order('floor_level');

  const zones: Zone[] = zonesRes.data ?? [];
  const zoneIds = zones.map(z => z.id);

  let elements: BuildingElement[] = [];
  let openings: Opening[]         = [];

  if (zoneIds.length) {
    const [elRes, opRes] = await Promise.all([
      (supabase.from('building_elements') as any)
        .select('*').in('zone_id', zoneIds).eq('is_active', true).order('sort_order'),
      (supabase.from('openings') as any)
        .select('*').eq('is_active', true),
    ]);
    elements = elRes.data ?? [];
    const elIds = new Set(elements.map((e: BuildingElement) => e.id));
    openings = (opRes.data ?? []).filter((o: any) => elIds.has(o.element_id));
  }

  const xml = buildVabiXml(session, org, building, zones, elements, openings);

  const ref      = building.reference_code ?? buildingId.slice(0, 8);
  const filename = `${ref}_VABI.xml`.replace(/[^a-zA-Z0-9_.-]/g, '_');

  return new NextResponse(xml, {
    headers: {
      'Content-Type':        'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
