import { cookies } from 'next/headers';
import type { DataSource } from './DataSourceContext';

// Server-component counterpart to useDataSource(). The client-side
// DataSourceProvider mirrors its state into a `scanergy:data-source` cookie
// (see DataSourceContext.tsx) specifically so pages that still fetch
// server-side (buildings/organizations lists, building detail) can branch
// on the active source without a client round-trip.
const COOKIE_NAME = 'scanergy:data-source';

export async function getServerDataSource(): Promise<DataSource> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === 'appsheet' ? 'appsheet' : 'scanergy';
}
