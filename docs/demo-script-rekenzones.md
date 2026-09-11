# Demo script — Zones & Rekenzones

Database has been reset (building/session data cleared, accounts kept) — start from a clean slate.

## Mobile app

1. **Create a building** and open it to start a new inspection session.
2. In the session wizard, complete **Step 1 — Draw Floor Plan** for the ground floor (begane grond).
   - You'll land on **Step 2 — Define Zones** (`ZoneManager`) next.
3. On **Define Zones**:
   - Add 2–3 zones (verdiepingen): begane grond + one or two upper floors.
   - Use the rekenzone picker to create a new rekenzone (e.g. "A met airco") and assign the zones to it.
4. Continue through Grid Analysis / Place Elements as normal to populate a few elements (gevels, daken, vloeren, installaties) per zone.

## Web dashboard

5. Open the building page and scroll to the **Rekenzones** table.
   - Point out the per-type counts: Gevels / Daken / Vloeren / Installaties.
6. **Click the rekenzone row.** This is the new piece — the drill-down page pools every element across all assigned verdiepingen into one consolidated view.
7. Note it's **read-only** — no pencil/edit icons — and explain why: it mirrors the AppSheet screen it replaces; editing still happens per-zone on the building page (`ZoneEditButton`) or on mobile.
