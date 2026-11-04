import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const ELEMENT_FIELDS = [
  'construction_type', 'description', 'insulation_type', 'finish_type',
  'installation_type', 'fuel_type', 'efficiency', 'capacity_kw', 'year_installed',
  'tilt_deg', 'nokhoogte_m', 'bodemisolatie', 'brand', 'model_nr', 'cv_klasse',
  'rc_value', 'u_value', 'notes',
  // Migration 024 calc fields (GAP W2)
  'plafond_type', 'warmtecap_vloer_klasse', 'warmtecap_gevel_klasse',
  'dikte_vloerconstructie_mm', 'rekenhoogte_m_override', 'rc_source',
] as const;

const OPENING_FIELDS = [
  'opening_type', 'frame_type', 'glazing_type',
  'thermisch_onderbroken', 'has_shading', 'shading_type', 'shading_factor',
  'overstek_m', 'belemmering', 'notes',
  // Migration 024 calc fields (§4.2/4.3)
  'u_glas', 'g_waarde', 'f_sh',
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const elementId = params.id;

  // Build element update — only allow whitelisted fields
  const elementUpdate: Record<string, unknown> = {};
  for (const key of ELEMENT_FIELDS) {
    if (key in body && body[key] !== undefined) {
      elementUpdate[key] = body[key];
    }
  }

  if (Object.keys(elementUpdate).length > 0) {
    const { error } = await (supabase.from('building_elements') as any)
      .update(elementUpdate)
      .eq('id', elementId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If opening data provided, upsert the opening record for this element
  if (body.opening) {
    const openingUpdate: Record<string, unknown> = {};
    for (const key of OPENING_FIELDS) {
      if (key in body.opening && body.opening[key] !== undefined) {
        openingUpdate[key] = body.opening[key];
      }
    }

    if (Object.keys(openingUpdate).length > 0) {
      // Try update first, then insert if none exists
      const { data: existing } = await (supabase.from('openings') as any)
        .select('id')
        .eq('element_id', elementId)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (existing?.id) {
        const { error } = await (supabase.from('openings') as any)
          .update(openingUpdate)
          .eq('id', existing.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        // Need org_id — get it from the element
        const { data: el } = await (supabase.from('building_elements') as any)
          .select('org_id')
          .eq('id', elementId)
          .single();
        const { error } = await (supabase.from('openings') as any)
          .insert({ ...openingUpdate, element_id: elementId, org_id: el?.org_id });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
