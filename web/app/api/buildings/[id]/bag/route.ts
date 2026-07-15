import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  BAG_API_BASE, DBAG_API_BASE,
  mapBagAdressen, extract3dbagHeight, buildBagUpdate, normalizePostcode,
} from '@/lib/bag';

// POST /api/buildings/[id]/bag — fetch BAG + 3DBAG data for the building's
// address and cache it on the buildings row (migration 026 columns).
// Manual-button-only + 30-day cache keeps Kadaster usage near zero; the
// panel itself only reads DB columns, so it renders fine with the API down.
//
// Keyless fallback if BAG_API_KEY provisioning ever stalls: PDOK
// Locatieserver resolves address → BAG ids but not oppervlakte/gebruiksdoel,
// so it cannot replace the Kadaster API — degrade to 503 instead.

const CACHE_DAYS = 30;
const FETCH_TIMEOUT_MS = 5000;

const BAG_FIELDS =
  'id, postal_code, house_number, house_number_addition, ' +
  'bag_pand_id, bag_vbo_id, bag_bouwjaar, bag_oppervlakte_m2, bag_gebruiksdoel, dbag_hoogte_m, bag_fetched_at';

type CachedRow = {
  id: string;
  postal_code: string;
  house_number: string;
  house_number_addition: string | null;
  bag_pand_id: string | null;
  bag_vbo_id: string | null;
  bag_bouwjaar: number | null;
  bag_oppervlakte_m2: number | null;
  bag_gebruiksdoel: string | null;
  dbag_hoogte_m: number | null;
  bag_fetched_at: string | null;
};

const dataOf = (b: CachedRow) => ({
  bag_pand_id: b.bag_pand_id,
  bag_vbo_id: b.bag_vbo_id,
  bag_bouwjaar: b.bag_bouwjaar,
  bag_oppervlakte_m2: b.bag_oppervlakte_m2,
  bag_gebruiksdoel: b.bag_gebruiksdoel,
  dbag_hoogte_m: b.dbag_hoogte_m,
  bag_fetched_at: b.bag_fetched_at,
});

async function bagLookup(apiKey: string, postcode: string, huisnummer: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ postcode, huisnummer, exacteMatch: 'true', ...params });
  const res = await fetch(`${BAG_API_BASE}/adressenuitgebreid?${qs}`, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/hal+json', 'Accept-Crs': 'epsg:28992' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 404 = address not found in BAG; every other non-OK status is an outage.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BAG API ${res.status}`);
  return mapBagAdressen(await res.json());
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS-scoped read: any org member may refresh (writes only registry data).
  const buildingRes = await (supabase.from('buildings') as any)
    .select(BAG_FIELDS)
    .eq('id', params.id)
    .single() as unknown as { data: CachedRow | null };
  const building = buildingRes.data;
  if (!building) return NextResponse.json({ error: 'Building not found' }, { status: 404 });

  const force = Boolean(await req.json().then(b => b?.force).catch(() => false));
  if (!force && building.bag_fetched_at) {
    const ageMs = Date.now() - new Date(building.bag_fetched_at).getTime();
    if (ageMs < CACHE_DAYS * 24 * 3600 * 1000) {
      return NextResponse.json({ cached: true, data: dataOf(building) });
    }
  }

  const apiKey = process.env.BAG_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'bag_not_configured' }, { status: 503 });

  // BAG lookup with a retry ladder for the huisletter-vs-toevoeging ambiguity.
  const postcode = normalizePostcode(building.postal_code);
  const huisnummer = String(building.house_number).trim();
  const addition = building.house_number_addition?.trim();
  const warnings: string[] = [];

  let bagData;
  try {
    if (addition) {
      bagData = await bagLookup(apiKey, postcode, huisnummer, { huisnummertoevoeging: addition });
      if (!bagData) bagData = await bagLookup(apiKey, postcode, huisnummer, { huisletter: addition });
      if (!bagData) {
        bagData = await bagLookup(apiKey, postcode, huisnummer, {});
        if (bagData) warnings.push('toevoeging_genegeerd');
      }
    } else {
      bagData = await bagLookup(apiKey, postcode, huisnummer, {});
    }
  } catch {
    return NextResponse.json({ error: 'bag_unavailable' }, { status: 502 });
  }
  if (!bagData) return NextResponse.json({ error: 'address_not_found' }, { status: 422 });
  warnings.push(...bagData.warnings);

  // 3DBAG height — non-fatal: a miss caches the BAG data with hoogte NULL.
  let hoogte: number | null = null;
  if (bagData.bag_pand_id) {
    try {
      const res = await fetch(`${DBAG_API_BASE}/NL.IMBAG.Pand.${bagData.bag_pand_id}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) hoogte = extract3dbagHeight(await res.json(), bagData.bag_pand_id);
      else warnings.push('3dbag_unavailable');
    } catch {
      warnings.push('3dbag_unavailable');
    }
  }

  const update = buildBagUpdate(bagData, hoogte);
  const { error } = await (supabase.from('buildings') as any).update(update).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    cached: false,
    data: update,
    ...(warnings.length ? { warnings } : {}),
  });
}
