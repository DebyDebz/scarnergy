/**
 * BAG / 3DBAG response mapping — pure functions, no Next.js/DOM imports so
 * the root jest suite (__tests__/bagMapping.test.ts) can exercise them.
 *
 * Sources:
 *  - Kadaster "BAG API Individuele Bevragingen v2" /adressenuitgebreid
 *    (requires X-Api-Key; free self-service provisioning at Kadaster).
 *  - 3DBAG open API (no key): building height attributes per pand.
 *
 * Values are cached RAW on the buildings row (migration 026) — no year-class
 * derivation or gebruiksdoel translation here; calc validations V-01/02/03
 * interpret them later.
 */

export const BAG_API_BASE  = 'https://api.bag.kadaster.nl/lvbag/individuelebevragingen/v2';
export const DBAG_API_BASE = 'https://api.3dbag.nl/collections/pand/items';

export interface BagAddressData {
  bag_pand_id: string | null;
  bag_vbo_id: string | null;
  bag_bouwjaar: number | null;
  bag_oppervlakte_m2: number | null;
  bag_gebruiksdoel: string | null;
  warnings: string[];
}

/** '3818 le' → '3818LE' (BAG expects the compact uppercase form). */
export function normalizePostcode(pc: string): string {
  return pc.replace(/\s+/g, '').toUpperCase();
}

/**
 * Map a /adressenuitgebreid HAL response to the cached fields.
 * Returns null when the address resolved to no adressen (address_not_found).
 * Takes the first adres/pand and surfaces multiplicity as warnings.
 */
export function mapBagAdressen(json: unknown): BagAddressData | null {
  const adressen = (json as any)?._embedded?.adressen;
  if (!Array.isArray(adressen) || adressen.length === 0) return null;

  const warnings: string[] = [];
  if (adressen.length > 1) warnings.push('meerdere_verblijfsobjecten');

  const a = adressen[0];
  const panden = Array.isArray(a?.pandIdentificaties) ? a.pandIdentificaties : [];
  if (panden.length > 1) warnings.push('meerdere_panden');

  const bouwjaarRaw = Array.isArray(a?.oorspronkelijkBouwjaar) ? a.oorspronkelijkBouwjaar[0] : a?.oorspronkelijkBouwjaar;
  const gebruiksdoelen = Array.isArray(a?.gebruiksdoelen) ? a.gebruiksdoelen.filter((g: unknown) => typeof g === 'string') : [];

  return {
    bag_pand_id: typeof panden[0] === 'string' ? panden[0] : null,
    bag_vbo_id: typeof a?.adresseerbaarObjectIdentificatie === 'string' ? a.adresseerbaarObjectIdentificatie : null,
    bag_bouwjaar: toPositiveNumber(bouwjaarRaw),
    bag_oppervlakte_m2: toPositiveNumber(a?.oppervlakte),
    bag_gebruiksdoel: gebruiksdoelen.length ? gebruiksdoelen.join(', ') : null,
    warnings,
  };
}

// Number(null) and Number('') are 0, which would cache bogus zeros and — for
// bouwjaar — violate migration 026's CHECK (BETWEEN 1000 AND 2100); neither
// value is ever legitimately 0 in BAG data.
function toPositiveNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Building height from a 3DBAG pand feature: b3_h_dak_70p (70th-percentile
 * roof height) minus b3_h_maaiveld (ground level), both in m NAP. Either can
 * be null in real 3DBAG data → null.
 */
export function extract3dbagHeight(json: unknown, pandId: string): number | null {
  const attrs = (json as any)?.feature?.CityObjects?.[`NL.IMBAG.Pand.${pandId}`]?.attributes;
  const dak = attrs?.b3_h_dak_70p;
  const maaiveld = attrs?.b3_h_maaiveld;
  if (typeof dak !== 'number' || typeof maaiveld !== 'number' || !Number.isFinite(dak) || !Number.isFinite(maaiveld)) {
    return null;
  }
  return Math.round((dak - maaiveld) * 100) / 100;
}

/** The whitelisted buildings-row update — exactly the 026 cache columns. */
export function buildBagUpdate(a: BagAddressData, hoogte: number | null) {
  return {
    bag_pand_id: a.bag_pand_id,
    bag_vbo_id: a.bag_vbo_id,
    bag_bouwjaar: a.bag_bouwjaar,
    bag_oppervlakte_m2: a.bag_oppervlakte_m2,
    bag_gebruiksdoel: a.bag_gebruiksdoel,
    dbag_hoogte_m: hoogte,
    bag_fetched_at: new Date().toISOString(),
  };
}
