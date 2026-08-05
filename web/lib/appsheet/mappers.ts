// Pure AppSheet-row -> ScanergyV2-type mapping functions, confirmed against
// live Bedrijven/Objecten/BAG Data/Contactpersoon responses. No fetch
// dependency here so both the client-side services (lib/services/appsheet/*,
// which call the /api/appsheet/[table] proxy over HTTP) and server
// components (buildings/organizations pages, which call appsheetFind()
// directly) can share the same mapping logic.

import type { Organisation, Building, Contact, ContactRole, UserProfile, Role } from '@/lib/types';

export function escapeForSelector(value: string) {
  return value.replace(/"/g, '\\"');
}

// ── Bedrijven -> Organisation ──────────────────────────────────────────
export function mapBedrijvenRow(row: Record<string, unknown>): Organisation {
  return {
    id: String(row['Bedrijf ID'] ?? ''),
    name: String(row['Bedrijfsnaam'] ?? ''),
    address: null,
    city: null,
    postal_code: null,
    latitude: null,
    longitude: null,
    settings: {},
  };
}

// ── Objecten (+ BAG Data) -> Building ──────────────────────────────────
// No direct street/city columns exist — only a combined `Adres` string
// ("Straat Nr, Postcode  Stad") plus separate Huisnummer/Postcode. This
// splits it heuristically using the known house number as an anchor; it's
// a best-effort parse of observed AppSheet data, not a guaranteed-correct
// address parser.
export function parseAdres(adres: string, huisnummer: string, huisletter: string, huistoevoeging: string) {
  const [addrPart, cityPart] = String(adres ?? '').split(',').map((s) => s.trim());
  const numberSuffix = `${huisnummer ?? ''}${huisletter ?? ''}${huistoevoeging ?? ''}`.trim();

  let street = addrPart ?? '';
  if (numberSuffix && street.endsWith(numberSuffix)) {
    street = street.slice(0, street.length - numberSuffix.length).trim();
  }

  const city = (cityPart ?? '').replace(/^\d{4}\s?[A-Za-z]{2}\s+/, '').trim();
  return { street, city };
}

// Objecten has no construction_year/gross_floor_area_m2 columns; both only
// exist via BAG Data (joined on Object ID), which per
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §1 is populated for only ~5 of
// 774 rows. Rows with no BAG Data match get 0 as an explicit placeholder
// (decided with the user over relaxing the shared Building type).
export function mapObjectenRow(row: Record<string, unknown>, bagRow: Record<string, unknown> | undefined): Building {
  const { street, city } = parseAdres(
    String(row['Adres'] ?? ''),
    String(row['Huisnummer'] ?? ''),
    String(row['Huisletter'] ?? ''),
    String(row['Huistoevoeging'] ?? '')
  );

  const bagBouwjaar = bagRow?.['BAG Bouwjaar'] ? Number(bagRow['BAG Bouwjaar']) : null;
  const bagOppervlakte = bagRow?.['BAG Oppervlakte'] ? Number(bagRow['BAG Oppervlakte']) : null;
  const dbagHoogte = bagRow?.['Hoogte'] ? Number(bagRow['Hoogte']) : null;

  return {
    id: String(row['Object ID'] ?? ''),
    org_id: String(row['Bedrijfs ID'] ?? ''),
    reference_code: String(row['Object ID'] ?? ''),
    street,
    house_number: `${row['Huisnummer'] ?? ''}${row['Huisletter'] ?? ''}${row['Huistoevoeging'] ?? ''}`,
    postal_code: String(row['Postcode'] ?? ''),
    city,
    building_type: String(row['Objecttype'] ?? ''),
    construction_year: bagBouwjaar ?? 0,
    gross_floor_area_m2: bagOppervlakte ?? 0,
    latitude: null,
    longitude: null,
    bag_pand_id: bagRow?.['BAG Pand ID'] ? String(bagRow['BAG Pand ID']) : null,
    bag_vbo_id: bagRow?.['BAG Verblijfsobject ID'] ? String(bagRow['BAG Verblijfsobject ID']) : null,
    bag_bouwjaar: bagBouwjaar,
    bag_oppervlakte_m2: bagOppervlakte,
    bag_gebruiksdoel: bagRow?.['BAG Gebruiksdoel'] ? String(bagRow['BAG Gebruiksdoel']) : null,
    dbag_hoogte_m: dbagHoogte,
    bag_fetched_at: null,
  };
}

// ── Contactpersoon -> Contact ──────────────────────────────────────────
const ROLE_MAP: Record<string, ContactRole> = {
  Eigenaar: 'eigenaar',
  Huurder: 'huurder',
  Beheerder: 'beheerder',
  Opdrachtgever: 'opdrachtgever',
};

export function mapContactpersoonRow(row: Record<string, unknown>): Contact {
  const rol = String(row['Rol'] ?? '').trim();
  const telefoon = row['Telefoon'];
  const notities = String(row['Notities'] ?? '').trim();

  return {
    id: String(row['Contactpersoon ID'] ?? ''),
    org_id: '',
    building_id: null,
    legacy_id: String(row['Contactpersoon ID'] ?? ''),
    full_name: String(row['Naam'] ?? ''),
    // Telefoon is mixed string/float/"(blank)" in the source (see
    // CONTACTPERSOON_DATA_ANALYSIS.md §3) — normalize to text or null here
    // rather than carrying "(blank)" through as a literal phone value.
    phone: telefoon == null || telefoon === '' || telefoon === '(blank)' ? null : String(telefoon),
    email: row['Email'] ? String(row['Email']) : null,
    role: ROLE_MAP[rol] ?? null,
    // The source tags 10 rows with the literal lineage marker
    // "Import from Shopify" instead of real user notes — don't surface it.
    notes: notities && notities !== 'Import from Shopify' ? notities : null,
    created_at: '',
    updated_at: '',
  };
}

// ── Inspecteurs -> UserProfile ─────────────────────────────────────────
// Per docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §1: "Inspecteurs (5) ->
// user_profiles (role=inspector), ScanergyV2 folds all roles into one table
// + enum" — but Inspecteurs itself carries a `Rol` column with two observed
// values (confirmed live: "Inspecteur", "Beheerder"), not a flat inspector
// role. "Beheerder" (manager) is mapped to 'supervisor' as the closest
// analog; there is no AppSheet-side equivalent of ScanergyV2's 'admin' or
// 'service_role' at all, so the AppSheet-mode user list is always a subset
// of what ScanergyV2 shows — a real difference between the two
// independently-maintained datasets, not a bug.
const INSPECTEUR_ROLE_MAP: Record<string, Role> = {
  Inspecteur: 'inspector',
  Beheerder: 'supervisor',
};

export function mapInspecteurRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row['Inspecteur ID'] ?? ''),
    org_id: String(row['Bedrijf ID'] ?? ''),
    role: INSPECTEUR_ROLE_MAP[String(row['Rol'] ?? '').trim()] ?? 'inspector',
    full_name: String(row['Inspecteur Naam'] ?? ''),
    is_active: String(row['Actief'] ?? '').trim().toUpperCase() === 'Y',
  };
}
