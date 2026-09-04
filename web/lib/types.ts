export type Role = 'inspector' | 'supervisor' | 'admin';

export interface Organisation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  settings: Record<string, unknown>;
}
export type UserStatus = 'pending' | 'approved' | 'rejected';
export interface UserProfile {
  id: string;
  org_id: string;
  role: Role;
  full_name: string;
  is_active: boolean;
  status: UserStatus;
}
export interface BleDevice {
  id: string;
  org_id: string;
  mac_address: string;
  nickname: string;
  battery_level: number | null;
  last_connected_at: string | null;
  is_active: boolean;
}
export interface Building {
  id: string;
  org_id: string;
  reference_code: string;
  street: string;
  house_number: string;
  postal_code: string;
  city: string;
  building_type: string;
  construction_year: number;
  gross_floor_area_m2: number;
  latitude: number | null;
  longitude: number | null;
  // BAG / 3DBAG cache (migration 026) — raw registry values, distinct from
  // the manual construction_year / gross_floor_area_m2 above.
  bag_pand_id: string | null;
  bag_vbo_id: string | null;
  bag_bouwjaar: number | null;
  bag_oppervlakte_m2: number | null;
  bag_gebruiksdoel: string | null;
  dbag_hoogte_m: number | null;
  bag_fetched_at: string | null;
  // AppSheet-only: set when the source Objecten row's Adres column is that
  // workbook's own live automation's error string ("...niet gevonden, pas
  // regel aan...") rather than a real address — see
  // lib/appsheet/mappers.ts isUnresolvedAdres(). Native/Supabase buildings
  // never set this (always undefined there).
  address_unresolved?: boolean;
}
export interface Rekenzone {
  id: string;
  org_id: string;
  building_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  sort_order: number;
  is_active: boolean;
  // AppSheet-only: this rekenzone's correlated Rekenzone ID once a
  // dak/vloer/installatie under it has synced to/from AppSheet (migration
  // 031) — mirrors zones/building_elements/openings' appsheet_row_key (030).
  appsheet_row_key?: string | null;
}
export interface ElementDefault {
  id: string;
  org_id: string;
  element_kind: string;
  payload: Record<string, unknown>;
  updated_at: string;
}
export interface Zone {
  id: string;
  building_id: string;
  zone_code: string;
  name: string;
  floor_level: number;
  gross_area_m2: number;
  ceiling_height_m: number | null;
  description: string | null;
  energy_label: string | null;
  rekenzone_id: string | null;
  floor_plan_image_url: string | null;
  floor_plan_points: Array<{ x: number; y: number }> | null;
  floor_plan_scale_m: number | null;
}
export interface BuildingElement {
  id: string;
  zone_id: string;
  element_type: string;
  name: string;
  description: string | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  area_m2: number | null;
  orientation_deg: number | null;
  tilt_deg: number | null;
  rc_value: number | null;
  u_value: number | null;
  lambda_value: number | null;
  insulation_thickness_mm: number | null;
  construction_type: string | null;
  insulation_type: string | null;
  finish_type: string | null;
  installation_type: string | null;
  fuel_type: string | null;
  efficiency: number | null;
  capacity_kw: number | null;
  year_installed: number | null;
  nokhoogte_m: number | null;
  bodemisolatie: boolean;
  brand: string | null;
  model_nr: string | null;
  cv_klasse: string | null;
  parent_element_id: string | null;
  perimeter_m: number | null;
  dikte_vloer_boven_mm: number | null;
  dikte_vloer_onder_mm: number | null;
  dikte_muren_mm: number | null;
  photo_urls: string[];
  is_complete: boolean;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
  // Migration 024 — Phase 2 calc fields (all nullable/defaulted, additive)
  dikte_vloerconstructie_mm: number | null;
  rekenhoogte_m_override: number | null;
  warmtecap_vloer_klasse: string | null;
  warmtecap_gevel_klasse: string | null;
  plafond_type: string | null;
  rc_source: string | null;
  isolatie_dikte_mm: number | null;
  isolatie_lambda: number | null;
  na_isolatie: boolean;
  na_isolatie_jaar: number | null;
  kruipruimte_hoogte_m: number | null;
  pv_aantal_panelen: number | null;
  pv_wp_per_paneel: number | null;
  pv_orientatie_deg: number | null;
  pv_hellingshoek_deg: number | null;
  pv_beschaduwing_klasse: string | null;
  tapwater_segments: Record<string, number[]> | null;
}
export interface Opening {
  id: string;
  element_id: string;
  opening_type: string;
  name: string | null;
  width_mm: number | null;
  height_mm: number | null;
  area_m2: number | null;
  glazing_type: string | null;
  frame_type: string | null;
  g_value: number | null;
  u_value_frame: number | null;
  u_value_glass: number | null;
  u_value_total: number | null;
  has_shading: boolean;
  shading_type: string | null;
  shading_factor: number | null;
  thermisch_onderbroken: boolean;
  overstek_m: number;
  belemmering: string | null;
  notes: string | null;
  // Migration 024 — Phase 2 calc fields (§4.2/4.3)
  u_glas: number | null;
  g_waarde: number | null;
  f_sh: number | null;
}
export interface InspectionSession {
  id: string;
  org_id: string;
  building_id: string;
  inspector_id: string;
  session_code: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_measurements: number;
  anomaly_count: number;
  sync_status: string;
  is_active: boolean;
}
export interface Measurement {
  id: string;
  session_id: string;
  device_id: string | null;
  value_mm: number;
  unit: string;
  measurement_type: string | null;
  is_anomaly: boolean;
  measured_at: string;
}
export interface BuildingFacadePhoto {
  id: string;
  org_id: string;
  building_id: string;
  session_id: string | null;
  direction: 'voor' | 'achter' | 'links' | 'rechts';
  photo_url: string;
  captured_at: string;
  created_at: string;
}

export type ContactRole = 'eigenaar' | 'huurder' | 'beheerder' | 'opdrachtgever';
export interface Contact {
  id: string;
  org_id: string;
  building_id: string | null;
  legacy_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: ContactRole | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnergyLabelSnapshot {
  id: string;
  org_id: string;
  building_id: string;
  session_id: string;
  energy_label: string;
  computed_at: string;
}

export interface BuildingSummary extends Building {
  full_address: string;
  zone_count: number;
  element_count: number;
  session_count: number;
  last_inspection_at: string | null;
  latest_energy_label: string | null;
}
export interface SessionSummary extends InspectionSession {
  inspector_name: string;
  building_address: string;
  building_city: string;
}
export interface RecentMeasurement extends Measurement {
  device_nickname: string;
  element_name: string;
  zone_name: string;
  building_address: string;
}

type R = never[];

type TableDef<Row, Ins = Partial<Row>, Upd = Partial<Row>> = {
  Row: Row;
  Insert: Ins;
  Update: Upd;
  Relationships: R;
};
type ViewDef<Row> = {
  Row: Row;
  Relationships: R;
};

export type Database = {
  public: {
    Tables: {
      organisations:       TableDef<Organisation>;
      user_profiles:       TableDef<UserProfile>;
      ble_devices:         TableDef<BleDevice, Omit<BleDevice, 'id'>>;
      buildings:           TableDef<Building>;
      element_defaults:    TableDef<ElementDefault>;
      rekenzones:          TableDef<Rekenzone>;
      zones:               TableDef<Zone>;
      building_elements:   TableDef<BuildingElement>;
      openings:            TableDef<Opening>;
      inspection_sessions: TableDef<InspectionSession>;
      measurements:        TableDef<Measurement>;
      contacts:            TableDef<Contact>;
    };
    Views: {
      building_summary:    ViewDef<BuildingSummary>;
      session_summary:     ViewDef<SessionSummary>;
      recent_measurements: ViewDef<RecentMeasurement>;
    };
    Functions: {
      close_inspection_session: {
        Args: { p_session_id: string };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
