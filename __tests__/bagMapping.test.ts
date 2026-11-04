/**
 * BAG / 3DBAG response mapping (GAP W3) — fixture-driven, no live API calls.
 * Fixtures are trimmed real response shapes: BAG IB v2 /adressenuitgebreid
 * (HAL) and a 3DBAG pand feature (height attribute values captured from the
 * live API on 2026-07-15).
 */

import {
  normalizePostcode,
  mapBagAdressen,
  extract3dbagHeight,
  buildBagUpdate,
} from '../web/lib/bag';

const adres = (over: Record<string, unknown> = {}) => ({
  nummeraanduidingIdentificatie: '0307200000469798',
  postcode: '3818LE',
  huisnummer: 1,
  adresseerbaarObjectIdentificatie: '0307010000335988',
  pandIdentificaties: ['0307100000342441'],
  oorspronkelijkBouwjaar: ['1889'],
  oppervlakte: 168,
  gebruiksdoelen: ['woonfunctie'],
  ...over,
});

const halResponse = (adressen: unknown[]) => ({ _embedded: { adressen } });

const dbagFeature = (attrs: Record<string, unknown>, pandId = '0307100000342441') => ({
  feature: {
    CityObjects: {
      [`NL.IMBAG.Pand.${pandId}`]: { attributes: attrs },
    },
  },
});

describe('normalizePostcode', () => {
  it('strips spaces and uppercases', () => {
    expect(normalizePostcode('3818 le')).toBe('3818LE');
    expect(normalizePostcode('1016ZZ')).toBe('1016ZZ');
  });
});

describe('mapBagAdressen', () => {
  it('maps the happy path', () => {
    const out = mapBagAdressen(halResponse([adres()]));
    expect(out).toEqual({
      bag_pand_id: '0307100000342441',
      bag_vbo_id: '0307010000335988',
      bag_bouwjaar: 1889,
      bag_oppervlakte_m2: 168,
      bag_gebruiksdoel: 'woonfunctie',
      warnings: [],
    });
  });

  it('returns null when no adressen resolve (address_not_found)', () => {
    expect(mapBagAdressen(halResponse([]))).toBeNull();
    expect(mapBagAdressen({})).toBeNull();
    expect(mapBagAdressen(undefined)).toBeNull();
  });

  it('warns on multiple verblijfsobjecten and takes the first', () => {
    const out = mapBagAdressen(halResponse([adres(), adres({ oppervlakte: 80 })]))!;
    expect(out.warnings).toContain('meerdere_verblijfsobjecten');
    expect(out.bag_oppervlakte_m2).toBe(168);
  });

  it('warns on multiple panden and takes the first', () => {
    const out = mapBagAdressen(halResponse([adres({ pandIdentificaties: ['p1', 'p2'] })]))!;
    expect(out.warnings).toContain('meerdere_panden');
    expect(out.bag_pand_id).toBe('p1');
  });

  it('joins multiple gebruiksdoelen', () => {
    const out = mapBagAdressen(halResponse([adres({ gebruiksdoelen: ['woonfunctie', 'kantoorfunctie'] })]))!;
    expect(out.bag_gebruiksdoel).toBe('woonfunctie, kantoorfunctie');
  });

  it('maps null/empty/zero numerics to null instead of 0 (0 would violate the bouwjaar CHECK)', () => {
    const out = mapBagAdressen(halResponse([adres({
      oorspronkelijkBouwjaar: [null],
      oppervlakte: 0,
    })]))!;
    expect(out.bag_bouwjaar).toBeNull();
    expect(out.bag_oppervlakte_m2).toBeNull();

    const out2 = mapBagAdressen(halResponse([adres({ oorspronkelijkBouwjaar: [''] })]))!;
    expect(out2.bag_bouwjaar).toBeNull();
  });

  it('null-safes missing fields', () => {
    const out = mapBagAdressen(halResponse([adres({
      oppervlakte: undefined,
      gebruiksdoelen: undefined,
      oorspronkelijkBouwjaar: undefined,
      pandIdentificaties: undefined,
      adresseerbaarObjectIdentificatie: undefined,
    })]))!;
    expect(out).toEqual({
      bag_pand_id: null,
      bag_vbo_id: null,
      bag_bouwjaar: null,
      bag_oppervlakte_m2: null,
      bag_gebruiksdoel: null,
      warnings: [],
    });
  });
});

describe('extract3dbagHeight', () => {
  it('computes dak_70p minus maaiveld, rounded to cm (live-captured values)', () => {
    const json = dbagFeature({ b3_h_dak_70p: 25.474000930786133, b3_h_maaiveld: 2.5309998989105225 });
    expect(extract3dbagHeight(json, '0307100000342441')).toBe(22.94);
  });

  it('returns null when either attribute is null/missing', () => {
    expect(extract3dbagHeight(dbagFeature({ b3_h_dak_70p: null, b3_h_maaiveld: 2.5 }), '0307100000342441')).toBeNull();
    expect(extract3dbagHeight(dbagFeature({ b3_h_maaiveld: 2.5 }), '0307100000342441')).toBeNull();
    expect(extract3dbagHeight({}, '0307100000342441')).toBeNull();
  });

  it('returns null when the pand key does not match', () => {
    const json = dbagFeature({ b3_h_dak_70p: 25.47, b3_h_maaiveld: 2.53 }, 'ANDER_PAND');
    expect(extract3dbagHeight(json, '0307100000342441')).toBeNull();
  });
});

describe('buildBagUpdate', () => {
  it('emits exactly the migration-026 cache columns', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T10:00:00.000Z'));
    const data = mapBagAdressen(halResponse([adres()]))!;
    const update = buildBagUpdate(data, 22.94);
    jest.useRealTimers();

    expect(update).toEqual({
      bag_pand_id: '0307100000342441',
      bag_vbo_id: '0307010000335988',
      bag_bouwjaar: 1889,
      bag_oppervlakte_m2: 168,
      bag_gebruiksdoel: 'woonfunctie',
      dbag_hoogte_m: 22.94,
      bag_fetched_at: '2026-07-15T10:00:00.000Z',
    });
    // whitelist guard: nothing beyond the 7 cache columns may ever be written
    expect(Object.keys(update).sort()).toEqual([
      'bag_bouwjaar', 'bag_fetched_at', 'bag_gebruiksdoel', 'bag_oppervlakte_m2',
      'bag_pand_id', 'bag_vbo_id', 'dbag_hoogte_m',
    ]);
  });
});
