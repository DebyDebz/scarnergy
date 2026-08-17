import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetAction, AppSheetConfigError } from '@/lib/appsheet/client';
import {
  buildNewVerdiepingRow, buildVerdiepingEditRow,
  buildNewGevelRow, buildGevelEditRow,
  buildNewTransparantDeelRow,
} from '@/lib/appsheet/mappers';

// Fires once, when an inspector closes a session on a building whose
// AppSheet source is active (buildings.appsheet_object_id is set) — a batch
// export of that session's *finished* zone/element/opening dimensions into
// AppSheet, not a live per-field sync. See the plan doc for why: AppSheet
// has no columns for the mobile app's mid-session mechanics (grid
// coordinates, drawn shapes, dirty-tracking), so Supabase stays the write
// of record throughout the session regardless of this push's outcome.
//
// Only `gevel` elements (and their `transparant_deel` openings) are pushed
// today — `dak`/`vloer`/`installatie` link to AppSheet via a Rekenzone ID
// that ScanergyV2's `rekenzones` table has no stored correlation to (no
// buildNewRekenzoneRow exists yet either). Rather than guess a Rekenzone ID
// and risk a landmine Add failure (see mappers.ts comments), those rows are
// skipped and reported back to the caller instead of silently dropped.
interface ZoneInput { id: string; appsheet_row_key: string | null; name: string; gross_area_m2: number | null; ceiling_height_m: number | null; description: string | null; }
interface ElementInput { id: string; appsheet_row_key: string | null; zone_id: string; element_type: string; name: string; length_mm: number | null; height_mm: number | null; area_m2: number | null; orientation_deg: number | null; construction_type: string | null; notes: string | null; }
interface OpeningInput { id: string; appsheet_row_key: string | null; element_id: string; opening_type: string; width_mm: number | null; height_mm: number | null; area_m2: number | null; glazing_type: string | null; frame_type: string | null; notes: string | null; }

function mmToM(v: number | null): number | undefined {
  return v != null ? v / 1000 : undefined;
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const buildingId: string | undefined = typeof body?.buildingId === 'string' ? body.buildingId : undefined;
  const zones: ZoneInput[] = Array.isArray(body?.zones) ? body.zones : [];
  const elements: ElementInput[] = Array.isArray(body?.elements) ? body.elements : [];
  const openings: OpeningInput[] = Array.isArray(body?.openings) ? body.openings : [];
  if (!buildingId) return NextResponse.json({ error: 'buildingId is required' }, { status: 400 });

  const buildingResult = await (supabase.from('buildings') as any)
    .select('appsheet_object_id')
    .eq('id', buildingId)
    .maybeSingle() as unknown as { data: { appsheet_object_id: string | null } | null };
  const objectId = buildingResult.data?.appsheet_object_id;
  if (!objectId) {
    return NextResponse.json({ error: 'This building has no linked AppSheet object — nothing to push' }, { status: 400 });
  }

  const results: { table: string; id: string; status: 'added' | 'edited' | 'skipped' | 'failed'; reason?: string; appsheetKey?: string }[] = [];

  try {
    for (const zone of zones) {
      if (zone.appsheet_row_key) {
        const row = buildVerdiepingEditRow(zone.appsheet_row_key, {
          grossAreaM2: zone.gross_area_m2, ceilingHeightM: zone.ceiling_height_m, notes: zone.description,
        });
        await appsheetAction('Verdiepingen', 'Edit', [row]);
        results.push({ table: 'Verdiepingen', id: zone.id, status: 'edited', appsheetKey: zone.appsheet_row_key });
        continue;
      }
      const row = buildNewVerdiepingRow(objectId, {
        naam: zone.name, grossAreaM2: zone.gross_area_m2, ceilingHeightM: zone.ceiling_height_m, notes: zone.description,
      });
      const added = await appsheetAction('Verdiepingen', 'Add', [row]);
      const newKey = Array.isArray(added) ? String(added[0]?.['Verdieping ID'] ?? '') : '';
      if (newKey) {
        await (supabase.from('zones') as any).update({ appsheet_row_key: newKey }).eq('id', zone.id);
        zone.appsheet_row_key = newKey;
      }
      results.push({ table: 'Verdiepingen', id: zone.id, status: 'added', appsheetKey: newKey || undefined });
    }

    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const gevelKeyByElementId = new Map<string, string>();

    for (const el of elements) {
      if (el.element_type !== 'gevel') {
        results.push({ table: 'Gevels', id: el.id, status: 'skipped', reason: `element_type "${el.element_type}" has no reliable AppSheet link (needs a Rekenzone ID ScanergyV2 doesn't correlate yet)` });
        continue;
      }
      const zone = zoneById.get(el.zone_id);
      if (!zone?.appsheet_row_key) {
        results.push({ table: 'Gevels', id: el.id, status: 'failed', reason: 'parent zone has no AppSheet row key' });
        continue;
      }
      if (el.appsheet_row_key) {
        const row = buildGevelEditRow(el.appsheet_row_key, {
          name: el.name, widthM: mmToM(el.length_mm) ?? null, heightM: mmToM(el.height_mm) ?? null,
          areaM2: el.area_m2, orientationDeg: el.orientation_deg, positie: el.construction_type, notes: el.notes,
        });
        await appsheetAction('Gevels', 'Edit', [row]);
        gevelKeyByElementId.set(el.id, el.appsheet_row_key);
        results.push({ table: 'Gevels', id: el.id, status: 'edited', appsheetKey: el.appsheet_row_key });
        continue;
      }
      const row = buildNewGevelRow(zone.appsheet_row_key, {
        name: el.name, positie: el.construction_type || 'Voorgevel',
        widthM: mmToM(el.length_mm) ?? null, heightM: mmToM(el.height_mm) ?? null,
        areaM2: el.area_m2, orientationDeg: el.orientation_deg, notes: el.notes,
      });
      const added = await appsheetAction('Gevels', 'Add', [row]);
      const newKey = Array.isArray(added) ? String(added[0]?.['Gevel ID'] ?? '') : '';
      if (newKey) {
        await (supabase.from('building_elements') as any).update({ appsheet_row_key: newKey }).eq('id', el.id);
        gevelKeyByElementId.set(el.id, newKey);
      }
      results.push({ table: 'Gevels', id: el.id, status: 'added', appsheetKey: newKey || undefined });
    }

    for (const opening of openings) {
      const gevelKey = gevelKeyByElementId.get(opening.element_id);
      if (!gevelKey) {
        results.push({ table: 'Transparante_Delen', id: opening.id, status: 'skipped', reason: 'parent element is not a gevel pushed to AppSheet' });
        continue;
      }
      const row = buildNewTransparantDeelRow('Gevel ID', gevelKey, {
        typeDeel: opening.opening_type, widthM: mmToM(opening.width_mm) ?? null, heightM: mmToM(opening.height_mm) ?? null,
        areaM2: opening.area_m2, glastype: opening.glazing_type, materiaal: opening.frame_type, notes: opening.notes,
      });
      const added = await appsheetAction('Transparante_Delen', 'Add', [row]);
      const newKey = Array.isArray(added) ? String(added[0]?.['Deel ID'] ?? '') : '';
      if (newKey) {
        await (supabase.from('openings') as any).update({ appsheet_row_key: newKey }).eq('id', opening.id);
      }
      results.push({ table: 'Transparante_Delen', id: opening.id, status: 'added', appsheetKey: newKey || undefined });
    }
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message, results }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message, results }, { status: 502 });
  }

  return NextResponse.json({ results });
}
