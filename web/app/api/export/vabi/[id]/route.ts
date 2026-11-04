import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildVabiXml } from '@/lib/vabiXml';
import type { BuildingElement, Opening, Rekenzone, Zone } from '@/lib/types';

// Session-scoped VABI export. The XML itself comes from the shared builder in
// @scarnergy/opname-calc (same canonical format as the mobile export and the
// building-level route) — this file only loads the session's data. The old
// inline duplicate of the builder was removed when rekenzone grouping landed.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessionId = params.id;

  // ── Fetch session + organisation in parallel ────────────────────────────
  const [sessionRes, orgRes] = await Promise.all([
    (supabase.from('session_summary') as any).select('*').eq('id', sessionId).single(),
    (supabase.from('organisations') as any).select('name').single(),
  ]);

  const session = sessionRes.data;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Fetch building details separately (session_summary has minimal building data)
  const [buildingRes, zonesRes, rekenzonesRes] = await Promise.all([
    (supabase.from('buildings') as any)
      .select('construction_year, building_type')
      .eq('id', session.building_id)
      .single(),
    (supabase.from('zones') as any)
      .select('*')
      .eq('building_id', session.building_id)
      .eq('is_active', true)
      .order('floor_level'),
    (supabase.from('rekenzones') as any)
      .select('*')
      .eq('building_id', session.building_id)
      .eq('is_active', true)
      .order('sort_order'),
  ]);
  const building = buildingRes.data ?? {};
  const zones: Zone[] = zonesRes.data ?? [];
  const rekenzones: Rekenzone[] = rekenzonesRes.data ?? [];
  const zoneIds = zones.map(z => z.id);

  // ── Elements & openings ───────────────────────────────────────────────
  let elements: BuildingElement[] = [];
  let openings: Opening[] = [];

  if (zoneIds.length) {
    const [elemRes, openRes] = await Promise.all([
      (supabase.from('building_elements') as any)
        .select('*')
        .in('zone_id', zoneIds)
        .eq('is_active', true)
        .order('sort_order'),
      (supabase.from('openings') as any)
        .select('*')
        .eq('is_active', true),
    ]);
    elements = elemRes.data ?? [];
    // Filter openings to only those belonging to elements in this building
    const elementIds = new Set(elements.map((e: BuildingElement) => e.id));
    openings = (openRes.data ?? []).filter((o: any) => elementIds.has(o.element_id));
  }

  const xml = buildVabiXml(session, { name: orgRes.data?.name ?? '' }, building, zones, elements, openings, rekenzones);

  const filename = `${session.session_code}_VABI.xml`.replace(/[^a-zA-Z0-9_.-]/g, '_');

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
