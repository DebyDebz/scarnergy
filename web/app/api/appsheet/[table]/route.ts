import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
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
const ALLOWED_TABLES = new Set(['Bedrijven', 'Objecten', 'Contactpersoon', 'BAG Data']);

// Write access (Add/Delete) is scoped tighter than read — only these two
// tables, and only for admins, mirroring the existing /api/buildings write
// routes. Confirmed live: Add on Objecten auto-generates the key column and
// can trigger a live address-validation automation (see
// lib/appsheet/client.ts) — this is a real write to production AppSheet
// data, not a local mock. Inspecteurs has no such quirks — Add/Delete both
// confirmed clean on a throwaway row.
const WRITE_TABLES = new Set(['Objecten', 'Inspecteurs']);

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
    const { error } = await requireAdmin();
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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  const { error } = await requireAdmin();
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
  if (!WRITE_TABLES.has(table)) {
    return NextResponse.json({ error: `Writes not enabled for AppSheet table "${table}"` }, { status: 404 });
  }
  const { error } = await requireAdmin();
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
