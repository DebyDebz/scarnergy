// Per-entity service-layer contracts for the AppSheet <-> ScanergyV2 toggle.
//
// Each entity gets ONE interface implemented twice: a `scanergy/` module
// (real Supabase reads) and an `appsheet/` module (AppSheet Enterprise API,
// via the bulk Find + Selector pattern decided in
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §4 — NOT the old prototype's
// per-row fan-out). `index.ts` picks the implementation based on the active
// DataSource so callers never branch on source themselves.
//
// Only organisations/buildings/contacts are implemented end-to-end here as
// the reference slice (contacts because it's this build's other deliverable
// and previously didn't exist on the ScanergyV2 side at all). The remaining
// ~9 entity types in the analysis doc's §1 table (rekenzones, zones,
// building_elements, openings, ble_devices, user_profiles, ...) follow the
// exact same two-file-plus-factory shape — add them the same way when the
// AppSheet-side blockers below are cleared.
//
// Update (credentials confirmed, all three reference-slice entities wired):
// AppSheet Enterprise API access and a fresh, non-exposed
// ApplicationAccessKey are available (verified live against the account) —
// both prior blockers are cleared. `appsheet/organisations.ts`,
// `appsheet/buildings.ts`, and `appsheet/contacts.ts` all call the real API
// via the server proxy at web/app/api/appsheet/[table]/route.ts, with field
// mappings confirmed against live Bedrijven/Objecten/BAG Data/Contactpersoon
// responses (not just the analysis doc).
//
// `DataSourceBlockedError` is kept for the ~9 remaining entity types
// (rekenzones, zones, building_elements, openings, ble_devices,
// user_profiles, ...) that still need a two-file-plus-factory
// implementation the same way — see the file-level comment above.

import type { Organisation, Building, Contact } from '@/lib/types';

export class DataSourceBlockedError extends Error {
  constructor(entity: string, reason?: string) {
    super(
      `AppSheet-side "${entity}" service is not wired up yet. ` +
      (reason ?? 'Blocked pending confirmation of the exact AppSheet column names for this table.')
    );
    this.name = 'DataSourceBlockedError';
  }
}

export interface OrganisationService {
  list(): Promise<Organisation[]>;
  get(id: string): Promise<Organisation | null>;
}

export interface BuildingService {
  list(orgId: string): Promise<Building[]>;
  get(id: string): Promise<Building | null>;
}

export interface ContactService {
  /** The operative relationship per the analysis doc: a contact belongs to a building. */
  listByBuilding(buildingId: string): Promise<Contact[]>;
  get(id: string): Promise<Contact | null>;
}
