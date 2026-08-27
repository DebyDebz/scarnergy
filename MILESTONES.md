# ScanergyV2 — Implementation Milestones

Status key: ✅ Done · 🔨 Partial · ❌ Not started

This file is the high-level roadmap. For AppSheet-integration work
specifically, `GAP.md` is the authoritative, line-by-line tracker (its own
rule: "work that isn't ticked there is not done, no matter what a chat log
says") — Milestone 9 below just points into it rather than duplicating it.

---

## What's already built

| Area | Status | Notes |
|---|---|---|
| Infrastructure (Docker Compose + all services) | ✅ | DB, auth, REST, Realtime, Studio, Kong, Mosquitto, Grafana |
| Database migrations | ✅ | 001–032, RLS, realtime publication, views, seed data |
| Kong API gateway config | ✅ | Routes for /auth, /rest/v1, /realtime, /ai |
| AI server (FastAPI) | ✅ | `/energy` label prediction + `/validate` anomaly routers |
| Python BLE bridge | ✅ | `ble_bridge/bridge.py` — WebSocket + MQTT + Supabase fan-out |
| ESP32 firmware | 🔨 | GLM↔MQTT bridge working; BLE provisioning + NVS config written, **not compiled/flashed** (see M7) |
| Mobile — Auth (sign-in, forgot-password, sign-up) | ✅ | `app/auth/{sign-in,forgot-password}.tsx`; sign-up is web-only, see M5 |
| Mobile — Buildings / Sessions / Device tabs | ✅ | `app/tabs/{buildings,sessions,device}.tsx` |
| Mobile — AppSheet-sourced screens | ✅ | `app/tabs/sessions/appsheet-detail.tsx` + dual-source toggle across buildings/sessions/dashboard |
| Mobile — BLE hooks | ✅ | `useBLEDevice`, `useESP32Provisioning`, `useSyncQueue` |
| Web dashboard (Next.js) | ✅ | `web/` — full admin/supervisor app: buildings, sessions, organisations, users, AppSheet toggle, VABI/PDF export |
| Supabase edge functions | ✅ | `energy_label_estimate`, `measurement_validate`, `session_close` |
| Grafana dashboards | ✅ | Provisioned in `infrastructure/grafana/` |
| CI (`.github/workflows/ci.yml`) | ✅ | tsc ×2, `next build`, `npm test`, DB migration chain, RLS tests, API smoke tests — every PR |

---

## Milestone 1 — Session Lifecycle (Mobile)

**Goal:** Inspectors can create, manage, and close sessions from the app.

| Task | File(s) | Status |
|---|---|---|
| "New Session" button + creation form | `app/tabs/sessions/index.tsx` | ✅ |
| Session creation calls PostgREST insert | `app/tabs/sessions/index.tsx` | ✅ |
| "Close Session" button in session detail | `app/tabs/sessions/[id].tsx` | ✅ |
| Wire `session_close` edge function to close button | `app/tabs/sessions/[id].tsx` | ✅ (RPC fallback for local dev) |
| Pause / resume session state | `app/tabs/sessions/[id].tsx` | ✅ |
| AppSheet-linked session sync-back on close | `web/app/api/appsheet/mobile/session-close/route.ts` | ✅ gevel/dak/vloer *(installatie Add still blocked, see GAP.md W7)* |

---

## Milestone 2 — Building Hierarchy Navigation (Mobile)

**Goal:** Inspector drills from building → zone → element → opening, with measurement capture at element level.

> Superseded by the **unified inspection flow** (see `docs/UNIFIED_FLOORPLAN_FLOW.md`):
> buildings → start inspection → staged flow (`flow.tsx`) → floor plan (`floorplan.tsx`)
> → element inspect (`inspect.tsx`) → facade photos.

| Task | File(s) | Status |
|---|---|---|
| Zones list per session/building | `app/tabs/sessions/[id].tsx` (zone tabs) | ✅ |
| Elements list per zone | `app/tabs/sessions/[id].tsx` | ✅ |
| Element detail — openings + MeasurementInput | `app/tabs/sessions/inspect.tsx` | ✅ |
| Link measurement rows to `element_id` on insert | `app/tabs/sessions/inspect.tsx` | ✅ |
| Tap a building card → sessions / start inspection | `app/tabs/buildings.tsx` | ✅ |
| Retake/trace-floor-plan for an AppSheet-sourced zone | `app/tabs/sessions/{appsheet-detail,flow}.tsx` | ✅ |

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

Not blocking anything today — mobile screens have grown their own
consistent-enough inline styling instead. Revisit only if screen count
grows enough that duplication becomes a real cost.

---

## Milestone 4 — AI / Energy Label Integration (Mobile)

**Goal:** After a session accumulates measurements, the app fetches an energy label prediction and shows it.

| Task | File(s) | Status |
|---|---|---|
| Compute labels after session closes | `session_close` edge fn → `energy_label_estimate` → `compute_zone_energy_label` | ✅ |
| Energy label result screen | `app/tabs/sessions/results.tsx` | ✅ |
| Anomaly list with drill-down to element | `app/tabs/sessions/results.tsx` | ✅ |
| Display confidence alongside label | results screen shows data-coverage % (labels are rule-based) | ✅ (proxy) |
| Real confidence from the §9 NTA 8800 engine | replaces the data-coverage proxy above | ❌ blocked — calc Phase 4, no engine yet |

---

## Milestone 5 — Auth Completeness

**Goal:** Full auth flow beyond sign-in.

| Task | File(s) | Status |
|---|---|---|
| Password reset / forgot-password screen (mobile) | `app/auth/forgot-password.tsx` (email → recovery code → new password) | ✅ |
| Profile / settings screen (mobile) | `app/tabs/profile.tsx` | ✅ |
| Role-aware tab visibility (mobile) | `app/tabs/_layout.tsx` (GLM tab hidden for supervisors) | ✅ |
| Sign-up / registration screen (web, org-creation) | `web/app/auth/sign-up/{page,SignUpForm}.tsx` + `POST /api/auth/signup` | ✅ code done — **not yet exercised end-to-end** (would hit the remote Supabase instance from here; needs Deborah or a local-stack-pointed env) |
| Close the role-trust gap `handle_new_user()` had | `supabase/migrations/032_signup_role_hardening.sql` | ✅ verified live against local stack |
| Admin auth check on `/api/organisations` + `/api/users/invite` | `web/lib/requireAdmin.ts` | ✅ — previously reachable by anyone (middleware only guards page paths) |
| Mobile self-serve sign-up | — | not planned — inspectors join an org via admin invite only, by design (see GAP.md W7) |

---

## Milestone 6 — Supervisor / Web Dashboard

**Goal:** Supervisors and admins can monitor sessions and buildings from a browser.

Built — this milestone's original scope shipped as the `web/` Next.js app,
well beyond what was originally listed here.

| Task | Notes | Status |
|---|---|---|
| Web app (Next.js) | `web/` | ✅ |
| Auth (Supabase session via `@supabase/ssr` cookies) | `web/middleware.ts`, `web/lib/supabase-server.ts` | ✅ |
| Building list + session overview per building | `web/app/(dashboard)/buildings`, `.../sessions` | ✅ |
| Energy label history per building | native-mode building detail page | ✅ (AppSheet mode has no equivalent data — explicit notice instead, GAP.md W6) |
| Inspector / org management (invite, add org) | `web/components/admin/{InviteUserForm,AddOrgForm}.tsx` | ✅ |
| Dual data-source toggle (native ScanergyV2 vs AppSheet) | `web/lib/dataSource/`, mirrored on mobile | ✅ — see GAP.md W1–W7 for the full AppSheet integration |
| Live session view (Supabase Realtime WebSocket) | mirrors mobile's `session-live:{id}` channel | ❌ — web session detail is read/refresh-on-navigate, not a live socket subscription |
| Grafana embed or direct chart components | Grafana already provisioned; web app has its own charts instead (`EnergyLabelTrendChart`, VABI export) | ❌ not pursued — redundant with what's already built |

---

## Milestone 7 — ESP32 Provisioning & OTA

**Goal:** ESP32 firmware can be configured without recompiling.

| Task | File(s) | Status |
|---|---|---|
| BLE provisioning characteristic (write WiFi + MQTT creds at runtime) | `esp32_firmware/src/main.cpp` | ✅ code written — **not compiled** (no PlatformIO CLI available where this was written) |
| Store credentials in NVS (`Preferences`) instead of `#define` | `esp32_firmware/src/main.cpp` | ✅ code written, same caveat |
| Consecutive-WiFi-failure recovery (drops back into provisioning mode) | `esp32_firmware/src/main.cpp` | ✅ code written, same caveat |
| Companion provisioning screen in mobile app | `app/tabs/esp32-provisioning.tsx` + `hooks/useESP32Provisioning.ts` | ✅ mobile `tsc` clean, linked from `device.tsx` |
| `ble_devices` registration for a provisioned gateway | uses existing `device_type: 'other'` + `metadata` JSONB — no migration needed | ✅ |
| OTA update trigger via MQTT command topic | `esp32_firmware/src/main.cpp` | 🔨 (code scaffolded, unchanged this pass) |
| **Real verification**: `pio run`, flash a physical unit, confirm the BLE round-trip + WiFi/MQTT bring-up | — | ❌ — needs Deborah; this is the actual gate, everything above is "should work," not "confirmed working" |

---

## Milestone 8 — Hardening & Testing

**Goal:** System is reliable enough for field use.

| Task | Notes | Status |
|---|---|---|
| End-to-end test: BLE → insert → realtime → mobile re-render | `__tests__/blePipeline.e2e.test.ts` (real decoder/dispatch/merge, faked network edge) | ✅ |
| Offline sync stress test (`useSyncQueue`) | `__tests__/syncQueue.test.ts` — drop mid-drain, retry cap, 50-op stress, concurrent-drain coalescing | ✅ |
| RLS policy tests pass in CI | `supabase/migrations/rls_tests.sql`, real harness (simulated JWT claims), CI `db` job | ✅ |
| API smoke tests cover Kong routes | `scripts/api_smoke.sh`, read-only, CI-wired | ✅ |
| AI model retrain pipeline documented | `ai_server/models/train_models.py` exists | 🔨 |
| EAS build pipeline (iOS + Android) | `scarnergy-app/eas.json` exists | 🔨 |
| Docker image for `ai_server` tested in compose | `ai_server/Dockerfile` exists | 🔨 |
| On-device physical verification pass | forgot-password, profile edits, role-gated tabs, results screen, VABI share, BLE Capture button, Grid Analysis resume, dashboard error banner, Retake Measurement (dak/vloer/installatie), Trace-floor-plan | ❌ — inherently manual, Deborah's to run |

---

## Milestone 9 — AppSheet dual-source integration

**Goal:** Every screen works correctly against either data source (native
ScanergyV2 or AppSheet), fully connected — no partial/stub state, per
`GAP.md`'s own definition of done. Full detail lives there (sections W1–W7);
this is the index-level summary.

| Task | Notes | Status |
|---|---|---|
| Buildings/sessions/zones/elements read + edit parity | GAP.md W1–W5 | ✅ |
| Openings (Transparante_Delen) full write path + cascade delete | GAP.md W6 | ✅ live-confirmed |
| Dak/Vloer sync-back + generalized Retake Measurement | GAP.md W6/W7 | ✅ live-confirmed (Grenzend-aan-code landmine found + fixed) |
| Installatie sync-back (Add direction) | GAP.md W7 | ❌ blocked — "Ventilatie Code" has no discoverable valid value; needs AppSheet editor access |
| Retake-measurement zone → Grid Analysis entry point | GAP.md W6 | ✅ |
| AppSheet building detail "Visit" section | GAP.md W6 | ✅ |
| Vloeren `Bodemisolatie` enum | GAP.md W6 | ❌ blocked — needs Deborah to check the AppSheet editor's valid values |
| Phase 3 offline validators V-04/05/09/11 | GAP.md M section | ❌ blocked — needs the licensed `opname-calculation-spec.md` §10 |

---

## Priority order (suggested)

1. **M8 (on-device pass)** — nothing above is "done" for real users until it's confirmed on a phone
2. **M7 (ESP32 verification)** — code is written; compiling and flashing is the actual gate
3. **M5 (sign-up HTTP test)** — same shape: code done, live round-trip not yet run
4. **M9 (Installatie/Bodemisolatie/validators)** — each blocked on a specific external input (AppSheet editor access ×2, licensed spec doc) — unblock by gathering those, not more engineering
5. **M4 (real confidence engine)** — larger, separate calc-Phase-4 effort; lowest urgency of what's left
6. **M6 (live session view, Grafana embed)** — nice-to-haves, no current demand signal
7. **M3** — shared UI components — revisit only if screen duplication becomes a real cost
