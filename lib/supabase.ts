import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { getItemChunked, setItemChunked, removeItemChunked } from "./secureStore";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Missing config must NOT throw here: this module is imported during app
// bootstrap, and a module-scope throw kills the app before the first frame
// (builds 13/14 SIGSEGV'd at launch while native marshaled exactly this
// error). Export the problem instead; the root layout renders a readable
// configuration-error screen.
export const supabaseConfigError: string | null =
  !SUPABASE_URL || !SUPABASE_ANON_KEY
    ? '[Supabase] EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set.\n' +
      'Dev: npm start (the prestart hook auto-detects the backend IP).\n' +
      'Release: set them in the eas.json build profile env.'
    : null;

const supabaseStorage =
  Platform.OS === "web"
    ? {
        getItem:    (key: string) => Promise.resolve(localStorage.getItem(key)),
        setItem:    (key: string, value: string) => { localStorage.setItem(key, value); return Promise.resolve(); },
        removeItem: (key: string) => { localStorage.removeItem(key); return Promise.resolve(); },
      }
    : {
        // Chunked adapter: the Supabase session exceeds SecureStore's ~2048-byte
        // single-value limit, so we split it across keychain entries. See
        // lib/secureStore.ts. Legacy single-value sessions are read as a fallback.
        getItem:    (key: string) => getItemChunked(key),
        setItem:    (key: string, value: string) => setItemChunked(key, value),
        removeItem: (key: string) => removeItemChunked(key),
      };

const DEV_JWT = process.env.EXPO_PUBLIC_DEV_JWT;

function devFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${DEV_JWT}`);
  return fetch(input, { ...init, headers });
}

export const supabase = createClient(
  // Fallbacks keep createClient from throwing when config is missing; the
  // config-error screen prevents any real request from being made.
  SUPABASE_URL ?? "http://supabase-config-missing.invalid",
  SUPABASE_ANON_KEY ?? "supabase-config-missing",
  {
    auth: {
      storage: supabaseStorage,
      // In dev-bypass mode skip token refresh and session persistence entirely —
      // all requests already carry DEV_JWT so there is nothing to refresh, and
      // persisting a fake session causes Supabase to fire a slow refresh request
      // on every cold start before INITIAL_SESSION resolves.
      autoRefreshToken: !DEV_JWT,
      persistSession:   !DEV_JWT,
      detectSessionInUrl: false,
    },
    ...(DEV_JWT ? { global: { fetch: devFetch } } : {}),
  }
);

// WebSocket (Realtime) doesn't go through devFetch — set the token directly
// so RLS sees the correct identity for postgres_changes subscriptions.
if (DEV_JWT) {
  supabase.realtime.setAuth(DEV_JWT);
}

export type Database = {
  public: {
    Tables: {
      organisations:       { Row: Organisation };
      user_profiles:       { Row: UserProfile };
      ble_devices:         { Row: BleDevice };
      buildings:           { Row: Building };
      rekenzones:          { Row: Rekenzone };
      zones:               { Row: Zone };
      building_elements:   { Row: BuildingElement };
      openings:            { Row: Opening };
      inspection_sessions: { Row: InspectionSession };
      measurements:        { Row: Measurement };
    };
    Views: {
      building_summary:    { Row: BuildingSummary };
      session_summary:     { Row: SessionSummary };
      recent_measurements: { Row: RecentMeasurement };
    };
  };
};

export interface Organisation {
  id: string; name: string; city: string; settings: Record<string, unknown>;
}
export interface UserProfile {
  id: string; org_id: string; role: string; full_name: string; is_active: boolean;
}
export interface BleDevice {
  id: string; org_id: string; mac_address: string; nickname: string; device_type: string;
  battery_level: number | null; last_connected_at: string | null; is_active: boolean;
}
export interface Building {
  id: string; org_id: string; reference_code: string; street: string;
  house_number: string; postal_code: string; city: string;
  building_type: string; construction_year: number; gross_floor_area_m2: number;
  is_active: boolean;
  latitude: number | null; longitude: number | null;
  // BAG / 3DBAG cache (migration 026) — written by the web API route,
  // display-only on mobile via the normal buildings/building_summary reads.
  bag_pand_id: string | null; bag_vbo_id: string | null;
  bag_bouwjaar: number | null; bag_oppervlakte_m2: number | null;
  bag_gebruiksdoel: string | null; dbag_hoogte_m: number | null;
  bag_fetched_at: string | null;
}
export interface Rekenzone {
  id: string; org_id: string; building_id: string; name: string;
  description: string | null; notes: string | null;
  sort_order: number; is_active: boolean;
}
export interface Zone {
  id: string; building_id: string; zone_code: string; name: string;
  floor_level: number; gross_area_m2: number; energy_label: string | null;
  ceiling_height_m: number | null; description: string | null;
  rekenzone_id: string | null;
  is_active: boolean;
  floor_plan_points: Array<{ x: number; y: number }> | null;
  floor_plan_scale_m: number | null;
  floor_plan_image_url: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface BuildingElement {
  id: string; zone_id: string; element_type: string; name: string;
  description: string | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null;
  area_m2: number | null;
  orientation_deg: number | null;
  tilt_deg: number | null;
  rc_value: number | null; u_value: number | null;
  lambda_value: number | null; insulation_thickness_mm: number | null;
  construction_type: string | null; insulation_type: string | null; finish_type: string | null;
  installation_type: string | null; fuel_type: string | null;
  efficiency: number | null; capacity_kw: number | null; year_installed: number | null;
  // Migration 017 — NTA 8800 fields
  nokhoogte_m: number | null;
  bodemisolatie: boolean;
  brand: string | null;
  model_nr: string | null;
  cv_klasse: string | null;
  // Migration 018 — dakkapel + perimeter/thickness
  parent_element_id: string | null;
  perimeter_m: number | null;
  dikte_vloer_boven_mm: number | null;
  dikte_vloer_onder_mm: number | null;
  dikte_muren_mm: number | null;
  photo_urls: string[];
  is_complete: boolean; is_active: boolean; sort_order: number;
  notes: string | null;
  grid_x: number | null; grid_y: number | null;
  grid_w: number | null; grid_h: number | null;
  grid_rotation: number | null;
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
  id: string; org_id: string; element_id: string; opening_type: string;
  name: string | null;
  width_mm: number | null; height_mm: number | null; area_m2: number | null;
  glazing_type: string | null; frame_type: string | null;
  g_value: number | null; u_value_frame: number | null; u_value_glass: number | null; u_value_total: number | null;
  has_shading: boolean; shading_type: string | null; shading_factor: number | null;
  // Migration 017 — NTA 8800 fields
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
  id: string; org_id: string; building_id: string; inspector_id: string;
  session_code: string; status: string; started_at: string; completed_at: string | null;
  total_measurements: number; anomaly_count: number; sync_status: string;
  notes: string | null;
  flow_stage: number;
}
export interface Measurement {
  id: string; session_id: string; device_id: string | null; value_mm: number;
  unit: string; measurement_type: string | null; is_anomaly: boolean; measured_at: string;
  org_id: string; inspector_id: string | null; element_id: string | null;
  is_deleted: boolean; ingestion_path: string | null;
}
export interface BuildingSummary extends Building {
  full_address: string; zone_count: number; element_count: number;
  session_count: number; last_inspection_at: string | null; latest_energy_label: string | null;
}
export interface SessionSummary extends InspectionSession {
  inspector_name: string; building_address: string; building_city: string;
}
export interface RecentMeasurement extends Measurement {
  device_nickname: string; element_name: string; zone_name: string; building_address: string;
}
export interface BuildingFacadePhoto {
  id: string; org_id: string; building_id: string; session_id: string | null;
  direction: 'voor' | 'achter' | 'links' | 'rechts';
  photo_url: string; captured_at: string; created_at: string;
}
