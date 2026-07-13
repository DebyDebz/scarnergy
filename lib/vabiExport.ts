/**
 * VABI XML export utilities — pure TypeScript, no platform dependencies.
 * Shared between mobile (Expo) and can also be referenced by the web API route.
 *
 * Spec: docs/vabi_xml_format.md — VabiProject versie 3.0
 */

import type { BuildingElement, Opening, Zone } from './supabase';
import { r2, toCardinal, floorId, floorName } from '@scarnergy/opname-calc';

// ── Session / Building types needed by buildVabiXml ──────────────────────────

export interface VabiSessionInfo {
  id: string;
  session_code: string;
  status: string;
  started_at: string | null;
  inspector_name: string;
  building_address: string;
  building_city: string;
  building_id: string;
}

export interface VabiBuildingInfo {
  construction_year?: number | null;
  building_type?: string | null;
}

export interface VabiOrgInfo {
  name?: string | null;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

// toCardinal / floorId / floorName now come from @scarnergy/opname-calc
// (shared with the web app — single source of truth).

export function openingTypeVabi(t: string | null): string {
  switch ((t ?? '').toLowerCase()) {
    case 'door':    return 'Deur';
    case 'skylight': return 'Raam';
    default:        return 'Raam';
  }
}

export function frameMatVabi(f: string | null): string {
  if (!f) return '';
  const lower = f.toLowerCase();
  if (lower.includes('aluminium') || lower.includes('aluminum') || lower.includes('metaal') || lower.includes('metal')) return 'Metaal';
  if (lower.includes('kunststof') || lower.includes('pvc') || lower.includes('plastic')) return 'Kunststof';
  if (lower.includes('hout') || lower.includes('wood') || lower.includes('timber')) return 'Hout';
  return f;
}

export function glazingVabi(g: string | null): string {
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

export function installTypeVabi(t: string | null, name: string): string {
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

export function gevelpositie(el: BuildingElement): string {
  const combined = `${el.description ?? ''} ${el.construction_type ?? ''} ${el.name}`.toLowerCase();
  if (combined.includes('voor') || combined.includes('front')) return 'Voorgevel';
  if (combined.includes('achter') || combined.includes('rear') || combined.includes('back')) return 'Achtergevel';
  if (combined.includes('rechts') || combined.includes('right')) return 'Rechtergevel';
  if (combined.includes('links') || combined.includes('left')) return 'Linkergevel';
  return '';
}

export function grenztAan(el: BuildingElement): string {
  const src = `${el.description ?? ''} ${el.construction_type ?? ''}`.toLowerCase();
  if (src.includes('kruipruimte') || src.includes('crawl')) return 'Kruipruimte';
  if (src.includes('onverwarmd') || src.includes('unheated')) return 'Aangrenzende onverwarmde ruimte';
  if (src.includes('verwarmd') || src.includes('heated')) return 'Aangrenzende verwarmde ruimte';
  if (src.includes('sterk geventileerd')) return 'Aangrenzende sterk geventileerde ruimte';
  return 'Buitenlucht';
}

export function dakType(el: BuildingElement): string {
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

// r2 now comes from @scarnergy/opname-calc (shared rounding primitive).

// ── XML indenter helper ───────────────────────────────────────────────────────

function indent(s: string, n: number): string {
  return s.split('\n').map(l => ' '.repeat(n) + l).join('\n');
}

// ── Main document builder ─────────────────────────────────────────────────────

export function buildVabiXml(
  session: VabiSessionInfo,
  org: VabiOrgInfo,
  building: VabiBuildingInfo,
  zones: Zone[],
  elements: BuildingElement[],
  openings: Opening[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const surveyDate = session.started_at ? new Date(session.started_at).toISOString().slice(0, 10) : today;

  // Index openings by element_id
  const openingsByElement: Record<string, Opening[]> = {};
  for (const o of openings) {
    ((openingsByElement as any)[o.element_id] ??= []).push(o);
  }

  // Bucket elements by type
  const gevels       = elements.filter(e => e.element_type === 'gevel');
  const vloeren      = elements.filter(e => e.element_type === 'vloer');
  const daken        = elements.filter(e => e.element_type === 'dak');
  const installaties = elements.filter(e => e.element_type === 'installatie');

  // Index dakkapellen by parent dak id
  const dakkapellenByParent: Record<string, BuildingElement[]> = {};
  for (const dk of elements.filter(e => e.element_type === 'dakkapel')) {
    if (dk.parent_element_id) (dakkapellenByParent[dk.parent_element_id] ??= []).push(dk);
  }

  const totalArea = zones.reduce((s, z) => s + (z.gross_area_m2 ?? 0), 0);

  // Group zones by floor level for Verdiepingen
  const byLevel = zones.reduce<Record<number, Zone[]>>((acc, z) => {
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
    `    <Rekenzone id="A">\n` +
    `      <Naam>Zone A - Volledig woning</Naam>\n` +
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

    `    </Rekenzone>\n` +
    `  </Rekenzones>\n\n` +

    (installXml
      ? `  <Installaties>\n${indent(installXml, 4)}\n  </Installaties>\n\n`
      : `  <Installaties/>\n\n`) +

    `</VabiProject>\n`
  );
}
