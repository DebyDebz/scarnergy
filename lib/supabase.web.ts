import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[Supabase] EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set.\n' +
    'Run: cd scarnergy-app && npm start  (the prestart hook auto-detects the backend IP)'
  );
}

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
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
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

// Inject dev JWT into the Realtime WebSocket so RLS sees the correct identity.
// Without this, postgres_changes subscriptions are rejected as anonymous on web.
if (DEV_JWT) {
  supabase.realtime.setAuth(DEV_JWT);
}

export type { Database, Organisation, UserProfile, BleDevice, Building, Zone,
  BuildingElement, Opening, InspectionSession, Measurement, BuildingSummary,
  SessionSummary, RecentMeasurement } from "./supabase";
