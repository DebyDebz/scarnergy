# Scarnergy v2.0 — System Architecture

## Overview

Scarnergy is a mobile-first energy audit platform for Dutch building inspectors (NTA 8800 standard). Inspectors carry an iOS/Android device and a Bosch GLM 50C laser distance meter. Measurements flow from the GLM over Bluetooth into the app, are stored locally with instant sync to a self-hosted backend, and processed by an AI server for anomaly detection and measurement classification.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FIELD (on-site)                                                        │
│                                                                         │
│  ┌─────────────┐  BLE GATT   ┌──────────────────────────────────────┐  │
│  │  Bosch GLM  │ ──────────► │   Expo React Native App (iOS/Android) │  │
│  │   50C       │             │   • BLE measurement capture           │  │
│  └─────────────┘             │   • Session management                │  │
│                              │   • Offline-first sync queue          │  │
│                              └────────────┬─────────────────────────┘  │
│                                           │ HTTPS REST + Realtime WS    │
└───────────────────────────────────────────┼─────────────────────────────┘
                                            │
                    ┌───────────────────────▼───────────────────────┐
                    │  BACKEND  (Docker Compose, self-hosted)        │
                    │                                                │
                    │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
                    │  │  Kong    │  │ GoTrue   │  │ PostgREST  │  │
                    │  │ (Gateway)│  │ (Auth)   │  │ (REST API) │  │
                    │  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
                    │       │             │               │          │
                    │  ┌────▼─────────────▼───────────────▼──────┐  │
                    │  │   PostgreSQL 15 + TimescaleDB            │  │
                    │  │   (Scarnergy schema + Metabase schema)   │  │
                    │  └───────────────────────────────────────── ┘  │
                    │                                                │
                    │  ┌──────────────┐  ┌──────────────────────┐   │
                    │  │  Supabase    │  │  Realtime            │   │
                    │  │  Studio      │  │  (postgres_changes   │   │
                    │  │  (port 54323)│  │   WebSocket)         │   │
                    │  └──────────────┘  └──────────────────────┘   │
                    │                                                │
                    │  ┌──────────────┐  ┌──────────────────────┐   │
                    │  │  Mosquitto   │  │  FastAPI AI Server   │   │
                    │  │  MQTT broker │  │  (anomaly detection, │   │
                    │  │  port 1883   │  │   ML classification) │   │
                    │  └──────────────┘  └──────────────────────┘   │
                    │                                                │
                    │  ┌──────────────┐                             │
                    │  │  Grafana     │                             │
                    │  │  (metrics)   │                             │
                    │  └──────────────┘                             │
                    └────────────────────────────────────────────────┘
```

---

## Component Inventory

### Mobile App — `scarnergy-app/`

| File / Folder | Role |
|---|---|
| `app/_layout.tsx` | Root navigator; bootstraps auth, injects DEV_BYPASS profile |
| `app/tabs/index.tsx` | Dashboard: stats + recent sessions |
| `app/tabs/buildings.tsx` | Building list; tap to start inspection |
| `app/tabs/sessions/index.tsx` | Session list + new-session modal |
| `app/tabs/sessions/[id].tsx` | Session detail: zone picker, element list, live measurements |
| `app/tabs/sessions/inspect.tsx` | Element inspector: BLE slot fill, save, photo |
| `app/tabs/sessions/floorplan.tsx` | SVG floor-plan overlay |
| `app/tabs/device.tsx` | BLE scanner/device status |
| `hooks/useBLEDevice.ts` | Core BLE hook (GLM 50C protocol, GATT subscribe, CMD_ENABLE) |
| `hooks/useBLEDevice.web.ts` | Web stub (BLE not available in browser) |
| `hooks/useLiveMeasurements.ts` | Supabase Realtime subscription for live measurement feed |
| `hooks/useSyncQueue.ts` | Offline sync queue (pending writes → drain on reconnect) |
| `hooks/bleDecoder.ts` | Pure BLE packet decoder (testable without React/native) |
| `lib/BLEContext.tsx` | React context wrapping `useBLEDevice` — shared across all screens |
| `lib/supabase.ts` | Supabase client (native: SecureStore session, devFetch injects JWT) |
| `lib/supabase.web.ts` | Supabase client for web (localStorage session, Realtime auth) |
| `store/authStore.ts` | Zustand auth store: session, user, profile |
| `scripts/detect-dev-ip.sh` | Auto-detects LAN IP and updates `.env` before Metro starts |
| `__tests__/bleDecoder.test.ts` | 29 unit tests for BLE packet decode and dispatch logic |

### Backend — `infrastructure/`

| Container | Image | Port | Role |
|---|---|---|---|
| `scarnergy_kong` | Kong 2.8.1 | 54321 (HTTP), 54320 (HTTPS) | API Gateway — routes to PostgREST, GoTrue, Realtime |
| `scarnergy_rest` | PostgREST 12.2.0 | 3000 (internal) | REST API generated from PostgreSQL schema |
| `scarnergy_auth` | GoTrue | 9999 | JWT auth, user management |
| `scarnergy_realtime` | Supabase Realtime | 4000 (internal) | postgres_changes → WebSocket broadcast |
| `scarnergy_db` | PostgreSQL 15 + TimescaleDB | 54322 | Primary database |
| `scarnergy_studio` | Supabase Studio | 54323 | Database admin UI |
| `scarnergy_mqtt` | Eclipse Mosquitto | 1883 (MQTT), 9001 (WS) | IoT device communication |
| `scarnergy_ai` | FastAPI (Python) | 8001 | Anomaly detection, ML measurement classification |
| `scarnergy_grafana` | Grafana | 3001 | Metrics dashboards |
| `scarnergy_metabase` | Metabase | 13002 | Business intelligence |

---

## Database Schema

### Schema: `public`

```
organisations
  id · name · kvk_number · address · city · country · email · settings · is_active

user_profiles  (extends auth.users)
  id → auth.users · org_id → organisations · role · full_name · certifications · is_active

ble_devices
  id · org_id → organisations · device_type · mac_address · nickname · battery_level

buildings
  id · org_id · reference_code · bag_id · street · house_number · postal_code · city
  building_type · construction_year · gross_floor_area_m2 · num_floors

  └── zones
        id · building_id · zone_code · name · floor_level · gross_area_m2
        energy_label · primary_energy_demand

        └── building_elements
              id · zone_id · element_type (gevel/dak/vloer/installatie/transparant_deel)
              name · length_mm · width_mm · height_mm · orientation_deg
              rc_value · u_value · construction_type · is_complete

              └── openings
                    id · element_id · opening_type · width_mm · height_mm
                    glazing_type · u_value_total

inspection_sessions
  id · org_id · building_id · inspector_id · session_code (INS-YYYY-NNNN)
  status (active/paused/completed/cancelled) · started_at · completed_at
  total_measurements · anomaly_count · sync_status

measurements  (TimescaleDB hypertable — partitioned by measured_at)
  measured_at · id · org_id · session_id · device_id (nullable) · inspector_id
  element_id (optional) · value_mm · unit · measurement_type
  anomaly_score · is_anomaly · classifier_label · classifier_confidence
  ingestion_path (mobile/python_bridge/esp32) · is_deleted

sync_queue
  id · org_id · inspector_id · table_name · record_id · operation · payload
  sync_status · retry_count
```

### Views

| View | Purpose |
|---|---|
| `session_summary` | Joins `inspection_sessions` + `user_profiles` (inspector_name) + `buildings` (building_address, building_city) |
| `building_summary` | Joins `buildings` + zone/element/session counts + latest energy label |
| `recent_measurements` | Last 100 measurements per session with device/element/zone names |

### TimescaleDB Policies (on `measurements`)

- Hypertable with 1-week chunk interval
- Retention: 10 years
- Continuous aggregate: `measurements_hourly` (1-hour buckets, org + device + element)
- Refreshed every 30 minutes

---

## Security Model

### JWT Structure

Every API call carries a JWT. Two types are in use:

**Dev bypass JWT** (`EXPO_PUBLIC_DEV_JWT`) — hardcoded in `.env`, signed with the demo JWT secret:
```json
{
  "sub":       "00000000-0000-0000-0000-000000000000",
  "org_id":    "00000000-0000-0000-0000-000000000001",
  "user_role": "admin",
  "role":      "authenticated",
  "exp":       2051218800
}
```

**Production JWT** — issued by GoTrue on login; enriched with `org_id` and `user_role` claims via a `custom_access_token_hook` PostgreSQL function (migration 006).

### Row-Level Security (RLS)

Every table has RLS enabled. Policies call:
- `auth.user_org_id()` → reads `org_id` claim from JWT
- `auth.user_profile_id()` → reads `sub` (auth.uid())
- `auth.is_privileged()` → role IN ('admin', 'supervisor', 'service_role')

| Table | Policy logic |
|---|---|
| `buildings`, `zones`, `building_elements` | `org_id = auth.user_org_id()` |
| `inspection_sessions` | `org_id = auth.user_org_id()` AND (`inspector_id = uid` OR is_privileged) |
| `measurements` | `org_id = auth.user_org_id()` AND (`inspector_id = uid` OR is_privileged) |

The `service_role` key bypasses RLS entirely — used only by server-side processes.

---

## BLE Protocol — Bosch GLM 50C

The GLM 50C advertises over BLE using a proprietary Bosch GATT service:

```
Service:         02a6c0d0-0451-4000-b000-fb3210111989  (d0)
Characteristic:  02a6c0d1-0451-4000-b000-fb3210111989  (d1)
```

Two packet types flow through the same characteristic:

### 4-byte Continuous Heartbeat (streaming mode)
```
C0 <type> <hi> <lo>
Byte 0: 0xC0 = streaming marker
Byte 1: measurement sub-type
Bytes 2-3: big-endian uint16 in cm → multiply by 10 for mm
```
Emitted ~2Hz when the GLM is active. Used as a live preview display and as a fallback when CMD_ENABLE fails.

### 8-byte Trigger-Press Indication (tap mode)
```
C0 55 10 06 <batt> ?? <flags> <float32 LE in metres>
Bytes 7-10: IEEE 754 float32 little-endian (metres) → multiply by 1000 for mm
Byte 4: battery level (0-100)
```
Emitted when the physical trigger button is pressed. Requires `CMD_ENABLE` to be written to the characteristic after subscribing.

### CMD_ENABLE Write
```
C0 55 02 01 00 1A  (base64: wFUCAQAa)
```
Must be written AFTER subscribing, with a short delay (≥400ms). Retried up to 3 times with increasing backoff. If all attempts fail, the app falls back to capturing continuous heartbeat packets instead.

**CRITICAL:** Only subscribe to the `d0/d1` characteristic. The Bosch `f0` service (proprietary) will cause an immediate disconnect if CCCDs are enabled on its characteristics.

---

## Network Topology

### Local Development

```
Mac (developer machine)
├── Docker Compose stack
│   ├── 192.168.10.x:54321  →  Kong (API Gateway)
│   ├── 192.168.10.x:54322  →  PostgreSQL (direct, migrations only)
│   ├── 192.168.10.x:54323  →  Supabase Studio
│   ├── 192.168.10.x:1883   →  MQTT (TCP)
│   ├── 192.168.10.x:9001   →  MQTT (WebSocket)
│   └── 192.168.10.x:8001   →  AI Server
├── Metro Bundler (port 8082)
└── Wi-Fi: LAN IP auto-detected by scripts/detect-dev-ip.sh
```

### IP Auto-Detection Flow

Every `npm start` runs `prestart → scripts/detect-dev-ip.sh` which:
1. Detects current LAN IP (macOS `en0`/`en1`, Linux `hostname -I`)
2. Verifies Supabase responds on port 54321 at that IP
3. Rewrites `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_AI_SERVER_URL` in `scarnergy-app/.env`
4. Starts Metro → bundle bakes the correct IP in

Only `scarnergy-app/.env` is touched. The Docker stack uses internal container DNS (`kong:8000`) and is unaffected.

---

## Data Flow Summary

```
[User taps trigger on GLM 50C]
         │
         │ BLE GATT notification (d0/d1 characteristic)
         ▼
[useBLEDevice.ts: handleMeasurement()]
  • decodePacket() → GLMMeasurement { value_mm, is_continuous, battery_level }
  • if is_continuous=false → dispatch immediately (trigger press)
  • if is_continuous=true  → dispatch only if pendingMeasurementRef armed
         │
         ▼
[onMeasurementRef callback → inspect.tsx]
  • Finds the active slot (activeSlotRef) or first unfilled slot
  • setValues({ [slot]: value_mm.toFixed(1) })
         │
         ▼
[User taps Save]
  • UPDATE building_elements SET length_mm/height_mm/width_mm, is_complete
  • INSERT INTO measurements (one row per filled slot)
  • Optimistic UI update via useLiveMeasurements.addMeasurement()
         │
         ▼
[Supabase Realtime]
  • postgres_changes INSERT event → useLiveMeasurements
  • session_summary view refreshes (total_measurements counter)
```
