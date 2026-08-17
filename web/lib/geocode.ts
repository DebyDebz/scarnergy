// Keyless PDOK Locatieserver lookup (GAP W3 map). Extracted out of
// app/api/buildings/[id]/geocode/route.ts so the AppSheet-sourced building
// detail page can resolve the same address -> coordinates without a
// Supabase buildings row to persist into.

const PDOK_FREE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';

export async function geocodeAddress(
  street: string,
  houseNumber: string,
  houseNumberAddition: string | null,
  postalCode: string,
  city: string
): Promise<{ lat: number; lon: number } | null> {
  const q = `${street} ${houseNumber}${houseNumberAddition ?? ''}, ${postalCode} ${city}`;
  const qs = new URLSearchParams({ q, fq: 'type:adres', rows: '1', fl: 'id,weergavenaam,centroide_ll' });
  const res = await fetch(`${PDOK_FREE}?${qs}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`PDOK ${res.status}`);
  const json = await res.json();
  // centroide_ll is WKT: "POINT(5.38763889 52.15517440)" — lon lat order.
  const wkt: string | undefined = json?.response?.docs?.[0]?.centroide_ll;
  const m = wkt?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}
