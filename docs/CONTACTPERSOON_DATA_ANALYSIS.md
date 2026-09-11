# Contactpersoon — Data Analysis for ScanergyV2 Build

Handover doc for building the `contacts` equivalent in ScanergyV2, scoped as part of the AppSheet↔ScanergyV2 toggle work. Covers both data sources: the live AppSheet-backed Excel sheet (source of truth today) and the current ScanergyV2 schema (`DATA_STRUCTURE.md`, migrations `002`–`027`).

**Context:** the toggle is a full data-source switch. When set to ScanergyV2, contact info is currently omitted (no table exists). This build closes that gap. Confirmed in scope for the current 3-month window.

---

## 1. Source A: Excel/AppSheet `Contactpersoon` sheet (live, updated per visit)

**Shape:** 90 rows, 7 columns, no blank padding rows (unlike some other sheets in the same workbook).

| Column | Type observed | Nulls | Notes |
|---|---|---|---|
| `Contactpersoon ID` | string (8-char hex-ish, e.g. `85dbca28`) | 0/90 | Primary key. All 90 values are unique. |
| `Naam` | string | 0/90 | Full name or company name (a few rows hold a company name here, e.g. "Vastgoed Neutraal B.V.", not a person). |
| `Telefoon` | **mixed**: string, float, and literal string `"(blank)"` | 10/90 truly empty | Data-quality issue — see §3. |
| `Email` | string | 76/90 empty | Only 14 of 90 rows have an email at all. |
| `Rol` | string, one of: `Eigenaar` (19), `Huurder` (10), `Beheerder` (3), `Opdrachtgever` (3) | **55/90 empty** | No enum/dropdown enforced in the source — over half the rows have no role. |
| `Notities` | string | 35/90 filled | Free text. 10 rows contain the literal note `"Import from Shopify"` — a lineage marker, not user-entered content (see §3). |
| `Bedrijf ID` | float (1.0, 2.0, or 4.0) | 2/90 empty | FK to `Bedrijven.Bedrijf ID`. |

**Real relationships confirmed by direct ID lookup (not assumed from column names):**

- `Contactpersoon.Bedrijf ID` → `Bedrijven.Bedrijf ID` — works as expected (84 rows point to Bedrijf 1, 2 to Bedrijf 2, 2 to Bedrijf 4 — note Bedrijf 4 doesn't appear in the `Bedrijven` sheet itself, which only lists IDs 1 and 2; see §3).
- `Objecten.Contactpersoon ID` → `Contactpersoon.Contactpersoon ID` — **this is the FK that actually matters for the feature.** Verified: values like `54a67bdc` and `5c2e19e7` on `Objecten` rows resolve correctly to real `Contactpersoon` rows. Only 2 of 5 `Objecten` rows currently have a contact set — the other 3 are null.
- **A contact belongs to a building (`Objecten`), not directly to a company** — the `Bedrijf ID` on each contact row looks like it's there for filtering/scoping, but the operative link for "who do I call about this building" is `Objecten.Contactpersoon ID`, a 1-to-1 (per building) reference into this table.

## 2. Source B: ScanergyV2 schema (current state, per `DATA_STRUCTURE.md`)

- No table equivalent to `Contactpersoon` exists. Checked: `organisations`, `user_profiles`, `buildings`, `building_facade_photos` — none carry a building-owner/contact concept.
- Closest analog is `buildings.created_by → user_profiles`, but that's the *inspector* who created the record, not the building's owner/tenant/contact — a different person entirely.
- No `Rol`-equivalent enum exists yet (the schema's `user_role` enum — `inspector | supervisor | admin | service_role` — is for app users, not building contacts, and shouldn't be reused for this).

## 3. Data quality issues to resolve before or during migration

- **Duplicate rows.** At least two clear duplicate clusters: "Annemone Rietdijk" (phone `622666821`) appears 3x with 3 different `Contactpersoon ID`s, and "Vastgoed Neutraal B.V." appears 3x the same way. These 6 rows are tagged `Notities = "Import from Shopify"` — they look like repeated import artifacts, not 3 distinct people.
- **Test/junk rows.** At least 2 rows are explicit test data: `"test na bedrijfs id"` and `"Test op ander bedrijf"` (the latter also introduces `Bedrijf ID = 2.0`, which is a real company — so this test row is mixed into real Krontiva data).
- **`Bedrijf ID = 4.0` has no matching company.** The `Bedrijven` sheet only defines IDs `1` (Energeticas) and `2` (Krontiva) — the 2 contact rows with `Bedrijf ID = 4.0` point to nothing. Needs a decision: dead data, or a missing `Bedrijven` row.
- **`Telefoon` has inconsistent types**: plain strings (`"06123456789"`), international format (`"+31 6 39107529"`), bare numbers stored as floats (`622666821.0`), and the literal text `"(blank)"` used as a placeholder instead of an actual empty cell. Any migration needs to normalize this before it can be a typed `phone` column.
- **`Rol` is unenforced** — 55 of 90 rows have no role at all, and there's no evidence of a dropdown constraining the 4 values seen. Worth deciding whether ScanergyV2 makes this required or keeps it optional.
- **Naming collision (separate sheet, flagged for awareness):** the `Bedrijven` sheet has its own column literally called `Contactpersoon`, but its values (`3f661d2c`, `3g662d2e`) are actually `Inspecteurs` IDs, not `Contactpersoon` IDs. Don't let this column name cause confusion when mapping sheets — it's mislabeled at the source.
- **`Objecten.Bedrijfs ID` is inconsistently typed** — usually a number (`1.0`) matching `Bedrijven.Bedrijf ID`, but on one row it's the string `3f661d2c` (an Inspecteur ID, not a Bedrijf ID). Doesn't affect the contacts build directly, but flag it if anyone touches that field.

## 4. Proposed field mapping (Excel → ScanergyV2 Postgres)

| Excel column | Proposed column | Type | Notes |
|---|---|---|---|
| `Contactpersoon ID` | keep as `legacy_id` (text) alongside a new `id` (UUID) | text + uuid | Preserve for traceability during coexistence period; don't reuse as the PK. |
| — | `building_id` | uuid → `buildings.id` | New FK — this is the real relationship (see §1), not `org_id` alone. |
| — | `org_id` | uuid → `organisations.id` | Standard tenant scoping, same pattern as every other table. |
| `Naam` | `full_name` | text, not null | |
| `Telefoon` | `phone` | text | Normalize formats on import (§3); no evidence a stricter type is needed elsewhere in the schema (other phone fields are also plain `text`). |
| `Email` | `email` | text, nullable | Majority-null in source; keep optional. |
| `Rol` | `role` | text or new enum | Recommend enum (`eigenaar`/`huurder`/`beheerder`/`opdrachtgever`) if ScanergyV2 wants to standardize; source data doesn't enforce it today. |
| `Notities` | `notes` | text, nullable | Strip/flag the `"Import from Shopify"` lineage rows separately — don't carry that string in as real user notes. |
| `Bedrijf ID` | *(drop, or keep as secondary `org_id` derivation)* | — | Redundant once `building_id` → `org_id` chain exists; recommend not migrating this as its own column. |

## 5. Open items for the build (data facts only, not proposing a solution)

- Decide how to handle the 6 duplicate rows and 2 test rows before/during import — straight 1:1 migration would carry known-bad data into the new table.
- Decide what happens to the 3 `Objecten` rows with no `Contactpersoon ID` set — migrate as "no contact" or backfill first.
- Decide the fate of `Bedrijf ID = 4.0` rows (2 contacts pointing at a company that doesn't exist in `Bedrijven`).
- Confirm whether `role` should be a constrained enum or free text in the new table, given the source enforces nothing.
