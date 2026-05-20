import { createClient } from "@supabase/supabase-js";

const webStorage = {
  getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
  setItem: (key: string, value: string) => { localStorage.setItem(key, value); return Promise.resolve(); },
  removeItem: (key: string) => { localStorage.removeItem(key); return Promise.resolve(); },
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
      storage: webStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    ...(DEV_JWT ? { global: { fetch: devFetch } } : {}),
  }
);

export type { Database, Organisation, UserProfile, BleDevice, Building, Zone,
  BuildingElement, Opening, InspectionSession, Measurement, BuildingSummary,
  SessionSummary, RecentMeasurement } from "./supabase";
