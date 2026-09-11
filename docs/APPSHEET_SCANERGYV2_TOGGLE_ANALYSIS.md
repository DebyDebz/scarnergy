# AppSheet ↔ ScanergyV2 Toggle — Full Data Analysis & Handover

For whoever builds the dashboard toggle. Covers the full data structure on both sides (not just Contactpersoon — see `CONTACTPERSOON_DATA_ANALYSIS.md` for that entity in isolation), what happens to each entity when the toggle flips, what the UI needs to support it, and what's actually feasible against the AppSheet API. Shopify Orders is intentionally out of scope (descoped earlier as a separate intake-workflow question).

**Confirmed design constraint:** the toggle is a **full data-source switch** — each side reads from its own store, no blended/merged view. That single decision drives almost everything below.

---

## 1. Full entity comparison (real data pulled from both sides)

| AppSheet/Excel entity | Live rows | ScanergyV2 equivalent | Match quality |
|---|---|---|---|
| Bedrijven | 2 | `organisations` | Clean 1:1 |
| Inspecteurs | 5 | `user_profiles` (role=inspector) | Clean, ScanergyV2 folds all roles into one table + enum |
| Objecten | 5 | `buildings` | Clean 1:1, ScanergyV2 has richer typed fields (building_type, year_class, compactness_factor) that don't exist in Excel at all |
| Contactpersoon | 90 (many duplicate/test rows, see below) | **none** | Gap — in progress, scoped separately |
| Rekenzones | 4 | `rekenzones` | **Name matches, scope doesn't** — see §2 |
| Verdiepingen | 9 | `zones` | Clean 1:1 (floors), just named differently |
| Daken / Gevels / Vloeren / Installaties | 5 / 24 / 5 / 6 | `building_elements` (unified, `element_type` enum) | Clean, but 4 sheets → 1 table; adds a `dakkapel` (dormer) type Excel never modeled |
| Transparante_Delen | 52 | `openings` | Clean 1:1 |
| Annotations | 41 | ScanergyV2's own floor-map pin feature (exists, per your confirmation) | Feature-parity check owned elsewhere — not analyzed here |
| BAG Data | 5 populated / 774 total rows | `buildings.bag_*` columns | Clean 1:1, **but 769 of 774 rows in the sheet are blank padding** — don't script a 1:1 row import, filter first |
| Standaardwaarden | 90 rows, 74 distinct object references | `element_defaults` (org-level, not per-object) | **Real mismatch, quantified below** |
| DownloadUrls | 2 populated / 24 total | Storage buckets + `inspection_sessions.report_url` | Low volume, low risk |
| 16 lookup/logic sheets (Orientatie, Grenst-aan, Constructie type, Ventilatie, Zonwering, etc.) | static reference data | Postgres enums + hardcoded mapping functions in `packages/opname-calc` | **Architecture shift**: data-driven table → compiled code. See §2. |

### Standaardwaarden — quantified mismatch

Pulled every row and cross-checked against the 5 real `Objecten`: only **2 of 5 current objects have any Standaardwaarden entry at all**. The other 72 distinct object IDs referenced across the 90 rows point to objects that no longer exist in the current `Objecten` sheet — historical/deleted data, not live. Where data does exist, it shows real per-object variation over time (e.g. object `e3108902` has two rows 10 minutes apart, `HR++ Glas` → `Dubbel Glas`, timestamped via `LaatsteUpdate` — looks like a correction, not two simultaneous defaults). This supports treating it as a **"latest value wins" log**, which maps reasonably well to `element_defaults`'s single-current-value design — the earlier open question about per-object granularity turns out to be lower-stakes than it looked, since so little of the 90 rows is actually live.

---

## 2. What happens when the toggle flips — entity by entity

Because this is a full data-source switch, the honest framing is: **flipping the toggle doesn't show the same data two ways — it shows two different, independently-maintained datasets that happen to describe the same buildings.** Concretely:

- **Bedrijven/Inspecteurs/Objecten/Verdiepingen/Daken/Gevels/Vloeren/Installaties/Transparante_Delen** — structurally equivalent on both sides, so toggling should show "the same building" in both, *if* the two stores are actually kept in sync (they aren't automatically — there's no live replication implied anywhere in either source). Worth being explicit with the team that "full data-source switch" does not mean "same data, different UI" — it means whatever's been entered into each system independently.
- **Rekenzones — the one place toggling could visibly confuse a user mid-transition.** In AppSheet, "Rekenzone" is the primary grouping a user works within (4 zones cover all 5 objects). In ScanergyV2, `rekenzones` is an *optional* layer sitting above `zones` (floors) — a building can have floors with no rekenzone at all. So the same building could show a populated grouping on one side and an empty/different one on the other. This is the single highest-confusion-risk item on the list.
- **Contactpersoon** — already resolved: omitted on the ScanergyV2 side until the new table ships (in scope for this build, per earlier discussion).
- **Annotations** — out of scope per earlier steer; feature-parity ownership confirmed to sit with a **third party**, not an internal team. Worth flagging that explicitly in planning: third-party dependencies typically need more lead time to schedule and less visibility into progress than an internal owner would. Toggling to ScanergyV2 shows whatever that third party's floor-map pin feature currently holds, which is not verified to contain the same 41 live AppSheet annotations — recommend getting a firm confirmation date from them before the 3-month cutover window is treated as fixed.
- **BAG Data / Standaardwaarden / DownloadUrls** — low visible impact; these are enrichment/metadata fields, not primary workflow data an inspector is staring at during a visit.
- **The 16 lookup tables** — this is a quieter but real risk. In AppSheet, if someone adds a new orientation code or wall-construction type by adding a row to a lookup sheet, it's immediately available. In ScanergyV2, the equivalent is a Postgres enum or a hardcoded mapping function — changing it requires a code change and deploy. If anyone on the ops side is used to extending these lists themselves, toggling to ScanergyV2 silently removes that ability. Worth a heads-up to whoever owns data governance post-cutover.

---

## 3. UI requirements

**Note:** the real ScanergyV2 web dashboard is already built, but its repo isn't connected to this workspace — so the below is written from the data/architecture facts in `DATA_STRUCTURE.md` plus general patterns, not a scan of the actual dashboard components. Confirmed: whoever this doc is handed to has direct access to that build and can verify/adjust each item below against the real code (e.g. whether a global state pattern already exists, what the current nav/settings structure looks like) — treat §3 as the requirements checklist to validate against the real UI, not as a description of it.

What a full data-source-switch toggle needs, minimum:

- **A single, app-wide toggle control** (settings page or persistent header control), not a per-page setting — since every screen needs to agree on which source it's reading from.
- **A data-source context/provider** wrapping the app so every screen's data-fetching goes through one selected implementation rather than each page independently checking a flag. `DATA_STRUCTURE.md` confirms the web app currently has *no global client state store* (only the mobile app has `authStore.ts`) — so this context doesn't exist yet and needs to be built from scratch, not extended.
- **A parallel service layer per entity**, one implementation hitting Supabase, one hitting the AppSheet API — for every entity in the table above that both sides support (Bedrijven→organisations, Objecten→buildings, etc.), not just Contactpersoon. That's roughly a dozen entity types needing dual implementations, not one.
- **A visible, persistent indicator of which source is active** — given the earlier-flagged risk (people not knowing which system they're in), this isn't optional polish, it's the main thing preventing the fragmentation problem this whole toggle exists to manage during the transition window.
- **Explicit empty-state handling** for entities missing on one side (Contactpersoon today; any others found once someone audits Annotations parity).
- **Loading-state design that assumes AppSheet is slower.** The AppSheet API is a remote third-party call per request, with fan-out required to reconstruct a full building (object → rekenzones → each Dak/Gevel/Vloer/Installatie is a separate `Find` call, based on how the existing prototype code does it — see §4). Supabase is a direct DB read. These will not feel the same speed-wise; don't reuse one loading spinner design for both.

## 4. AppSheet API — what's actually feasible

Verified against Google's own AppSheet API docs, plus a real (if prototype/non-production) integration found in this workspace at `/GitHub/Bosch-GLM50C-Rangefinder/web/services/appsheetApi.ts` — worth knowing this exists as a reference even though it's not part of the production ScanergyV2 dashboard:

- **API access requires an Enterprise AppSheet plan.** Confirm the account this needs to run against actually has that — if not, this is a blocker before any of the above matters.
- **Auth is a single `ApplicationAccessKey` header**, validated against keys configured in the AppSheet app settings. The prototype file above has a real App ID and access key **hardcoded directly in client-side TypeScript** — that's a live secret sitting in a repo, retrievable by anyone who loads the web bundle. Whatever gets built for the real toggle should call AppSheet from a server-side proxy/route, not the browser, and that exposed key should be rotated regardless of whether this prototype code is reused.
- **Bulk reads are supported and better than the existing prototype uses.** The prototype only does per-ID `Find` lookups (fetch one Object, then N parallel fetches for its Rekenzones, then N more for each Dak/Gevel/Vloer/Installatie — a fan-out pattern). The actual API supports a `Find` with an empty `Rows` array and no `Selector`, which returns **the entire table in one call** — and a `Selector` property supporting `FILTER()`, `ORDERBY()`, `SELECT()`, and `TOP()` expressions for server-side filtering/sorting/limiting. Whoever builds the real integration should use this instead of copying the prototype's per-row fan-out pattern, especially for list views (e.g. "all buildings" or "all contacts").
- **No documented fixed rate limit** — Google's docs describe performance as "entirely application dependent" (driven by security-filter evaluation, virtual column computation, and automation rules on the AppSheet side) and point to AppSheet's own Performance Profiler as the way to measure it for a specific app. This needs to be load-tested against the real account before committing to any real-time UI expectations — don't assume it behaves like a normal low-latency API.
- **Every one of the ~30 sheets is its own API endpoint** (`/tables/{tableName}/Action`) — there's no single query across the whole workbook. Building the AppSheet side of the toggle means wiring roughly as many endpoint integrations as there are entity types in the table in §1, not just Contactpersoon.
- **Decided:** build the AppSheet-side service layer on the bulk `Find` + `Selector` pattern (`FILTER()`/`ORDERBY()`/`SELECT()`/`TOP()`), not the existing prototype's per-row fan-out. No reason surfaced to keep the fan-out approach — it's slower, makes more calls against an unknown rate limit, and the bulk pattern is natively supported.

---

## 5. Next steps

- Whoever receives this doc should validate §3's UI requirements against the actual ScanergyV2 dashboard build (existing state patterns, nav structure, settings surface) — they have direct access to confirm what already exists vs. what's net-new.
- Confirm AppSheet Enterprise plan status before scoping the API work.
- Rotate the exposed `ApplicationAccessKey` found in `Bosch-GLM50C-Rangefinder/web/services/appsheetApi.ts`, independent of whether that code gets reused.
- Build the AppSheet-side service layer on bulk `Find`/`Selector`, not the prototype's fan-out pattern (decided, §4).
- Decide who owns the Rekenzones scope-mismatch risk (§2) before cutover — it's the one place toggling could show materially different structure for the same building, and it isn't part of the Contactpersoon-scoped build.
- Get a firm delivery/confirmation date from the third party owning Annotations feature parity — don't let it default to "sometime before cutover."
- Load-test the AppSheet API against the actual account/data volumes before committing to a real-time toggle UX.

---

## 6. Build status (2026-07-30)

§3 validated against the real dashboard repo (`web/`), not just the data facts:

- **Global state**: confirmed the doc's claim — the web app had zero React Context/Zustand/Redux before this build (only mobile's `store/authStore.ts`). Built `web/lib/dataSource/DataSourceContext.tsx`, a plain React Context (a store library is overkill for one app-wide enum), wrapped around `{children}` in `web/app/(dashboard)/layout.tsx`.
- **Settings/nav surface**: no dedicated `/settings` route exists. The toggle + indicator live in the persistent `TopBar` (`web/components/nav/DataSourceToggle.tsx`) instead — the one place guaranteed visible on every screen.
- **Service layer**: confirmed there was no existing service-layer abstraction — components called Supabase directly. Built `web/lib/services/{types.ts,index.ts,scanergy/*,appsheet/*}` with one interface per entity, a Supabase-backed impl, an AppSheet-backed impl, and a factory keyed off the active `DataSource`.
- **Contacts table**: shipped (`supabase/migrations/029_contacts.sql`, `contacts` table + `contact_role` enum + RLS, per `CONTACTPERSOON_DATA_ANALYSIS.md` §4's field mapping). Wired end-to-end as the reference dual-sided entity: `BuildingContactCard` on the building detail page reads through the toggle, with explicit loading/blocked/empty states per §3.
- **Scope actually implemented**: organisations, buildings, and contacts got both a `scanergy/` and an `appsheet/` implementation. The other ~9 entity types in §1's table (rekenzones, zones, building_elements, openings, ble_devices, user_profiles, etc.) are **not yet built** — they follow the identical two-file-plus-factory shape documented in `web/lib/services/types.ts`; this is a scale-out task, not a design question.
- **AppSheet-side blockers — still open, not resolved by this build.** Checked this repo and this environment for evidence either way and found none:
  1. **AppSheet Enterprise API access is not confirmed** on the target account.
  2. **The exposed `ApplicationAccessKey`** in `Bosch-GLM50C-Rangefinder/web/services/appsheetApi.ts` could not be checked or rotated — that repo isn't present in this environment.

  Because of this, every `appsheet/*` service implementation is a stub: it throws `DataSourceBlockedError` (see `web/lib/services/types.ts`) instead of calling a real endpoint. **The toggle UI is fully wired and functional** — flipping to "AppSheet" visibly changes the active-source indicator and every screen reads through the same context — but no AppSheet network call happens yet. This is intentional: building the real bulk `Find`/`Selector` integration against an unconfirmed account/unrotated key would either fail opaquely or, worse, work against a still-exposed secret. Both must be resolved before the `appsheet/*` stubs are replaced with real server-proxy calls.
