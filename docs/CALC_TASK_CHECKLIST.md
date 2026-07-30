# Calc Refactor — Task-Level Checklist

**Companion to:** `CALC_ARCHITECTURE_PLAN.md`
**Overriding constraint:** every phase ends **green** — existing mobile + web functionality
and design must keep working. Each phase has a **Verify** gate; do not start the next phase
until the current one's gate passes.

Legend: `[ ]` todo · files are exact paths.

---

## Phase 0 — Guardrails (make "existing works" *verifiable* first)

Nothing here changes app behaviour; it restores our ability to prove non-regression.

- [x] **Restore the test harness.** `ts-jest` is referenced in `package.json` but not installed
      → `npm test` fails. Reinstall `ts-jest` (or migrate the config to `jest-expo`), then
      confirm `bleDecoder.test.ts`, `floorplanGeometry.test.ts`, `thickness.test.ts` pass.
- [x] **Scope the root tsconfig.** Add `"exclude": ["web", "supabase/functions", "node_modules"]`
      so `npx tsc --noEmit` typechecks the **mobile** app only (today it drags in web + Deno and
      throws ~40 false errors). Add a `"typecheck": "tsc --noEmit"` script to each app.
- [x] **Fix / confirm** the one real mobile error: `expo-file-system/legacy` in `lib/uploadImage.ts:14`.
- [x] **Capture a golden VABI export.** Run the current mobile `buildVabiXml` and web `vabiXml`
      on one real session; save both outputs as fixtures. These are the regression oracle for Phase 1.
      (`__tests__/fixtures/vabi.mobile.golden.xml` + snapshot; mobile format is the canonical oracle.)
- **Verify gate:** ✅ 2026-07-13 — `npm test` green (88) · mobile `tsc` clean · `cd web && tsc` clean · `next build` succeeds · golden fixtures saved.

---

## Phase 1 — Shared core (kill the duplication, zero behaviour change)

- [x] Create `packages/opname-calc` (`package.json` name `@scarnergy/opname-calc`, `tsconfig`,
      `src/index.ts`). (Wired via `file:` deps in both apps instead of root workspaces —
      same effect, no hoisting surprises with Metro.)
- [x] Move pure primitives in, **verbatim** (no logic changes yet):
      - `src/units.ts` ← `mmToM`, formatters (from `web/lib/calc.ts`)
      - `src/geometry.ts` ← `toCardinal`, `openingArea`, area/netto helpers (from `lib/vabiExport.ts` + `web/lib/calc.ts`)
      - `src/thickness.ts` ← move `lib/thickness.ts`
- [x] Point **both** apps at the package: Next `transpilePackages: ["@scarnergy/opname-calc"]`;
      Metro resolution via `file:` dep. Imports updated in
      `web/lib/vabiXml.ts`, `web/lib/calc.ts`, and mobile callers.
- [x] Collapse the two VABI exporters onto one shared builder; delete the divergent copy.
      (`packages/opname-calc/src/vabi.ts`; canonical = mobile format + web's Vloer `<Perimeter>`.
      `lib/vabiExport.ts` deleted; `web/lib/vabiXml.ts` is a re-export shim.)
- **Verify gate:** ✅ 2026-07-13 — mobile golden **byte-identical** · web divergence diff-reviewed
      (web adopts the richer mobile format) · both `tsc` clean · `next build` ok ·
      _mobile export share on a real device: still to re-verify after next dev-client session._

---

## Phase 2 — Authoritative engine, web server-side (new capability)

**Gate BEFORE coding:** licensed NTA 8800 / ISSO 82.1 forfait tables transcribed;
§3.1 (36.7 vs 37.35) and §5.1 (10.40 vs 10.90) conventions frozen with AppSheet owner.

- [ ] Apply the data-model migration (see `proposed_migration_calc_fields.sql`) — additive only.
- [ ] `web/lib/engine/forfait/` — Rc (§6), U/g (§4.2), warmtecapaciteit (§1.3) tables + loaders.
- [ ] `web/lib/engine/rc.ts` — priority chain: documented → observed → build-year forfait.
- [ ] `web/lib/engine/uvalue.ts` (§4.2/§4.3), `floorUeq.ts` (§5.2 B′/crawl-space), `ht.ts` (§8), `pv.ts` (§7.3).
- [ ] `web/lib/engine/ag.ts` — NEN 2580 Ag exclusions (§1.1).
- [ ] Expose via API routes / server actions; every `calc:` result returns its derivation string (audit trail).
- [ ] Unit-test each formula against worked examples from the spec's "observed" values.
- **Verify gate:** engine unit tests green · existing web pages/exports unchanged (fixtures still pass) ·
      `next build` ok · admin dashboard renders new derived fields without layout regressions.

---

## Phase 3 — Mobile on-site validation (offline-safe)

- [ ] Implement V-04, V-05, V-09, V-11 in a mobile validator using `@scarnergy/opname-calc`.
- [ ] Surface as blocking flags in `app/tabs/sessions/inspect.tsx` / session close — **must work offline**.
- **Verify gate:** validations fire with network off · no false blocks on existing valid sessions ·
      mobile `tsc` clean · tests green.

---

## Phase 4 — Remaining surface (web)

- [ ] §7.2 installation η (BCRG lookup vs forfait — build/buy decision).
- [ ] §9 indicative label (+ "indicatief — geen officieel label" disclaimer).
- [ ] Retire toy label engines: `ai_server/routers/energy.py:/predict`, SQL `compute_zone_energy_label`,
      edge `energy_label_estimate` — only after §9 replaces them and nothing references them.
- [ ] BAG / 3DBAG integration for V-01/02/03 (net-new external source).
- **Verify gate:** no dead references to removed engines · full build green both apps · label shows disclaimer.

---

## Standing regression rule

After **every** task: mobile `tsc` clean · `web tsc` clean · `next build` ok · `npm test` green ·
golden VABI fixtures unchanged unless intentionally updated (with review).
