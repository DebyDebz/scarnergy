import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetAction, appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import {
  buildNewVerdiepingRow, buildVerdiepingEditRow,
  buildNewRekenzoneRow,
  buildNewGevelRow, buildGevelEditRow,
  buildNewDakRow, buildDakEditRow,
  buildNewVloerRow, buildVloerEditRow,
  buildNewInstallatieRow, buildInstallatieEditRow,
  buildNewTransparantDeelRow, buildTransparantDeelEditRow,
  formatAppsheetDuration, parseAppsheetDateTime, escapeForSelector,
} from '@/lib/appsheet/mappers';

// Fires once, when an inspector closes a session on a building whose
// AppSheet source is active (buildings.appsheet_object_id is set) — a batch
// export of that session's *finished* zone/element/opening dimensions into
// AppSheet, not a live per-field sync. See the plan doc for why: AppSheet
// has no columns for the mobile app's mid-session mechanics (grid
// coordinates, drawn shapes, dirty-tracking), so Supabase stays the write
// of record throughout the session regardless of this push's outcome.
//
// gevel/dak/vloer/installatie (and gevel/dak/vloer's transparant_deel
// openings) all push now. dak/vloer/installatie link to AppSheet via a
// Rekenzone ID rather than a Verdieping ID — migration 031 gave
// `rekenzones` its own appsheet_row_key, find-or-created the same way the
// zones→Verdiepingen loop below already works (buildNewRekenzoneRow
// confirmed live: only "Object ID"+"Naam Rekenzone" required, no landmine).
// A dak/vloer/installatie whose zone has no rekenzone assigned still can't
// be pushed — there's no Rekenzone to attach it to in AppSheet's model —
// and is reported back as skipped rather than silently dropped.
interface ZoneInput { id: string; appsheet_row_key: string | null; rekenzone_id: string | null; name: string; gross_area_m2: number | null; ceiling_height_m: number | null; description: string | null; floor_plan_image_url: string | null; }
interface ElementInput {
  id: string; appsheet_row_key: string | null; zone_id: string; element_type: string; name: string;
  length_mm: number | null; width_mm: number | null; height_mm: number | null; area_m2: number | null;
  orientation_deg: number | null; tilt_deg: number | null; nokhoogte_m: number | null;
  construction_type: string | null; insulation_type: string | null; description: string | null;
  installation_type: string | null; brand: string | null; notes: string | null;
  grid_x: number | null; grid_y: number | null;
}
interface OpeningInput { id: string; appsheet_row_key: string | null; element_id: string; opening_type: string; width_mm: number | null; height_mm: number | null; area_m2: number | null; glazing_type: string | null; frame_type: string | null; notes: string | null; }

// Which AppSheet table + parent-id field each syncable element_type uses —
// keeps the elements loop below one shared shape instead of 3 near-copies.
const ELEMENT_SYNC_SPEC: Record<string, { table: string; key: string; parentOpeningField?: 'Gevel ID' | 'Dak ID' | 'Vloer ID' }> = {
  gevel: { table: 'Gevels', key: 'Gevel ID', parentOpeningField: 'Gevel ID' },
  dak: { table: 'Daken', key: 'Dak ID', parentOpeningField: 'Dak ID' },
  vloer: { table: 'Vloeren', key: 'Vloer ID', parentOpeningField: 'Vloer ID' },
  installatie: { table: 'Installaties', key: 'Installatie ID' },
};

function mmToM(v: number | null): number | undefined {
  return v != null ? v / 1000 : undefined;
}

// Every buildXEditRow() in mappers.ts treats a field as "leave this AppSheet
// column untouched" only when it's `undefined`; `null` is treated as "clear
// it to empty" (see buildVerdiepingEditRow etc — `!== undefined` gates
// inclusion, `?? ''` blanks it). Supabase returns `null`, not `undefined`,
// for an unset column, and mmToM(null) below normally already returns
// undefined but was being coerced back to `null` via `?? null` at several
// call sites — so every Edit call ended up actively blanking any dimension
// or enum-backed field (Positie, Type Dak, Vloerisolatie, Type Installatie,
// Orientatie, Glastype, Materiaal…) that just happened to be unset locally,
// even when AppSheet already had a real value for it. Confirmed live: a
// blank "Positie" 400s the whole Edit ("Missing value in column: Positie",
// an Enum column) — other blanked enum columns either 400 the same way or
// silently erase real data, neither of which is intended by "this field
// wasn't touched this session." orUndef() converts null -> undefined so
// these edit-row builders correctly skip the field instead.
function orUndef<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}

// appsheetAction('Add', ...) responds with { Rows: [...] } — NOT a bare
// array like appsheetFind does. Every `Array.isArray(added)` check below
// used to assume the Find shape, so it was always false for an Add
// response and silently treated every successful Add as if it returned no
// row — the new row's key was never read back, so appsheet_row_key was
// never persisted to Supabase and the same zone/element got re-Added (or
// reported as unresolvable, e.g. "could not create a Rekenzone") on every
// subsequent close, even though AppSheet had already created the row.
function firstAddedRow(added: unknown): Record<string, unknown> | undefined {
  if (added && typeof added === 'object' && Array.isArray((added as any).Rows)) {
    return (added as any).Rows[0];
  }
  if (Array.isArray(added)) return added[0];
  return undefined;
}

// The mobile app's opening_type is English ('window'/'door'/'skylight' —
// see inspect.tsx's DETAIL_FIELDS options); AppSheet's "Type Deel" is a
// fixed Dutch enum (confirmed live values: Raam, Deur, Deur met Glas,
// Deurglas, Paneel) — sending the raw English value through unmapped would
// write a value AppSheet's own UI never produces itself. No "skylight"
// equivalent exists in the enum; "Raam" (window) is the closest fit.
const OPENING_TYPE_TO_APPSHEET: Record<string, string> = { window: 'Raam', door: 'Deur', skylight: 'Raam' };

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
    .select('appsheet_object_id, org_id')
    .eq('id', buildingId)
    .maybeSingle() as unknown as { data: { appsheet_object_id: string | null; org_id: string } | null };
  const objectId = buildingResult.data?.appsheet_object_id;
  if (!objectId) {
    return NextResponse.json({ error: 'This building has no linked AppSheet object — nothing to push' }, { status: 400 });
  }
  const orgId = buildingResult.data!.org_id;

  const results: { table: string; id: string; status: 'added' | 'edited' | 'skipped' | 'failed'; reason?: string; appsheetKey?: string }[] = [];

  try {
    const zoneById = new Map(zones.map((z) => [z.id, z]));

    // Rekenzone find-or-create — parent link for dak/vloer/installatie AND
    // (below) a hard requirement for a new Verdieping. Only fetched for
    // rekenzones already referenced by a zone in this session — zones with
    // no rekenzone_id at all get one lazily created in the loop below.
    const rekenzoneIds = Array.from(new Set(zones.map(z => z.rekenzone_id).filter((v): v is string => !!v)));
    const rekenzoneById = new Map<string, { id: string; name: string; appsheet_row_key: string | null }>();
    if (rekenzoneIds.length) {
      const rzRes = await (supabase.from('rekenzones') as any)
        .select('id, name, appsheet_row_key')
        .in('id', rekenzoneIds) as unknown as { data: { id: string; name: string; appsheet_row_key: string | null }[] | null };
      for (const rz of (rzRes.data ?? [])) rekenzoneById.set(rz.id, rz);
    }
    const ensureRekenzoneKey = async (rekenzoneId: string): Promise<string | null> => {
      const rz = rekenzoneById.get(rekenzoneId);
      if (!rz) return null;
      if (rz.appsheet_row_key) return rz.appsheet_row_key;
      const row = buildNewRekenzoneRow(objectId!, { naam: rz.name });
      const added = await appsheetAction('Rekenzones', 'Add', [row]);
      const newKey = String(firstAddedRow(added)?.['Rekenzone ID'] ?? '');
      if (newKey) {
        await (supabase.from('rekenzones') as any).update({ appsheet_row_key: newKey }).eq('id', rekenzoneId);
        rz.appsheet_row_key = newKey;
      }
      return newKey || null;
    };

    // Every zone needs a Rekenzone, not just ones with dak/vloer/installatie
    // elements: a new Verdieping's "Object ID" is only actually stamped by
    // AppSheet when "Rekenzone ID" is supplied on the same Add (confirmed
    // live — Object ID alone returns 200 and *looks* successful, but the
    // row comes back with a blank Object ID, an invisible orphan never
    // listed under the building), and Gevels' own Add is confirmed to hard-
    // require a "Rekenzone ID" of its own too. Reuse the zone's assigned
    // Rekenzone if it has one, else create a dedicated 1:1 Rekenzone (named
    // after the zone) and persist the link back onto it.
    const ensureZoneRekenzoneKey = async (zone: ZoneInput): Promise<string | null> => {
      if (zone.rekenzone_id) return ensureRekenzoneKey(zone.rekenzone_id);
      const rzRow = buildNewRekenzoneRow(objectId!, { naam: zone.name });
      const addedRz = await appsheetAction('Rekenzones', 'Add', [rzRow]);
      const rekenzoneKey = String(firstAddedRow(addedRz)?.['Rekenzone ID'] ?? '') || null;
      if (!rekenzoneKey) return null;
      const insertedRz = await (supabase.from('rekenzones') as any)
        .insert({ org_id: orgId, building_id: buildingId, appsheet_row_key: rekenzoneKey, name: zone.name })
        .select('id')
        .single() as unknown as { data: { id: string } | null };
      if (insertedRz.data) {
        await (supabase.from('zones') as any).update({ rekenzone_id: insertedRz.data.id }).eq('id', zone.id);
        zone.rekenzone_id = insertedRz.data.id;
        rekenzoneById.set(insertedRz.data.id, { id: insertedRz.data.id, name: zone.name, appsheet_row_key: rekenzoneKey });
      }
      return rekenzoneKey;
    };

    for (const zone of zones) {
      if (zone.appsheet_row_key) {
        const row = buildVerdiepingEditRow(zone.appsheet_row_key, {
          grossAreaM2: orUndef(zone.gross_area_m2), ceilingHeightM: orUndef(zone.ceiling_height_m), notes: orUndef(zone.description),
          plattegrondSchets: orUndef(zone.floor_plan_image_url),
        });
        await appsheetAction('Verdiepingen', 'Edit', [row]);
        results.push({ table: 'Verdiepingen', id: zone.id, status: 'edited', appsheetKey: zone.appsheet_row_key });
        continue;
      }

      const rekenzoneKey = await ensureZoneRekenzoneKey(zone);
      if (!rekenzoneKey) {
        results.push({ table: 'Verdiepingen', id: zone.id, status: 'failed', reason: 'could not create a Rekenzone to link this zone to AppSheet' });
        continue;
      }

      const row = buildNewVerdiepingRow(objectId, {
        naam: zone.name, rekenzoneId: rekenzoneKey, grossAreaM2: zone.gross_area_m2, ceilingHeightM: zone.ceiling_height_m, notes: zone.description,
        plattegrondSchets: zone.floor_plan_image_url,
      });
      const added = await appsheetAction('Verdiepingen', 'Add', [row]);
      const newKey = String(firstAddedRow(added)?.['Verdieping ID'] ?? '');
      if (newKey) {
        await (supabase.from('zones') as any).update({ appsheet_row_key: newKey }).eq('id', zone.id);
        zone.appsheet_row_key = newKey;
      }
      results.push({ table: 'Verdiepingen', id: zone.id, status: 'added', appsheetKey: newKey || undefined });
    }

    // parent-key-by-element-id, keyed by element type so the openings loop
    // below can look up the right parent field (Gevel/Dak/Vloer ID) —
    // installatie never carries openings so it's never populated here.
    const parentKeyByElementId = new Map<string, { field: 'Gevel ID' | 'Dak ID' | 'Vloer ID'; value: string }>();

    for (const el of elements) {
      const spec = ELEMENT_SYNC_SPEC[el.element_type];
      if (!spec) {
        results.push({ table: 'Gevels', id: el.id, status: 'skipped', reason: `element_type "${el.element_type}" has no AppSheet write path` });
        continue;
      }
      const zone = zoneById.get(el.zone_id);

      // gevel/dakkapel-style elements hang off a Verdieping (zone); dak/vloer/
      // installatie hang off a Rekenzone — resolve whichever parent key this
      // element's type actually needs.
      let parentKey: string | null = null;
      // Gevels' own Add is confirmed to hard-require "Rekenzone ID" too
      // (a 400 "Missing value in column: Rekenzone ID" — not just the
      // Verdieping ID the field-set here originally assumed), so it needs
      // both parent keys resolved, same as dak/vloer/installatie for the
      // Rekenzone half.
      let gevelRekenzoneKey: string | null = null;
      if (el.element_type === 'gevel') {
        parentKey = zone?.appsheet_row_key ?? null;
        if (!parentKey) {
          results.push({ table: spec.table, id: el.id, status: 'failed', reason: 'parent zone has no AppSheet row key' });
          continue;
        }
        gevelRekenzoneKey = zone ? await ensureZoneRekenzoneKey(zone) : null;
        if (!gevelRekenzoneKey) {
          results.push({ table: spec.table, id: el.id, status: 'failed', reason: 'could not resolve/create the AppSheet Rekenzone required by Gevels' });
          continue;
        }
      } else {
        if (!zone?.rekenzone_id) {
          results.push({ table: spec.table, id: el.id, status: 'skipped', reason: 'zone has no rekenzone assigned — nothing to attach this element to in AppSheet' });
          continue;
        }
        parentKey = await ensureRekenzoneKey(zone.rekenzone_id);
        if (!parentKey) {
          results.push({ table: spec.table, id: el.id, status: 'failed', reason: 'could not resolve/create the AppSheet Rekenzone for this element\'s zone' });
          continue;
        }
      }

      // Gevels' own Add is confirmed to hard-require "Hoogte" (height) —
      // a 400 "Missing value in column: Hoogte" — unlike Edit, which only
      // touches fields actually supplied. A wall the inspector hasn't
      // measured a height for yet (is_complete=false, common: only length
      // captured so far) simply can't be pushed as a *new* row; skip rather
      // than guess a height, and let the next session-close retry it once
      // it's measured.
      if (el.element_type === 'gevel' && !el.appsheet_row_key && el.height_mm == null) {
        results.push({ table: spec.table, id: el.id, status: 'skipped', reason: 'Gevel Add requires a height — not measured yet' });
        continue;
      }

      // Installaties' Add is confirmed live-blocked: "Ventilatie Code" is an
      // unconditionally required Ref column with no discoverable valid
      // value (every existing row has it blank; no Ventilatie_Logica-style
      // lookup exists in mappers.ts) — Add always 400s. Edit is unaffected
      // (buildInstallatieEditRow never touches that column), so only a
      // brand-new Installatie is skipped, not an update to an existing one.
      if (el.element_type === 'installatie' && !el.appsheet_row_key) {
        results.push({ table: spec.table, id: el.id, status: 'skipped', reason: 'Installatie Add is blocked live — "Ventilatie Code" has no known valid value (needs AppSheet editor lookup)' });
        continue;
      }

      let newKey: string | undefined;
      if (el.appsheet_row_key) {
        const row = el.element_type === 'gevel'
          ? buildGevelEditRow(el.appsheet_row_key, {
              name: orUndef(el.name), widthM: mmToM(el.length_mm), heightM: mmToM(el.height_mm),
              areaM2: orUndef(el.area_m2), orientationDeg: orUndef(el.orientation_deg), positie: orUndef(el.construction_type), notes: orUndef(el.notes),
            })
          : el.element_type === 'dak'
          ? buildDakEditRow(el.appsheet_row_key, {
              name: orUndef(el.name), lengthM: mmToM(el.length_mm), widthM: mmToM(el.width_mm),
              areaM2: orUndef(el.area_m2), tiltDeg: orUndef(el.tilt_deg), roofType: orUndef(el.construction_type),
              nokhoogteM: orUndef(el.nokhoogte_m), notes: orUndef(el.notes),
            })
          : el.element_type === 'vloer'
          ? buildVloerEditRow(el.appsheet_row_key, {
              name: orUndef(el.name), lengthM: mmToM(el.length_mm), widthM: mmToM(el.width_mm),
              areaM2: orUndef(el.area_m2), vloerisolatie: orUndef(el.insulation_type), notes: orUndef(el.notes),
            })
          : buildInstallatieEditRow(el.appsheet_row_key, {
              installationType: orUndef(el.installation_type), merkModel: orUndef(el.brand), notes: orUndef(el.notes),
            });
        await appsheetAction(spec.table, 'Edit', [row]);
        newKey = el.appsheet_row_key;
        results.push({ table: spec.table, id: el.id, status: 'edited', appsheetKey: newKey });
      } else {
        const row = el.element_type === 'gevel'
          ? buildNewGevelRow(parentKey, {
              name: el.name, positie: el.construction_type || 'Voorgevel', rekenzoneId: gevelRekenzoneKey!,
              widthM: mmToM(el.length_mm) ?? null, heightM: mmToM(el.height_mm) ?? null,
              areaM2: el.area_m2, orientationDeg: el.orientation_deg, notes: el.notes,
            })
          : el.element_type === 'dak'
          ? buildNewDakRow(parentKey, {
              naam: el.name, lengthM: mmToM(el.length_mm) ?? null, widthM: mmToM(el.width_mm) ?? null,
              areaM2: el.area_m2, tiltDeg: el.tilt_deg, roofType: el.construction_type,
              nokhoogteM: el.nokhoogte_m, notes: el.notes,
            })
          : el.element_type === 'vloer'
          // "Grenzend aan code" is confirmed live REQUIRED on Vloeren Add
          // (400s "Missing value in column" otherwise, unlike Daken where
          // it silently defaults) — default to "Grond" (code '2') when the
          // element has no boundary classification of its own, since floors
          // are ground-facing far more often than not and AppSheet gives no
          // "unknown"/"overige" option to fall back to instead.
          ? buildNewVloerRow(parentKey, {
              naam: el.name, lengthM: mmToM(el.length_mm) ?? null, widthM: mmToM(el.width_mm) ?? null,
              areaM2: el.area_m2, vloerisolatie: el.insulation_type,
              grenztAanOmschrijving: el.description || 'Grond', notes: el.notes,
            })
          : buildNewInstallatieRow(parentKey, {
              installationType: el.installation_type || 'Onbekend', merkModel: el.brand, notes: el.notes,
            });
        const added = await appsheetAction(spec.table, 'Add', [row]);
        newKey = String(firstAddedRow(added)?.[spec.key] ?? '');
        if (newKey) {
          await (supabase.from('building_elements') as any).update({ appsheet_row_key: newKey }).eq('id', el.id);
        }
        results.push({ table: spec.table, id: el.id, status: 'added', appsheetKey: newKey || undefined });
      }
      if (newKey && spec.parentOpeningField) {
        parentKeyByElementId.set(el.id, { field: spec.parentOpeningField, value: newKey });
      }
    }

    // The mobile grid-canvas flow places windows/doors as their own
    // building_elements row (element_type "transparant_deel"), a sibling of
    // the walls rather than nested inside one — so its `openings` row's
    // element_id points at itself, never at a gevel/dak/vloer. AppSheet's
    // Transparante_Delen has no such standalone concept: every row needs a
    // real Gevel/Dak/Vloer parent. Recover one geometrically — each opening
    // carries the grid position + rotation it was drawn at, which lines up
    // with the wall it sits on (same rotation, closest position) far more
    // reliably than nearest-by-distance alone (a corner window can be
    // physically closer to the wrong, perpendicular wall).
    const wallParentByOpeningElementId = new Map<string, string>();
    for (const el of elements) {
      if (el.element_type !== 'transparant_deel' || el.grid_x == null || el.grid_y == null) continue;
      const candidates = elements.filter(w =>
        w.zone_id === el.zone_id && w.grid_x != null && w.grid_y != null &&
        ['gevel', 'dak', 'vloer'].includes(w.element_type)
      );
      if (!candidates.length) continue;
      const sameOrientation = el.orientation_deg != null
        ? candidates.filter(w => w.orientation_deg != null && Math.abs(((w.orientation_deg! - el.orientation_deg! + 540) % 360) - 180) < 5)
        : [];
      const pool = sameOrientation.length ? sameOrientation : candidates;
      const nearest = pool.reduce((best, w) => {
        const d = (w.grid_x! - el.grid_x!) ** 2 + (w.grid_y! - el.grid_y!) ** 2;
        return d < best.d ? { w, d } : best;
      }, { w: pool[0], d: Infinity }).w;
      wallParentByOpeningElementId.set(el.id, nearest.id);
    }

    for (const opening of openings) {
      // Already linked to an AppSheet row from a prior session-close on this
      // same building — Edit it in place instead of re-Adding, otherwise
      // every closed session after the first would push a duplicate
      // Transparante_Delen row for the same physical window/door. Mirrors
      // the zone/element branching above. No parent-wall resolution needed
      // here — the row already carries its Gevel/Dak/Vloer ID link in AppSheet.
      if (opening.appsheet_row_key) {
        const row = buildTransparantDeelEditRow(opening.appsheet_row_key, {
          typeDeel: OPENING_TYPE_TO_APPSHEET[opening.opening_type] ?? 'Raam',
          widthM: mmToM(opening.width_mm), heightM: mmToM(opening.height_mm),
          glastype: orUndef(opening.glazing_type), materiaal: orUndef(opening.frame_type), notes: orUndef(opening.notes),
        });
        await appsheetAction('Transparante_Delen', 'Edit', [row]);
        results.push({ table: 'Transparante_Delen', id: opening.id, status: 'edited', appsheetKey: opening.appsheet_row_key });
        continue;
      }

      const wallElementId = wallParentByOpeningElementId.get(opening.element_id) ?? opening.element_id;
      const parent = parentKeyByElementId.get(wallElementId);
      if (!parent) {
        results.push({ table: 'Transparante_Delen', id: opening.id, status: 'skipped', reason: 'parent element was not pushed to AppSheet (or its type has no opening support)' });
        continue;
      }
      const row = buildNewTransparantDeelRow(parent.field, parent.value, {
        typeDeel: OPENING_TYPE_TO_APPSHEET[opening.opening_type] ?? 'Raam',
        widthM: mmToM(opening.width_mm) ?? null, heightM: mmToM(opening.height_mm) ?? null,
        areaM2: opening.area_m2, glastype: opening.glazing_type, materiaal: opening.frame_type, notes: opening.notes,
      });
      const added = await appsheetAction('Transparante_Delen', 'Add', [row]);
      const newKey = String(firstAddedRow(added)?.['Deel ID'] ?? '');
      if (newKey) {
        await (supabase.from('openings') as any).update({ appsheet_row_key: newKey }).eq('id', opening.id);
      }
      results.push({ table: 'Transparante_Delen', id: opening.id, status: 'added', appsheetKey: newKey || undefined });
    }

    // Mark the visit complete on the Objecten row itself, so AppSheet-mode
    // admin views (dashboard "Active sessions", /sessions list) stop
    // counting this building's session as active. AppSheet's own "Status"
    // column has no confirmed-valid "completed" enum value (only "Nieuw"/
    // "Besteld" are known — see OBJECTEN_STATUS_MAP). "Eind Opname Compleet"
    // — the column objectenSessionStatus() actually reads for its past-due
    // check — LOOKS writable but is a read-only formula column (confirmed
    // live: an Edit to it has no effect). "Duur" is the real writable input
    // that formula is computed from (Opname Datum/Tijd + Duur — confirmed
    // live too), so this pushes the real elapsed time since the visit
    // started instead. Wrapped separately so a failure here doesn't discard
    // the zone/element/opening results above.
    try {
      const idf = escapeForSelector(objectId);
      const objRows = await appsheetFind('Objecten', `FILTER(Objecten, [Object ID] = "${idf}")`);
      const objRow = Array.isArray(objRows) ? objRows[0] : undefined;
      const opnameStart = objRow
        ? parseAppsheetDateTime(`${objRow['Opname Datum'] ?? ''} ${objRow['Opname Tijd'] ?? ''}`.trim())
        : null;
      if (!opnameStart) {
        results.push({ table: 'Objecten', id: buildingId, status: 'skipped', reason: 'could not read this visit\'s start time from AppSheet' });
      } else {
        let elapsedMs = Math.max(0, Date.now() - opnameStart.getTime());
        // objectenSessionStatus() ignores an Eind Opname Compleet that sits
        // within ~1 minute of exactly Opname Tijd + 60 minutes — that's
        // AppSheet's own synthetic default for a never-touched row, not a
        // real completion. A genuine ~1-hour inspection would collide with
        // that same window and get ignored the same way, so nudge clear of
        // it — this doesn't need to be exact, only "clearly not the
        // untouched default and clearly in the past."
        const SYNTHETIC_DEFAULT_MS = 60 * 60 * 1000;
        if (Math.abs(elapsedMs - SYNTHETIC_DEFAULT_MS) < 2 * 60 * 1000) {
          elapsedMs = SYNTHETIC_DEFAULT_MS + 2 * 60 * 1000;
        }
        await appsheetAction('Objecten', 'Edit', [
          { 'Object ID': objectId, Duur: formatAppsheetDuration(elapsedMs) },
        ]);
        results.push({ table: 'Objecten', id: buildingId, status: 'edited', appsheetKey: objectId });
      }
    } catch (e: any) {
      results.push({ table: 'Objecten', id: buildingId, status: 'failed', reason: e?.message ?? 'could not mark the visit complete' });
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
