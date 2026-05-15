export type Role = "inspector" | "supervisor" | "admin";

export interface Organisation {
  id: string; name: string; city: string; settings: Record<string, unknown>;
}
export interface UserProfile {
  id: string; org_id: string; role: Role; full_name: string; email: string; is_active: boolean;
}
export interface BleDevice {
  id: string; org_id: string; mac_address: string; nickname: string;
  battery_level: number | null; last_connected_at: string | null; is_active: boolean;
}
export interface Building {
  id: string; org_id: string; reference_code: string; street: string;
  house_number: string; postal_code: string; city: string;
  building_type: string; construction_year: number; gross_floor_area_m2: number;
}
export interface Zone {
  id: string; building_id: string; zone_code: string; name: string;
  floor_level: number; gross_area_m2: number; energy_label: string | null;
  is_active: boolean; updated_at: string;
}
export interface BuildingElement {
  id: string; zone_id: string; element_type: string; name: string;
  length_mm: number | null; width_mm: number | null; height_mm: number | null;
  rc_value: number | null; u_value: number | null; is_complete: boolean; is_active: boolean;
}
export interface Opening {
  id: string; element_id: string; opening_type: string;
  width_mm: number | null; height_mm: number | null;
  glazing_type: string | null; u_value_total: number | null;
}
export interface InspectionSession {
  id: string; org_id: string; building_id: string; inspector_id: string;
  session_code: string; status: "active" | "paused" | "completed";
  started_at: string; completed_at: string | null;
  total_measurements: number; anomaly_count: number; sync_status: string;
  report_url: string | null;
}
export interface Measurement {
  id: string; session_id: string; device_id: string | null; element_id: string | null;
  value_mm: number; unit: string; measurement_type: string | null;
  is_anomaly: boolean; measured_at: string; ingestion_path: string;
}
export interface BuildingSummary extends Building {
  full_address: string; zone_count: number; element_count: number;
  session_count: number; last_inspection_at: string | null; latest_energy_label: string | null;
}
export interface SessionSummary extends InspectionSession {
  inspector_name: string; building_address: string; building_city: string;
}
export interface RecentMeasurement extends Measurement {
  device_nickname: string; element_name: string | null;
  zone_name: string | null; building_address: string;
}
export interface AnomalyFeedRow {
  id: string; org_id: string; session_id: string;
  element_id: string | null; device_id: string | null;
  measured_at: string; value_mm: number; unit: string;
  is_anomaly: boolean; anomaly_score: number | null;
  classifier_label: string | null; validation_message: string | null;
  ingestion_path: string | null;
  session_code: string; building_id: string; building_address: string;
  device_nickname: string; element_name: string | null;
  zone_name: string | null; inspector_name: string;
}

export type Database = {
  public: {
    Tables: {
      organisations:       { Row: Organisation;       Insert: Partial<Organisation>;       Update: Partial<Organisation> };
      user_profiles:       { Row: UserProfile;        Insert: Partial<UserProfile>;        Update: Partial<UserProfile> };
      ble_devices:         { Row: BleDevice;          Insert: Partial<BleDevice>;          Update: Partial<BleDevice> };
      buildings:           { Row: Building;           Insert: Partial<Building>;           Update: Partial<Building> };
      zones:               { Row: Zone;               Insert: Partial<Zone>;               Update: Partial<Zone> };
      building_elements:   { Row: BuildingElement;    Insert: Partial<BuildingElement>;    Update: Partial<BuildingElement> };
      openings:            { Row: Opening;            Insert: Partial<Opening>;            Update: Partial<Opening> };
      inspection_sessions: { Row: InspectionSession;  Insert: Partial<InspectionSession>;  Update: Partial<InspectionSession> };
      measurements:        { Row: Measurement;        Insert: Partial<Measurement>;        Update: Partial<Measurement> };
    };
    Views: {
      building_summary:    { Row: BuildingSummary };
      session_summary:     { Row: SessionSummary };
      recent_measurements: { Row: RecentMeasurement };
      anomaly_feed:        { Row: AnomalyFeedRow };
    };
    Functions: {
      close_inspection_session: {
        Args: { p_session_id: string };
        Returns: InspectionSession;
      };
    };
  };
};
