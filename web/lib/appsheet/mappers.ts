// Pure AppSheet-row -> ScanergyV2-type mapping functions, confirmed against
// live Bedrijven/Objecten/BAG Data/Contactpersoon responses. No fetch
// dependency here so both the client-side services (lib/services/appsheet/*,
// which call the /api/appsheet/[table] proxy over HTTP) and server
// components (buildings/organizations pages, which call appsheetFind()
// directly) can share the same mapping logic.

import type {
  Organisation, Building, Contact, ContactRole, UserProfile, Role, SessionSummary,
  Zone, Rekenzone, BuildingElement, Opening,
} from '@/lib/types';

export function escapeForSelector(value: string) {
  return value.replace(/"/g, '\\"');
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// AppSheet stores linear dimensions in meters; ScanergyV2 in millimeters.
function mToMm(v: number | null): number | null {
  return v != null ? Math.round(v * 1000) : null;
}

function isBlank(v: unknown): boolean {
  return String(v ?? '').trim() === '';
}

// A comma-joined AppSheet "Related X" ref list ("id1 , id2 , id3") -> first id.
function firstRelatedId(v: unknown): string {
  return String(v ?? '').split(',')[0]?.trim() ?? '';
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
// AppSheet's own live automation on Objecten rewrites Adres to this literal
// Dutch error string ("Postcode Huisnummer niet gevonden, pas regel aan...")
// when it can't resolve a postcode+house number to a real address — it's
// not a street name, and parsing it with parseAdres() below produces
// garbage that looks like a real (if odd) address rather than an obvious
// error. Callers that display a building's address as a title/label should
// check this first rather than trust parseAdres()'s output blindly.
export function isUnresolvedAdres(adres: unknown): boolean {
  return String(adres ?? '').toLowerCase().includes('niet gevonden');
}

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
  const rawAdres = String(row['Adres'] ?? '');
  const addressUnresolved = isUnresolvedAdres(rawAdres);
  // Don't feed the error string through parseAdres() — its comma/suffix
  // heuristics produce a plausible-looking but bogus street+city (see
  // isUnresolvedAdres above), worse than leaving them blank for callers to
  // detect via address_unresolved and show a real "needs review" message.
  const { street, city } = addressUnresolved
    ? { street: '', city: '' }
    : parseAdres(
        rawAdres,
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
    address_unresolved: addressUnresolved,
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

// Construction year has no column on Objecten itself (confirmed live — see
// mapObjectenRow above) — it only exists via a separate "BAG Data" row
// joined on Object ID. So unlike every other buildNewObjectenRow field,
// entering a year on Add means a second, separate Add call against BAG
// Data once the new Object ID comes back (see AppsheetAddBuildingForm).
// "BAG Bouwjaar" and "Object ID" are the two columns confirmed live via a
// real Find against BAG Data; this row deliberately carries nothing else
// so it can't collide with the BAG-lookup automation's own columns
// (BAG Pand ID etc.) on a row it didn't populate.
export function buildNewBagDataRow(objectId: string, bouwjaar: number): Record<string, unknown> {
  return {
    'Object ID': objectId,
    'BAG Bouwjaar': bouwjaar,
  };
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

// ── Inspecteurs Edit (role change / active toggle) ─────────────────────
// Confirmed live: edit + revert clean on both fields. `rol` uses
// Inspecteurs' own two values (Inspecteur/Beheerder — see
// INSPECTEUR_ROLE_MAP above), not ScanergyV2's role enum.
export function buildInspecteurEditRow(
  id: string,
  fields: { rol?: 'Inspecteur' | 'Beheerder'; actief?: boolean }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Inspecteur ID': id };
  if (fields.rol !== undefined) row['Rol'] = fields.rol;
  if (fields.actief !== undefined) row['Actief'] = fields.actief ? 'Y' : '';
  return row;
}

// ── New Bedrijven row payload (for Add) ────────────────────────────────
// Confirmed live: unlike every other AppSheet key column in this file
// (auto-generated hex string, e.g. "75dd7925"), "Bedrijf ID" is Number-
// typed — letting AppSheet auto-generate it 400s ("cannot be converted to
// type 'Number'"). Callers must supply the next sequential integer
// themselves; `existingIds` is the full set of current Bedrijf IDs
// (already loaded by the organizations page for the list) so this stays a
// pure function with no extra fetch.
export function buildNewBedrijfRow(name: string, existingIds: string[]): Record<string, unknown> {
  const nextId = existingIds.reduce((max, id) => Math.max(max, Number(id) || 0), 0) + 1;
  return {
    'Bedrijf ID': String(nextId),
    Bedrijfsnaam: name,
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
// observed live, and both are AppSheet workflow/ordering states ("new" /
// "booked"), not a completion flag — confirmed live, every current Objecten
// row's "Eind Opname Compleet" (survey end) is already in the past while
// Status still reads "Nieuw"/"Besteld". Neither AppSheet value corresponds
// to paused/cancelled at all — until one is seen, those two tabs will
// legitimately show empty in AppSheet mode rather than guess.
const OBJECTEN_STATUS_MAP: Record<string, SessionSummary['status']> = {
  Nieuw: 'active',
  Besteld: 'active',
};

// AppSheet stores datetimes as "MM/DD/YYYY HH:mm:ss" (US format) — parses
// correctly via the Date constructor, unlike the Opname Datum/Tijd split
// columns below which are kept as their raw display string.
export function parseAppsheetDateTime(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Shared by mapObjectenToSessionSummary below and the buildings list's
// "Last inspected" column (toBuildingSummary in buildings/page.tsx and the
// mobile buildings route) — same past-due/synthetic-default completion
// logic, factored out so both call sites agree on what "completed" means
// without duplicating the synthetic-default detection.
export function objectenSessionStatus(
  row: Record<string, unknown>
): { status: SessionSummary['status']; completedAt: string | null } {
  const opnameDatum = String(row['Opname Datum'] ?? '');
  const opnameTijd = String(row['Opname Tijd'] ?? '');
  const startedAt = opnameDatum ? `${opnameDatum} ${opnameTijd}`.trim() : '';

  // "Eind Opname Compleet" is the survey's real scheduled end — once it's
  // passed, the visit is complete in the real world even though AppSheet's
  // own Status column hasn't been updated to reflect that. BUT: AppSheet
  // auto-populates this column with "Opname Tijd + 1 hour" on every new
  // Objecten row when it's left blank on Add (confirmed live — every
  // freshly created row carries exactly a 60-minute gap from Opname
  // Datum/Tijd, regardless of whether any inspection ever happened). That
  // synthetic default isn't a real completion timestamp, so a brand new
  // building was flipping to "completed" the moment that default hour
  // elapsed. Only trust it once it has been edited away from that default.
  const opnameStart = parseAppsheetDateTime(startedAt);
  const eindOpname = parseAppsheetDateTime(row['Eind Opname Compleet']);
  const SYNTHETIC_DEFAULT_GAP_MS = 60 * 60 * 1000;
  const looksLikeUntouchedDefault =
    opnameStart != null && eindOpname != null &&
    Math.abs(eindOpname.getTime() - opnameStart.getTime() - SYNTHETIC_DEFAULT_GAP_MS) < 60 * 1000;
  const isPastDue = eindOpname != null && !looksLikeUntouchedDefault && eindOpname.getTime() <= Date.now();
  const status: SessionSummary['status'] = isPastDue
    ? 'completed'
    : (OBJECTEN_STATUS_MAP[String(row['Status'] ?? '').trim()] ?? 'active');

  return { status, completedAt: isPastDue ? (eindOpname as Date).toISOString() : null };
}

// "Related X" ref-list columns (e.g. "Related Verdiepingen", "Related
// Gevels") are comma-joined id lists ("id1 , id2 , id3") — same shape
// firstRelatedId already reads above. Counting non-empty entries gives a
// real zone/element count straight off the Objecten row already fetched
// for the buildings list, with no extra per-building Find call needed.
export function countRelatedIds(v: unknown): number {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  return s.split(',').map(x => x.trim()).filter(Boolean).length;
}

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
  const { status, completedAt } = objectenSessionStatus(row);

  return {
    id: objectId,
    org_id: String(row['Bedrijfs ID'] ?? ''),
    building_id: objectId,
    inspector_id: inspecteurId,
    session_code: `OBJ-${objectId}`,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    total_measurements: 0,
    anomaly_count: 0,
    sync_status: 'n/a',
    is_active: true,
    inspector_name: inspecteurNameById.get(inspecteurId) ?? 'Unknown',
    building_address: `${street} ${row['Huisnummer'] ?? ''}${row['Huisletter'] ?? ''}${row['Huistoevoeging'] ?? ''}`.trim(),
    building_city: city,
  };
}

// ── Verdiepingen -> Zone, Rekenzones -> Rekenzone, Daken/Gevels/Vloeren/
// Installaties -> BuildingElement, Transparante_Delen -> Opening ──────────
// Column names below are confirmed live against the real AppSheet tables
// (not guessed) — pulled with a Find call against each table during this
// build. See docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §1 for which
// ScanergyV2 tables these correspond to.

// Verdiepingen has no explicit floor-level number — only a free-text Dutch
// name ("Kelder", "Bg", "V1", "Verdieping"). Parsed heuristically the same
// way the rest of this file treats AppSheet free text: best-effort, not a
// guaranteed-correct parser.
function parseFloorLevel(naam: string): number {
  const n = naam.trim().toLowerCase();
  if (n.includes('kelder')) return -1;
  if (n === 'bg' || n.includes('begane grond')) return 0;
  const m = n.match(/^v(\d+)$/);
  if (m) return Number(m[1]);
  return 0;
}

export function mapVerdiepingRow(row: Record<string, unknown>): Zone {
  const naam = String(row['Naam Verdieping'] ?? '');
  return {
    id: String(row['Verdieping ID'] ?? ''),
    building_id: String(row['Object ID'] ?? ''),
    zone_code: '',
    name: naam || 'Verdieping',
    floor_level: parseFloorLevel(naam),
    gross_area_m2: num(row['GBO']) ?? 0,
    ceiling_height_m: num(row['Hoogte']),
    description: row['Notities'] ? String(row['Notities']) : null,
    energy_label: null,
    rekenzone_id: row['Rekenzone ID'] ? String(row['Rekenzone ID']) : null,
    // "Plattegrond Schets" is a path into AppSheet's own file storage, not a
    // URL this app can sign/serve — floor plans stay unavailable in this mode.
    floor_plan_image_url: null,
    floor_plan_points: null,
    floor_plan_scale_m: null,
  };
}

export function mapRekenzoneRow(row: Record<string, unknown>): Rekenzone {
  return {
    id: String(row['Rekenzone ID'] ?? ''),
    org_id: '',
    building_id: String(row['Object ID'] ?? ''),
    name: String(row['Naam Rekenzone'] ?? ''),
    description: null,
    notes: row['Notities Rekenzone'] ? String(row['Notities Rekenzone']) : null,
    sort_order: 0,
    is_active: true,
  };
}

// Grenst_aan_logica, pulled live (Grenst aan Code -> Omschrijving). Per the
// toggle doc's §2/§4 "architecture shift" — a data-driven lookup sheet on
// the AppSheet side becomes a compiled mapping here, same pattern as
// OBJECTEN_STATUS_MAP/INSPECTEUR_ROLE_MAP above.
export const GRENST_AAN_OMSCHRIJVING: Record<string, string> = {
  '0': 'Buitenlucht',
  '1': 'Water',
  '2': 'Grond',
  '3': 'Kruipruimte',
  '4': 'Aangrenzende onverwarmde ruimte',
  '5': 'Aangrenzende onverwarmde serre',
  '6': 'Aangrenzende sterk geventileerde ruimte',
  '7': 'Aangrenzende onverwarmde kelder',
  '8': 'Aangrenzende verwarmde ruimte',
};

// Orientatie_Logica, pulled live: for Voorgevel/Achtergevel the Orientatie
// Code -> Resultaat_Orientatie mapping is identical and code-only (verified
// across every Hoofd_Orientatie row). For Linker-/Rechtergevel the same code
// yields a different result depending on the building's Hoofd_Orientatie,
// which isn't exposed anywhere in Objecten/Gevels via the API — so those two
// positions reuse the Voor/Achter table as a best-effort approximation
// rather than being left unmapped.
export const ORIENTATIE_CODE_TO_DEG: Record<string, number> = {
  '4': 0,   // Noord
  '5': 45,  // Noord-Oost
  '6': 90,  // Oost
  '7': 135, // Zuid-Oost
  '0': 180, // Zuid
  '1': 225, // Zuid-West
  '2': 270, // West
  '3': 315, // Noord-West
};

// Zonwering_logica, pulled live (Zonwering ID -> Omschrijving). '0' = "Geen
// Zonwering" (no shading); every other code is a real shading type.
const ZONWERING_OMSCHRIJVING: Record<string, string> = {
  '1': 'Vaste Zonwering',
  '2': 'Uitvalscherm',
  '3': 'Knikarmscherm',
  '4': 'Screens (Buiten)',
  '5': 'Jaloezieen (Buiten)',
  '6': 'Gemetalliseerde Weefsels (Binnen)',
  '7': 'Rolluiken (buiten)',
};

// Shared "not captured in AppSheet" defaults for the ScanergyV2-only calc
// fields (migration 024 Phase 2) that have no AppSheet-side equivalent.
const ELEMENT_CALC_DEFAULTS = {
  dikte_vloerconstructie_mm: null,
  rekenhoogte_m_override: null,
  warmtecap_vloer_klasse: null,
  warmtecap_gevel_klasse: null,
  plafond_type: null,
  rc_source: null,
  isolatie_dikte_mm: null,
  isolatie_lambda: null,
  na_isolatie: false,
  na_isolatie_jaar: null,
  kruipruimte_hoogte_m: null,
  pv_aantal_panelen: null,
  pv_wp_per_paneel: null,
  pv_orientatie_deg: null,
  pv_hellingshoek_deg: null,
  pv_beschaduwing_klasse: null,
  tapwater_segments: null,
} as const;

export function mapGevelRow(row: Record<string, unknown>): BuildingElement {
  const orientCode = String(row['Orientatie Code'] ?? '').trim();
  const grenstCode = String(row['Grenzend aan code'] ?? '').trim();
  return {
    id: String(row['Gevel ID'] ?? ''),
    zone_id: String(row['Verdieping ID'] ?? ''),
    element_type: 'gevel',
    name: String(row['Naam'] ?? row['Positie'] ?? 'Gevel'),
    description: GRENST_AAN_OMSCHRIJVING[grenstCode] ?? null,
    length_mm: mToMm(num(row['Breedte'])),
    width_mm: null,
    height_mm: mToMm(num(row['Hoogte'])),
    area_m2: num(row['Bruto Oppervlakte']),
    orientation_deg: ORIENTATIE_CODE_TO_DEG[orientCode] ?? null,
    tilt_deg: null,
    rc_value: null,
    u_value: null,
    lambda_value: null,
    insulation_thickness_mm: null,
    // gevelpositie() reads name/description/construction_type as free text —
    // Positie ("Voorgevel"/"Achtergevel"/...) goes here so it resolves correctly.
    construction_type: row['Positie'] ? String(row['Positie']) : null,
    insulation_type: null,
    finish_type: null,
    installation_type: null,
    fuel_type: null,
    efficiency: null,
    capacity_kw: null,
    year_installed: null,
    nokhoogte_m: null,
    bodemisolatie: false,
    brand: null,
    model_nr: null,
    cv_klasse: null,
    parent_element_id: null,
    perimeter_m: null,
    dikte_vloer_boven_mm: null,
    dikte_vloer_onder_mm: null,
    dikte_muren_mm: null,
    photo_urls: [],
    is_complete: isBlank(row['Nog uit te werken']),
    is_active: true,
    sort_order: num(row['Locatie']) ?? 0,
    notes: row['Notities'] ? String(row['Notities']) : null,
    ...ELEMENT_CALC_DEFAULTS,
  };
}

export function mapDakRow(row: Record<string, unknown>, zoneId: string): BuildingElement {
  const orientCode = String(row['Orientatie Code'] ?? '').trim();
  const grenstCode = String(row['Grenzend aan code'] ?? '').trim();
  return {
    id: String(row['Dak ID'] ?? ''),
    zone_id: zoneId,
    element_type: 'dak',
    name: String(row['Naam'] ?? 'Dak'),
    description: GRENST_AAN_OMSCHRIJVING[grenstCode] ?? null,
    length_mm: mToMm(num(row['Lengte Dak'])),
    width_mm: mToMm(num(row['Breedte Dak'])),
    height_mm: null,
    area_m2: num(row['Bruto Oppervlakte']),
    orientation_deg: ORIENTATIE_CODE_TO_DEG[orientCode] ?? null,
    tilt_deg: num(row['Hoek']),
    rc_value: null,
    u_value: null,
    lambda_value: null,
    insulation_thickness_mm: null,
    // dakType() matches "plat"/"hellend" in construction_type/name — Type Dak
    // ("Plat Dak"/"Hellend Dak") already carries those exact Dutch words.
    construction_type: row['Type Dak'] ? String(row['Type Dak']) : null,
    insulation_type: null,
    finish_type: null,
    installation_type: null,
    fuel_type: null,
    efficiency: null,
    capacity_kw: null,
    year_installed: null,
    nokhoogte_m: num(row['Nokhoogte/Lengte Vloer']),
    bodemisolatie: false,
    brand: null,
    model_nr: null,
    cv_klasse: null,
    parent_element_id: null,
    perimeter_m: null,
    dikte_vloer_boven_mm: null,
    dikte_vloer_onder_mm: null,
    dikte_muren_mm: null,
    photo_urls: [],
    is_complete: isBlank(row['Nog uit te werken']),
    is_active: true,
    sort_order: num(row['Locatie']) ?? 0,
    notes: row['Notities'] ? String(row['Notities']) : null,
    ...ELEMENT_CALC_DEFAULTS,
  };
}

export function mapVloerRow(row: Record<string, unknown>, zoneId: string): BuildingElement {
  const grenstCode = String(row['Grenzend aan code'] ?? '').trim();
  return {
    id: String(row['Vloer ID'] ?? ''),
    zone_id: zoneId,
    element_type: 'vloer',
    name: String(row['Naam'] ?? 'Vloer'),
    description: GRENST_AAN_OMSCHRIJVING[grenstCode] ?? null,
    length_mm: mToMm(num(row['Lengte'])),
    width_mm: mToMm(num(row['Breedte'])),
    height_mm: null,
    area_m2: num(row['Bruto Oppervlakte']),
    orientation_deg: null,
    tilt_deg: null,
    rc_value: null,
    u_value: null,
    lambda_value: null,
    insulation_thickness_mm: null,
    construction_type: null,
    insulation_type: row['Vloerisolatie'] ? String(row['Vloerisolatie']) : null,
    finish_type: null,
    installation_type: null,
    fuel_type: null,
    efficiency: null,
    capacity_kw: null,
    year_installed: null,
    nokhoogte_m: null,
    bodemisolatie: !isBlank(row['Bodemisolatie']),
    brand: null,
    model_nr: null,
    cv_klasse: null,
    parent_element_id: null,
    perimeter_m: num(row['Perimeter berekend']) ?? num(row['Totale Perimeter']),
    dikte_vloer_boven_mm: null,
    dikte_vloer_onder_mm: null,
    dikte_muren_mm: null,
    photo_urls: [],
    is_complete: isBlank(row['Nog uit te werken']),
    is_active: true,
    sort_order: num(row['Locatie']) ?? 0,
    notes: row['Notities'] ? String(row['Notities']) : null,
    ...ELEMENT_CALC_DEFAULTS,
  };
}

export function mapInstallatieRow(row: Record<string, unknown>, zoneId: string): BuildingElement {
  const type = row['Type Installatie'] ? String(row['Type Installatie']) : null;
  return {
    id: String(row['Installatie ID'] ?? ''),
    zone_id: zoneId,
    element_type: 'installatie',
    name: type ?? 'Installatie',
    description: row['Locatie in huis'] ? String(row['Locatie in huis']) : null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    area_m2: null,
    orientation_deg: null,
    tilt_deg: null,
    rc_value: null,
    u_value: null,
    lambda_value: null,
    insulation_thickness_mm: null,
    construction_type: null,
    insulation_type: null,
    finish_type: null,
    // AppSheet has no brand/model split (just one combined "Merk/Model"
    // string) and no efficiency/capacity/year fields at all — a real data
    // gap, not a mapping bug (ScanergyV2 has richer typed installation
    // fields Excel never modeled, per the toggle doc §1).
    installation_type: type ? type.toLowerCase() : null,
    fuel_type: null,
    efficiency: null,
    capacity_kw: null,
    year_installed: null,
    nokhoogte_m: null,
    bodemisolatie: false,
    brand: row['Merk/Model'] ? String(row['Merk/Model']) : null,
    model_nr: null,
    cv_klasse: null,
    parent_element_id: null,
    perimeter_m: null,
    dikte_vloer_boven_mm: null,
    dikte_vloer_onder_mm: null,
    dikte_muren_mm: null,
    photo_urls: [],
    is_complete: isBlank(row['Nog uit te werken']),
    is_active: true,
    sort_order: 0,
    notes: row['Notities Installatie'] ? String(row['Notities Installatie']) : null,
    ...ELEMENT_CALC_DEFAULTS,
  };
}

export function mapTransparantDeelRow(row: Record<string, unknown>): Opening {
  const zonweringCode = String(row['Zonwering'] ?? '').trim();
  const hasShading = zonweringCode !== '' && zonweringCode !== '0';
  const belemmering = String(row['Belemmering'] ?? '').trim().toUpperCase() === 'Y';
  return {
    id: String(row['Deel ID'] ?? ''),
    element_id: String(row['Gevel ID'] || row['Dak ID'] || row['Vloer ID'] || ''),
    opening_type: String(row['Type Deel'] ?? '').toLowerCase(),
    name: null,
    width_mm: mToMm(num(row['Breedte'])),
    height_mm: mToMm(num(row['Hoogte'])),
    area_m2: num(row['Netto Oppervlakte']) ?? num(row['Bruto Oppervlakte']),
    glazing_type: row['Glastype'] ? String(row['Glastype']) : null,
    frame_type: row['Materiaal'] ? String(row['Materiaal']) : null,
    g_value: null,
    u_value_frame: null,
    u_value_glass: null,
    u_value_total: null,
    has_shading: hasShading,
    shading_type: hasShading ? (ZONWERING_OMSCHRIJVING[zonweringCode] ?? null) : null,
    shading_factor: null,
    thermisch_onderbroken: false,
    overstek_m: num(row['Overstek Diepte']) ?? 0,
    belemmering: belemmering
      ? [row['Belemmering Zijde'], row['Belemmering Afstand'] ? `${row['Belemmering Afstand']} m` : null]
          .filter(Boolean).join(' · ') || 'Ja'
      : null,
    notes: row['Notities Deel'] ? String(row['Notities Deel']) : null,
    u_glas: null,
    g_waarde: null,
    f_sh: null,
  };
}

// Rekenzone -> first Verdieping id (best-effort zone assignment for
// Daken/Vloeren/Installaties, which carry a Rekenzone ID but no Verdieping
// ID of their own — unlike Gevels. When a rekenzone spans multiple floors,
// the element is attached to its first floor; it still groups correctly
// under the right rekenzone in the accordion either way.
export function firstZoneIdForRekenzone(rekenzoneRow: Record<string, unknown>): string {
  return firstRelatedId(rekenzoneRow['Related Verdiepingens']);
}

// ── Inverse mappers for AppSheet Edit (write-back) ──────────────────────────
// Mirrors mapVerdiepingRow/mapGevelRow/mapDakRow/mapVloerRow/mapInstallatieRow
// in reverse, but only for the fields each edit UI exposes — see
// app/api/appsheet/[table]/route.ts's EDIT_TABLES, which is the actual
// field-level allowlist enforced server-side. AppSheet stores Breedte/
// Hoogte/Lengte/GBO directly in meters/m² (confirmed live), so these take
// plain meter/m² values already in the AppSheet unit — no mm<->m conversion
// here, only in the edit UI's *display* of an existing millimeter value.
// A field left `undefined` is omitted from the row entirely (leaves that
// AppSheet column untouched); `null` clears it to an empty string.

const DEG_TO_ORIENTATIE_CODE: Record<number, string> = Object.fromEntries(
  Object.entries(ORIENTATIE_CODE_TO_DEG).map(([code, deg]) => [deg, code])
);

const OMSCHRIJVING_TO_GRENST_AAN_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(GRENST_AAN_OMSCHRIJVING).map(([code, label]) => [label, code])
);

// Dutch cardinal labels for the 8 orientation codes this workbook uses
// (see ORIENTATIE_CODE_TO_DEG above) — shared by the edit UI's orientation
// select so it doesn't duplicate this list.
export const ORIENTATIE_LABELS: Record<number, string> = {
  0: 'Noord', 45: 'Noord-Oost', 90: 'Oost', 135: 'Zuid-Oost',
  180: 'Zuid', 225: 'Zuid-West', 270: 'West', 315: 'Noord-West',
};

export function buildVerdiepingEditRow(
  zoneId: string,
  fields: { grossAreaM2?: number | null; ceilingHeightM?: number | null; notes?: string | null }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Verdieping ID': zoneId };
  if (fields.grossAreaM2 !== undefined) row['GBO'] = fields.grossAreaM2 ?? '';
  if (fields.ceilingHeightM !== undefined) row['Hoogte'] = fields.ceilingHeightM ?? '';
  if (fields.notes !== undefined) row['Notities'] = fields.notes ?? '';
  return row;
}

export function buildGevelEditRow(
  gevelId: string,
  fields: {
    name?: string | null; widthM?: number | null; heightM?: number | null; areaM2?: number | null;
    orientationDeg?: number | null; grenztAanOmschrijving?: string | null; positie?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Gevel ID': gevelId };
  if (fields.name !== undefined) row['Naam'] = fields.name ?? '';
  if (fields.widthM !== undefined) row['Breedte'] = fields.widthM ?? '';
  if (fields.heightM !== undefined) row['Hoogte'] = fields.heightM ?? '';
  if (fields.areaM2 !== undefined) row['Bruto Oppervlakte'] = fields.areaM2 ?? '';
  if (fields.orientationDeg !== undefined) {
    row['Orientatie Code'] = fields.orientationDeg != null ? (DEG_TO_ORIENTATIE_CODE[fields.orientationDeg] ?? '') : '';
  }
  if (fields.grenztAanOmschrijving !== undefined) {
    row['Grenzend aan code'] = fields.grenztAanOmschrijving ? (OMSCHRIJVING_TO_GRENST_AAN_CODE[fields.grenztAanOmschrijving] ?? '') : '';
  }
  if (fields.positie !== undefined) row['Positie'] = fields.positie ?? '';
  if (fields.notes !== undefined) row['Notities'] = fields.notes ?? '';
  return row;
}

export function buildDakEditRow(
  dakId: string,
  fields: {
    name?: string | null; lengthM?: number | null; widthM?: number | null; areaM2?: number | null; tiltDeg?: number | null;
    roofType?: string | null; nokhoogteM?: number | null; grenztAanOmschrijving?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Dak ID': dakId };
  if (fields.name !== undefined) row['Naam'] = fields.name ?? '';
  if (fields.lengthM !== undefined) row['Lengte Dak'] = fields.lengthM ?? '';
  if (fields.widthM !== undefined) row['Breedte Dak'] = fields.widthM ?? '';
  if (fields.areaM2 !== undefined) row['Bruto Oppervlakte'] = fields.areaM2 ?? '';
  if (fields.tiltDeg !== undefined) row['Hoek'] = fields.tiltDeg ?? '';
  if (fields.roofType !== undefined) row['Type Dak'] = fields.roofType ?? '';
  if (fields.nokhoogteM !== undefined) row['Nokhoogte/Lengte Vloer'] = fields.nokhoogteM ?? '';
  if (fields.grenztAanOmschrijving !== undefined) {
    row['Grenzend aan code'] = fields.grenztAanOmschrijving ? (OMSCHRIJVING_TO_GRENST_AAN_CODE[fields.grenztAanOmschrijving] ?? '') : '';
  }
  if (fields.notes !== undefined) row['Notities'] = fields.notes ?? '';
  return row;
}

export function buildVloerEditRow(
  vloerId: string,
  fields: {
    // Bodemisolatie deliberately omitted — confirmed live it's a
    // constrained Enum with no accepted boolean-ish value found (see
    // app/api/appsheet/[table]/route.ts EDIT_TABLES.Vloeren comment).
    name?: string | null; lengthM?: number | null; widthM?: number | null; areaM2?: number | null; vloerisolatie?: string | null;
    grenztAanOmschrijving?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Vloer ID': vloerId };
  if (fields.name !== undefined) row['Naam'] = fields.name ?? '';
  if (fields.lengthM !== undefined) row['Lengte'] = fields.lengthM ?? '';
  if (fields.widthM !== undefined) row['Breedte'] = fields.widthM ?? '';
  if (fields.areaM2 !== undefined) row['Bruto Oppervlakte'] = fields.areaM2 ?? '';
  if (fields.vloerisolatie !== undefined) row['Vloerisolatie'] = fields.vloerisolatie ?? '';
  if (fields.grenztAanOmschrijving !== undefined) {
    row['Grenzend aan code'] = fields.grenztAanOmschrijving ? (OMSCHRIJVING_TO_GRENST_AAN_CODE[fields.grenztAanOmschrijving] ?? '') : '';
  }
  if (fields.notes !== undefined) row['Notities'] = fields.notes ?? '';
  return row;
}

// ── New Verdiepingen/Gevels/Daken/Vloeren/Installaties/Transparante_Delen
// row payloads (for Add) ────────────────────────────────────────────────
// Built for the mobile session-close export (web/app/api/appsheet/mobile/
// session-close/route.ts): pushes a *finished* inspection's dimensions into
// AppSheet once a session closes. Field sets mirror the edit-row builders
// above (only what AppSheet already models — see the toggle doc) plus the
// linking column each table actually requires.
//
// IMPORTANT — unlike every buildNew*Row above, these have NOT been
// confirmed against a live Add call. The existing WRITE_TABLES/DELETE_TABLES
// comments in app/api/appsheet/[table]/route.ts already document known
// landmines here (Gevels needs "Positie", Vloeren/Daken/Installaties need
// "Rekenzone ID", Installaties may need "Type Toestel Tapwater" depending on
// type) — the required fields below are a best-effort reconstruction of
// those landmines, not a verified-clean payload. The session-close route
// must treat each row's Add as independently failable and report failures
// back rather than assuming success.

// Confirmed live via a real Add+Delete round-trip: only "Object ID" +
// "Naam Rekenzone" are required — no landmine, no Number-typed sequential
// ID like Bedrijven. "Notities Rekenzone" is free text, optional. The
// Daken/Gevels/Vloeren/Installaties/Related-* columns on a Rekenzone row
// are read-only reverse-reference lists computed by AppSheet itself, never
// something an Add/Edit payload sets.
export function buildNewRekenzoneRow(
  objectId: string,
  fields: { naam: string; notes?: string | null }
): Record<string, unknown> {
  return {
    'Object ID': objectId,
    'Naam Rekenzone': fields.naam,
    ...(fields.notes ? { 'Notities Rekenzone': fields.notes } : {}),
  };
}

// Confirmed live via a real Add+Delete round-trip: "Rekenzone ID" is a hard
// requirement, not an optional link. An Add with "Object ID" alone returns
// 200 and looks successful, but AppSheet silently drops the Object ID —
// the row comes back with a blank Object ID and never shows up as a
// "Related Verdieping" under the building (an invisible orphan row). Every
// caller must resolve or create a Rekenzone first (see session-close/route.ts).
export function buildNewVerdiepingRow(
  objectId: string,
  fields: { naam: string; rekenzoneId: string; grossAreaM2?: number | null; ceilingHeightM?: number | null; notes?: string | null }
): Record<string, unknown> {
  return {
    'Object ID': objectId,
    'Rekenzone ID': fields.rekenzoneId,
    'Naam Verdieping': fields.naam,
    ...(fields.grossAreaM2 != null ? { GBO: fields.grossAreaM2 } : {}),
    ...(fields.ceilingHeightM != null ? { Hoogte: fields.ceilingHeightM } : {}),
    ...(fields.notes ? { Notities: fields.notes } : {}),
  };
}

// Confirmed live: Gevels Add hard-requires "Rekenzone ID" — a 400 "Missing
// value in column: Rekenzone ID" otherwise — in addition to "Verdieping ID",
// even though a Gevel conceptually only hangs off a floor (Verdieping).
export function buildNewGevelRow(
  verdiepingId: string,
  fields: {
    name?: string | null; positie: string; rekenzoneId: string; widthM?: number | null; heightM?: number | null;
    areaM2?: number | null; orientationDeg?: number | null; grenztAanOmschrijving?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  return {
    'Verdieping ID': verdiepingId,
    'Rekenzone ID': fields.rekenzoneId,
    Positie: fields.positie,
    ...(fields.name ? { Naam: fields.name } : {}),
    ...(fields.widthM != null ? { Breedte: fields.widthM } : {}),
    ...(fields.heightM != null ? { Hoogte: fields.heightM } : {}),
    ...(fields.areaM2 != null ? { 'Bruto Oppervlakte': fields.areaM2 } : {}),
    ...(fields.orientationDeg != null ? { 'Orientatie Code': DEG_TO_ORIENTATIE_CODE[fields.orientationDeg] ?? '' } : {}),
    ...(fields.grenztAanOmschrijving ? { 'Grenzend aan code': OMSCHRIJVING_TO_GRENST_AAN_CODE[fields.grenztAanOmschrijving] ?? '' } : {}),
    ...(fields.notes ? { Notities: fields.notes } : {}),
  };
}

export function buildNewDakRow(
  rekenzoneId: string,
  fields: {
    naam?: string | null; lengthM?: number | null; widthM?: number | null; areaM2?: number | null; tiltDeg?: number | null;
    roofType?: string | null; nokhoogteM?: number | null; grenztAanOmschrijving?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  return {
    'Rekenzone ID': rekenzoneId,
    ...(fields.naam ? { Naam: fields.naam } : {}),
    ...(fields.lengthM != null ? { 'Lengte Dak': fields.lengthM } : {}),
    ...(fields.widthM != null ? { 'Breedte Dak': fields.widthM } : {}),
    ...(fields.areaM2 != null ? { 'Bruto Oppervlakte': fields.areaM2 } : {}),
    ...(fields.tiltDeg != null ? { Hoek: fields.tiltDeg } : {}),
    ...(fields.roofType ? { 'Type Dak': fields.roofType } : {}),
    ...(fields.nokhoogteM != null ? { 'Nokhoogte/Lengte Vloer': fields.nokhoogteM } : {}),
    ...(fields.grenztAanOmschrijving ? { 'Grenzend aan code': OMSCHRIJVING_TO_GRENST_AAN_CODE[fields.grenztAanOmschrijving] ?? '' } : {}),
    ...(fields.notes ? { Notities: fields.notes } : {}),
  };
}

export function buildNewVloerRow(
  rekenzoneId: string,
  fields: {
    naam?: string | null; lengthM?: number | null; widthM?: number | null; areaM2?: number | null;
    vloerisolatie?: string | null; grenztAanOmschrijving?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  return {
    'Rekenzone ID': rekenzoneId,
    ...(fields.naam ? { Naam: fields.naam } : {}),
    ...(fields.lengthM != null ? { Lengte: fields.lengthM } : {}),
    ...(fields.widthM != null ? { Breedte: fields.widthM } : {}),
    ...(fields.areaM2 != null ? { 'Bruto Oppervlakte': fields.areaM2 } : {}),
    ...(fields.vloerisolatie ? { Vloerisolatie: fields.vloerisolatie } : {}),
    ...(fields.grenztAanOmschrijving ? { 'Grenzend aan code': OMSCHRIJVING_TO_GRENST_AAN_CODE[fields.grenztAanOmschrijving] ?? '' } : {}),
    ...(fields.notes ? { Notities: fields.notes } : {}),
  };
}

export function buildNewInstallatieRow(
  rekenzoneId: string,
  fields: { installationType: string; locatie?: string | null; merkModel?: string | null; notes?: string | null }
): Record<string, unknown> {
  return {
    'Rekenzone ID': rekenzoneId,
    'Type Installatie': fields.installationType,
    ...(fields.locatie ? { 'Locatie in huis': fields.locatie } : {}),
    ...(fields.merkModel ? { 'Merk/Model': fields.merkModel } : {}),
    ...(fields.notes ? { 'Notities Installatie': fields.notes } : {}),
  };
}

// Transparante_Delen has no edit-row builder to mirror (it isn't in
// EDIT_TABLES at all yet) — field names here come straight from
// mapTransparantDeelRow's read side. `parentIdField`/`parentId` picks
// whichever of Gevel ID/Dak ID/Vloer ID this opening belongs to.
export function buildNewTransparantDeelRow(
  parentIdField: 'Gevel ID' | 'Dak ID' | 'Vloer ID',
  parentId: string,
  fields: {
    typeDeel: string; widthM?: number | null; heightM?: number | null; areaM2?: number | null;
    glastype?: string | null; materiaal?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  return {
    [parentIdField]: parentId,
    'Type Deel': fields.typeDeel,
    ...(fields.widthM != null ? { Breedte: fields.widthM } : {}),
    ...(fields.heightM != null ? { Hoogte: fields.heightM } : {}),
    ...(fields.areaM2 != null ? { 'Bruto Oppervlakte': fields.areaM2 } : {}),
    ...(fields.glastype ? { Glastype: fields.glastype } : {}),
    ...(fields.materiaal ? { Materiaal: fields.materiaal } : {}),
    ...(fields.notes ? { 'Notities Deel': fields.notes } : {}),
  };
}

export function buildInstallatieEditRow(
  installatieId: string,
  fields: { installationType?: string | null; locatie?: string | null; merkModel?: string | null; notes?: string | null }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Installatie ID': installatieId };
  if (fields.installationType !== undefined) row['Type Installatie'] = fields.installationType ?? '';
  if (fields.locatie !== undefined) row['Locatie in huis'] = fields.locatie ?? '';
  if (fields.merkModel !== undefined) row['Merk/Model'] = fields.merkModel ?? '';
  if (fields.notes !== undefined) row['Notities Installatie'] = fields.notes ?? '';
  return row;
}

// Confirmed live: "Type Deel"/"Materiaal"/"Glastype" are constrained Enum
// columns (a free-text Edit 400s: "cannot be converted to type 'Enum'"),
// same shape as Grenzend-aan-code — see TYPE_DEEL_OPTIONS/MATERIAAL_OPTIONS/
// GLASTYPE_OPTIONS in AppsheetOpeningEditPanel.tsx for the observed
// vocabulary. "Bruto Oppervlakte"/"Netto Oppervlakte" are deliberately
// omitted — confirmed live they're formula columns (Breedte × Hoogte),
// not something an Edit payload should try to set. Zonwering/Overstek/
// Belemmering are deliberately left off the write path for now — they're a
// cluster of related numeric-code + detail columns that would need their
// own live-confirmed vocabulary, and aren't needed to close the "no write
// path at all" gap (dimensions/type/material/glazing/notes cover the
// primary use case).
export function buildTransparantDeelEditRow(
  deelId: string,
  fields: {
    typeDeel?: string | null; widthM?: number | null; heightM?: number | null;
    glastype?: string | null; materiaal?: string | null; notes?: string | null;
  }
): Record<string, unknown> {
  const row: Record<string, unknown> = { 'Deel ID': deelId };
  if (fields.typeDeel !== undefined) row['Type Deel'] = fields.typeDeel ?? '';
  if (fields.widthM !== undefined) row['Breedte'] = fields.widthM ?? '';
  if (fields.heightM !== undefined) row['Hoogte'] = fields.heightM ?? '';
  if (fields.glastype !== undefined) row['Glastype'] = fields.glastype ?? '';
  if (fields.materiaal !== undefined) row['Materiaal'] = fields.materiaal ?? '';
  if (fields.notes !== undefined) row['Notities Deel'] = fields.notes ?? '';
  return row;
}
