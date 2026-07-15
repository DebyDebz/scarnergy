/**
 * VABI XML export — the single shared builder for mobile and web.
 *
 * Collapsed from lib/vabiExport.ts (mobile) and web/lib/vabiXml.ts in calc
 * Phase 1. The mobile builder was the richer superset (Notities, extra
 * NL/EN mapping synonyms, multiline project header) and its output is locked
 * by __tests__/vabiExport.golden.test.ts, so it is the canonical format; the
 * one web-only feature (Vloer <Perimeter>) is folded in.
 *
 * Spec: docs/vabi_xml_format.md — VabiProject versie 3.0
 */

import { r2 } from './units';
import { toCardinal, floorId, floorName } from './geometry';

// ── Structural input types ────────────────────────────────────────────────────
// Only the fields the builder actually reads, all optional except identifiers,
// so both apps' row types (lib/supabase.ts and web/lib/types.ts) satisfy them
// without casts.

export interface VabiSessionInfo {
  building_address: string;
  building_city: string;
  inspector_name: string;
  started_at: string | null;
}

export interface VabiBuildingInfo {
  construction_year?: number | null;
  building_type?: string | null;
}

export interface VabiOrgInfo {
  name?: string | null;
}

export interface VabiZone {
  floor_level: number;
  gross_area_m2?: number | null;
  id?: string;
  rekenzone_id?: string | null;
}

export interface VabiRekenzone {
  id: string;
  name: string;
  sort_order?: number | null;
}

export interface VabiElement {
  id: string;
  name: string;
  element_type: string;
  zone_id?: string | null;
  description?: string | null;
  construction_type?: string | null;
  insulation_type?: string | null;
  installation_type?: string | null;
  fuel_type?: string | null;
  orientation_deg?: number | null;
  tilt_deg?: number | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  area_m2?: number | null;
  rc_value?: number | null;
  efficiency?: number | null;
  capacity_kw?: number | null;
  nokhoogte_m?: number | null;
  bodemisolatie?: boolean | null;
  brand?: string | null;
  model_nr?: string | null;
  cv_klasse?: string | null;
  parent_element_id?: string | null;
  perimeter_m?: number | null;
  dikte_vloer_boven_mm?: number | null;
  dikte_vloer_onder_mm?: number | null;
  dikte_muren_mm?: number | null;
  notes?: string | null;
}

export interface VabiOpening {
  id: string;
  element_id?: string | null;
  opening_type?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  area_m2?: number | null;
  glazing_type?: string | null;
  frame_type?: string | null;
  has_shading?: boolean | null;
  shading_type?: string | null;
  thermisch_onderbroken?: boolean | null;
  overstek_m?: number | null;
  belemmering?: string | null;
  notes?: string | null;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

export function openingTypeVabi(t: string | null | undefined): string {
  switch ((t ?? '').toLowerCase()) {
    case 'door':    return 'Deur';
    case 'skylight': return 'Raam';
    default:        return 'Raam';
  }
}

export function frameMatVabi(f: string | null | undefined): string {
  if (!f) return '';
  const lower = f.toLowerCase();
  if (lower.includes('aluminium') || lower.includes('aluminum') || lower.includes('metaal') || lower.includes('metal')) return 'Metaal';
  if (lower.includes('kunststof') || lower.includes('pvc') || lower.includes('plastic')) return 'Kunststof';
  if (lower.includes('hout') || lower.includes('wood') || lower.includes('timber')) return 'Hout';
  return f;
}

export function glazingVabi(g: string | null | undefined): string {
  if (!g) return '';
  const lower = g.toLowerCase().replace(/\s/g, '');
  if (lower.includes('triple') || lower.includes('drievoudig')) return 'Triple';
  if (lower.includes('hr+++') || lower.includes('hrplusplus')) return 'Triple';
  if (lower.includes('hr++') || lower.includes('hrdubbelplus')) return 'HRdubbelplus';
  if (lower.includes('hr+') || lower.includes('hrplus')) return 'HRplus';
  if (lower.includes('enkel') || lower.includes('single')) return 'Enkel';
  if (lower.includes('dubbel') || lower.includes('double')) return 'Dubbel';
  return g;
}

export function installTypeVabi(t: string | null | undefined, name: string): string {
  if (!t) {
    const n = name.toLowerCase();
    if (n.includes('ventilat')) return 'Ventilatie';
    if (n.includes('warmtepomp') || n.includes('heat pump')) return 'WarmtePomp';
    if (n.includes('zonnepan') || n.includes('pv')) return 'ZonnePanelen';
    if (n.includes('zonnecolle')) return 'ZonneCollectoren';
    if (n.includes('tapwater') || n.includes('boiler') || n.includes('geiser')) return 'Tapwater';
    return 'Verwarming';
  }
  const lower = t.toLowerCase();
  if (lower.includes('ventilat')) return 'Ventilatie';
  if (lower.includes('warmtepomp') || lower.includes('heat pump')) return 'WarmtePomp';
  if (lower.includes('zonnepan') || lower.includes('pv')) return 'ZonnePanelen';
  if (lower.includes('zonnecolle')) return 'ZonneCollectoren';
  if (lower.includes('tapwater') || lower.includes('boiler')) return 'Tapwater';
  return 'Verwarming';
}

export function gevelpositie(el: VabiElement): string {
  const combined = `${el.description ?? ''} ${el.construction_type ?? ''} ${el.name}`.toLowerCase();
  if (combined.includes('voor') || combined.includes('front')) return 'Voorgevel';
  if (combined.includes('achter') || combined.includes('rear') || combined.includes('back')) return 'Achtergevel';
  if (combined.includes('rechts') || combined.includes('right')) return 'Rechtergevel';
  if (combined.includes('links') || combined.includes('left')) return 'Linkergevel';
  return '';
}

export function grenztAan(el: VabiElement): string {
  const src = `${el.description ?? ''} ${el.construction_type ?? ''}`.toLowerCase();
  if (src.includes('kruipruimte') || src.includes('crawl')) return 'Kruipruimte';
  if (src.includes('onverwarmd') || src.includes('unheated')) return 'Aangrenzende onverwarmde ruimte';
  if (src.includes('verwarmd') || src.includes('heated')) return 'Aangrenzende verwarmde ruimte';
  if (src.includes('sterk geventileerd')) return 'Aangrenzende sterk geventileerde ruimte';
  return 'Buitenlucht';
}

export function dakType(el: VabiElement): string {
  const combined = `${el.construction_type ?? ''} ${el.name}`.toLowerCase();
  if (combined.includes('plat') || combined.includes('flat') || (el.tilt_deg != null && el.tilt_deg < 5)) return 'PlatDak';
  if (combined.includes('zadel') || combined.includes('saddle') || combined.includes('gable')) return 'Zadeldak';
  return 'HellendDak';
}

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── XML indenter helper ───────────────────────────────────────────────────────

function indent(s: string, n: number): string {
  return s.split('\n').map(l => ' '.repeat(n) + l).join('\n');
}

// ── Rekenzone block renderer ─────────────────────────────────────────────────
// Renders one <Rekenzone> block from the zones/elements assigned to it.
// Extracted verbatim from the single hardcoded "Zone A" block; the legacy
// no-rekenzones path must stay byte-identical (locked by the golden test).
// Installaties are NOT rendered here — they live at project level.

function renderRekenzone(
  attrId: string,
  naam: string,
  zones: VabiZone[],
  elements: VabiElement[],
  openingsByElement: Record<string, VabiOpening[]>,
  dakkapellenByParent: Record<string, VabiElement[]>,
): string {
  // Bucket elements by type
  const gevels  = elements.filter(e => e.element_type === 'gevel');
  const vloeren = elements.filter(e => e.element_type === 'vloer');
  const daken   = elements.filter(e => e.element_type === 'dak');

  const totalArea = zones.reduce((s, z) => s + (z.gross_area_m2 ?? 0), 0);

  // Group zones by floor level for Verdiepingen
  const byLevel = zones.reduce<Record<number, VabiZone[]>>((acc, z) => {
    (acc[z.floor_level] ??= []).push(z);
    return acc;
  }, {});

  // ── Verdiepingen ────────────────────────────────────────────────────────────
  const verdiepingenXml = Object.entries(byLevel)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([lvl, zoneGroup]) => {
      const lvlNum = Number(lvl);
      const areaSum = zoneGroup.reduce((s, z) => s + (z.gross_area_m2 ?? 0), 0);
      return (
        `<Verdieping id="${esc(floorId(lvlNum))}">\n` +
        `  <Naam>${esc(floorName(lvlNum))}</Naam>\n` +
        `  <Gebruiksoppervlakte>${r2(areaSum)}</Gebruiksoppervlakte>\n` +
        `</Verdieping>`
      );
    }).join('\n');

  // ── Gevels ──────────────────────────────────────────────────────────────────
  const gevelsXml = gevels.map(el => {
    const positie    = gevelpositie(el);
    const orientatie = toCardinal(el.orientation_deg);
    const hoogte     = el.height_mm != null ? r2(el.height_mm / 1000) : null;
    const breedte    = el.length_mm  != null ? r2(el.length_mm  / 1000) : null;
    const grenst     = grenztAan(el);
    const elOpenings = openingsByElement[el.id] ?? [];

    const transDelen = elOpenings.map(o => {
      const type      = openingTypeVabi(o.opening_type);
      const oh        = o.height_mm != null ? r2(o.height_mm / 1000) : null;
      const ob        = o.width_mm  != null ? r2(o.width_mm  / 1000) : null;
      const oa        = o.area_m2 ?? (oh != null && ob != null ? r2(oh * ob) : null);
      const materiaal = frameMatVabi(o.frame_type);
      const beglazing = glazingVabi(o.glazing_type);
      const thermisch = o.thermisch_onderbroken ?? false;
      const overstek  = o.overstek_m ?? 0;

      return (
        `<TransparantDeel id="${esc(o.id)}">\n` +
        `  <Type>${esc(type)}</Type>\n` +
        (oh != null ? `  <Hoogte>${oh}</Hoogte>\n` : '') +
        (ob != null ? `  <Breedte>${ob}</Breedte>\n` : '') +
        (oa != null ? `  <Oppervlakte>${oa}</Oppervlakte>\n` : '') +
        (materiaal ? `  <RaamkozijnMateriaal>${esc(materiaal)}</RaamkozijnMateriaal>\n` : '') +
        `  <ThermischOnderbroken>${thermisch}</ThermischOnderbroken>\n` +
        (beglazing ? `  <Beglazing>${esc(beglazing)}</Beglazing>\n` : '') +
        (o.has_shading && o.shading_type
          ? `  <Zonwering>\n    <Type>${esc(o.shading_type)}</Type>\n  </Zonwering>\n`
          : `  <Zonwering><Type>Geen</Type></Zonwering>\n`) +
        `  <Overstek>${overstek.toFixed(2)}</Overstek>\n` +
        (o.belemmering ? `  <Belemmering>${esc(o.belemmering)}</Belemmering>\n` : `  <Belemmering/>\n`) +
        (o.notes ? `  <Notities>${esc(o.notes)}</Notities>\n` : '') +
        `</TransparantDeel>`
      );
    });

    const transDelenXml = transDelen.length
      ? `<TransparanteDelen>\n${indent(transDelen.join('\n'), 2)}\n</TransparanteDelen>`
      : '<TransparanteDelen/>';

    // Calculated vs original dimensions (NTA 8800 height correction)
    const dikteB = el.dikte_vloer_boven_mm ?? 0;
    const dikteO = el.dikte_vloer_onder_mm ?? 0;
    const dikteM = el.dikte_muren_mm ?? 0;
    const origH = hoogte != null ? r2(hoogte - (dikteB + dikteO) / 1000) : null;
    const origB = breedte != null ? r2(breedte - dikteM / 1000) : null;

    return (
      `<Gevel id="${esc(el.id)}">\n` +
      `  <Naam>${esc(el.name)}</Naam>\n` +
      (positie    ? `  <Positie>${esc(positie)}</Positie>\n` : '') +
      (orientatie ? `  <Orientatie>${esc(orientatie)}</Orientatie>\n` : '') +
      (hoogte  != null ? `  <Hoogte>${hoogte}</Hoogte>\n` : '') +
      (breedte != null ? `  <Breedte>${breedte}</Breedte>\n` : '') +
      (origH != null ? `  <OrigineleHoogte>${origH}</OrigineleHoogte>\n` : '') +
      (origB != null ? `  <OrigineleBreedte>${origB}</OrigineleBreedte>\n` : '') +
      (dikteB ? `  <DikteVloerBoven>${r2(dikteB / 1000)}</DikteVloerBoven>\n` : '') +
      (dikteO ? `  <DikteVloerOnder>${r2(dikteO / 1000)}</DikteVloerOnder>\n` : '') +
      (dikteM ? `  <DikteAangrezendemuren>${r2(dikteM / 1000)}</DikteAangrezendemuren>\n` : '') +
      (el.perimeter_m != null ? `  <Perimeter>${el.perimeter_m}</Perimeter>\n` : '') +
      (el.area_m2 != null ? `  <Oppervlakte>${r2(el.area_m2)}</Oppervlakte>\n` : '') +
      (grenst  ? `  <GrenztAan>${esc(grenst)}</GrenztAan>\n` : '') +
      (el.notes ? `  <Notities>${esc(el.notes)}</Notities>\n` : '') +
      `  ${transDelenXml}\n` +
      `</Gevel>`
    );
  }).join('\n');

  // ── Vloeren ─────────────────────────────────────────────────────────────────
  const vloerXml = vloeren.map(el => {
    const grenst = grenztAan(el);
    return (
      `<Vloer id="${esc(el.id)}">\n` +
      `  <Naam>${esc(el.name)}</Naam>\n` +
      (grenst ? `  <GrenztAan>${esc(grenst)}</GrenztAan>\n` : '') +
      (el.area_m2 != null ? `  <Oppervlakte>${r2(el.area_m2)}</Oppervlakte>\n` : '') +
      `  <Vloerisolatie>${el.insulation_type ? 'true' : 'false'}</Vloerisolatie>\n` +
      `  <Bodemisolatie>${el.bodemisolatie ?? false}</Bodemisolatie>\n` +
      // Perimeter carried over from the web builder in the Phase 1 collapse
      // (the mobile builder never emitted it for floors).
      (el.perimeter_m != null ? `  <Perimeter>${el.perimeter_m}</Perimeter>\n` : '') +
      (el.rc_value != null ? `  <Rc>${el.rc_value}</Rc>\n` : '') +
      (el.notes ? `  <Notities>${esc(el.notes)}</Notities>\n` : '') +
      `</Vloer>`
    );
  }).join('\n');

  // ── Daken ───────────────────────────────────────────────────────────────────
  const dakenXml = daken.map(el => {
    const type       = dakType(el);
    const orientatie = toCardinal(el.orientation_deg);
    const lengte     = el.length_mm != null ? r2(el.length_mm / 1000) : null;
    const breedte    = el.width_mm  != null ? r2(el.width_mm  / 1000) : null;
    const bruto      = lengte != null && breedte != null ? r2(lengte * breedte) : null;
    const netto      = el.area_m2 ?? bruto;

    return (
      `<Dak id="${esc(el.id)}">\n` +
      `  <Naam>${esc(el.name)}</Naam>\n` +
      (orientatie ? `  <Orientatie>${esc(orientatie)}</Orientatie>\n` : '') +
      `  <Type>${esc(type)}</Type>\n` +
      (lengte  != null ? `  <Lengte>${lengte}</Lengte>\n` : '') +
      (breedte != null ? `  <Breedte>${breedte}</Breedte>\n` : '') +
      (el.tilt_deg != null ? `  <Hoek>${el.tilt_deg}</Hoek>\n` : '') +
      (el.nokhoogte_m != null ? `  <Nokhoogte>${el.nokhoogte_m}</Nokhoogte>\n` : '') +
      (bruto   != null ? `  <BrutoOppervlakte>${bruto}</BrutoOppervlakte>\n` : '') +
      (netto   != null ? `  <NettoOppervlak>${netto}</NettoOppervlak>\n` : '') +
      (el.rc_value != null ? `  <Rc>${el.rc_value}</Rc>\n` : '') +
      (el.notes ? `  <Notities>${esc(el.notes)}</Notities>\n` : '') +
      (() => {
        const dks = dakkapellenByParent[el.id] ?? [];
        if (!dks.length) return `  <Dakkapellen/>\n`;
        const dkXml = dks.map(dk =>
          `<Dakkapel id="${esc(dk.id)}">\n` +
          `  <Naam>${esc(dk.name)}</Naam>\n` +
          (dk.width_mm  != null ? `  <Breedte>${r2(dk.width_mm  / 1000)}</Breedte>\n` : '') +
          (dk.length_mm != null ? `  <Diepte>${r2(dk.length_mm / 1000)}</Diepte>\n`   : '') +
          (dk.height_mm != null ? `  <Hoogte>${r2(dk.height_mm / 1000)}</Hoogte>\n`   : '') +
          `</Dakkapel>`
        ).join('\n');
        return `  <Dakkapellen>\n${indent(dkXml, 4)}\n  </Dakkapellen>\n`;
      })() +
      `</Dak>`
    );
  }).join('\n');

  return (
    `    <Rekenzone id="${esc(attrId)}">\n` +
    `      <Naam>${esc(naam)}</Naam>\n` +
    `      <Gebruiksoppervlakte>${r2(totalArea)}</Gebruiksoppervlakte>\n\n` +

    (verdiepingenXml
      ? `      <Verdiepingen>\n${indent(verdiepingenXml, 8)}\n      </Verdiepingen>\n\n`
      : `      <Verdiepingen/>\n\n`) +

    (gevelsXml
      ? `      <Gevels>\n${indent(gevelsXml, 8)}\n      </Gevels>\n\n`
      : `      <Gevels/>\n\n`) +

    (vloerXml
      ? `      <Vloeren>\n${indent(vloerXml, 8)}\n      </Vloeren>\n\n`
      : `      <Vloeren/>\n\n`) +

    (dakenXml
      ? `      <Daken>\n${indent(dakenXml, 8)}\n      </Daken>\n\n`
      : `      <Daken/>\n\n`) +

    `    </Rekenzone>\n`
  );
}

// ── Main document builder ─────────────────────────────────────────────────────

export function buildVabiXml(
  session: VabiSessionInfo,
  org: VabiOrgInfo,
  building: VabiBuildingInfo,
  zones: VabiZone[],
  elements: VabiElement[],
  openings: VabiOpening[],
  rekenzones?: VabiRekenzone[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const surveyDate = session.started_at ? new Date(session.started_at).toISOString().slice(0, 10) : today;

  // Index openings by element_id
  const openingsByElement: Record<string, VabiOpening[]> = {};
  for (const o of openings) {
    if (o.element_id) (openingsByElement[o.element_id] ??= []).push(o);
  }

  const installaties = elements.filter(e => e.element_type === 'installatie');

  // Index dakkapellen by parent dak id
  const dakkapellenByParent: Record<string, VabiElement[]> = {};
  for (const dk of elements.filter(e => e.element_type === 'dakkapel')) {
    if (dk.parent_element_id) (dakkapellenByParent[dk.parent_element_id] ??= []).push(dk);
  }

  // ── Installaties ─────────────────────────────────────────────────────────────
  const installXml = installaties.map(el => {
    const type = installTypeVabi(el.installation_type, el.name);
    const merk  = el.brand ?? el.name.split(/\s+/)[0] ?? '';
    const model = el.model_nr ?? el.name.split(/\s+/).slice(1).join(' ');
    const locatie = el.description ?? '';

    return (
      `<Installatie id="${esc(el.id)}">\n` +
      `  <Type>${esc(type)}</Type>\n` +
      (merk   ? `  <Merk>${esc(merk)}</Merk>\n` : '') +
      (model  ? `  <Model>${esc(model)}</Model>\n` : '') +
      (locatie ? `  <Locatie>${esc(locatie)}</Locatie>\n` : '') +
      (el.cv_klasse ? `  <KlasseCV>${esc(el.cv_klasse)}</KlasseCV>\n` : '') +
      (el.fuel_type     ? `  <Brandstof>${esc(el.fuel_type)}</Brandstof>\n` : '') +
      (el.efficiency != null ? `  <Rendement>${el.efficiency}</Rendement>\n` : '') +
      (el.capacity_kw != null ? `  <Vermogen>${el.capacity_kw}</Vermogen>\n` : '') +
      `</Installatie>`
    );
  }).join('\n');

  const rekenzonesXml = renderRekenzone(
    'A', 'Zone A - Volledig woning', zones, elements, openingsByElement, dakkapellenByParent,
  );

  // ── Assemble ─────────────────────────────────────────────────────────────────
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<VabiProject xmlns="http://www.vabi.nl/schema"\n` +
    `             versie="3.0"\n` +
    `             aanmaakdatum="${today}">\n\n` +

    `  <Gebouw>\n` +
    `    <Omschrijving>${esc(`${session.building_address}, ${session.building_city}`)}</Omschrijving>\n` +
    (building.construction_year ? `    <Bouwjaar>${building.construction_year}</Bouwjaar>\n` : '') +
    (building.building_type     ? `    <Gebouwtype>${esc(building.building_type)}</Gebouwtype>\n` : '') +
    `    <Opnamedatum>${surveyDate}</Opnamedatum>\n` +
    `    <Opnemer>${esc(session.inspector_name)}</Opnemer>\n` +
    `    <Bedrijf>${esc(org.name ?? '')}</Bedrijf>\n` +
    `  </Gebouw>\n\n` +

    `  <Rekenzones>\n` +
    rekenzonesXml +
    `  </Rekenzones>\n\n` +

    (installXml
      ? `  <Installaties>\n${indent(installXml, 4)}\n  </Installaties>\n\n`
      : `  <Installaties/>\n\n`) +

    `</VabiProject>\n`
  );
}
