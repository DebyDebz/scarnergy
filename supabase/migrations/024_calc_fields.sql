-- ─────────────────────────────────────────────────────────────────────────────
-- SCARNERGY v2.0 — Migration 024: Phase 2 calc data-model fields (GAP W2)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Safety: ADDITIVE ONLY. Every statement is idempotent (IF NOT EXISTS) and adds
--         nullable / defaulted columns. No existing column is altered or dropped,
--         so existing mobile/web reads and writes are unaffected.
--
-- Backs: opname-calculation-spec.md §1.3, §2.1, §5.2, §6, §7.3, §4.2/4.3
-- ─────────────────────────────────────────────────────────────────────────────

-- ── §2.1 Rekenhoogte / floor-construction thickness ──────────────────────────
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS dikte_vloerconstructie_mm INTEGER,          -- default handled in engine (0.30 m)
  ADD COLUMN IF NOT EXISTS rekenhoogte_m_override    NUMERIC(8,3);     -- null = use computed value

COMMENT ON COLUMN building_elements.dikte_vloerconstructie_mm IS 'Gevel: floor-construction thickness for rekenhoogte (§2.1); null → engine forfait 300mm';
COMMENT ON COLUMN building_elements.rekenhoogte_m_override    IS 'Gevel: manual override of computed rekenhoogte (§2.1)';

-- ── §1.3 Interne warmtecapaciteit classes (per storey/zone element) ───────────
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS warmtecap_vloer_klasse  TEXT,   -- 'licht' | 'zwaar'
  ADD COLUMN IF NOT EXISTS warmtecap_gevel_klasse  TEXT,   -- 'licht' | 'zwaar'
  ADD COLUMN IF NOT EXISTS plafond_type            TEXT;   -- 'gesloten' | 'open' | 'overig'

COMMENT ON COLUMN building_elements.warmtecap_vloer_klasse IS 'Interne warmtecapaciteit floor class (§1.3)';
COMMENT ON COLUMN building_elements.warmtecap_gevel_klasse IS 'Interne warmtecapaciteit facade class (§1.3)';
COMMENT ON COLUMN building_elements.plafond_type          IS 'Ceiling type for warmtecapaciteit lookup (§1.3)';

-- ── §6 Rc priority chain (documented / observed / na-isolatie) ────────────────
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS rc_source          TEXT,           -- 'documented' | 'observed' | 'buildyear_forfait'
  ADD COLUMN IF NOT EXISTS isolatie_dikte_mm  INTEGER,        -- observed insulation thickness
  ADD COLUMN IF NOT EXISTS isolatie_lambda    NUMERIC(5,3),   -- λ, forfait 0.040 if unknown
  ADD COLUMN IF NOT EXISTS na_isolatie        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS na_isolatie_jaar   INTEGER;

COMMENT ON COLUMN building_elements.rc_source         IS 'Rc provenance for audit trail (§6 priority chain)';
COMMENT ON COLUMN building_elements.isolatie_dikte_mm IS 'Observed insulation thickness for Rc = Rc_basis + d/λ (§6)';
COMMENT ON COLUMN building_elements.isolatie_lambda   IS 'Insulation λ (W/mK); forfait 0.040 when material unknown (§6)';
COMMENT ON COLUMN building_elements.na_isolatie       IS 'Element retrofitted with insulation after build (§6 override)';
COMMENT ON COLUMN building_elements.na_isolatie_jaar  IS 'Year of na-isolatie retrofit (§6)';

-- ── §5.2 Crawl-space geometry (floor U_eq) ───────────────────────────────────
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS kruipruimte_hoogte_m NUMERIC(6,3); -- null → engine forfait

COMMENT ON COLUMN building_elements.kruipruimte_hoogte_m IS 'Crawl-space height for U_eq/B'' method (§5.2)';

-- ── §4.2/4.3 Stored U/g/shading per transparant deel ─────────────────────────
ALTER TABLE openings
  ADD COLUMN IF NOT EXISTS u_glas   NUMERIC(5,3),   -- from forfait (§4.2)
  ADD COLUMN IF NOT EXISTS g_waarde NUMERIC(4,3),   -- solar factor (§4.2)
  ADD COLUMN IF NOT EXISTS f_sh     NUMERIC(4,3);   -- combined shading factor (§4.3)

COMMENT ON COLUMN openings.u_glas   IS 'Forfait U-value of glazing/frame combo (§4.2)';
COMMENT ON COLUMN openings.g_waarde IS 'Solar transmittance g (§4.2)';
COMMENT ON COLUMN openings.f_sh     IS 'Combined shading factor F_zonw × F_ov × F_bel (§4.3)';

-- ── §7.3 PV parameters (on installatie elements) ─────────────────────────────
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS pv_aantal_panelen INTEGER,
  ADD COLUMN IF NOT EXISTS pv_wp_per_paneel  INTEGER,
  ADD COLUMN IF NOT EXISTS pv_orientatie_deg NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS pv_hellingshoek_deg NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pv_beschaduwing_klasse TEXT;

COMMENT ON COLUMN building_elements.pv_aantal_panelen      IS 'PV: number of panels (§7.3)';
COMMENT ON COLUMN building_elements.pv_wp_per_paneel       IS 'PV: Wp per panel (§7.3)';
COMMENT ON COLUMN building_elements.pv_orientatie_deg      IS 'PV: orientation degrees (§7.3)';
COMMENT ON COLUMN building_elements.pv_hellingshoek_deg    IS 'PV: tilt angle; default = roof hoek (§7.3)';
COMMENT ON COLUMN building_elements.pv_beschaduwing_klasse IS 'PV: shading class (§7.3)';

-- ── §7.1 Tapwater segment lists (structured, replaces free-text sums) ─────────
-- Stored as JSONB arrays of metre segments, e.g. {"badkamer":[4.77,2.39],"keuken":[0.2]}
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS tapwater_segments JSONB;

COMMENT ON COLUMN building_elements.tapwater_segments IS 'Tapwater pipe-length segments per room (§7.1)';
