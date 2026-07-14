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

- [ ] **Group zone elements by type with counts.** Replace the flat elements
      table with sections/cards per `element_type`: Gevels, Daken, Vloeren,
      Installaties, each with a count badge (AppSheet: "Gevels 8 · Daken 1 ·
      Vloeren 1 · Installaties 3"). Use `lib/elementTypes.ts` labels.
- [ ] **Gevel rows**: show Positie, Huidige Orientatiecode (derive cardinal
      from `orientation_deg` via `@scarnergy/opname-calc` `toCardinal`),
      Bruto Oppervlakte, Hoogte, Breedte.
- [ ] **Transparante Delen detail** (expandable per opening): Type Deel,
      Materiaal (`frame_type`), Glastype (`glazing_type`), Hoogte/Breedte,
      Bruto + Netto Oppervlakte, Zonwering (`has_shading`/`shading_type`/
      `shading_factor`), Overstek (`overstek_m`), Belemmering (`belemmering`),
      Thermisch onderbroken (`thermisch_onderbroken`), U-values, g-value.
      All columns exist since migrations 017–018.
- [ ] **Dakkapellen nested under their Dak** using `parent_element_id`;
      show per-dak Totaal Oppervlakte Gaten and Netto Dakoppervlak
      (bruto − openings − dakkapel footprints) computed via
      `@scarnergy/opname-calc` — same math as the VABI export, do not fork it.
- [ ] **Installaties card**: Brand (`brand`), Model (`model_nr`),
      CV-klasse (`cv_klasse`), fuel/installation type, efficiency,
      capacity, year — currently only efficiency renders.
- [ ] **Vloeren rows**: Perimeter (`perimeter_m`), Grenzend aan (parsed the
      same way `lib/vabiExport.ts:185` `grenztAan()` does), oppervlakte.
- [ ] **Notities en Foto's**: render element `notes` and `photo_urls`
      (signed URLs, same pattern as facade photos on the building page).
- [ ] **Session header parity** in
      `web/app/(dashboard)/sessions/[id]/page.tsx`: add Duur
      (completed_at − started_at) and Voorgevel Orientatie.
- **Verify gate:** visual check against the AppSheet screenshots ·
  no layout regressions on existing sections · standing regression rule.

---

## W2 — Apply the drafted migration, then the calc-field UI

Blocked on: reviewing `docs/proposed_migration_calc_fields.sql` (additive,
idempotent — designed to be safe).

- [ ] Move `docs/proposed_migration_calc_fields.sql` →
      `supabase/migrations/024_calc_fields.sql` and apply it.
- [ ] Regenerate/extend types: `lib/supabase.ts` interfaces and
      `web/lib/types.ts` (keep both in sync).
- [ ] **Verdieping/zone edit form** (web): Plafond (`plafond_type`),
      Warmtecapaciteit vloer (`warmtecap_vloer_klasse`), Warmtecapaciteit
      gevel (`warmtecap_gevel_klasse`), Hoogte, GebruiksOppervlakte, Notities,
      kJ_m2K (derived, read-only) — mirrors the AppSheet "BG" edit form.
- [ ] **Gevel calc fields**: Rekenhoogte / Rekenbreedte display
      (`rekenhoogte_m_override`, `dikte_vloerconstructie_mm`, engine default
      300 mm per §2.1).
- [ ] **Transparante Delen calc fields**: `u_glas`, `g_waarde`, `f_sh`.
- [ ] **Rc provenance**: show `rc_source` (documented / observed /
      buildyear-forfait) as a small badge next to Rc values.
- **Verify gate:** migration applies cleanly on a copy · existing mobile app
  unaffected (columns nullable/additive) · standing regression rule.

---

## W3 — Net-new integrations

- [ ] **BAG / 3DBAG panel** on the building page: BAG Bouwjaar, BAG Opp,
      3dbag hoogte, BAG Gebruiksdoel, BAG Pand ID. Server-side Next API route
      calling the Kadaster BAG API + 3dbag.nl by address/postcode; cache the
      result on the building row (needs a small additive migration for the
      cached fields + fetched_at). Feeds validations V-01/02/03 in the calc
      plan (Phase 4 there).
- [ ] **Map on the building/opname page**: embed (Google Maps iframe or
      Leaflet+OSM to avoid an API key) showing the geocoded address, matching
      the AppSheet header card.
- **Verify gate:** panel renders gracefully when the external API is down ·
  no server key leaks to the client · standing regression rule.

---

## W4 — Nice-to-haves / decisions

- [ ] **"Sla op als Standaard"** for Transparante Delen: new small table
      (e.g. `element_defaults`: org_id, element_kind, payload JSONB) + a
      "save as default" action and a "apply default" picker on the add/edit
      form. Additive migration.
- [ ] **Grenst-aan & Orientatie reference screens**: do NOT clone the AppSheet
      lookup screens; add filter chips on the element sections instead
      (filter by grenzend-aan / by orientation). Revisit only if inspectors
      ask for the reverse-lookup views.
- [ ] **DECISION NEEDED (with AppSheet/calc owner):** Rekenzone grouping.
      AppSheet: Rekenzone ("A met airco") contains multiple Verdiepingen
      (BG/V1/V2) plus gevels/daken/vloeren/installaties. Current schema:
      `zones` == one floor; no grouping layer above it. Options:
      (a) add `rekenzone` table + `zones.rekenzone_id` (additive),
      (b) keep zones-as-floors and tag elements with a rekenzone label,
      (c) accept the flat model. Must be frozen before calc Phase 2
      (same gate as `docs/CALC_TASK_CHECKLIST.md` Phase 2).
- **Verify gate:** standing regression rule.

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
      network off. **BLOCKED on** the Phase 2 conventions freeze (§3.1/§5.1 +
      Rekenzone decision, see W4).
- [ ] **Mobile follow-through when migration 024 lands** (pairs with W2): extend
      `lib/supabase.ts` interfaces (sync with `web/lib/types.ts`) + capture forms
      in inspect/zone screens for the new NTA fields — `plafond_type`,
      warmtecapaciteit classes, isolatie dikte/λ + na-isolatie, kruipruimte
      hoogte, PV params, tapwater segments, `rc_source` provenance.
- [ ] **Results screen confidence upgrade**: replace the data-coverage proxy with
      real confidence when the §9 engine (calc Phase 4) replaces the rule-based
      heuristic; keep the disclaimer.
- [ ] **M8 remainder**: RLS tests (`supabase/migrations/rls_tests.sql`) wired
      into CI · API smoke tests across Kong routes.
- [ ] **Deferred (decision needed before building)**: sign-up screen (users are
      admin-provisioned today) · ESP32 provisioning screen (M7, when the
      hardware fleet scales).