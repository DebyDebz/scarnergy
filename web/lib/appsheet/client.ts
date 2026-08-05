// Server-only AppSheet Enterprise API client. Never import this from a
// client component — the ApplicationAccessKey must never reach the browser
// (that's exactly how the old Bosch-GLM50C-Rangefinder prototype leaked its
// key). Route all calls through web/app/api/appsheet/[table]/route.ts.

const BASE_URL = 'https://api.appsheet.com/api/v2/apps';

export class AppSheetConfigError extends Error {
  constructor(missing: string) {
    super(`AppSheet API not configured: ${missing} is not set in web/.env.local.`);
    this.name = 'AppSheetConfigError';
  }
}

function requireConfig() {
  const appId = process.env.APPSHEET_APP_ID;
  const accessKey = process.env.APPSHEET_ACCESS_KEY;
  if (!appId) throw new AppSheetConfigError('APPSHEET_APP_ID');
  if (!accessKey) throw new AppSheetConfigError('APPSHEET_ACCESS_KEY');
  return { appId, accessKey };
}

// Bulk read via Find + Selector (FILTER/ORDERBY/SELECT/TOP) — never a
// per-row fan-out, per docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §4.
export async function appsheetFind(table: string, selector?: string) {
  const { appId, accessKey } = requireConfig();

  const res = await fetch(`${BASE_URL}/${appId}/tables/${encodeURIComponent(table)}/Action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApplicationAccessKey: accessKey,
    },
    body: JSON.stringify({
      Action: 'Find',
      Properties: {
        Locale: 'en-US',
        ...(selector ? { Selector: selector } : {}),
      },
      Rows: [],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AppSheet Find on "${table}" failed: ${res.status} ${res.statusText} ${body}`);
  }

  return res.json();
}
