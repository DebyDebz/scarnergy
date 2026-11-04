# Calculation Architecture Plan — Mobile + Web

**Status:** Proposed · **Date:** 2026-07-08
**Decides:** where every calculation in `opname-calculation-spec.md` runs, and how mobile
and web stop duplicating math.

---

## Problem this plan solves

1. `opname-calculation-spec.md` is **silent on mobile vs web** — it only says "in-app / our side".
2. Calc is currently **scattered and duplicated** across four places:
   - Mobile `lib/vabiExport.ts` (389 ln) — full VABI export + geometry
   - Web `web/lib/vabiXml.ts` (300 ln) — a *diverged hand-copy* of the above
   - Web `web/lib/calc.ts` — a third copy of the aggregation math
   - Server SQL `compute_zone_energy_label` + edge `energy_label_estimate` + FastAPI `energy.py` — three toy Rc-sum labels
3. Mobile (`scarnergy-app`) and web (`web`) are **separate npm packages with no shared code**, so anything built once drifts three times.

---

## Decisions (locked)

- **Shared code** → npm **workspace package** `packages/opname-calc` (pure TS, no react-native / no Next imports), imported by both apps.
- **Authoritative engine host** → **Next.js web server-side** (API routes / server actions). Same TS as the shared core; lives with admin; licensed tables stay server-side.

---

## The rule: split by *purpose*, not by app

| Concern | Home | Why |
|---|---|---|
| GLM capture, thickness from 2 faces, live area preview, **on-site** validation (V-04, V-05, V-09, V-11) | **Mobile** | Must run **offline**, and must catch fatal data errors *before the inspector leaves the building* |
| Deterministic primitives (mm↔m, area=h×w, cardinal orientation, netto=bruto−openings, rekenhoogte, thickness) | **`packages/opname-calc`** | Both sides need them — one source of truth kills the drift |
| **Authoritative NTA math**: Rc forfait (§6), U/g forfait (§4.2), shading F_sh (§4.3), floor U_eq/B′ (§5.2), warmtecapaciteit (§1.3), HT roll-up (§8), NEN 2580 Ag (§1.1), PV yield (§7.3), installation η (§7.2), VABI export, indicative label (§9) | **Web server-side** | Online, licensed tables, BAG/3DBAG access, supervisor review + certified sign-off, changes often |

---

## Spec section → home mapping

| Spec § | Calculation | Home |
|---|---|---|
| §1.1 | Ag per verdieping (NEN 2580 exclusions) | Web engine |
| §1.2 | Zone aggregates (Ag, Volume) | Web engine |
| §1.3 | Interne warmtecapaciteit (lookup) | Web engine |
| §2.1–2.3 | Rekenhoogte, bruto, **netto** | Core (primitives) + Web (overrides) |
| §2.4 | Perimeter from gevels | Core |
| §3.1–3.4 | Dak geometry, dakkapel | Core (geometry) + Web (gaten rules) |
| §4.1 | Transparant deel area | Core |
| §4.2 | U/g forfait lookup | Web engine |
| §4.3 | Shading F_sh | Web engine |
| §5.1 | Vloer geometry | Core |
| §5.2 | U_eq / B′ crawl-space | Web engine |
| §6 | Rc forfait engine | Web engine |
| §7 | Installations (η, PV, koeling) | Web engine |
| §8 | Zone/opname roll-ups (HT) | Web engine |
| §9 | Indicative label | Web engine (OUT OF SCOPE v1) |
| §10 | Validation V-04/05/09/11 | Mobile (on-site) |
| §10 | Validation V-01/02/03/06/07/08/10/12 | Web engine |

---

## Target layout

```
ScanergyV2/                     (npm workspace root — add "workspaces": ["web", "packages/*"])
├── packages/
│   └── opname-calc/            ← NEW shared package (pure TS)
│       ├── src/
│       │   ├── units.ts        mm↔m, formatters
│       │   ├── geometry.ts     area=h×w, netto, rekenhoogte, perimeter, orientation
│       │   ├── thickness.ts    (moved from mobile lib/thickness.ts)
│       │   └── index.ts
│       └── package.json        name: "@scarnergy/opname-calc"
├── app/ · lib/ · hooks/        mobile — imports @scarnergy/opname-calc
└── web/                        Next.js — imports @scarnergy/opname-calc
    └── lib/engine/             ← NEW authoritative engine (server-side)
        ├── forfait/            Rc, U/g, warmtecapaciteit tables (licensed)
        ├── rc.ts · uvalue.ts · floorUeq.ts · ht.ts · pv.ts
        └── vabi.ts             single authoritative VABI export
```

Metro (Expo) + Next both need the workspace package transpiled — configure
`transpilePackages: ["@scarnergy/opname-calc"]` in `next.config` and add the
package to Metro's `watchFolders` / resolver.

---

## Phases

### Phase 0 — Stop the bleeding
- Designate **web** as the single authoritative VABI export; mobile export becomes "on-site draft" (or routes through the shared core once it exists).
- Delete the toy label engines `ai_server/routers/energy.py:/predict` and SQL `compute_zone_energy_label`; keep AI server for anomaly/type ML + floorplan CV only.

### Phase 1 — Shared core
- Stand up the workspace + `@scarnergy/opname-calc`.
- Move primitives out of `lib/vabiExport.ts` and `web/lib/calc.ts` into it; both import it. `web/lib/vabiXml.ts` and `lib/vabiExport.ts` collapse onto one code path.

### Phase 2 — Authoritative engine (web server-side)
- **Gate first:** transcribe licensed NTA 8800 / ISSO 82.1 forfait tables (spec §11.3); resolve frozen-convention items §3.1 (36.7 vs 37.35) and §5.1 (10.40 vs 10.90) with the AppSheet owner.
- Implement §1.1, §2, §5.2, §6, §4.2/4.3, §8 as `web/lib/engine/*`, exposed via API routes / server actions. Each `calc:` field carries its derivation string (audit trail per spec convention).

### Phase 3 — Mobile on-site validation
- Implement V-04, V-05, V-09, V-11 on mobile using the shared core; surface as blocking flags before session close. Everything else stays web.

### Phase 4 — Remaining surface (web)
- §7.3 PV, §7.2 η (BCRG lookup vs forfait — build/buy, spec §11.5), §9 indicative label (+ "geen officieel label" disclaimer), BAG/3DBAG integration (net-new; not present today) for V-01/02/03.

---

## Data-model dependencies (new columns/tables, mostly Phase 2)

Already added (migration 0072): `thermisch_onderbroken`, `overstek_m`, `belemmering`,
`bodemisolatie`, `cv_klasse`, `nokhoogte_m`.

Still needed: `dikte_vloerconstructie`, rekenhoogte override, warmtecapaciteit classes
(plafond/vloer/gevel), kruipruimte height, na-isolatie flag+year+thickness, PV
(panel count / oriëntatie / hellingshoek / beschaduwing), tapwater segment lists,
stored `U`/`g`/`F_sh` per deel. Plan one migration wave.
