/**
 * Shared VABI XML generation helpers for web API routes.
 * Mirrors scarnergy-app/lib/vabiExport.ts but for Next.js server routes.
 */

import type { BuildingElement, Opening, Zone } from './types';

export interface VabiSession {
  building_address: string;
  building_city: string;
  inspector_name: string;
  started_at: string | null;
}

export interface VabiBuilding {
  construction_year?: number | null;
  building_type?: string | null;
}

export interface VabiOrg {
  name?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function toCardinal(deg: number | null): string {
  if (deg == null) return '';
  const d = ((deg % 360) + 360) % 360;
  return ['Noord','Noord-Oost','Oost','Zuid-Oost','Zuid','Zuid-West','West','Noord-West'][Math.round(d / 45) % 8];
}

export function floorId(level: number): string { return level === 0 ? 'Bg' : `V${level}`; }

export function floorName(level: number): string {
  if (level === 0) return 'Begane grond';
  if (level === 1) return 'Eerste verdieping';
  if (level === 2) return 'Tweede verdieping / zolder';
  return `Verdieping ${level}`;
}

export function openingTypeVabi(t: string | null): string {
  return (t ?? '').toLowerCase() === 'door' ? 'Deur' : 'Raam';
}

export function frameMatVabi(f: string | null): string {
  if (!f) return '';
  const l = f.toLowerCase();
  if (l.includes('aluminium') || l.includes('metaal') || l.includes('metal')) return 'Metaal';
  if (l.includes('kunststof') || l.includes('pvc')) return 'Kunststof';
  if (l.includes('hout') || l.includes('wood')) return 'Hout';
  return f;
}

export function glazingVabi(g: string | null): string {
  if (!g) return '';
  const l = g.toLowerCase().replace(/\s/g, '');
  if (l.includes('triple')) return 'Triple';
  if (l.includes('hr++')) return 'HRdubbelplus';
  if (l.includes('hr+'))  return 'HRplus';
  if (l.includes('enkel') || l.includes('single')) return 'Enkel';
  if (l.includes('dubbel') || l.includes('double')) return 'Dubbel';
  return g;
}

export function installTypeVabi(t: string | null, name: string): string {
  const src = ((t ?? '') + ' ' + name).toLowerCase();
  if (src.includes('ventilat'))   return 'Ventilatie';
  if (src.includes('warmtepomp')) return 'WarmtePomp';
  if (src.includes('zonnepan') || src.includes('pv')) return 'ZonnePanelen';
  if (src.includes('tapwater') || src.includes('boiler') || src.includes('geiser')) return 'Tapwater';
  return 'Verwarming';
}

export function gevelpositie(el: BuildingElement): string {
  const src = `${el.description ?? ''} ${el.construction_type ?? ''} ${el.name}`.toLowerCase();
  if (src.includes('voor')  || src.includes('front'))  return 'Voorgevel';
  if (src.includes('achter')|| src.includes('rear'))   return 'Achtergevel';
  if (src.includes('rechts')|| src.includes('right'))  return 'Rechtergevel';
  if (src.includes('links') || src.includes('left'))   return 'Linkergevel';
  return '';
}

export function grenztAan(el: BuildingElement): string {
  const src = `${el.description ?? ''} ${el.construction_type ?? ''}`.toLowerCase();
  if (src.includes('kruipruimte'))  return 'Kruipruimte';
  if (src.includes('onverwarmd'))   return 'Aangrenzende onverwarmde ruimte';
  if (src.includes('verwarmd'))     return 'Aangrenzende verwarmde ruimte';
  return 'Buitenlucht';
}

export function dakType(el: BuildingElement): string {
  const src = `${el.construction_type ?? ''} ${el.name}`.toLowerCase();
  if (src.includes('plat') || (el.tilt_deg != null && el.tilt_deg < 5)) return 'PlatDak';
  if (src.includes('zadel')) return 'Zadeldak';
  return 'HellendDak';
}

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export const r2 = (n: number | null | undefined): number | null =>
  n != null ? Number(n.toFixed(2)) : null;

function indent(s: string, n: number): string {
  return s.split('\n').map(l => ' '.repeat(n) + l).join('\n');
}

// ── Main document builder ──────────────────────────────────────────────────

export function buildVabiXml(
  session: VabiSession,
  org: VabiOrg,
  building: VabiBuilding,
  zones: Zone[],
  elements: BuildingElement[],
  openings: Opening[],
): string {
  const today      = new Date().toISOString().slice(0, 10);
  const surveyDate = session.started_at
    ? new Date(session.started_at).toISOString().slice(0, 10)
    : today;

  // Indexes
  const openingsByEl: Record<string, Opening[]> = {};
  for (const o of openings) ((openingsByEl as any)[(o as any).element_id] ??= []).push(o);

  const dakkapellenByParent: Record<string, BuildingElement[]> = {};
  for (const dk of elements.filter(e => e.element_type === 'dakkapel')) {
    if (dk.parent_element_id) (dakkapellenByParent[dk.parent_element_id] ??= []).push(dk);
  }

  const gevels       = elements.filter(e => e.element_type === 'gevel');
  const vloeren      = elements.filter(e => e.element_type === 'vloer');
  const daken        = elements.filter(e => e.element_type === 'dak');
  const installaties = elements.filter(e => e.element_type === 'installatie');

  const totalArea = zones.reduce((s, z) => s + (z.gross_area_m2 ?? 0), 0);
  const byLevel   = zones.reduce<Record<number, Zone[]>>((acc, z) => {
    (acc[z.floor_level] ??= []).push(z); return acc;
  }, {});

  // Verdiepingen
  const verdiepingenXml = Object.entries(byLevel)
    .sort(([a],[b]) => Number(a)-Number(b))
    .map(([lvl, grp]) => {
      const n = Number(lvl);
      const a = grp.reduce((s,z) => s+(z.gross_area_m2??0), 0);
      return `<Verdieping id="${esc(floorId(n))}">\n  <Naam>${esc(floorName(n))}</Naam>\n  <Gebruiksoppervlakte>${r2(a)}</Gebruiksoppervlakte>\n</Verdieping>`;
    }).join('\n');

  // Gevels
  const gevelsXml = gevels.map(el => {
    const positie    = gevelpositie(el);
    const orientatie = toCardinal(el.orientation_deg);
    const hoogte     = el.height_mm != null ? r2(el.height_mm / 1000) : null;
    const breedte    = el.length_mm != null ? r2(el.length_mm / 1000) : null;
    const dikteB = el.dikte_vloer_boven_mm ?? 0;
    const dikteO = el.dikte_vloer_onder_mm ?? 0;
    const dikteM = el.dikte_muren_mm ?? 0;
    const origH  = hoogte  != null ? r2(hoogte  - (dikteB + dikteO) / 1000) : null;
    const origB  = breedte != null ? r2(breedte - dikteM / 1000) : null;

    const transDelen = (openingsByEl[el.id] ?? []).map(o => {
      const oh = o.height_mm != null ? r2(o.height_mm/1000) : null;
      const ob = o.width_mm  != null ? r2(o.width_mm /1000) : null;
      const oa = o.area_m2 ?? (oh!=null&&ob!=null ? r2(oh*ob) : null);
      return (
        `<TransparantDeel id="${esc(o.id)}">\n` +
        `  <Type>${esc(openingTypeVabi(o.opening_type))}</Type>\n` +
        (oh!=null?`  <Hoogte>${oh}</Hoogte>\n`:'') +
        (ob!=null?`  <Breedte>${ob}</Breedte>\n`:'') +
        (oa!=null?`  <Oppervlakte>${oa}</Oppervlakte>\n`:'') +
        (o.frame_type?`  <RaamkozijnMateriaal>${esc(frameMatVabi(o.frame_type))}</RaamkozijnMateriaal>\n`:'') +
        `  <ThermischOnderbroken>${o.thermisch_onderbroken??false}</ThermischOnderbroken>\n` +
        (o.glazing_type?`  <Beglazing>${esc(glazingVabi(o.glazing_type))}</Beglazing>\n`:'') +
        (o.has_shading&&o.shading_type
          ?`  <Zonwering>\n    <Type>${esc(o.shading_type)}</Type>\n  </Zonwering>\n`
          :`  <Zonwering><Type>Geen</Type></Zonwering>\n`) +
        `  <Overstek>${(o.overstek_m??0).toFixed(2)}</Overstek>\n` +
        (o.belemmering?`  <Belemmering>${esc(o.belemmering)}</Belemmering>\n`:`  <Belemmering/>\n`) +
        `</TransparantDeel>`
      );
    });
    const transXml = transDelen.length
      ? `<TransparanteDelen>\n${indent(transDelen.join('\n'),2)}\n</TransparanteDelen>`
      : '<TransparanteDelen/>';

    return (
      `<Gevel id="${esc(el.id)}">\n` +
      `  <Naam>${esc(el.name)}</Naam>\n` +
      (positie    ?`  <Positie>${esc(positie)}</Positie>\n`:'') +
      (orientatie ?`  <Orientatie>${esc(orientatie)}</Orientatie>\n`:'') +
      (hoogte !=null?`  <Hoogte>${hoogte}</Hoogte>\n`:'') +
      (breedte!=null?`  <Breedte>${breedte}</Breedte>\n`:'') +
      (origH  !=null?`  <OrigineleHoogte>${origH}</OrigineleHoogte>\n`:'') +
      (origB  !=null?`  <OrigineleBreedte>${origB}</OrigineleBreedte>\n`:'') +
      (dikteB?`  <DikteVloerBoven>${r2(dikteB/1000)}</DikteVloerBoven>\n`:'') +
      (dikteO?`  <DikteVloerOnder>${r2(dikteO/1000)}</DikteVloerOnder>\n`:'') +
      (dikteM?`  <DikteAangrezendemuren>${r2(dikteM/1000)}</DikteAangrezendemuren>\n`:'') +
      (el.perimeter_m!=null?`  <Perimeter>${el.perimeter_m}</Perimeter>\n`:'') +
      (el.area_m2!=null?`  <Oppervlakte>${r2(el.area_m2)}</Oppervlakte>\n`:'') +
      (`  <GrenztAan>${esc(grenztAan(el))}</GrenztAan>\n`) +
      `  ${transXml}\n</Gevel>`
    );
  }).join('\n');

  // Vloeren
  const vloerXml = vloeren.map(el => (
    `<Vloer id="${esc(el.id)}">\n` +
    `  <Naam>${esc(el.name)}</Naam>\n` +
    `  <GrenztAan>${esc(grenztAan(el))}</GrenztAan>\n` +
    (el.area_m2!=null?`  <Oppervlakte>${r2(el.area_m2)}</Oppervlakte>\n`:'') +
    `  <Vloerisolatie>${el.insulation_type?'true':'false'}</Vloerisolatie>\n` +
    `  <Bodemisolatie>${el.bodemisolatie??false}</Bodemisolatie>\n` +
    (el.perimeter_m!=null?`  <Perimeter>${el.perimeter_m}</Perimeter>\n`:'') +
    (el.rc_value!=null?`  <Rc>${el.rc_value}</Rc>\n`:'') +
    `</Vloer>`
  )).join('\n');

  // Daken
  const dakenXml = daken.map(el => {
    const type  = dakType(el);
    const ori   = toCardinal(el.orientation_deg);
    const len   = el.length_mm!=null ? r2(el.length_mm/1000) : null;
    const bre   = el.width_mm !=null ? r2(el.width_mm /1000) : null;
    const bruto = len!=null&&bre!=null ? r2(len*bre) : null;
    const netto = el.area_m2 ?? bruto;
    const dks   = dakkapellenByParent[el.id] ?? [];
    const dkXml = dks.length
      ? `<Dakkapellen>\n${indent(dks.map(dk =>
          `<Dakkapel id="${esc(dk.id)}">\n` +
          `  <Naam>${esc(dk.name)}</Naam>\n` +
          (dk.width_mm !=null?`  <Breedte>${r2(dk.width_mm /1000)}</Breedte>\n`:'') +
          (dk.length_mm!=null?`  <Diepte>${r2(dk.length_mm/1000)}</Diepte>\n`:'') +
          (dk.height_mm!=null?`  <Hoogte>${r2(dk.height_mm/1000)}</Hoogte>\n`:'') +
          `</Dakkapel>`
        ).join('\n'), 2)}\n</Dakkapellen>`
      : '<Dakkapellen/>';
    return (
      `<Dak id="${esc(el.id)}">\n` +
      `  <Naam>${esc(el.name)}</Naam>\n` +
      (ori ?`  <Orientatie>${esc(ori)}</Orientatie>\n`:'') +
      `  <Type>${esc(type)}</Type>\n` +
      (len !=null?`  <Lengte>${len}</Lengte>\n`:'') +
      (bre !=null?`  <Breedte>${bre}</Breedte>\n`:'') +
      (el.tilt_deg!=null?`  <Hoek>${el.tilt_deg}</Hoek>\n`:'') +
      (el.nokhoogte_m!=null?`  <Nokhoogte>${el.nokhoogte_m}</Nokhoogte>\n`:'') +
      (bruto!=null?`  <BrutoOppervlakte>${bruto}</BrutoOppervlakte>\n`:'') +
      (netto!=null?`  <NettoOppervlak>${netto}</NettoOppervlak>\n`:'') +
      (el.rc_value!=null?`  <Rc>${el.rc_value}</Rc>\n`:'') +
      `  ${dkXml}\n</Dak>`
    );
  }).join('\n');

  // Installaties
  const installXml = installaties.map(el => {
    const type  = installTypeVabi(el.installation_type, el.name);
    const merk  = el.brand   ?? el.name.split(/\s+/)[0] ?? '';
    const model = el.model_nr ?? el.name.split(/\s+/).slice(1).join(' ');
    return (
      `<Installatie id="${esc(el.id)}">\n` +
      `  <Type>${esc(type)}</Type>\n` +
      (merk  ?`  <Merk>${esc(merk)}</Merk>\n`:'') +
      (model ?`  <Model>${esc(model)}</Model>\n`:'') +
      (el.description?`  <Locatie>${esc(el.description)}</Locatie>\n`:'') +
      (el.cv_klasse   ?`  <KlasseCV>${esc(el.cv_klasse)}</KlasseCV>\n`:'') +
      (el.fuel_type   ?`  <Brandstof>${esc(el.fuel_type)}</Brandstof>\n`:'') +
      (el.efficiency!=null?`  <Rendement>${el.efficiency}</Rendement>\n`:'') +
      (el.capacity_kw!=null?`  <Vermogen>${el.capacity_kw}</Vermogen>\n`:'') +
      `</Installatie>`
    );
  }).join('\n');

  const wrap = (xml: string, tag: string, n: number) =>
    xml ? `${' '.repeat(n)}<${tag}>\n${indent(xml,n+2)}\n${' '.repeat(n)}</${tag}>\n\n`
        : `${' '.repeat(n)}<${tag}/>\n\n`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<VabiProject xmlns="http://www.vabi.nl/schema" versie="3.0" aanmaakdatum="${today}">\n\n` +
    `  <Gebouw>\n` +
    `    <Omschrijving>${esc(`${session.building_address}, ${session.building_city}`)}</Omschrijving>\n` +
    (building.construction_year?`    <Bouwjaar>${building.construction_year}</Bouwjaar>\n`:'') +
    (building.building_type    ?`    <Gebouwtype>${esc(building.building_type)}</Gebouwtype>\n`:'') +
    `    <Opnamedatum>${surveyDate}</Opnamedatum>\n` +
    `    <Opnemer>${esc(session.inspector_name)}</Opnemer>\n` +
    `    <Bedrijf>${esc(org.name??'')}</Bedrijf>\n` +
    `  </Gebouw>\n\n` +
    `  <Rekenzones>\n    <Rekenzone id="A">\n` +
    `      <Naam>Zone A - Volledig woning</Naam>\n` +
    `      <Gebruiksoppervlakte>${r2(totalArea)}</Gebruiksoppervlakte>\n\n` +
    wrap(verdiepingenXml,'Verdiepingen',6) +
    wrap(gevelsXml,'Gevels',6) +
    wrap(vloerXml,'Vloeren',6) +
    wrap(dakenXml,'Daken',6) +
    `    </Rekenzone>\n  </Rekenzones>\n\n` +
    wrap(installXml,'Installaties',2) +
    `</VabiProject>\n`
  );
}
