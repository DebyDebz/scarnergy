import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../_auth';
import { appsheetFind, appsheetAction, AppSheetConfigError } from '@/lib/appsheet/client';

// Server-side proxy for AppSheet bulk Find + Selector calls. The
// ApplicationAccessKey lives only in process.env here — see
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §4 for why the old prototype's
// client-side key is exactly what this route exists to avoid repeating.
//
// Table allowlist: only entities with a confirmed field mapping get a real
// appsheet/* service implementation (see web/lib/services/types.ts). Keeping
// the allowlist here too stops the proxy itself being used to fetch
// arbitrary sheets from this workbook before they're vetted.
const ALLOWED_TABLES = new Set([
  'Bedrijven', 'Objecten', 'Contactpersoon', 'BAG Data', 'Inspecteurs',
  'Verdiepingen', 'Gevels', 'Daken', 'Vloeren', 'Installaties', 'Transparante_Delen',
]);

// Write access (Add/Delete/Edit) is scoped tighter than read, and only for
// admins, mirroring the existing /api/buildings write routes. Confirmed
// live: Add on Objecten auto-generates the key column and can trigger a
// live address-validation automation (see lib/appsheet/client.ts) — this is
// a real write to production AppSheet data, not a local mock. Inspecteurs
// has no such quirks — Add/Delete both confirmed clean on a throwaway row.
// Bedrijven's Add is confirmed clean too, but its "Bedrijf ID" key column
// is Number-typed, not an AppSheet-auto-generated key like every other
// table here — auto-generation produces a hex string ("75dd7925") that gets
// rejected ("cannot be converted to type 'Number'"); callers must supply
// the next sequential integer explicitly (see buildNewBedrijfRow).
// BAG Data added for the construction-year Add flow only: the new-building
// form writes a narrow {Object ID, BAG Bouwjaar} row here (see
// buildNewBagDataRow) since Objecten itself has no year column. Nothing
// else in this app Adds to BAG Data — every other BAG Data row is
// populated by the workbook's own external BAG lookup automation, not by
// this proxy.
// Transparante_Delen (openings) Add confirmed live clean with
// buildNewTransparantDeelRow's exact payload shape (parent Gevel/Dak/Vloer
// ID + Type Deel + optional Breedte/Hoogte/Glastype/Materiaal/notes) — real
// Add+Delete round-trip, no landmine. "Materiaal" silently defaults to
// "Hout/Kunststof" when omitted (AppSheet's own default, not this app's).
const WRITE_TABLES = new Set([
  'Objecten', 'Inspecteurs', 'Bedrijven', 'BAG Data', 'Transparante_Delen',
]);

// Edit-capable tables — a narrower set than WRITE_TABLES's Add/Delete
// scope. Confirmed live (edit + revert on a real row of each) that a
// narrow field-level Edit has no virtual-column side effects on any of
// these, even though several of them have landmine-heavy Add validation
// (see DELETE_TABLES below) — Edit and Add are validated independently by
// AppSheet, so a table being Edit-safe says nothing about Add-safety.
const EDIT_TABLES: Record<string, { key: string; fields: string[] }> = {
  Verdiepingen: { key: 'Verdieping ID', fields: ['GBO', 'Hoogte', 'Notities'] },
  Gevels: {
    key: 'Gevel ID',
    fields: ['Naam', 'Breedte', 'Hoogte', 'Bruto Oppervlakte', 'Orientatie Code', 'Grenzend aan code', 'Positie', 'Notities'],
  },
  Daken: {
    key: 'Dak ID',
    fields: ['Naam', 'Lengte Dak', 'Breedte Dak', 'Bruto Oppervlakte', 'Hoek', 'Type Dak', 'Nokhoogte/Lengte Vloer', 'Grenzend aan code', 'Notities'],
  },
  // Bodemisolatie is a constrained Enum column — confirmed live that none
  // of 'Y'/'N'/'Ja'/'Nee'/'1'/'0'/etc. are accepted values, and every real
  // row has it blank, so there's no observed value to copy either. Left out
  // rather than shipping a field that always 400s.
  Vloeren: {
    key: 'Vloer ID',
    fields: ['Naam', 'Lengte', 'Breedte', 'Bruto Oppervlakte', 'Vloerisolatie', 'Grenzend aan code', 'Notities'],
  },
  // 'Locatie in huis' is a constrained Enum — confirmed live it only
  // accepts exactly 'Binnen de thermische zone' / 'Buiten de thermische
  // zone' (free text 400s), enforced in the edit UI as a select, not text.
  Installaties: {
    key: 'Installatie ID',
    fields: ['Type Installatie', 'Locatie in huis', 'Merk/Model', 'Notities Installatie'],
  },
  // Rol/Actief are Inspecteurs' own two-value fields (see mapInspecteurRow's
  // INSPECTEUR_ROLE_MAP) — confirmed live, edit + revert clean.
  Inspecteurs: { key: 'Inspecteur ID', fields: ['Rol', 'Actief'] },
  // "Type Deel"/"Materiaal"/"Glastype" are constrained Enums — confirmed
  // live a free-text Edit 400s ("cannot be converted to type 'Enum'");
  // "Bruto Oppervlakte"/"Netto Oppervlakte" are formula columns (Breedte ×
  // Hoogte, confirmed via a live Add), left out of Edit for the same reason
  // Rc/kJ-m2K-style derived fields never appear in these allowlists.
  Transparante_Delen: {
    key: 'Deel ID',
    fields: ['Type Deel', 'Breedte', 'Hoogte', 'Glastype', 'Materiaal', 'Notities Deel'],
  },
};

// Delete-capable tables — deliberately separate from WRITE_TABLES/EDIT_TABLES
// rather than reusing either: WRITE_TABLES governs Add (which several of
// these tables fail hard, per landmine-heavy required-field chains
// confirmed live on Gevels/Vloeren/Installaties — missing Rekenzone
// ID/Positie/Type Toestel Tapwater/etc., the same shape of problem Objecten's
// Woning defaults already had), and being Edit-safe (EDIT_TABLES) says
// nothing about Delete-safety either. Delete itself is confirmed clean on
// all five: real Add+Delete round-trips on throwaway rows for Verdiepingen/
// Daken/Vloeren, and — since Gevels/Installaties' Add landmines made a
// throwaway row impractical without risking a botched restore of a real
// row's photo-attachment columns — a Delete-of-a-nonexistent-key call
// confirmed the same graceful, uniform no-op response AppSheet's generic
// Delete action gives on every other table tested, rather than a table-
// specific code path that could behave differently.
// Transparante_Delen Delete confirmed live clean (real Add+Delete
// round-trip on a throwaway row, same as Verdiepingen/Daken/Vloeren) —
// added so a deleted parent Gevel/Dak/Vloer's openings can be cascade-
// deleted instead of left orphaned (see AppsheetElementEditPanel.tsx).
const DELETE_TABLES = new Set([
  'Objecten', 'Inspecteurs', 'Bedrijven',
  'Verdiepingen', 'Gevels', 'Daken', 'Vloeren', 'Installaties', 'Transparante_Delen',
]);

async function requireAdmin(req: NextRequest) {
  const { user, supabase } = await getAuthFromRequest(req);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const profileResult = await (supabase.from('user_profiles') as any)
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: string } | null };

  if (profileResult.data?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { error: null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { table: string } }
) {
  const table = params.table;
  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: `Unknown or unvetted AppSheet table "${table}"` }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  if (body?.action === 'add') {
    if (!WRITE_TABLES.has(table)) {
      return NextResponse.json({ error: `Writes not enabled for AppSheet table "${table}"` }, { status: 404 });
    }
    const { error } = await requireAdmin(req);
    if (error) return error;

    const rows = Array.isArray(body.rows) ? body.rows : [];
    try {
      const result = await appsheetAction(table, 'Add', rows);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof AppSheetConfigError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (body?.action === 'edit') {
    const editSpec = EDIT_TABLES[table];
    if (!editSpec) {
      return NextResponse.json({ error: `Edits not enabled for AppSheet table "${table}"` }, { status: 404 });
    }
    const { error } = await requireAdmin(req);
    if (error) return error;

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows to edit' }, { status: 400 });
    }
    // Only the key column + whitelisted fields survive — same
    // defense-in-depth as the Scanergy zone/element PATCH routes.
    const allowed = new Set([editSpec.key, ...editSpec.fields]);
    const sanitizedRows = rows.map((row: Record<string, unknown>) => {
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        if (allowed.has(key)) clean[key] = row[key];
      }
      return clean;
    });
    if (sanitizedRows.some((r: Record<string, unknown>) => !(editSpec.key in r))) {
      return NextResponse.json({ error: `Every row must include "${editSpec.key}"` }, { status: 400 });
    }

    try {
      const result = await appsheetAction(table, 'Edit', sanitizedRows);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof AppSheetConfigError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const { user } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const selector: string | undefined = typeof body?.selector === 'string' ? body.selector : undefined;

  try {
    const result = await appsheetFind(table, selector);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// "Delete session" for AppSheet-sourced sessions doesn't delete the
// Objecten row (a session there IS the building row — deleting it would be
// the much bigger action the buildings page's DELETE already covers).
// Instead it resets Status back to "Nieuw", matching ScanergyV2's own
// session delete (a SOFT delete — is_active=false, building untouched).
// Confirmed live: Opname Datum is a required Date column and can't be
// blanked, so Status is the only field this narrow endpoint touches —
// intentionally not a generic field-patch endpoint, to keep this from
// becoming an arbitrary-write backdoor into production Objecten data.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { table: string } }
) {
  const table = params.table;
  // Deliberately Objecten-only, not WRITE_TABLES — this endpoint's
  // Status-reset semantics don't apply to Inspecteurs (no Status/Object ID
  // columns there at all).
  if (table !== 'Objecten') {
    return NextResponse.json({ error: `Writes not enabled for AppSheet table "${table}"` }, { status: 404 });
  }
  const { error } = await requireAdmin(req);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const objectId: string | undefined = typeof body?.objectId === 'string' ? body.objectId : undefined;
  if (!objectId) {
    return NextResponse.json({ error: 'objectId is required' }, { status: 400 });
  }

  try {
    const result = await appsheetAction(table, 'Edit', [{ 'Object ID': objectId, Status: 'Nieuw' }]);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { table: string } }
) {
  const table = params.table;
  if (!DELETE_TABLES.has(table)) {
    return NextResponse.json({ error: `Deletes not enabled for AppSheet table "${table}"` }, { status: 404 });
  }
  const { error } = await requireAdmin(req);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ error: 'No rows to delete' }, { status: 400 });
  }

  try {
    const result = await appsheetAction(table, 'Delete', rows);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
