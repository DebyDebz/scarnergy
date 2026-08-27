# Gap Checklist — Web ↔ AppSheet + Mobile

**Source:** screen-by-screen comparison of the reference AppSheet app
("Opname app-sandboxV5", screenshots 2026-07-07) against the web app (`web/`),
done 2026-07-09. Mobile gaps tracked in section M below.

**Companions:** `docs/CALC_ARCHITECTURE_PLAN.md`, `docs/CALC_TASK_CHECKLIST.md`,
`docs/proposed_migration_calc_fields.sql`.

**Overriding constraint:** existing functionality and design must keep working.
Reuse the current design system (Tailwind cards/tables, Dutch title +
English subtitle convention, existing components in `web/components/`).

**Definition of done — an item may be ticked `[x]` ONLY when ALL of these hold:**
1. 100% implemented — no partial/stub state;
2. connected to the live backend/database (real queries, RLS-verified),
   not mocked or hardcoded;
3. existing functionality and design unchanged;
4. standing regression rule green: mobile `tsc` clean · `cd web && tsc` clean ·
   `next build` ok · `npm test` green · golden VABI fixtures byte-identical.
   Enforced automatically by CI (`.github/workflows/ci.yml`) on every PR.

Tick items with the date and gate evidence. This file is the single tracker:
work that isn't ticked here is not done, no matter what a chat log says.

Legend: `[ ]` todo · `[x]` done · file paths are exact.

---

## W0 — Bank the finished calc-refactor work (do first)

The Phase 0/1 work from `docs/CALC_TASK_CHECKLIST.md` exists in the working
tree but is **uncommitted** (this repo learned the hard way that uncommitted
work doesn't ship — EAS builds from git HEAD).

- [x] Commit the workspace package `packages/opname-calc` (units, geometry) and
      the root `workspaces` change in `package.json`.
- [x] Commit the restored test harness + tests: `__tests__/opnameCalc.test.ts`,
      `__tests__/vabiExport.golden.test.ts`, `__tests__/fixtures/`,
      `__tests__/__snapshots__/`, plus the ts-jest config migration.
- [x] Commit the web/mobile import updates (`web/lib/calc.ts`,
      `web/lib/vabiXml.ts`, `lib/vabiExport.ts`, `web/next.config.mjs`,
      `tsconfig.json`).
- **Verify gate:** ✅ 2026-07-13 — banked as commits b0affd5…9c580fa (incl. M4/M5/M8
  mobile features, thickness move, exporter collapse) · `npm test` green (88) ·
  `next build` ok · clean `git status`.

---

## W1 — UI-only parity (no schema changes; all data already in DB)

Target file for most of this: `web/app/(dashboard)/buildings/[id]/page.tsx`
and new components in `web/components/elements/`.

- [x] **Group zone elements by type with counts.** Replaced the flat elements
      table with sections per `element_type`: Gevels, Daken, Vloeren,
      Installaties (+ Overige fallback so nothing disappears), each with a
      count badge — `web/components/elements/ElementTypeSections.tsx`.
- [x] **Gevel rows**: Positie (`gevelpositie`), Orientatie (`toCardinal`),
      Hoogte, Breedte, Bruto Oppervlakte, Rc, status — all via
      `@scarnergy/opname-calc`.
- [x] **Transparante Delen detail** (expandable per opening, now ALL openings
      per element — the old view silently showed only one): Type Deel,
      Materiaal, Glastype, Hoogte×Breedte, Bruto + Netto Oppervlakte,
      Zonwering (+factor), Overstek, Belemmering, Thermisch onderbroken,
      U kozijn/glas/totaal, g-waarde, notes.
- [x] **Dakkapellen nested under their Dak** via `parent_element_id`; per-dak
      Totaal Oppervlakte Gaten + Netto Dakoppervlak via new shared
      `roofAreaBreakdown()` in `@scarnergy/opname-calc` (unit-tested, same
      bruto formula as the VABI export — not forked).
- [x] **Installaties card**: Merk, Model, CV-klasse, type, brandstof,
      rendement, vermogen, bouwjaar.
- [x] **Vloeren rows**: Perimeter, Grenzend aan (shared `grenztAan()`),
      oppervlakte, vloer/bodemisolatie, Rc.
- [x] **Notities en Foto's**: element `notes` + `photo_urls` signed from the
      `inspection-photos` bucket (http entries as-is, `file:` fallbacks skipped).
- [x] **Session header parity**: Duur (`fmtDuration`, completed − started) and
      Voorgevel Orientatie (front-facade gevel → `toCardinal`) KPI cards in
      `web/app/(dashboard)/sessions/[id]/page.tsx`.
- **Verify gate:** ✅ 2026-07-14 — 91 tests green (incl. new roofAreaBreakdown
  unit tests, goldens byte-identical) · mobile `tsc` clean · web `tsc` clean ·
  `next build` ok · every rendered column verified queryable against the live
  DB (elements/openings/sessions probes) · layout: existing sections untouched,
  new sections reuse the card/table design system. Field-level parity follows
  the spec above; final visual side-by-side vs the AppSheet screenshots: Deborah.

---

## W2 — Apply the drafted migration, then the calc-field UI

- [x] Move `docs/proposed_migration_calc_fields.sql` →
      `supabase/migrations/024_calc_fields.sql` and apply it.
      ✅ 2026-07-15 — statement-identical to the reviewed draft (verified by
      script) · dry-run in a rollback txn, then applied to the local stack ·
      new columns probed queryable.
- [x] Regenerate/extend types: `lib/supabase.ts` interfaces and
      `web/lib/types.ts` (keep both in sync).
      ✅ 2026-07-15 — all 024 element/opening fields + `Zone.ceiling_height_m`/
      `description` + `Building.latitude/longitude`, both apps in sync.
- [x] **Verdieping/zone edit form** (web): Plafond (`plafond_type`),
      Warmtecapaciteit vloer (`warmtecap_vloer_klasse`), Warmtecapaciteit
      gevel (`warmtecap_gevel_klasse`), Hoogte, GebruiksOppervlakte, Notities,
      kJ_m2K (derived, read-only) — mirrors the AppSheet "BG" edit form.
      ✅ 2026-07-15 — `web/components/buildings/ZoneEditButton.tsx` (pencil in
      the zone accordion header) + new whitelisted `PATCH /api/zones/[id]`;
      plafond/warmtecap write to the storey's vloer element (where 024 puts
      them) via `/api/elements/[id]`. **Note:** kJ_m2K renders "—" until the
      licensed §1.3 forfait table is transcribed (`opname-calculation-spec.md`
      is not in the repo — calc Phase 2 gate with the owner); the lookup
      plumbing (`warmtecapKJm2K` in `@scarnergy/opname-calc/nta`) is in place.
- [x] **Gevel calc fields**: Rekenhoogte / Rekenbreedte display
      (`rekenhoogte_m_override`, `dikte_vloerconstructie_mm`, engine default
      300 mm per §2.1).
      ✅ 2026-07-15 — shared `rekenhoogte()` helper (override ?? hoogte +
      dikte/1000, 300 mm forfait; unit-tested) rendered in GevelRow with an
      "override" badge; both fields editable in ElementEditPanel.
- [x] **Transparante Delen calc fields**: `u_glas`, `g_waarde`, `f_sh`.
      ✅ 2026-07-15 — displayed as "(forfait)" fields next to the measured
      U/g values in ElementTypeSections; editable via ElementEditPanel;
      whitelisted in the openings API.
- [x] **Rc provenance**: show `rc_source` (documented / observed /
      buildyear-forfait) as a small badge next to Rc values.
      ✅ 2026-07-15 — `RcValue` badge (emerald/sky/amber) in Gevel/Dak/Vloer
      rows; `rc_source` selectable in ElementEditPanel.
- **Verify gate:** ✅ 2026-07-15 — migration dry-run + applied cleanly ·
  mobile unaffected (columns nullable/additive; mobile `tsc` clean) ·
  standing regression rule green: 114 tests · goldens byte-identical ·
  web `tsc` · `next build` ok.

---

## W3 — Net-new integrations

- [x] **BAG / 3DBAG panel** on the building page: BAG Bouwjaar, BAG Opp,
      3dbag hoogte, BAG Gebruiksdoel, BAG Pand ID. Server-side Next API route
      calling the Kadaster BAG API + 3dbag.nl by address/postcode; cache the
      result on the building row (needs a small additive migration for the
      cached fields + fetched_at). Feeds validations V-01/02/03 in the calc
      plan (Phase 4 there).
      ✅ 2026-07-15 — migration 026 (bag_* columns + building_summary recreate,
      applied to local stack) · `POST /api/buildings/[id]/bag` (30-day cache,
      huisletter/toevoeging retry ladder, non-fatal 3DBAG height) ·
      `BagPanel`/`BagFetchButton` on the building page · mobile shows the
      cached line via `building_summary` (display-only, offline-safe) ·
      both W3 gates verified: panel reads DB columns only (renders with API
      down; graceful 422/502/503) and `grep BAG_API_KEY web/.next/static` clean ·
      106 tests green (11 new fixture-driven mapping tests). **Note:** live
      Kadaster fetch still needs `BAG_API_KEY` provisioned (free Kadaster
      self-service); route returns `bag_not_configured` until then.
- [x] **Map on the building/opname page**: embed (Google Maps iframe or
      Leaflet+OSM to avoid an API key) showing the geocoded address, matching
      the AppSheet header card.
      ✅ 2026-07-15 — keyless OpenStreetMap embed (`MapPanel`) driven by the
      existing `buildings.latitude/longitude` columns; "Locatie ophalen"
      button → new `POST /api/buildings/[id]/geocode` using the keyless PDOK
      Locatieserver (response shape live-verified) caching coords on the row.
      Graceful empty state without coords; 502/422 on PDOK down/miss; no key
      anywhere.
- **Verify gate:** panel renders gracefully when the external API is down ·
  no server key leaks to the client · standing regression rule.

---

## W4 — Nice-to-haves / decisions

- [x] **"Sla op als Standaard"** for Transparante Delen: new small table
      (e.g. `element_defaults`: org_id, element_kind, payload JSONB) + a
      "save as default" action and a "apply default" picker on the add/edit
      form. Additive migration.
      ✅ 2026-07-15 — migration 027 (`element_defaults`, UNIQUE(org,kind),
      RLS 4-policy block; applied to local stack) · GET/PUT
      `/api/element-defaults` (org-scoped upsert) · "Standaard toepassen" /
      "Sla op als standaard" in ElementEditPanel (works for every element
      kind, incl. Transparante Delen); applied payloads re-filter through the
      form's known keys + the API whitelists. ElementEditPanel is now
      reachable: per-element pencil on the building page element sections.
- [x] **Grenst-aan & Orientatie reference screens**: do NOT clone the AppSheet
      lookup screens; add filter chips on the element sections instead
      (filter by grenzend-aan / by orientation). Revisit only if inspectors
      ask for the reverse-lookup views.
      ✅ 2026-07-15 — grenzend-aan + orientatie chips above the element
      sections (`ElementTypeSections`, now a client component); a filter only
      constrains the element types it describes; no selection → render
      identical to before.
- [x] **DECISION MADE + IMPLEMENTED (option a):** Rekenzone grouping.
      AppSheet: Rekenzone ("A met airco") contains multiple Verdiepingen
      (BG/V1/V2) plus gevels/daken/vloeren/installaties.
      ✅ 2026-07-15 — migration 025 (`rekenzones` table + nullable
      `zones.rekenzone_id`, RLS 4-policy block, rls_tests TEST 4b; applied to
      local stack) · VABI exporter iterates `<Rekenzone>` blocks when zones
      are assigned, **legacy no-rekenzones output byte-identical** (strict-
      equality test + untouched golden snapshot; new grouped golden
      `vabi.rekenzones.golden.xml`) · mobile: rekenzone create/pick in
      ZoneManager, grouped zone list with per-type counts, grouped session
      zone chips · web: Rekenzones table (Naam | Gevels | Daken | Vloeren |
      Installaties | Notities) + rekenzone-grouped zones accordion ·
      all five gates green. This unfreezes the calc Phase 2 Rekenzone
      convention (§3.1/§5.1 number freeze still pending with owner).
      Remaining VABI semantics to confirm with calc owner: per-block
      Gebruiksoppervlakte = Σ member-zone areas; unassigned zones emit a
      trailing "Overige zones" block; `<Verdieping id>` repeats across blocks.
- **Verify gate:** standing regression rule.

---

## W5 — Follow-ups from AppSheet screenshot parity checks (2026-07-17)

Source: side-by-side of four AppSheet screens (Rekenzones Read only, Dak
Details, Grenst aan Readonly, mobile session detail) against the current apps.

- [x] **Commit the dak grenzend-aan parity fix**: `Grenzend aan` field on
      DakRow + daks included in the grenzend-aan filter chips
      (`web/components/elements/ElementTypeSections.tsx`).
      ✅ 2026-07-20.
- [x] **Rekenzone detail drill-down** (web): new route
      `web/app/(dashboard)/buildings/[id]/rekenzones/[rekenzoneId]/page.tsx` —
      Rekenzones table rows now link through; the page fetches the rekenzone's
      zones (`zones.rekenzone_id`) then all `building_elements`/`openings` for
      those zone ids and pools them into one flat list across every
      verdieping, rendered via the existing `ElementTypeSections` (now with a
      `readOnly` prop that hides the edit pencil/panel — matches the AppSheet
      "Read only" screen; no new mutation path, no schema change). Direct
      Supabase queries, same pattern as the building page.
      ✅ 2026-07-20 · mobile+web tsc clean · 120 tests green · `next build` ok
      (new route compiles, 292 B / 105 kB First Load JS).
- [ ] **Deferred pending inspector demand** (W4 decision stands): building-wide
      grenst-aan / orientatie reverse-lookup views with aggregate counts
      (AppSheet "Grenst aan Readonly"). Chips cover the question per verdieping;
      revisit only if inspectors ask for the pooled view.
- **Verify gate:** standing regression rule.

---

## W6 — AppSheet write-path completeness (mobile + web, 2026-08-21)

Source: a chat-session audit of the AppSheet dual-source integration found
six gaps; this closes four fully and wires the plumbing for a fifth, with
one sub-item left honestly open pending a live test this session didn't run.

- [x] **Openings (Transparante_Delen) full write path + cascade delete.**
      `web/app/api/appsheet/[table]/route.ts` (WRITE_TABLES/EDIT_TABLES/
      DELETE_TABLES), `web/lib/appsheet/mappers.ts` (`buildTransparantDeelEditRow`),
      new `web/components/elements/AppsheetOpeningEditPanel.tsx` (add/edit/delete
      UI per opening, slotted into `ElementTypeSections` via a new optional
      `OpeningEditPanel` prop — native mode passes nothing, zero behavior change
      there), cascade-delete in `AppsheetElementEditPanel.tsx`'s `handleDelete`.
      ✅ 2026-08-21 — live Add+Delete AND Edit+revert round-trips run directly
      against production AppSheet (Deel ID auto-gen confirmed hex; Type Deel/
      Materiaal/Glastype confirmed constrained Enums — free text 400s; Bruto/
      Netto Oppervlakte confirmed formula columns, left out of Edit) · web
      `tsc` clean · `next build` ok · 120 tests green.
- [ ] **Dak/Vloer/Installatie sync-back + Retake Measurement generalization.**
      Migration 031 (`rekenzones.appsheet_row_key`, applied to local stack,
      dry-run + verified) · `buildNewRekenzoneRow` (mappers.ts) · Rekenzone
      find-or-create loop + per-type branches in
      `web/app/api/appsheet/mobile/session-close/route.ts` (replacing the old
      gevel-only short-circuit) · `materialize-element/route.ts` generalized
      to gevel/dak/vloer/installatie (Rekenzone → first related Verdieping
      resolution) · `lib/appsheetProxy.ts` + `app/tabs/sessions/appsheet-detail.tsx`
      updated to offer "Retake Measurement" for all four types.
      ✅ 2026-08-21 — `buildNewDakRow`/`buildNewVloerRow`/`buildNewInstallatieRow`
      (previously flagged "NOT confirmed against a live Add call") each got
      a real live Add+Delete round-trip:
      - **Dak**: confirmed clean, no changes needed.
      - **Vloer**: found a real landmine — "Grenzend aan code" is
        unconditionally required on Add (400s otherwise, unlike Dak where it
        silently defaults). Fixed: `session-close/route.ts` now passes
        `el.description || 'Grond'` (ground is the safe default absent a
        real classification) — confirmed live with the corrected payload.
      - **Installatie**: confirmed genuinely blocked — "Ventilatie Code" is
        an unconditionally required Ref column with no discoverable valid
        value (every real row has it blank; no lookup table exists in
        mappers.ts). **Not fixed, by design**: `session-close/route.ts` now
        explicitly skips a brand-new Installatie Add with a clear reason
        instead of attempting a call that always 400s — Edit (for an
        already-linked Installatie) is unaffected and still works, since
        `buildInstallatieEditRow` never touches that column.
      **Still not ticked `[x]`** because Installatie Add genuinely can't
      ship yet — needs someone with the AppSheet editor to identify what
      "Ventilatie Code" references. Dak/Vloer sync-back is now fully correct
      and could be split into its own done item if useful. Web+mobile `tsc`
      clean, `next build` ok, 120 tests green.
- [x] **Retake-measurement zone → Grid Analysis entry point.**
      `app/tabs/sessions/flow.tsx`'s `forceStage` extended with a `'2'` +
      `zoneId`/`zoneName` branch (reuses the existing stage-2
      `FloorPlanImageUpload` path `handleDrawZone` already uses) ·
      `appsheet-detail.tsx` zone chips got a "📐 Trace floor plan" action
      (materializes via the first element in that zone, then routes into
      the wizard at stage 2). ✅ 2026-08-21 mobile `tsc` clean · code-level
      verification only — **needs the same on-device pass already open
      below** (this is additive to that existing open item, not a new one).
- [x] **AppSheet building detail "Visit" section.**
      `web/app/(dashboard)/buildings/[id]/page.tsx`'s `AppsheetBuildingDetail`
      gained a "Visit" card (`mapObjectenToSessionSummary`/`objectenSessionStatus`,
      already live-proven by the AppSheet Sessions list) plus an explicit
      "not available in AppSheet mode" notice for facade photos/floor-plan
      images/energy label history (genuine schema-level gaps, not just
      unbuilt — confirmed via `docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md`'s
      full entity list). ✅ 2026-08-21 — read-only, no schema changes, web
      `tsc` clean, `next build` ok.
- [x] **Perf fix**: `app/tabs/sessions/[id].tsx`'s `syncToAppsheetIfLinked`
      scoped its `openings` query to the session's actual element ids
      instead of fetching all active openings org-wide. ✅ 2026-08-21 mobile
      `tsc` clean, same result, no behavior change.
- [ ] **Vloeren `Bodemisolatie` enum** — still blocked: confirmed live no
      obvious boolean-ish value is accepted, and the actual allowed values
      live only in AppSheet's no-code editor (not visible via the Find/
      Action API). Needs Deborah to check the editor and report the exact
      valid strings.
- [ ] **On-device physical verification** of this session's mobile-side
      fixes (BLE Capture button, Grid Analysis resume, dashboard error
      banner, Retake Measurement for dak/vloer/installatie, Trace-floor-plan
      zone action) — inherently manual, folds into the existing open
      "On-device verification pass" item below.
- **Verify gate:** ✅ mobile `tsc` clean · web `tsc` clean · `next build` ok ·
  120 tests green (`npm test`, root) · migration 031 dry-run + applied to
  local stack, column verified present.

---

## W7 — Sign-up screen + ESP32 provisioning + security hardening (2026-08-21)

Both "deferred, decision needed" items from the list above, decided and
built. Research before writing code surfaced two real pre-existing security
gaps that got fixed as part of this work rather than shipped around.

- [x] **Auth hardening (found while scoping sign-up, fixed regardless)**:
      `/api/organisations` and `/api/users/invite` had **zero server-side
      auth checks** — `web/middleware.ts`'s ADMIN_ONLY protection only
      covers page paths, its matcher explicitly excludes `api/`. New shared
      `web/lib/requireAdmin.ts` (cookie-session admin check, mirrors the
      AppSheet mobile routes' own Bearer-token equivalent) wired into both.
      Separately, `handle_new_user()` (migration `006_auth_hooks.sql`)
      trusted a client-supplied `role` from `auth.signUp()`'s metadata,
      defaulting to `'inspector'` only when absent — meaning anyone could
      call `signUp()` directly with the public anon key and `role: 'admin'`
      in metadata and be granted admin. Migration `032_signup_role_hardening.sql`
      makes the trigger always insert `'inspector'` regardless of metadata;
      the invite route's own explicit post-insert `user_profiles` upsert
      (unaffected) still assigns real roles correctly.
      ✅ 2026-08-21 — migration 032 dry-run + applied to local stack;
      verified via a direct SQL test (inserted an `auth.users` row with
      `role:'admin'` in `raw_user_meta_data` inside a rolled-back
      transaction — resulting profile landed as `'inspector'`, confirmed,
      then rolled back with zero residue) · web `tsc` clean.
- [x] **Sign-up screen** — scoped to "create a brand-new organisation and
      become its first admin" (not joining an existing org — that already
      has a working, admin-initiated path via the invite flow; a self-serve
      "pick any org_id" flow would mean trusting a client-supplied org_id,
      the exact privilege-boundary problem just closed above). Web-only —
      mobile field inspectors join via invite, no mobile signup screen.
      New `POST /api/auth/signup` (service-role, mirrors `/api/organisations`
      + `/api/users/invite`'s proven shape: create the org, `admin.createUser`
      — not the public `signUp()` API — then an explicit `user_profiles`
      upsert with `role:'admin'`, so it never depends on trusting client
      metadata). New `web/app/auth/sign-up/{page,SignUpForm}.tsx`, matching
      `LoginForm.tsx`'s exact card/input/button styling; linked from the
      login page. ✅ 2026-08-21 — web `tsc` clean. **Not yet exercised
      end-to-end via HTTP**: `web/.env.local` points the running app at a
      remote Supabase instance (`supabase.krontiva.africa`), not the local
      docker stack — running the route live would create a real org/user
      there, so that step needs Deborah (or a local-stack-pointed env).
- [x] **ESP32 provisioning** — standard BLE-provisioning pattern confirmed
      from `MILESTONES.md` M7 + the existing `esp32_firmware/src/main.cpp`
      (not a blank slate). Firmware: unprovisioned unit advertises a BLE
      GATT *server* ("SCARNERGY-ESP32-SETUP") with a config characteristic
      (JSON: ssid/password/mqtt_host/mqtt_port/org_id/device_id) and a
      status characteristic (ack/error); a valid write persists to NVS
      (`Preferences`) and reboots into normal GLM-bridge operation reading
      that config instead of the old hardcoded `#define`s; a
      consecutive-WiFi-failure counter drops a misconfigured unit back into
      provisioning mode without a USB reflash.
      `CONFIG_BT_NIMBLE_MAX_CONNECTIONS=1` (platformio.ini) untouched — the
      two BLE roles (provisioning server vs. GLM client) are mutually
      exclusive by boot-mode, never concurrent. Mobile: new
      `hooks/useESP32Provisioning.ts` (deliberately separate from
      `useBLEDevice.ts` — that hook is hardcoded end-to-end for the GLM's
      protocol) + new `app/tabs/esp32-provisioning.tsx` screen (matches
      `device.tsx`'s status-card/instructions pattern), linked from the GLM
      Device screen. No migration — `ble_devices.device_type` stays
      `'other'` for an ESP32 gateway (extending the enum is a real
      transactional-migration landmine not worth it for a cosmetic value);
      WiFi/MQTT/provisioning state rides in the existing `metadata JSONB`
      column.
      ✅ 2026-08-21 mobile `tsc` clean. **Not compiled or flashed** — this
      dev environment has no PlatformIO CLI; `pio run` + a real BLE
      round-trip against a physical ESP32 is the actual verification gate,
      and it's Deborah's to run.
- **Verify gate:** web+mobile `tsc` clean · 120 tests green · migration 032
  dry-run + applied to local stack + SQL-verified. Sign-up HTTP round-trip
  and ESP32 firmware compile/flash explicitly NOT done here — see notes
  above, both need Deborah.

---

## Already covered (no action)

For orientation — these AppSheet features exist on the web today:

- Facade photos, 4 directions — `web/app/(dashboard)/buildings/[id]/page.tsx`
- Floor plans per zone (viewer + upload) — `web/components/buildings/FloorPlan*`
- Floor-area summary and totals — `web/lib/calc.ts`
- MAAK PDF → printable report — `web/app/buildings/[id]/print/page.tsx`
- EXPORT VABI → `web/app/api/export/vabi/building/[id]/route.ts`
- Sessions list/detail, measurements live feed, energy label badges
- Grenst-aan capture (mobile) + VABI `<GrenztAan>` export — `lib/vabiExport.ts`

---

## M — Mobile gap checklist

Same definition of done as above: ticked = 100% implemented, backend/DB-connected,
existing functionality and design intact, all gates green.

### Done

- [x] **Calc Phase 1, mobile side**: `lib/thickness.ts` moved into
      `@scarnergy/opname-calc`; mobile + web VABI exporters collapsed into one
      shared builder (`packages/opname-calc/src/vabi.ts`); `lib/vabiExport.ts`
      deleted, `web/lib/vabiXml.ts` reduced to a re-export shim.
      ✅ 2026-07-13 · commits c8f61b5, 9c580fa · mobile golden **byte-identical** ·
      88 tests · both `tsc` clean · `next build` ok.
- [x] **M5 auth completeness**: forgot-password (`app/auth/forgot-password.tsx`,
      email → 6-digit code → new password via `verifyOtp`), GoTrue recovery
      template deployed (`supabase/templates/recovery.html`) and **verified
      end-to-end** (real /recover call → rendered code in mailpit), profile/settings
      tab (`app/tabs/profile.tsx`, writes `user_profiles`, reads `organisations`,
      RLS-verified), role-aware tabs, password visibility toggle on sign-in.
      ✅ 2026-07-13 · commits 3a10556, 1d9379d, 0337e67.
- [x] **M4 energy results screen** (`app/tabs/sessions/results.tsx`): building
      label (worst zone) + per-zone chips from `zones.energy_label`, data-coverage
      bar from `building_elements`/`openings`, anomaly drill-down from
      `measurements.is_anomaly` into inspect, recompute via `energy_label_estimate`
      edge fn with `compute_zone_energy_label` RPC fallback, indicatief disclaimer;
      wired from session close + completed-session detail.
      ✅ 2026-07-13 · commit 85388a4.
- [x] **M8 hardening, in-repo part**: sync-queue core extracted
      (`lib/syncQueue.ts`) with app-wide drain coalescing (fixes double-insert
      race on network restore), offline stress tests (mid-drain drop, retry cap,
      50-op stress), BLE → insert → realtime → merge pipeline test with real
      decoder/dispatch/merge. ✅ 2026-07-13 · commit cb58fa3.
- [x] **CI gate enforcement**: `.github/workflows/ci.yml` runs all five standing
      gates on every PR — red gate blocks merge. ✅ 2026-07-13.

### Open

- [ ] **On-device verification pass** (only human-executable): forgot-password
      flow end-to-end on the phone, profile edits, role-gated tabs, results
      screen render, VABI export **share** — the last unticked Phase 1 gate line.
- [ ] **Phase 3 — offline on-site validators** V-04, V-05, V-09, V-11 as blocking
      flags in `app/tabs/sessions/inspect.tsx` + session close; must work with
      network off. **BLOCKED on** the Phase 2 conventions freeze (§3.1/§5.1 —
      Rekenzone decision resolved 2026-07-15, see W4: option a implemented).
      **Additionally blocked (found 2026-07-16):** V-04/05/09/11 are referenced
      only by ID in the repo — their definitions live in the licensed
      `opname-calculation-spec.md` §10 which is not in the repo. Both the
      definitions and the §3.1/§5.1 numbers must come from the calc owner
      before these can be built.
- [x] **Mobile follow-through when migration 024 lands** (pairs with W2): extend
      `lib/supabase.ts` interfaces (sync with `web/lib/types.ts`) + capture forms
      in inspect/zone screens for the new NTA fields — `plafond_type`,
      warmtecapaciteit classes, isolatie dikte/λ + na-isolatie, kruipruimte
      hoogte, PV params, tapwater segments, `rc_source` provenance.
      ✅ 2026-07-16 — interfaces were synced with W2; DETAIL_FIELDS extended
      per element type (gevel/vloer/dak: isolatie dikte/λ, na-isolatie(+jaar),
      rc_source; gevel: dikte_vloerconstructie; vloer: kruipruimte hoogte when
      grenzend aan kruipruimte + the storey's plafond/warmtecap classes — same
      vloer-element carrier as the web zone form; installatie: PV params for
      ZonnePanelen, tapwater segments for Tapwater) · new collapsed-by-default
      DETAILS section in inspect.tsx (measurement-first flow + completion
      logic untouched) · tapwater text ⇄ JSONB round-trip in `lib/tapwater.ts`
      (unit-tested) · mobile `tsc` clean, 120 tests green.
- [ ] **Results screen confidence upgrade**: replace the data-coverage proxy with
      real confidence when the §9 engine (calc Phase 4) replaces the rule-based
      heuristic; keep the disclaimer.
- [x] **M8 remainder**: RLS tests (`supabase/migrations/rls_tests.sql`) wired
      into CI · API smoke tests across Kong routes.
      ✅ 2026-07-16 — rls_tests.sql rewritten into a real harness (one txn as
      the `authenticated` role with simulated JWT claims — the old suite's
      SET LOCAL was a no-op and the superuser bypassed RLS entirely; explicit
      PASS/FAIL per test; TEST 10's invalid UUID fixed to the seed zone) ·
      `scripts/db_check.sh` applies the full 001→027 chain to a fresh
      supabase/postgres behind a documented auth/storage shim, validated
      green end-to-end in a fresh container (11/11 PASS, energy label E from
      seed) · new CI `db` job runs it on every PR (same image as the local
      stack) · `scripts/api_smoke.sh` probes the Kong routes read-only —
      5/5 green against the live stack, and it caught a real bug: realtime's
      tenant health needs a Bearer token, so the web health dashboard
      mis-reported realtime as down (fixed in
      `web/app/api/health/realtime/route.ts`).
- [ ] **Deferred (decision needed before building)**: sign-up screen (users are
      admin-provisioned today) · ESP32 provisioning screen (M7, when the
      hardware fleet scales).