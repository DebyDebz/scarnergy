import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const supabaseStorage =
  Platform.OS === "web"
    ? {
        getItem:    (key: string) => Promise.resolve(localStorage.getItem(key)),
        setItem:    (key: string, value: string) => { localStorage.setItem(key, value); return Promise.resolve(); },
        removeItem: (key: string) => { localStorage.removeItem(key); return Promise.resolve(); },
      }
    : {
        getItem:    (key: string) => SecureStore.getItemAsync(key),
        setItem:    (key: string, value: string) => SecureStore.setItemAsync(key, value),
        removeItem: (key: string) => SecureStore.deleteItemAsync(key),
      };

const DEV_JWT = process.env.EXPO_PUBLIC_DEV_JWT;

function devFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${DEV_JWT}`);
  return fetch(input, { ...init, headers });
}

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: supabaseStorage,
      autoRefreshToken: true,
      persistSession: true,
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
  id: string; org_id: string; mac_address: string; nickname: string;
  battery_level: number | null; last_connected_at: string | null; is_active: boolean;
}
export interface Building {
  id: string; org_id: string; reference_code: string; street: string;
  house_number: string; postal_code: string; city: string;
  building_type: string; construction_year: number; gross_floor_area_m2: number;
  is_active: boolean;
}
export interface Zone {
  id: string; building_id: string; zone_code: string; name: string;
  floor_level: number; gross_area_m2: number; energy_label: string | null;
  is_active: boolean;
}
export interface BuildingElement {
  id: string; zone_id: string; element_type: string; name: string;
  description: string | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null;
  area_m2: number | null;
  orientation_deg: number | null;
  rc_value: number | null; u_value: number | null;
  construction_type: string | null; insulation_type: string | null;
  photo_urls: string[];
  is_complete: boolean; is_active: boolean; sort_order: number;
  notes: string | null;
}
export interface Opening {
  id: string; element_id: string; opening_type: string;
  width_mm: number | null; height_mm: number | null; glazing_type: string | null; u_value_total: number | null;
}
export interface InspectionSession {
  id: string; org_id: string; building_id: string; inspector_id: string;
  session_code: string; status: string; started_at: string; completed_at: string | null;
  total_measurements: number; anomaly_count: number; sync_status: string;
  notes: string | null;
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
