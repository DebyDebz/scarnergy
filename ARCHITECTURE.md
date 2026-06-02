# ScanergyV2 — Architecture

## Data Flow

```
Bosch GLM 50C (Bluetooth LE)
        │
        │  BLE — native radio
        │  iOS: CoreBluetooth
        │  Android: BluetoothGATT
        ▼
Scarnergy Mobile App  (Expo / React Native)
react-native-ble-plx  ·  hooks/useBLEDevice.ts
        │
        │  HTTPS POST
        │  supabase.from("measurements").insert()
        │  Falls back to offline queue (useSyncQueue) when no network
        ▼
Kong API Gateway  :54321 (host) → :8000 (container internal)
        │
        ├──▶  /auth/v1      → GoTrue (auth:9999)
        ├──▶  /rest/v1      → PostgREST (rest:3000)
        ├──▶  /realtime/v1  → Supabase Realtime (realtime:4000/socket)
        └──▶  /ai           → FastAPI AI Server  (ai_server:8001)
        │
        ▼
TimescaleDB  (PostgreSQL 15 + TimescaleDB extension)
scarnergy_db  :54322
        │
        │  Logical replication  (supabase_realtime publication)
        ▼
Supabase Realtime  (postgres_changes WebSocket)
        │
        │  ws://  channel: session-live:{session_id}
        ▼
All subscribed clients re-render instantly
(mobile app, web dashboard, supervisor view)
```

---

## Rule: BLE never runs on the server

The Nvidia server has **no Bluetooth hardware and must never have BlueZ installed**.
BlueZ opens a raw HCI socket — a kernel-level interface that is unnecessary and
inadvisable on a GPU inference / database server.

BLE lives on one of two places only:

| Where | How | Use case |
|---|---|---|
| Inspector's phone / tablet | `react-native-ble-plx` (native iOS/Android BLE API) | Primary — inspector carries the phone on-site |
| Dedicated on-site bridge device (Raspberry Pi, laptop) | Python `ble_bridge/` with `bleak` (needs BlueZ on *that* device) | Optional headless mode — device stays mounted in the building |

Both paths write JSON to the server over HTTPS or MQTT. The server only ever sees a
JSON payload, never a BLE packet.

---

## Services (Docker Compose)

| Container | Image | Port | Role |
|---|---|---|---|
| `scarnergy_db` | `timescale/timescaledb:2.13.0-pg15` | 54322 | Primary data store + hypertables |
| `scarnergy_auth` | `supabase/gotrue` | 9999 | JWT auth, user management |
| `scarnergy_rest` | `postgrest/postgrest` | 3000 | Auto-generated REST API from schema |
| `scarnergy_realtime` | `supabase/realtime` | 4000 | WebSocket live-query relay |
| `scarnergy_studio` | `supabase/studio` | 54323 | DB admin UI |
| `scarnergy_meta` | `supabase/postgres-meta` | 8081 | Schema introspection |
| `scarnergy_kong` | `kong:2.8.1` | 54321→8000 | API gateway, single entry point |
| `ai_server` | (local FastAPI) | — | Energy label prediction, anomaly scoring |
| `mosquitto` (optional) | `eclipse-mosquitto` | 1883 | MQTT broker for bridge device path |

---

## Real-time Rendering

Measurements arrive live on any screen via Supabase Realtime:

```
supabase
  .channel("session-live:{session_id}")
  .on("postgres_changes", { event: "INSERT", table: "measurements",
       filter: "session_id=eq.{id}" }, handler)
  .subscribe()
```

**Prerequisite (migration 006):** the `measurements` table must have
`REPLICA IDENTITY FULL` and be added to the `supabase_realtime` publication.
TimescaleDB hypertable chunks are created on demand — the publication must be
applied to the parent table before any chunks are written.

```sql
ALTER TABLE measurements REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE measurements;
```

---

## Mobile App — Key Files

```
scarnergy-app/
  hooks/
    useBLEDevice.ts          BLE scan, connect, decode GLM packets, expose deviceId
    useLiveMeasurements.ts   Supabase Realtime subscription for a session's measurements
    useSyncQueue.ts          Offline queue — drains to Supabase when network returns
  lib/
    BLEContext.tsx           Single shared BleManager instance for the whole app
    supabase.ts              Supabase client + TypeScript types
  app/tabs/sessions/
    index.tsx                Session list
    [id].tsx                 Session detail — BLE streaming + live measurement feed
  components/ble/
    MeasurementInput.tsx     Single-capture BLE input field (used in element forms)
```

---

## Python Bridge (headless only)

`ble_bridge/bridge.py` — runs on a Pi or laptop **that physically has a BT adapter**.
It is **not** intended for the Nvidia server.

```
start-bridge.sh
  1. Detects available hciX adapters  (/sys/class/bluetooth/)
  2. Lets operator pick one if multiple
  3. Powers on the adapter via bluetoothctl
  4. Scans for GLM 50C devices
  5. Launches bridge.py --adapter hci0 --org-id ... --session-id ...

bridge.py
  - Connects to up to 5 GLM devices simultaneously
  - Fans out each measurement to 3 channels:
      WebSocket  ws://localhost:8765   (local UI)
      MQTT       scarnergy/{org}/devices/{device}/measurements
      Supabase   measurements table (direct insert)
```

---

## Database Schema (summary)

```
organisations
  └── user_profiles          (inspectors, supervisors, admins)
  └── ble_devices            (registered GLM 50C units)
  └── buildings
        └── zones
              └── building_elements
                    └── openings
  └── inspection_sessions
        └── measurements     ← TimescaleDB hypertable (partitioned by measured_at, 1-week chunks)
              └── measurements_hourly  (continuous aggregate for dashboards)
```

Row-level security is enforced at the database level — every query is scoped to
`auth.user_org_id()` from the JWT. Inspectors see only their own sessions;
supervisors and admins see the full org.
