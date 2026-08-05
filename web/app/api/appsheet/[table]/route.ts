import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';

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

export async function POST(
  req: NextRequest,
  { params }: { params: { table: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const table = params.table;
  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: `Unknown or unvetted AppSheet table "${table}"` }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
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
