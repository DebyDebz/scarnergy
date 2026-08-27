import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import {
  mapVerdiepingRow, mapGevelRow, mapDakRow, mapVloerRow, mapInstallatieRow, mapRekenzoneRow,
  firstZoneIdForRekenzone, escapeForSelector,
} from '@/lib/appsheet/mappers';
import { materializeBuilding, materializeSession, MaterializeNotFoundError } from '@/lib/appsheet/materializeBuilding';

// Lets an inspector "retake" a measurement on an AppSheet-sourced element
// from /tabs/sessions/appsheet-detail: given the AppSheet Object ID +
// element id/type shown there, finds-or-creates the Supabase shadow
// building/zone/element chain (via appsheet_row_key — same correlation
// session-close/route.ts already writes on the way back out) plus an active
// session to hang the measurement off, so the existing BLE inspect flow
// (which only ever works against real Supabase uuids) runs unmodified.
//
// gevel hangs off a Verdieping directly (Gevel row's own "Verdieping ID").
// dak/vloer/installatie hang off a Rekenzone instead — resolved via the
// Rekenzone's first related Verdieping (firstZoneIdForRekenzone, same
// best-effort floor assignment the web building-detail page already uses)
// — and, since a Supabase zone needs a real `rekenzone_id` FK for
// session-close to later find the right Rekenzone to push back into, the
// Rekenzone itself is find-or-created here too (by appsheet_row_key,
// migration 031) alongside the zone.
const TABLE_BY_TYPE: Record<string, { table: string; key: string }> = {
  gevel: { table: 'Gevels', key: 'Gevel ID' },
  dak: { table: 'Daken', key: 'Dak ID' },
  vloer: { table: 'Vloeren', key: 'Vloer ID' },
  installatie: { table: 'Installaties', key: 'Installatie ID' },
};
const MAP_BY_TYPE: Record<string, (row: Record<string, unknown>, zoneId: string) => ReturnType<typeof mapGevelRow>> = {
  gevel: mapGevelRow,
  dak: mapDakRow,
  vloer: mapVloerRow,
  installatie: mapInstallatieRow,
};

export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const objectId: string | undefined = typeof body?.objectId === 'string' ? body.objectId : undefined;
  const elementId: string | undefined = typeof body?.elementId === 'string' ? body.elementId : undefined;
  const elementType: string | undefined = typeof body?.elementType === 'string' ? body.elementType : undefined;
  if (!objectId || !elementId || !elementType) {
    return NextResponse.json({ error: 'objectId, elementId and elementType are required' }, { status: 400 });
  }
  const spec = TABLE_BY_TYPE[elementType];
  if (!spec) {
    return NextResponse.json({ error: `Unsupported elementType "${elementType}"` }, { status: 400 });
  }

  const profileResult = await (supabase.from('user_profiles') as any)
    .select('org_id')
    .eq('id', user.id)
    .single() as unknown as { data: { org_id: string } | null };
  const orgId = profileResult.data?.org_id;
  if (!orgId) return NextResponse.json({ error: 'No organisation on profile' }, { status: 403 });

  try {
    const buildingId = await materializeBuilding(supabase, orgId, objectId);

    const elementResult = await appsheetFind(spec.table, `FILTER(${spec.table}, [${spec.key}] = "${escapeForSelector(elementId)}")`);
    const elementRow = Array.isArray(elementResult) ? elementResult[0] : undefined;
    if (!elementRow) {
      return NextResponse.json({ error: `No AppSheet ${spec.table} row found for id "${elementId}"` }, { status: 404 });
    }

    let verdiepingId = '';
    let rekenzoneId: string | null = null;
    let rekenzoneRow: Record<string, unknown> | undefined;

    if (elementType === 'gevel') {
      verdiepingId = String(elementRow['Verdieping ID'] ?? '');
    } else {
      rekenzoneId = String(elementRow['Rekenzone ID'] ?? '') || null;
      if (rekenzoneId) {
        const rzResult = await appsheetFind('Rekenzones', `FILTER(Rekenzones, [Rekenzone ID] = "${escapeForSelector(rekenzoneId)}")`);
        rekenzoneRow = Array.isArray(rzResult) ? rzResult[0] : undefined;
        verdiepingId = rekenzoneRow ? firstZoneIdForRekenzone(rekenzoneRow) : '';
      }
    }
    const verdiepingResult = verdiepingId
      ? await appsheetFind('Verdiepingen', `FILTER(Verdiepingen, [Verdieping ID] = "${escapeForSelector(verdiepingId)}")`)
      : [];
    const verdiepingRow = Array.isArray(verdiepingResult) ? verdiepingResult[0] : undefined;

    // Rekenzone: find-or-create by (building_id, appsheet_row_key) — only
    // for dak/vloer/installatie, gevel's zone has no rekenzone_id to set.
    let rekenzoneDbId: string | null = null;
    if (rekenzoneId) {
      const existingRekenzone = await (supabase.from('rekenzones') as any)
        .select('id')
        .eq('building_id', buildingId)
        .eq('appsheet_row_key', rekenzoneId)
        .maybeSingle() as unknown as { data: { id: string } | null };
      rekenzoneDbId = existingRekenzone.data?.id ?? null;
      if (!rekenzoneDbId) {
        const rz = rekenzoneRow ? mapRekenzoneRow(rekenzoneRow) : { name: 'Rekenzone', notes: null as string | null };
        const insertedRz = await (supabase.from('rekenzones') as any)
          .insert({ org_id: orgId, building_id: buildingId, appsheet_row_key: rekenzoneId, name: rz.name, notes: rz.notes })
          .select('id')
          .single() as unknown as { data: { id: string } | null; error: { message: string } | null };
        if (insertedRz.error || !insertedRz.data) {
          return NextResponse.json({ error: insertedRz.error?.message ?? 'Failed to materialize rekenzone' }, { status: 500 });
        }
        rekenzoneDbId = insertedRz.data.id;
      }
    }

    // Zone: find-or-create by (building_id, appsheet_row_key).
    const existingZone = await (supabase.from('zones') as any)
      .select('id')
      .eq('building_id', buildingId)
      .eq('appsheet_row_key', verdiepingId)
      .maybeSingle() as unknown as { data: { id: string } | null };

    let zoneId = existingZone.data?.id;
    if (!zoneId) {
      const zone = verdiepingRow
        ? mapVerdiepingRow(verdiepingRow)
        : { name: 'Verdieping', floor_level: 0, gross_area_m2: 0, ceiling_height_m: null as number | null, description: null as string | null };
      const insertedZone = await (supabase.from('zones') as any)
        .insert({
          org_id: orgId,
          building_id: buildingId,
          appsheet_row_key: verdiepingId || null,
          rekenzone_id: rekenzoneDbId,
          zone_code: '',
          name: zone.name,
          floor_level: zone.floor_level,
          gross_area_m2: zone.gross_area_m2,
          ceiling_height_m: zone.ceiling_height_m,
          description: zone.description,
        })
        .select('id')
        .single() as unknown as { data: { id: string } | null; error: { message: string } | null };
      if (insertedZone.error || !insertedZone.data) {
        return NextResponse.json({ error: insertedZone.error?.message ?? 'Failed to materialize zone' }, { status: 500 });
      }
      zoneId = insertedZone.data.id;
    } else if (rekenzoneDbId) {
      // Existing zone might predate this element's rekenzone link (e.g. it
      // was first created bare via a gevel retake) — backfill it.
      await (supabase.from('zones') as any)
        .update({ rekenzone_id: rekenzoneDbId })
        .eq('id', zoneId)
        .is('rekenzone_id', null);
    }

    // Element: find-or-create by (zone_id, appsheet_row_key).
    const existingElement = await (supabase.from('building_elements') as any)
      .select('id')
      .eq('zone_id', zoneId)
      .eq('appsheet_row_key', elementId)
      .maybeSingle() as unknown as { data: { id: string } | null };

    let materializedElementId = existingElement.data?.id;
    if (!materializedElementId) {
      const element = MAP_BY_TYPE[elementType](elementRow, zoneId as string);
      const insertedElement = await (supabase.from('building_elements') as any)
        .insert({
          org_id: orgId,
          zone_id: zoneId,
          appsheet_row_key: elementId,
          element_type: elementType,
          name: element.name,
          description: element.description,
          length_mm: element.length_mm,
          width_mm: element.width_mm,
          height_mm: element.height_mm,
          area_m2: element.area_m2,
          orientation_deg: element.orientation_deg,
          tilt_deg: element.tilt_deg,
          nokhoogte_m: element.nokhoogte_m,
          construction_type: element.construction_type,
          insulation_type: element.insulation_type,
          installation_type: element.installation_type,
          brand: element.brand,
          is_complete: element.is_complete,
          is_active: true,
        })
        .select('id')
        .single() as unknown as { data: { id: string } | null; error: { message: string } | null };
      if (insertedElement.error || !insertedElement.data) {
        return NextResponse.json({ error: insertedElement.error?.message ?? 'Failed to materialize element' }, { status: 500 });
      }
      materializedElementId = insertedElement.data.id;
    }

    const sessionId = await materializeSession(supabase, orgId, buildingId, user.id);

    return NextResponse.json({ buildingId, zoneId, elementId: materializedElementId, sessionId });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof MaterializeNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
