# ScanergyV2 — Data Structure Reference

How data is modeled and moves through the app: Postgres/Supabase schema, TypeScript types, client-side state, and the device → mobile → Supabase → web data flow.

> Generated from a repo audit on 2026-07-28. Source of truth is always the migrations in `supabase/migrations/` — if this doc and the SQL disagree, the SQL wins.

## 1. Database schema (Supabase / Postgres + TimescaleDB)

Source: `supabase/migrations/001_extensions.sql` through `027_element_defaults.sql`, plus `0071_views_functions.sql`, `0072_nta8800_fields.sql`, `0073_floor_plan_image.sql`, `0074_floor_plan_grid.sql`. Migrations run in lexical order: 001–009, then `0071`–`0074` (numbered as follow-ups to 007, not a separate sequence), then 010–027. `012_recover_missing_tables.sql` is a full idempotent re-definition of everything in 002–004+007 (needed because `auth.users` didn't exist yet when 002 first ran) — it adds no new concepts, just guarantees they exist.

### Extensions (`001_extensions.sql`)
`pgcrypto` (UUIDs), `pg_trgm` (fuzzy search), `pg_stat_statements`, **timescaledb** (measurements hypertable), `postgis` (optional), `vector` (optional/future embeddings), `pg_net` (optional, auth hooks).

### Enums (`002_core_schema.sql`, extended later)
- `user_role`: inspector | supervisor | admin | service_role
- `building_type`: residential_single | residential_multi | apartment | office | retail | industrial | mixed_use | other
- `construction_year_class`: pre_1945 | 1945_1974 | 1975_1991 | 1992_2005 | 2006_2014 | 2015_2020 | post_2020
- `energy_label`: A++++ … G
- `element_type`: gevel (wall) | dak (roof) | vloer (floor) | installatie (HVAC) | transparant_deel (window/door) | **dakkapel** (dormer, added in `018_dakkapel_perimeter.sql`)
- `measurement_unit`: mm | cm | m | deg | percent
- `session_status`: active | paused | completed | cancelled
- `sync_status`: pending | synced | conflict | failed
- `device_type`: bosch_glm50c | bosch_glm100c | other
- `validation_result`: pass | anomaly | warning | error

### Core tables

**`organisations`** (`002_core_schema.sql`) — tenant root.
`id`, `name`, `kvk_number` (unique), address/city/postal_code/country, `email`, `phone`, `logo_url`, `settings` JSONB, `is_active`, `latitude`/`longitude` (added `014_org_gps.sql`), timestamps.

**`user_profiles`** (`002_core_schema.sql`) — extends `auth.users`.
`id` (PK = `auth.users.id`, `ON DELETE CASCADE`), `org_id` → organisations, `role` (user_role), `full_name`, `phone`, `avatar_url`, `certifications` JSONB (NTA 8800 cert numbers), `is_active`, `last_seen_at`. Every RLS policy in the schema keys off `org_id = public.user_org_id()`, a helper that reads `org_id` out of the JWT (injected by `custom_access_token_hook`, see below).

**`ble_devices`** — registered Bosch laser meters.
`id`, `org_id`, `device_type`, `mac_address`, `serial_number`, `nickname`, `firmware_version`, `battery_level` (0–100 check), `last_connected_at`, `last_measurement_at`, `is_active`, `metadata`. Unique (`org_id`, `mac_address`).

**`buildings`** (`003_building_hierarchy.sql`) — "Objecten", the top of the physical hierarchy.
`id`, `org_id`, `reference_code`, `bag_id` (Dutch address-registry id), `description`, street/house_number/postal_code/city/municipality/province/country, `latitude`/`longitude` NUMERIC(10,7), `building_type`, `construction_year` (1400–2100 check), `year_class`, `gross_floor_area_m2`, `num_floors`, `num_units`, `nta_building_category`, `compactness_factor` (A/V ratio), `is_active`, `notes`, `metadata`, `created_by` → user_profiles.
Extended by `026_bag_cache.sql` with **raw BAG/3DBAG cache fields** (distinct from the manually-entered fields above, never overwritten): `bag_pand_id`, `bag_vbo_id`, `bag_bouwjaar`, `bag_oppervlakte_m2`, `bag_gebruiksdoel`, `dbag_hoogte_m`, `bag_fetched_at`. Populated by the web API route `/api/buildings/[id]/bag` from Kadaster BAG Individuele Bevragingen v2 + `api.3dbag.nl`.

**`zones`** (`003_building_hierarchy.sql`) — physical **floors/storeys** of a building.
`id`, `org_id`, `building_id`, `zone_code` (e.g. "Z01"), `name` ("Begane grond"), `description`, `floor_level` (0 = ground), `gross_area_m2`, `net_area_m2`, `volume_m3`, `ceiling_height_m`, `zone_function` (verblijfsgebied/verkeersgebied), `is_heated`, `is_cooled`, `setpoint_heating`/`cooling`, `energy_label` (computed), `primary_energy_demand` (kWh/m²·yr), `sort_order`, `is_active`, `metadata`. Unique (`building_id`, `zone_code`).
Extended: `rekenzone_id` → `rekenzones.id` ON DELETE SET NULL (`025_rekenzones.sql`); `floor_plan_image_url` (`0073_floor_plan_image.sql`); `floor_plan_points` JSONB (normalized 0–1 polygon coords) + `floor_plan_scale_m` (`0074_floor_plan_grid.sql`).

**`rekenzones`** (`025_rekenzones.sql`) — a **grouping layer above `zones`**, added for calculation-zone grouping (e.g. "A met airco" spanning multiple floors). Purely additive/optional — existing zones keep `rekenzone_id = NULL`.
`id`, `org_id`, `building_id`, `name`, `description`, `notes`, `sort_order`, `is_active`, `metadata`. Unique (`building_id`, `name`).

> ⚠️ **Naming trap**: `zones` = physical floors (the original "Rekenzone" concept per NTA-8800, named before `rekenzones` existed), while the `rekenzones` table (plural, added later) is the *newer* calculation-grouping concept. `zones.rekenzone_id` links a floor into a rekenzone group. Don't conflate the two when reading code or docs.

**`building_elements`** (`003_building_hierarchy.sql`) — unified table for walls/roofs/floors/installations/dormers, discriminated by `element_type`.
Core: `id`, `org_id`, `zone_id` → zones, `element_type`, `name`, `description`, `length_mm`/`width_mm`/`height_mm`/`area_m2` (filled by BLE), `orientation_deg` (0=N…270=W), `tilt_deg`, `rc_value` (m²K/W), `u_value` (W/m²K), `lambda_value` (W/mK), `insulation_thickness_mm`, `construction_type`, `insulation_type`, `finish_type`, `installation_type`, `fuel_type`, `efficiency`, `capacity_kw`, `year_installed`, `photo_urls` TEXT[], `is_complete`, `sort_order`, `is_active`, `notes`, `metadata`.
Extended by `0072_nta8800_fields.sql`: `nokhoogte_m` (roof ridge height), `bodemisolatie` (bool, floor soil insulation), `brand`, `model_nr`, `cv_klasse` (boiler comfort class).
Extended by `018_dakkapel_perimeter.sql`: `parent_element_id` (self-FK, dormer → parent roof), `dikte_vloer_boven_mm`/`dikte_vloer_onder_mm`/`dikte_muren_mm` (thickness corrections for NTA8800 rekenhoogte), `perimeter_m` (thermal-bridge perimeter for Ψ-value calc).
Extended by `0074_floor_plan_grid.sql`: `grid_x`/`grid_y`/`grid_w`/`grid_h` (normalized 0–1 position on the zone canvas), `grid_rotation` (0–315° in 45° steps).
Extended by `024_calc_fields.sql` (Phase 2 calc-engine fields, all additive/nullable):
- `dikte_vloerconstructie_mm`, `rekenhoogte_m_override` (§2.1 rekenhoogte)
- `warmtecap_vloer_klasse`/`warmtecap_gevel_klasse` ('licht'|'zwaar'), `plafond_type` ('gesloten'|'open'|'overig') (§1.3 internal heat capacity)
- `rc_source` ('documented'|'observed'|'buildyear_forfait'), `isolatie_dikte_mm`, `isolatie_lambda`, `na_isolatie` (bool), `na_isolatie_jaar` (§6 Rc priority chain)
- `kruipruimte_hoogte_m` (§5.2 crawl-space floor U_eq)
- `pv_aantal_panelen`, `pv_wp_per_paneel`, `pv_orientatie_deg`, `pv_hellingshoek_deg`, `pv_beschaduwing_klasse` (§7.3 PV, stored on `installatie` elements)
- `tapwater_segments` JSONB (§7.1, e.g. `{"badkamer":[4.77,2.39],"keuken":[0.2]}`)

**`openings`** (`003_building_hierarchy.sql`) — windows/doors/skylights, child of `building_elements` (walls only).
`id`, `org_id`, `element_id` → building_elements, `opening_type` ('window'|'door'|'skylight'), `name`, `width_mm`/`height_mm`/`area_m2` (BLE-measured), `glazing_type` ("HR++" etc.), `frame_type`, `g_value`, `u_value_frame`/`u_value_glass`/`u_value_total`, `has_shading`, `shading_type`, `shading_factor`, `photo_urls`, `sort_order`, `is_active`, `notes`, `metadata`.
Extended `0072_nta8800_fields.sql`: `thermisch_onderbroken` (bool), `overstek_m` (default 0, horizontal overhang), `belemmering` (obstruction description).
Extended `024_calc_fields.sql` (§4.2/4.3): `u_glas`, `g_waarde`, `f_sh` (combined shading factor).

**`element_defaults`** (`027_element_defaults.sql`) — "Save as Default" feature for element forms.
`id`, `org_id`, `element_kind` TEXT ('transparant_deel'/'gevel'/etc.), `payload` JSONB (whitelisted form values), timestamps. Unique (`org_id`, `element_kind`).

**`building_facade_photos`** (`019_facade_photos.sql`) — building-level (persists across sessions) exterior photos, 4 per building max.
`id`, `org_id`, `building_id`, `session_id` → inspection_sessions (ON DELETE SET NULL), `direction` CHECK IN ('voor','achter','links','rechts') (front/rear/left-gable/right-gable), `photo_url` (Storage path `facade-photos/{org_id}/{building_id}/{direction}_{timestamp}.jpg`), `captured_at`, `created_at`. Unique (`building_id`, `direction`) — one photo per direction, upsert pattern on mobile.

**`inspection_sessions`** (`004_sessions_measurements.sql`) — one inspection visit.
`id`, `org_id`, `building_id`, `inspector_id` → user_profiles, `supervisor_id` (nullable), `session_code` (auto: `INS-YYYY-NNNN` via trigger + sequence `inspection_sessions_seq`), `status` (session_status), `started_at`/`paused_at`/`completed_at`, `duration_seconds`, `total_measurements`, `anomaly_count`, `completion_pct`, `outdoor_temp_c`, `weather_description`, `sync_status`, `last_synced_at`, `offline_duration_seconds`, `report_url` (Storage path), `report_generated_at`, `notes`, `metadata`.
Extended: `is_active` bool (`022_soft_delete_sessions.sql` — soft-delete so measurements aren't cascade-lost); `flow_stage` SMALLINT 1–6 (`0074_floor_plan_grid.sql` — wizard stage: 1=check, 2=draw, 3=zones, 4=grid, 5=elements, 6=measure, persisted so an inspector can resume after a crash).

**`measurements`** (`004_sessions_measurements.sql`) — **TimescaleDB hypertable**, partitioned on `measured_at` (1-week chunks), compression policy after 30 days + 10-year retention (Timescale license only, silently skipped on Apache edition).
Composite PK (`measured_at`, `id`). Columns: `id`, `org_id`, `session_id` → inspection_sessions, `device_id` → ble_devices (made nullable in `010_device_id_nullable.sql` for web-entered measurements), `inspector_id` → user_profiles, `element_id` → building_elements (nullable), `opening_id` → openings (nullable), `value_mm` NUMERIC(12,4) (always stored in mm), `unit`, `measurement_type` TEXT (wall_height/wall_width/roof_length — populated by an ML classifier), `raw_ble_bytes` BYTEA, `anomaly_score` (0–1, Isolation Forest), `is_anomaly` bool, `classifier_label`, `classifier_confidence`, `validation_result`/`validation_message`/`validated_at` (server-side), `session_mean_mm`/`session_std_mm`/`session_count` (rolling stats for ML features), `ingestion_path` TEXT default 'mobile' ('mobile'|'python_bridge'|'esp32'), `client_timestamp` (original device time, GDPR audit), `sync_status`, `is_deleted`/`deleted_at` (soft delete), `metadata`.
`REPLICA IDENTITY FULL` + added to `supabase_realtime` publication (`006_auth_hooks.sql`) — enables live Realtime subscriptions.
Continuous aggregate `measurements_hourly` (Timescale-license only): bucketed by hour × org_id × device_id × element_id — count/avg/min/max/stddev of `value_mm` + anomaly stats.

**`sync_queue`** (`004_sessions_measurements.sql`) — offline-first conflict tracking.
`id`, `org_id`, `inspector_id`, `table_name`, `record_id`, `operation` ('INSERT'/'UPDATE'/'DELETE'), `payload` JSONB, `client_timestamp`, `server_timestamp`, `sync_status`, `retry_count`, `error_message`, `resolved_at`, `created_at`.

**`audit_log`** (`004_sessions_measurements.sql`) — GDPR Article 30 log, range-partitioned by year (`audit_log_2026`, `audit_log_2027`).
`id`, `org_id`, `user_id`, `action` ('measurement.created' etc.), `table_name`, `record_id`, `old_values`/`new_values` JSONB, `ip_address` INET, `user_agent`, `request_id`, `created_at`.

### Entity-relationship tree

```
organisations
 ├─ user_profiles (1 auth.users → 1 profile)
 ├─ ble_devices
 ├─ buildings
 │   ├─ zones (floors)                    ← rekenzone_id → rekenzones (optional group)
 │   │   └─ building_elements (walls/roofs/floors/installations/dormers)
 │   │        ├─ openings (windows/doors, child of walls)
 │   │        └─ parent_element_id (dormer → parent roof, self-referential)
 │   ├─ rekenzones (calc-zone groups spanning multiple floors)
 │   └─ building_facade_photos
 ├─ inspection_sessions (building_id, inspector_id, supervisor_id)
 │   └─ measurements (session_id, device_id, element_id, opening_id)
 ├─ sync_queue
 ├─ element_defaults
 └─ audit_log
```

### Views / RPC functions
- **`session_summary`** (`007_views.sql`, refined in `022`) — joins `inspection_sessions` + inspector name + building address/city; hides soft-deleted sessions/buildings.
- **`building_summary`** (`007_views.sql`, refined in `022`, `026`) — buildings + full_address + zone_count/element_count/session_count/last_inspection_at/latest_energy_label; re-created in `026` to expose the new BAG columns.
- **`recent_measurements`** (`007_views.sql`, fixed in `009` for nullable `device_id` via LEFT JOIN) — measurements + device_nickname (COALESCE 'web'), element_name, zone_name, building_address.
- **`anomaly_feed`** (`009_views_update.sql`) — org-wide anomalous-measurement feed with full context (building/zone/element/inspector names); RLS auto-scopes by org.
- **`inspector_dashboard`** (`0071_views_functions.sql`) — per-inspector stats: active/completed session counts, total measurements/anomalies in the last 30 days, `last_measurement_at`.
- **`compute_zone_energy_label(zone_id)`** (`0071`) — computes an `energy_label` from avg Rc of walls/roofs/floors + avg window U-value, writes it back onto `zones.energy_label` (a simplified heuristic label — the real NTA 8800 engine lives in `packages/opname-calc` / web calc routes).
- **`close_inspection_session(session_id)`** (`0071`, fixed in `023` for NULL anomaly_count on empty sessions) — RPC that finalizes a session: sets `status='completed'`, computes duration, total_measurements, anomaly_count, completion_pct (elements with ≥1 measurement / total active elements in the building).
- **`generate_session_code()`** trigger — auto session_code `INS-YYYY-NNNN`.
- **`update_updated_at()`** trigger — generic `updated_at = NOW()` on every core table.
- **`custom_access_token_hook(event)`** (`006_auth_hooks.sql`) — injects `org_id`, `user_role`, `full_name` into the JWT on every sign-in/refresh; backs `public.user_org_id()`/`public.user_role()` used throughout RLS.
- **`handle_new_user()`** trigger — auto-creates a `user_profiles` row from `auth.users` sign-up metadata.

### RLS pattern
Every table has SELECT/INSERT/UPDATE scoped to `org_id = public.user_org_id()`; DELETE restricted to `public.is_privileged()` (admin/supervisor). Helper functions: `user_org_id()`, `user_role()`, `user_profile_id()`, `is_privileged()`. Defined in `005_rls_policies.sql`/`012_recover_missing_tables.sql`, extended per-table in `019`/`021`/`022`/`025`/`027`.

### Storage buckets
`floor-plans` (public bucket, `020_floor_plans_storage.sql`) — floor-plan images, served via `getPublicUrl`. Facade photos live under `facade-photos/{org_id}/{building_id}/...` (see `019`). Report PDFs are referenced by `inspection_sessions.report_url`.

---

## 2. TypeScript types

The mobile (Expo) and web (Next.js) apps are separate TS projects with **two hand-written, manually-synced mirrors** of the DB schema — there's no shared `types` package for entities (only `packages/opname-calc` is shared calc logic).

### `lib/supabase.ts` (mobile, 224 lines)
- `Database` (line 70) — Supabase typed-client shape: `Tables.{organisations, user_profiles, ble_devices, buildings, rekenzones, zones, building_elements, openings, inspection_sessions, measurements}`, `Views.{building_summary, session_summary, recent_measurements}`.
- Entity interfaces: `Organisation` (92), `UserProfile` (95), `BleDevice` (98), `Building` (102, incl. BAG cache fields), `Rekenzone` (115), `Zone` (120, incl. floor_plan fields, rekenzone_id), `BuildingElement` (131 — the largest interface, mirrors all migration-024/018/0072/0074 additive columns), `Opening` (180), `InspectionSession` (197), `Measurement` (204 — a slimmed client-side subset, not the full server row), `BuildingSummary` (210), `SessionSummary` (214), `RecentMeasurement` (217), `BuildingFacadePhoto` (220).
- Also contains the actual Supabase client setup (chunked SecureStore adapter for RN, dev-bypass JWT support).

### `web/lib/types.ts` (web, 265 lines)
Same entity interfaces (`Organisation`, `UserProfile`, `BleDevice`, `Building`, `Rekenzone`, `ElementDefault` (62, **web-only**, not present in mobile's `lib/supabase.ts`), `Zone`, `BuildingElement`, `Opening`, `InspectionSession`, `Measurement`, `BuildingFacadePhoto`, `BuildingSummary`, `SessionSummary`, `RecentMeasurement`), plus a more elaborate typed `Database` (line 236) using generic `TableDef<Row,Insert,Update>`/`ViewDef<Row>` helpers, and a `Functions.close_inspection_session` RPC signature (256–260). `Role` type alias at line 1: `'inspector'|'supervisor'|'admin'`.

> ⚠️ **Drift risk**: the two files must be kept manually in sync. `ElementDefault` currently only exists in `web/lib/types.ts`; `Measurement` in mobile's `lib/supabase.ts` is missing several columns present in the DB row (e.g. `client_timestamp`, `anomaly_score`) — only what the mobile UI reads is typed.

### `lib/elementTypes.ts` (31 lines, mobile)
`TYPE_LABELS: Record<string,string>` — maps the Dutch `element_type` DB enum values (`gevel`, `dak`, `dakkapel`, `vloer`, `transparant_deel`, `installatie`) to English UI labels, plus an `elementTypeLabel()` helper.

### `packages/opname-calc/src/*` — shared calc engine (used by both apps as a workspace package)
This is the important **shared calculation type layer**, deliberately loose/duck-typed so both apps' native row types satisfy it without casts:
- **`vabi.ts`**: `VabiSessionInfo` (21), `VabiBuildingInfo` (28), `VabiOrgInfo` (33), `VabiZone` (37), `VabiRekenzone` (44), `VabiElement` (50 — subset of `building_elements` fields needed for VABI XML export), `VabiOpening` (82). Also `buildVabiXml()` (392) — the canonical VABI XML builder, locked by `__tests__/vabiExport.golden.test.ts`. Mapping helpers: `openingTypeVabi`, `frameMatVabi`, `glazingVabi`, `installTypeVabi`, `gevelpositie`, `grenztAan`, `dakType`.
- **`geometry.ts`**: `OpeningLike` (46), `ZoneLike` (67), `RoofLike` (80), `RoofAreaBreakdown` (95), `FloorAreaRow` (129) + area/perimeter helpers (`openingArea`, `totalZoneArea`, `dakkapelFootprint`, `roofAreaBreakdown`, `areaByFloor`, `toCardinal`, `floorId`, `floorName`).
- **`nta.ts`**: `WarmtecapKlasse = 'licht'|'zwaar'` (31), `PlafondType = 'gesloten'|'open'|'overig'` (32), `RcSource = 'documented'|'observed'|'buildyear_forfait'` (67), plus `rekenhoogte()`, `warmtecapKJm2K()`, `rcSourceLabel()`, constant `DIKTE_VLOERCONSTRUCTIE_FORFAIT_MM = 300`.
- **`thickness.ts`**: `SweepState` (26) + constants (`MIN_THICKNESS_MM`, `MIN_SWEEP_SAMPLES`, `MIN_SWEEP_SPREAD_MM`) and sweep-measurement helpers (`addSweepSample`, `thicknessFromSweep`, `thicknessFromFaces`) for BLE-based wall-thickness detection.
- **`units.ts`**: unit-conversion/formatting helpers (`mmToM`, `r2`, `fmtMeters`, `fmtArea`, `fmtEfficiencyPct`).

These `nta.ts`/`thickness.ts`/`units.ts`/`geometry.ts` types correspond directly to the DB columns added in migrations 018/024/0072/0074 — the calc package's vocabulary (`WarmtecapKlasse`, `RcSource`, `dikte_vloerconstructie`, sweep-based thickness) is effectively the app-level documentation of what those columns mean.

---

## 3. Client-side state (`store/`)

Only **one** Zustand store exists, in the mobile app: `store/authStore.ts`.

```ts
interface AuthState {
  session:  Session | null;      // @supabase/supabase-js Session
  user:     User | null;         // @supabase/supabase-js User
  profile:  UserProfile | null;  // from lib/supabase.ts
  loading:  boolean;
  signIn:   (email, password) => Promise<void>;
  signOut:  () => Promise<void>;
  loadProfile: (session?: Session | null) => Promise<void>;
}
```
- Dev-bypass mode (`EXPO_PUBLIC_DEV_BYPASS_AUTH`) pre-populates a fake `DEV_PROFILE` (org_id `...0001`, role admin) so the router never blocks on auth locally.
- `profileInflight` (module-level promise) dedupes concurrent `user_profiles` fetches triggered by both `signIn()` and the `onAuthStateChange` listener.
- Subscribes to `supabase.auth.onAuthStateChange` at module scope; defers `loadProfile()` via `setTimeout(...,0)` to avoid deadlocking auth-js's internal lock.

**No other global client state store exists.** Everything else (buildings, sessions, elements, measurements) is fetched directly per-screen via the Supabase client (`lib/supabase.ts`) and local React state — not centralized. Notable data-fetching hooks that fill this role locally:
- `hooks/useBLEDevice.ts` / `useBLEDevice.web.ts` — BLE scan/connect/decode state, exposes deviceId + latest measurement.
- `hooks/useLiveMeasurements.ts` — Supabase Realtime `postgres_changes` subscription for a session's measurements (channel `session-live:{session_id}`).
- `hooks/useSyncQueue.ts` — offline queue drain logic (backed by the `sync_queue` table + local persistence).
- `hooks/bleDecoder.ts` — raw BLE packet decode logic (JS mirror of `ble_bridge/glm_protocol.py`).
- `lib/syncQueue.ts`, `lib/BLEContext.tsx` (single shared `BleManager` instance via React Context, not Zustand).

The web app (`web/`) has no global store either — it's a Next.js server-component-heavy app; state lives in route/server components + small client components with direct Supabase queries.

---

## 4. Data flow: device → mobile → Supabase → web/calc

```
Bosch GLM 50C laser meter (BLE, custom service 00001523-1212-efde-1523-785feabcd123)
  10-byte notify packets: [type][status][value:i32LE 0.1mm units][unit][battery][checksum]
        │
        ├── Path A (primary): inspector's phone/tablet
        │     react-native-ble-plx → hooks/useBLEDevice.ts / hooks/bleDecoder.ts
        │     → supabase.from("measurements").insert()  (ingestion_path='mobile')
        │     → falls back to lib/syncQueue.ts + sync_queue table when offline
        │
        └── Path B (optional headless bridge): ble_bridge/bridge.py (Python, bleak)
              decodes via glm_protocol.py (mirrors the same 10-byte packet spec)
              fans out to: WebSocket :8765, MQTT scarnergy/{org}/devices/{device}/measurements,
              and direct Supabase insert (ingestion_path='python_bridge')
              (esp32_firmware/src/main.cpp implements the same BLE→packet decode in C++/NimBLE,
               publishing over MQTT instead of directly to Supabase)
        │
        ▼
Kong API Gateway → PostgREST / GoTrue / Realtime → TimescaleDB (measurements hypertable)
        │
        ├── Supabase Realtime (postgres_changes, REPLICA IDENTITY FULL) → any subscribed
        │     client (mobile session detail screen, web live feed components:
        │     web/components/sessions/LiveFeed.tsx, web/components/measurements/MeasurementsLiveTable.tsx)
        │
        └── Web app (Next.js) reads via building_summary/session_summary/
              recent_measurements/anomaly_feed views, runs the authoritative NTA 8800
              calc engine server-side (per docs/CALC_ARCHITECTURE_PLAN.md — licensed
              forfait tables, BAG/3DBAG enrichment, VABI XML export via
              packages/opname-calc/src/vabi.ts buildVabiXml()), and produces the
              PDF Opname Rapport (report_url stored back on inspection_sessions).
```

**Design split** (`docs/CALC_ARCHITECTURE_PLAN.md`): mobile does on-site validation/BLE capture only; the **authoritative NTA 8800 math** (Rc forfait, U/g forfait, shading, floor U_eq/B′, warmtecapaciteit, HT roll-up, PV yield, VABI export, indicative label) lives server-side in the Next.js web app, sharing core geometry/unit/VABI logic with mobile via `packages/opname-calc`.

See `ARCHITECTURE.md` for the full Docker Compose service diagram (scarnergy_db/auth/rest/realtime/studio/meta/kong, ai_server, optional mosquitto).

---

## File-path index

- Migrations: `supabase/migrations/001_extensions.sql` … `027_element_defaults.sql`, `0071_views_functions.sql`, `0072_nta8800_fields.sql`, `0073_floor_plan_image.sql`, `0074_floor_plan_grid.sql`
- Mobile types/client: `lib/supabase.ts`, `lib/elementTypes.ts`, `lib/BLEContext.tsx`, `lib/syncQueue.ts`
- Web types: `web/lib/types.ts`
- Shared calc package: `packages/opname-calc/src/{index,vabi,geometry,nta,thickness,units}.ts`
- State: `store/authStore.ts`
- Hooks: `hooks/{useBLEDevice.ts,useBLEDevice.web.ts,useLiveMeasurements.ts,useSyncQueue.ts,bleDecoder.ts}`
- BLE bridge: `ble_bridge/{bridge.py,glm_protocol.py}`
- Firmware: `esp32_firmware/src/main.cpp`
- Related docs: `ARCHITECTURE.md`, `docs/CALC_ARCHITECTURE_PLAN.md`, `docs/report_structure.md`, `docs/measurement_dictionary.md`, `docs/vabi_xml_format.md`, `GAP.md`
