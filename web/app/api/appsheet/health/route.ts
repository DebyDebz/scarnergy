import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';

// Live connectivity check for the AppSheet source-indicator pill
// (DataSourceToggle.tsx). A cheap single-row Find against Bedrijven (the
// smallest confirmed table) — enough to prove the ApplicationAccessKey and
// App ID actually work against the real account, not just that the toggle
// was flipped in the UI.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await appsheetFind('Bedrijven', 'TOP(FILTER(Bedrijven, TRUE()), 1)');
    if (!Array.isArray(result) || result.length === 0) {
      return NextResponse.json({ ok: false, error: 'AppSheet returned no rows for Bedrijven' }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
