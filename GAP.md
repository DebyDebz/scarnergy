# Web ↔ AppSheet Gap Checklist

**Source:** screen-by-screen comparison of the reference AppSheet app
("Opname app-sandboxV5", screenshots 2026-07-07) against the web app (`web/`),
done 2026-07-09.

**Companions:** `docs/CALC_ARCHITECTURE_PLAN.md`, `docs/CALC_TASK_CHECKLIST.md`,
`docs/proposed_migration_calc_fields.sql`.

**Overriding constraint:** existing functionality and design must keep working.
Reuse the current design system (Tailwind cards/tables, Dutch title +
English subtitle convention, existing components in `web/components/`).
After every milestone: mobile `tsc` clean · `cd web && tsc` clean ·
`next build` ok · `npm test` green (67 tests) · golden VABI fixtures unchanged.

Legend: `[ ]` todo · file paths are exact.

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

mobile 
Calc refactor — the two mobile-relevant phases
Phase 1 remainder: move lib/thickness.ts into @scarnergy/opname-calc, then the big one — collapse the mobile and web VABI exporters (lib/vabiExport.ts vs web/lib/vabiXml.ts) into one shared builder, verified byte-identical against the golden fixtures. Until then every export fix must be made twice.
Phase 3 — on-site validation (mobile-specific, not started): offline-safe validators V-04, V-05, V-09, V-11 surfaced as blocking flags in inspect.tsx and at session close. Gated on the Phase 2 convention freeze with the AppSheet owner (§3.1 / §5.1 values), so it can't start yet.
3. Schema follow-through when migration 024 lands (GAP.md W2)
When proposed_migration_calc_fields.sql is applied, the mobile app needs: extended interfaces in lib/supabase.ts (kept in sync with web types), and a decision on whether inspectors capture the new NTA fields on-site — plafond_type, warmtecapaciteit classes, rekenhoogte override, rc_source provenance. If yes (likely — they're opname data), that's form additions in the inspect/zone screens.

4. Deferred product features
Sign-up screen — deliberately skipped; users are admin-provisioned. Only build it if self-registration becomes a requirement.
ESP32 provisioning screen (M7) in the device tab — write WiFi/MQTT credentials over BLE. Only matters when the hardware fleet scales beyond hand-flashed units.
Results screen upgrade — when the Phase 4 §9 indicative-label engine replaces the rule-based heuristic, swap the data-coverage proxy for real confidence and keep the disclaimer wording.
Rekenzone decision (GAP.md W4) — whichever option is chosen will ripple into mobile zone screens; nothing to do until it's frozen.
5. Verification debt (not code, but real)
On-device pass over today's features — forgot-password, profile, role-gated tabs, results screen have green tests and clean types, but haven't been exercised on a phone yet. Now that your dev client connects, this is quick.
GoTrue recovery template — the forgot-password flow needs {{ .Token }} in the recovery email template on your self-hosted Supabase; without it, users get a link instead of a code. This is server config, and the flow is untestable until it's set.
M8 leftovers that live outside the app: RLS tests wired into CI and API smoke tests across Kong routes.