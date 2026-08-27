import type { SupabaseClient } from '@supabase/supabase-js';
import { appsheetFind } from '@/lib/appsheet/client';
import { mapObjectenRow } from '@/lib/appsheet/mappers';

export class MaterializeNotFoundError extends Error {}

// Idempotent find-or-create for the Supabase "shadow" buildings row
// correlated to an AppSheet Objecten row via `appsheet_object_id` — shared
// by /api/appsheet/mobile/buildings, /api/appsheet/mobile/materialize-element,
// and /api/appsheet/mobile/materialize-session.
export async function materializeBuilding(
  supabase: SupabaseClient, orgId: string, objectId: string
): Promise<string> {
  // Scoped to org_id too, not just appsheet_object_id — an AppSheet Object
  // ID isn't guaranteed unique across orgs upstream, so without this an
  // inspector from one org could be handed another org's shadow building
  // (and its session/zone/element data) just by materializing the same ID.
  const existing = await (supabase.from('buildings') as any)
    .select('id')
    .eq('appsheet_object_id', objectId)
    .eq('org_id', orgId)
    .maybeSingle() as unknown as { data: { id: string } | null };
  if (existing.data) return existing.data.id;

  const [objectenResult, bagResult] = await Promise.all([
    appsheetFind('Objecten', `FILTER(Objecten, [Object ID] = "${objectId}")`),
    appsheetFind('BAG Data', `FILTER("BAG Data", [Object ID] = "${objectId}")`),
  ]);
  const objectenRow = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
  if (!objectenRow) {
    throw new MaterializeNotFoundError(`No AppSheet building found for objectId "${objectId}"`);
  }
  const bagRow = Array.isArray(bagResult) ? bagResult[0] : undefined;

  const building = mapObjectenRow(objectenRow, bagRow);
  const buildingType = building.building_type === 'Woning' ? 'residential_single' : 'other';

  const inserted = await (supabase.from('buildings') as any)
    .insert({
      org_id: orgId,
      appsheet_object_id: objectId,
      reference_code: building.reference_code,
      street: building.street || 'Unknown',
      house_number: building.house_number || '',
      postal_code: building.postal_code || '',
      city: building.city || 'Unknown',
      building_type: buildingType,
      construction_year: building.construction_year || null,
      gross_floor_area_m2: building.gross_floor_area_m2 || null,
    })
    .select('id')
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null };

  if (inserted.error || !inserted.data) {
    throw new Error(inserted.error?.message ?? 'Failed to materialize building');
  }
  return inserted.data.id;
}

// Finds the building's most recent active session, or starts one — same
// behavior as tabs/buildings.tsx's "Start Inspection" button. Shared by
// /api/appsheet/mobile/materialize-element (retake a specific measurement)
// and /api/appsheet/mobile/materialize-session (draw a floor plan from
// scratch on an AppSheet building with no zones recorded yet).
export async function materializeSession(
  supabase: SupabaseClient, orgId: string, buildingId: string, inspectorId: string
): Promise<string> {
  const existing = await (supabase.from('inspection_sessions') as any)
    .select('id')
    .eq('building_id', buildingId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as { data: { id: string } | null };
  if (existing.data) return existing.data.id;

  const inserted = await (supabase.from('inspection_sessions') as any)
    .insert({ org_id: orgId, building_id: buildingId, inspector_id: inspectorId })
    .select('id')
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (inserted.error || !inserted.data) {
    throw new Error(inserted.error?.message ?? 'Failed to start session');
  }
  return inserted.data.id;
}
