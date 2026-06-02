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
export interface UserProfile {
  id: string;
  org_id: string;
  role: Role;
  full_name: string;
  is_active: boolean;
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
}
export interface Zone {
  id: string;
  building_id: string;
  zone_code: string;
  name: string;
  floor_level: number;
  gross_area_m2: number;
  energy_label: string | null;
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
  rc_value: number | null;
  u_value: number | null;
  construction_type: string | null;
  insulation_type: string | null;
  photo_urls: string[];
  is_complete: boolean;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
}
export interface Opening {
  id: string;
  element_id: string;
  opening_type: string;
  width_mm: number | null;
  height_mm: number | null;
  glazing_type: string | null;
  u_value_total: number | null;
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
      zones:               TableDef<Zone>;
      building_elements:   TableDef<BuildingElement>;
      openings:            TableDef<Opening>;
      inspection_sessions: TableDef<InspectionSession>;
      measurements:        TableDef<Measurement>;
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
