/**
 * Mobile client for the web dashboard's mobile-facing AppSheet endpoints
 * (web/app/api/appsheet/mobile/*). Mirrors lib/floorplanDetect.ts's
 * AbortController/timeout/typed-error pattern.
 *
 * The mobile app never holds the AppSheet ApplicationAccessKey — it only
 * ever calls these proxy routes, authenticated with the inspector's own
 * Supabase session token (never AppSheet's own key).
 */
import { useAuthStore } from "../store/authStore";

const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL;
const REQUEST_TIMEOUT_MS = 20000;

export class AppsheetProxyError extends Error {}

async function callProxy<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  if (!WEB_APP_URL) {
    throw new AppsheetProxyError("AppSheet sync is not configured (EXPO_PUBLIC_WEB_APP_URL is unset).");
  }
  const token = useAuthStore.getState().session?.access_token;
  if (!token) {
    throw new AppsheetProxyError("You must be signed in to use AppSheet sync.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${WEB_APP_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new AppsheetProxyError(
      e?.name === "AbortError"
        ? "AppSheet request timed out."
        : "Could not reach the AppSheet sync service."
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppsheetProxyError(data?.error ?? `AppSheet request failed (${res.status}).`);
  }
  return data as T;
}

export interface AppsheetBuilding {
  id: string;
  full_address: string;
  street: string;
  city: string;
  postal_code: string;
  building_type: string;
  construction_year: number;
  gross_floor_area_m2: number;
  bag_bouwjaar: number | null;
  bag_oppervlakte_m2: number | null;
  dbag_hoogte_m: number | null;
  bag_gebruiksdoel: string | null;
  zone_count: number;
  element_count: number;
  session_count: number;
  latest_energy_label: string | null;
}

export async function fetchAppsheetBuildings(): Promise<AppsheetBuilding[]> {
  const data = await callProxy<{ buildings: AppsheetBuilding[] }>("/api/appsheet/mobile/buildings");
  return data.buildings;
}

export interface AppsheetSessionSummary {
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
  inspector_name: string;
  building_address: string;
  building_city: string;
}

export async function fetchAppsheetSessions(buildingId?: string): Promise<AppsheetSessionSummary[]> {
  const path = buildingId
    ? `/api/appsheet/mobile/sessions?buildingId=${encodeURIComponent(buildingId)}`
    : "/api/appsheet/mobile/sessions";
  const data = await callProxy<{ sessions: AppsheetSessionSummary[] }>(path);
  return data.sessions;
}

export interface AppsheetDashboardStats {
  activeSessions: number;
  totalBuildings: number;
  measurementsToday: number;
  recentSessions: AppsheetSessionSummary[];
}

export async function fetchAppsheetDashboardStats(): Promise<AppsheetDashboardStats> {
  return callProxy<AppsheetDashboardStats>("/api/appsheet/mobile/dashboard-stats");
}

export async function materializeAppsheetBuilding(objectId: string): Promise<string> {
  const data = await callProxy<{ id: string }>("/api/appsheet/mobile/buildings", { action: "materialize", objectId });
  return data.id;
}

export interface SessionCloseSyncResult {
  table: string;
  id: string;
  status: "added" | "edited" | "skipped" | "failed";
  reason?: string;
}

export async function pushSessionResultsToAppsheet(payload: {
  buildingId: string;
  zones: unknown[];
  elements: unknown[];
  openings: unknown[];
}): Promise<SessionCloseSyncResult[]> {
  const data = await callProxy<{ results: SessionCloseSyncResult[] }>("/api/appsheet/mobile/session-close", payload);
  return data.results;
}
