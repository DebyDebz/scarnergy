# ScanergyV2 — Implementation Milestones

Status key: ✅ Done · 🔨 Partial · ❌ Not started

---

## What's already built

| Area | Status | Notes |
|---|---|---|
| Infrastructure (Docker Compose + all services) | ✅ | DB, auth, REST, Realtime, Studio, Kong, Mosquitto, Grafana |
| Database migrations (001–008) | ✅ | Schema, RLS, realtime publication, views, seed data |
| Kong API gateway config | ✅ | Routes for /auth, /rest/v1, /realtime, /ai |
| AI server (FastAPI) | ✅ | `/energy` label prediction + `/validate` anomaly routers |
| Python BLE bridge | ✅ | `ble_bridge/bridge.py` — WebSocket + MQTT + Supabase fan-out |
| ESP32 firmware | 🔨 | Connects to GLM, sends MQTT — credentials hardcoded |
| Mobile — Auth (sign-in) | ✅ | `app/auth/sign-in.tsx` + `authStore.ts` |
| Mobile — Buildings list | ✅ | `app/tabs/buildings.tsx` |
| Mobile — Sessions list | ✅ | `app/tabs/sessions/index.tsx` (read-only) |
| Mobile — Session detail + BLE streaming | ✅ | `app/tabs/sessions/[id].tsx` |
| Mobile — Device tab | ✅ | `app/tabs/device.tsx` |
| Mobile — BLE hooks | ✅ | `useBLEDevice`, `useLiveMeasurements`, `useSyncQueue` |
| Supabase edge functions | ✅ | `energy_label_estimate`, `measurement_validate`, `session_close` |
| Grafana dashboards | ✅ | Provisioned in `infrastructure/grafana/` |

---

## Milestone 1 — Session Lifecycle (Mobile)

**Goal:** Inspectors can create, manage, and close sessions from the app.

| Task | File(s) | Status |
|---|---|---|
| "New Session" button + creation form | `app/tabs/sessions/index.tsx` | ❌ |
| Session creation calls PostgREST insert | `app/tabs/sessions/index.tsx` | ❌ |
| "Close Session" button in session detail | `app/tabs/sessions/[id].tsx` | ❌ |
| Wire `session_close` edge function to close button | `app/tabs/sessions/[id].tsx` | ❌ |
| Pause / resume session state | `app/tabs/sessions/[id].tsx` | ❌ |

---

## Milestone 2 — Building Hierarchy Navigation (Mobile)

**Goal:** Inspector drills from building → zone → element → opening, with measurement capture at element level.

| Task | File(s) to create | Status |
|---|---|---|
| Building detail screen — zones list | `app/tabs/buildings/[id].tsx` | ❌ |
| Zone detail screen — elements list | `app/tabs/buildings/[bid]/zones/[zid].tsx` | ❌ |
| Building element detail — openings + MeasurementInput | `app/tabs/buildings/[bid]/zones/[zid]/elements/[eid].tsx` | ❌ |
| Link measurement rows to `element_id` / `opening_id` on insert | `app/tabs/sessions/[id].tsx` | ❌ |
| Tap a building card → opens building detail (not sessions list) | `app/tabs/buildings.tsx` | ❌ |

---

## Milestone 3 — Shared UI Components

**Goal:** Fill the empty `components/forms/` and `components/ui/` directories so screens can share consistent atoms.

| Task | File(s) to create | Status |
|---|---|---|
| `Button` component (primary / secondary / destructive) | `components/ui/Button.tsx` | ❌ |
| `Card` component | `components/ui/Card.tsx` | ❌ |
| `Badge` / status pill | `components/ui/Badge.tsx` | ❌ |
| `TextInput` wrapper with label + error | `components/ui/Input.tsx` | ❌ |
| `SessionForm` — new session fields (building picker, notes) | `components/forms/SessionForm.tsx` | ❌ |
| `BuildingForm` — add / edit building | `components/forms/BuildingForm.tsx` | ❌ |
| `ZoneForm` / `ElementForm` / `OpeningForm` | `components/forms/` | ❌ |

---

## Milestone 4 — AI / Energy Label Integration (Mobile)

**Goal:** After a session accumulates measurements, the app fetches an energy label prediction and shows it.

| Task | File(s) | Status |
|---|---|---|
| POST to `/ai/energy` after session closes | `app/tabs/sessions/[id].tsx` or edge fn | ❌ |
| Energy label result screen | `app/tabs/sessions/[id]/result.tsx` | ❌ |
| Anomaly list with drill-down explanation | `app/tabs/sessions/[id].tsx` | ❌ |
| Display confidence score alongside label | result screen | ❌ |

---

## Milestone 5 — Auth Completeness (Mobile)

**Goal:** Full auth flow beyond sign-in.

| Task | File(s) | Status |
|---|---|---|
| Sign-up / registration screen | `app/auth/sign-up.tsx` | ❌ |
| Password reset / forgot-password screen | `app/auth/reset.tsx` | ❌ |
| Profile / settings screen (change name, sign out) | `app/tabs/profile.tsx` | ❌ |
| Role-aware tab visibility (supervisor sees all orgs) | `app/tabs/_layout.tsx` | ❌ |

---

## Milestone 6 — Supervisor / Web Dashboard

**Goal:** Supervisors and admins can monitor sessions and buildings from a browser.

| Task | Notes | Status |
|---|---|---|
| Scaffold web app (Next.js or Vite + React recommended) | New top-level `web/` directory | ❌ |
| Auth (same Supabase JWT) | | ❌ |
| Building list + session overview per building | | ❌ |
| Live session view (Supabase Realtime WebSocket) | mirrors `session-live:{id}` channel | ❌ |
| Energy label history per building | query `measurements_hourly` view | ❌ |
| Grafana embed or direct chart components | Grafana already provisioned at port 3001 | ❌ |
| Inspector management (invite / deactivate) | | ❌ |

---

## Milestone 7 — ESP32 Provisioning & OTA

**Goal:** ESP32 firmware can be configured without recompiling.

| Task | File(s) | Status |
|---|---|---|
| BLE provisioning characteristic (write WiFi + MQTT creds at runtime) | `esp32_firmware/src/main.cpp` | 🔨 (OTA code present, no provisioning) |
| Store credentials in NVS (`Preferences`) instead of `#define` | `esp32_firmware/src/main.cpp` | ❌ |
| OTA update trigger via MQTT command topic | `esp32_firmware/src/main.cpp` | 🔨 (code scaffolded) |
| Companion provisioning screen in mobile app | `app/tabs/device.tsx` | ❌ |

---

## Milestone 8 — Hardening & Testing

**Goal:** System is reliable enough for field use.

| Task | Notes | Status |
|---|---|---|
| End-to-end test: BLE → insert → realtime → mobile re-render | | ❌ |
| Offline sync stress test (`useSyncQueue`) | drop network mid-session | ❌ |
| RLS policy tests pass in CI | `supabase/migrations/rls_tests.sql` exists | 🔨 |
| API smoke tests cover all Kong routes | `supabase/api_tests.http` exists | 🔨 |
| AI model retrain pipeline documented | `ai_server/models/train_models.py` exists | 🔨 |
| EAS build pipeline (iOS + Android) | `scarnergy-app/eas.json` exists | 🔨 |
| Docker image for `ai_server` tested in compose | `ai_server/Dockerfile` exists | 🔨 |

---

## Priority order (suggested)

1. **M1** — Session lifecycle unblocks field use of the app today
2. **M3** — Shared components make M2 and M5 faster to build
3. **M2** — Hierarchy navigation is the core inspection workflow
4. **M5** — Auth completeness for real users
5. **M4** — AI integration is the product's differentiator
6. **M7** — ESP32 provisioning before hardware fleet scales
7. **M6** — Web dashboard for supervisors
8. **M8** — Hardening before production rollout
