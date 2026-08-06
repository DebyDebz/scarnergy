// Pure AppSheet-row -> ScanergyV2-type mapping functions, confirmed against
// live Bedrijven/Objecten/BAG Data/Contactpersoon responses. No fetch
// dependency here so both the client-side services (lib/services/appsheet/*,
// which call the /api/appsheet/[table] proxy over HTTP) and server
// components (buildings/organizations pages, which call appsheetFind()
// directly) can share the same mapping logic.

import type { Organisation, Building, Contact, ContactRole, UserProfile, Role, SessionSummary } from '@/lib/types';

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

// ── New Objecten row payload (for Add) ─────────────────────────────────
// Confirmed live (see conversation notes): Objecttype is a constrained
// enum, and several "virtual"/formula columns (Gebouwtype, Subtype,
// Subtype_ID, Daktype_ligging, Daktype_ID) compute an invalid default when
// left unset for a "Woning" row — Add fails with a validation error citing
// Subtype unless real values are supplied. The combo below is copied
// verbatim from a real live Woning row's values, not invented.
// "Utiliteit" rows observed in the wild have all five of these blank, so
// they're omitted for that type — this is inferred from one example row,
// not verified with a live Add test the way Woning was; treat Utiliteit
// creation as lower-confidence until it's been tested the same way.
//
// Object ID is deliberately NOT included — AppSheet auto-generates it.
// Adres is composed to match the exact format seen on real rows
// ("Straat Nr, Postcode  Stad", double space before the city) because a
// live automation re-validates/rewrites this field against a real
// address lookup and will overwrite anything it can't resolve.
export interface NewBuildingInput {
  objecttype: 'Woning' | 'Utiliteit';
  street: string;
  houseNumber: string;
  houseLetter?: string;
  houseAddition?: string;
  postalCode: string;
  city: string;
  bedrijfsId: string;
}

const WONING_VIRTUAL_DEFAULTS = {
  Gebouwtype: '0',
  Subtype: 'Woning-2',
  Subtype_ID: '2',
  Daktype_ligging: 'Daktype-1',
  Daktype_ID: '1',
};

export function buildNewObjectenRow(input: NewBuildingInput): Record<string, unknown> {
  const houseSuffix = `${input.houseNumber}${input.houseLetter ?? ''}${input.houseAddition ?? ''}`;
  return {
    Objecttype: input.objecttype,
    // No separate "Straat" column exists — Adres carries the full string.
    Adres: `${input.street} ${houseSuffix}, ${input.postalCode}  ${input.city}`,
    Postcode: input.postalCode,
    Huisnummer: input.houseNumber,
    Huisletter: input.houseLetter ?? '',
    Huistoevoeging: input.houseAddition ?? '',
    'Bedrijfs ID': input.bedrijfsId,
    Status: 'Nieuw',
    ...(input.objecttype === 'Woning' ? WONING_VIRTUAL_DEFAULTS : {}),
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

// ── New Inspecteurs row payload (for Add) ──────────────────────────────
// Confirmed live: Add/Delete on Inspecteurs are both clean — no virtual-
// column validation, no address-lookup automation, unlike Objecten.
// Inspecteur ID is auto-generated; don't supply one.
export interface NewInspecteurInput {
  naam: string;
  email: string;
  rol: 'Inspecteur' | 'Beheerder';
  bedrijfId: string;
}

export function buildNewInspecteurRow(input: NewInspecteurInput): Record<string, unknown> {
  return {
    'Inspecteur Naam': input.naam,
    'Inspecteur Email': input.email,
    'Bedrijf ID': input.bedrijfId,
    Actief: 'Y',
    Rol: input.rol,
  };
}

// ── Objecten -> pseudo-SessionSummary ───────────────────────────────────
// AppSheet has no repeatable-session concept — each Objecten row carries
// exactly one Opname Datum/Tijd/Duur/Status (see
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §2). Per the user's explicit
// decision, the sessions page treats each Objecten row as one
// pseudo-session so All/Active/Completed/Paused/Cancelled + search + delete
// can exist there — but this is a real building row, not a session record,
// which is why "delete" (see /api/appsheet/[table] PATCH) resets Status
// rather than removing anything.
//
// Status mapping is best-effort: only "Nieuw" and "Besteld" have been
// observed live. Neither maps cleanly to ScanergyV2's four statuses, and no
// AppSheet value corresponding to completed/paused/cancelled has been seen
// at all — until one is, those three tabs will legitimately show empty in
// AppSheet mode rather than guess.
const OBJECTEN_STATUS_MAP: Record<string, SessionSummary['status']> = {
  Nieuw: 'active',
  Besteld: 'active',
};

export function mapObjectenToSessionSummary(
  row: Record<string, unknown>,
  inspecteurNameById: Map<string, string>
): SessionSummary {
  const objectId = String(row['Object ID'] ?? '');
  const inspecteurId = String(row['Inspecteur'] ?? '');
  const { street, city } = parseAdres(
    String(row['Adres'] ?? ''),
    String(row['Huisnummer'] ?? ''),
    String(row['Huisletter'] ?? ''),
    String(row['Huistoevoeging'] ?? '')
  );
  const opnameDatum = String(row['Opname Datum'] ?? '');
  const opnameTijd = String(row['Opname Tijd'] ?? '');
  const startedAt = opnameDatum ? `${opnameDatum} ${opnameTijd}`.trim() : '';

  return {
    id: objectId,
    org_id: String(row['Bedrijfs ID'] ?? ''),
    building_id: objectId,
    inspector_id: inspecteurId,
    session_code: `OBJ-${objectId}`,
    status: OBJECTEN_STATUS_MAP[String(row['Status'] ?? '').trim()] ?? 'active',
    started_at: startedAt,
    completed_at: null,
    total_measurements: 0,
    anomaly_count: 0,
    sync_status: 'n/a',
    is_active: true,
    inspector_name: inspecteurNameById.get(inspecteurId) ?? 'Unknown',
    building_address: `${street} ${row['Huisnummer'] ?? ''}${row['Huisletter'] ?? ''}${row['Huistoevoeging'] ?? ''}`.trim(),
    building_city: city,
  };
}
