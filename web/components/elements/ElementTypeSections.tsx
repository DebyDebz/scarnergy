'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Pencil, TriangleAlert } from 'lucide-react';
import { ElementEditPanel } from './ElementEditPanel';
import type { BuildingElement, Opening } from '@/lib/types';
import {
  toCardinal, gevelpositie, grenztAan, dakType,
  openingArea, roofAreaBreakdown,
  mmToM, r2, fmtArea, fmtMeters, fmtEfficiencyPct,
  rekenhoogte, rcSourceLabel,
} from '@scarnergy/opname-calc';

/**
 * Grouped element sections per zone — AppSheet parity (GAP.md W1).
 * Replaces the flat elements table: Gevels / Daken / Vloeren / Installaties
 * with count badges, Transparante Delen detail per gevel, Dakkapellen nested
 * under their Dak, and Notities & Foto's per element. All values come straight
 * from building_elements / openings rows; derived numbers (orientatie, positie,
 * grenzend aan, netto dakoppervlak) use @scarnergy/opname-calc — the same
 * functions the VABI export uses, never forked.
 */

export interface ElementWithRelations extends BuildingElement {
  openings: Opening[];
  dakkapellen: BuildingElement[];
}

interface Props {
  elements: ElementWithRelations[];
  /** element id → signed photo URLs (inspection-photos bucket) */
  photoUrls: Record<string, string[]>;
  /** hides the edit pencil + panel — used by the read-only rekenzone drill-down (GAP W5) */
  readOnly?: boolean;
}

const SECTIONS: { type: string; nl: string; en: string }[] = [
  { type: 'gevel',       nl: 'Gevels',       en: 'Walls' },
  { type: 'dak',         nl: 'Daken',        en: 'Roofs' },
  { type: 'vloer',       nl: 'Vloeren',      en: 'Floors' },
  { type: 'installatie', nl: 'Installaties', en: 'Installations' },
];
const SECTION_TYPES = new Set(SECTIONS.map(s => s.type));

const jaNee = (v: boolean | null | undefined) => (v ? 'Ja' : 'Nee');

// §6 Rc provenance badge (GAP W2): documented / observed / buildyear_forfait.
const RC_SOURCE_STYLE: Record<string, string> = {
  documented: 'bg-emerald-50 text-emerald-700',
  observed: 'bg-sky-50 text-sky-700',
  buildyear_forfait: 'bg-amber-50 text-amber-700',
};

function RcValue({ el }: { el: BuildingElement }) {
  const label = rcSourceLabel(el.rc_source);
  return (
    <span className="inline-flex items-center gap-1.5">
      {el.rc_value ?? '—'}
      {label && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${RC_SOURCE_STYLE[el.rc_source!] ?? 'bg-gray-100 text-gray-600'}`}>
          {label}
        </span>
      )}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className="text-xs font-medium text-gray-800">{value ?? '—'}</dd>
    </div>
  );
}

function StatusBadge({ complete }: { complete: boolean }) {
  return complete ? (
    <span className="text-emerald-600 font-medium text-xs">✓ compleet</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium text-[11px]">
      <TriangleAlert className="w-3 h-3" /> incompleet
    </span>
  );
}

function NotesPhotos({ el, urls }: { el: BuildingElement; urls: string[] }) {
  if (!el.notes && urls.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 space-y-2">
      <p className="text-[11px] font-medium text-gray-500">
        Notities en Foto&apos;s <span className="font-normal text-gray-400">Notes &amp; photos</span>
      </p>
      {el.notes && <p className="text-xs text-gray-700 whitespace-pre-wrap">{el.notes}</p>}
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map(u => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt={`${el.name} foto`} className="h-20 w-28 object-cover rounded-md border border-gray-200" />
          ))}
        </div>
      )}
    </div>
  );
}

function TransparanteDelen({ openings }: { openings: Opening[] }) {
  if (openings.length === 0) return null;
  return (
    <details className="group/td mt-2">
      <summary className="flex items-center gap-2 cursor-pointer list-none text-xs font-medium text-indigo-700 bg-indigo-50/60 rounded-lg px-3 py-2">
        <ChevronDown className="w-3.5 h-3.5 group-open/td:rotate-180 transition-transform" />
        Transparante Delen
        <span className="bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 text-[11px] font-semibold">{openings.length}</span>
        <span className="font-normal text-gray-400">Windows / doors</span>
      </summary>
      <div className="mt-2 space-y-2">
        {openings.map(o => {
          const h = mmToM(o.height_mm);
          const w = mmToM(o.width_mm);
          const bruto = h != null && w != null ? r2(h * w) : null;
          return (
            <div key={o.id} className="rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-800 capitalize mb-2">
                {o.opening_type}{o.name ? <span className="text-gray-400 font-normal"> · {o.name}</span> : null}
              </p>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                <Field label="Type Deel"   value={<span className="capitalize">{o.opening_type}</span>} />
                <Field label="Materiaal"   value={o.frame_type ?? '—'} />
                <Field label="Glastype"    value={o.glazing_type ?? '—'} />
                <Field label="Hoogte × Breedte" value={h != null || w != null ? `${fmtMeters(h)} × ${fmtMeters(w)}` : '—'} />
                <Field label="Bruto Oppervlakte" value={fmtArea(bruto)} />
                <Field label="Netto Oppervlakte" value={fmtArea(openingArea(o))} />
                <Field label="Zonwering" value={o.has_shading
                  ? `${o.shading_type ?? 'Ja'}${o.shading_factor != null ? ` (${o.shading_factor})` : ''}`
                  : 'Geen'} />
                <Field label="Overstek"    value={o.overstek_m != null ? `${o.overstek_m} m` : '—'} />
                <Field label="Belemmering" value={o.belemmering ?? '—'} />
                <Field label="Thermisch onderbroken" value={jaNee(o.thermisch_onderbroken)} />
                <Field label="U kozijn / glas / totaal"
                  value={[o.u_value_frame, o.u_value_glass, o.u_value_total].map(v => v ?? '—').join(' / ')} />
                <Field label="g-waarde"    value={o.g_value ?? '—'} />
                {/* Migration 024 forfait calc fields (§4.2/4.3) — distinct from the measured u_value/g_value above */}
                <Field label="U glas (forfait)" value={o.u_glas ?? '—'} />
                <Field label="g-waarde (forfait)" value={o.g_waarde ?? '—'} />
                <Field label="F_sh" value={o.f_sh ?? '—'} />
              </dl>
              {o.notes && <p className="mt-2 text-[11px] text-gray-500 italic">{o.notes}</p>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function GevelRow({ el, urls }: { el: ElementWithRelations; urls: string[] }) {
  const positie    = gevelpositie(el);
  const orientatie = toCardinal(el.orientation_deg);
  const hoogte     = mmToM(el.height_mm);
  const breedte    = mmToM(el.length_mm);
  const bruto      = el.area_m2 ?? (hoogte != null && breedte != null ? r2(hoogte * breedte) : null);
  // §2.1: rekenhoogte = override ?? hoogte + dikte_vloerconstructie (300 mm forfait);
  // rekenbreedte has no correction column — it is the stored breedte.
  const rekenH = rekenhoogte(hoogte, el.dikte_vloerconstructie_mm, el.rekenhoogte_m_override);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900">{el.name}</p>
        <StatusBadge complete={el.is_complete} />
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-6 gap-x-4 gap-y-2">
        <Field label="Positie"     value={positie || '—'} />
        <Field label="Orientatie"  value={orientatie || '—'} />
        <Field label="Hoogte"      value={fmtMeters(hoogte)} />
        <Field label="Breedte"     value={fmtMeters(breedte)} />
        <Field label="Rekenhoogte" value={
          <span className="inline-flex items-center gap-1.5">
            {fmtMeters(rekenH)}
            {el.rekenhoogte_m_override != null && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-700">override</span>
            )}
          </span>
        } />
        <Field label="Rekenbreedte" value={fmtMeters(breedte)} />
        <Field label="Bruto Oppervlakte" value={fmtArea(bruto)} />
        <Field label="Rc"          value={<RcValue el={el} />} />
      </dl>
      <TransparanteDelen openings={el.openings} />
      <NotesPhotos el={el} urls={urls} />
    </div>
  );
}

function DakRow({ el, urls }: { el: ElementWithRelations; urls: string[] }) {
  const breakdown = roofAreaBreakdown(el, el.openings, el.dakkapellen);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900">{el.name}</p>
        <span className="text-[11px] text-gray-400">{dakType(el)}</span>
        <StatusBadge complete={el.is_complete} />
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-6 gap-x-4 gap-y-2">
        <Field label="Orientatie" value={toCardinal(el.orientation_deg) || '—'} />
        <Field label="Lengte × Breedte"
          value={`${fmtMeters(mmToM(el.length_mm))} × ${fmtMeters(mmToM(el.width_mm))}`} />
        <Field label="Hoek"       value={el.tilt_deg != null ? `${el.tilt_deg}°` : '—'} />
        <Field label="Nokhoogte"  value={el.nokhoogte_m != null ? `${el.nokhoogte_m} m` : '—'} />
        <Field label="Grenzend aan" value={grenztAan(el)} />
        <Field label="Bruto Oppervlakte" value={fmtArea(breakdown.bruto)} />
        <Field label="Rc"         value={<RcValue el={el} />} />
        <Field label="Totaal Oppervlakte Gaten" value={fmtArea(breakdown.gaten)} />
        <Field label="Opp. Dakkapellen" value={fmtArea(breakdown.dakkapellen)} />
        <Field label="Netto Dakoppervlak" value={<span className="text-indigo-700">{fmtArea(breakdown.netto)}</span>} />
      </dl>
      {el.dakkapellen.length > 0 && (
        <div className="mt-2 rounded-lg border border-gray-100 overflow-hidden">
          <p className="px-3 py-1.5 text-[11px] font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
            Dakkapellen <span className="font-normal text-gray-400">Dormers ({el.dakkapellen.length})</span>
          </p>
          <div className="divide-y divide-gray-50">
            {el.dakkapellen.map(dk => (
              <div key={dk.id} className="px-3 py-2 flex items-center gap-4 text-xs">
                <span className="font-medium text-gray-800">{dk.name}</span>
                <span className="text-gray-500 font-mono">
                  B {fmtMeters(mmToM(dk.width_mm))} · D {fmtMeters(mmToM(dk.length_mm))} · H {fmtMeters(mmToM(dk.height_mm))}
                </span>
                <StatusBadge complete={dk.is_complete} />
              </div>
            ))}
          </div>
        </div>
      )}
      <TransparanteDelen openings={el.openings} />
      <NotesPhotos el={el} urls={urls} />
    </div>
  );
}

function VloerRow({ el, urls }: { el: ElementWithRelations; urls: string[] }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900">{el.name}</p>
        <StatusBadge complete={el.is_complete} />
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-6 gap-x-4 gap-y-2">
        <Field label="Grenzend aan"  value={grenztAan(el)} />
        <Field label="Oppervlakte"   value={fmtArea(el.area_m2)} />
        <Field label="Perimeter"     value={el.perimeter_m != null ? `${el.perimeter_m} m` : '—'} />
        <Field label="Vloerisolatie" value={jaNee(!!el.insulation_type)} />
        <Field label="Bodemisolatie" value={jaNee(el.bodemisolatie)} />
        <Field label="Rc"            value={<RcValue el={el} />} />
      </dl>
      <NotesPhotos el={el} urls={urls} />
    </div>
  );
}

function InstallatieRow({ el, urls }: { el: ElementWithRelations; urls: string[] }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900">{el.name}</p>
        <StatusBadge complete={el.is_complete} />
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-6 gap-x-4 gap-y-2">
        <Field label="Merk"       value={el.brand ?? '—'} />
        <Field label="Model"      value={el.model_nr ?? '—'} />
        <Field label="CV-klasse"  value={el.cv_klasse ?? '—'} />
        <Field label="Type"       value={<span className="capitalize">{el.installation_type ?? '—'}</span>} />
        <Field label="Brandstof"  value={<span className="capitalize">{el.fuel_type ?? '—'}</span>} />
        <Field label="Rendement"  value={fmtEfficiencyPct(el.efficiency)} />
        <Field label="Vermogen"   value={el.capacity_kw != null ? `${el.capacity_kw} kW` : '—'} />
        <Field label="Bouwjaar"   value={el.year_installed ?? '—'} />
      </dl>
      <NotesPhotos el={el} urls={urls} />
    </div>
  );
}

function GenericRow({ el, urls }: { el: ElementWithRelations; urls: string[] }) {
  const dims = [el.length_mm, el.width_mm, el.height_mm]
    .map(v => (v != null ? `${v}mm` : null)).filter(Boolean).join(' × ');
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900">{el.name}</p>
        <span className="text-[11px] text-gray-400 capitalize">{el.element_type}</span>
        <StatusBadge complete={el.is_complete} />
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-6 gap-x-4 gap-y-2">
        <Field label="Afmetingen" value={dims || '—'} />
        <Field label="Oppervlakte" value={fmtArea(el.area_m2)} />
        <Field label="Rc" value={el.rc_value ?? '—'} />
        <Field label="U" value={el.u_value ?? '—'} />
      </dl>
      <TransparanteDelen openings={el.openings} />
      <NotesPhotos el={el} urls={urls} />
    </div>
  );
}

const ROW_BY_TYPE: Record<string, (p: { el: ElementWithRelations; urls: string[] }) => React.ReactNode> = {
  gevel:       GevelRow,
  dak:         DakRow,
  vloer:       VloerRow,
  installatie: InstallatieRow,
};

// Filter chip row (GAP W4): filter by grenzend-aan / orientation instead of
// cloning the AppSheet reverse-lookup screens. No selection → identical render.
function ChipRow({ label, options, active, onToggle }: {
  label: string; options: string[]; active: string | null; onToggle: (v: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-gray-400">{label}</span>
      {options.map(o => (
        <button
          key={o}
          onClick={() => onToggle(o)}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium border ${
            active === o
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function ElementTypeSections({ elements, photoUrls, readOnly = false }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<ElementWithRelations | null>(null);
  const [grenstFilter, setGrenstFilter] = useState<string | null>(null);
  const [orientFilter, setOrientFilter] = useState<string | null>(null);

  // Dakkapellen render nested under their parent dak, never as a top-level row.
  const topLevel = elements.filter(e => e.element_type !== 'dakkapel');

  const grenstOptions = useMemo(
    () => Array.from(new Set(topLevel.filter(e => ['gevel', 'vloer', 'dak'].includes(e.element_type)).map(e => grenztAan(e)))).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements],
  );
  const orientOptions = useMemo(
    () => Array.from(new Set(topLevel
      .filter(e => ['gevel', 'dak'].includes(e.element_type))
      .map(e => toCardinal(e.orientation_deg))
      .filter(Boolean))).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements],
  );

  // Filters only constrain the types they describe; other types stay visible.
  const passes = (e: ElementWithRelations) => {
    if (grenstFilter && ['gevel', 'vloer', 'dak'].includes(e.element_type) && grenztAan(e) !== grenstFilter) return false;
    if (orientFilter && ['gevel', 'dak'].includes(e.element_type) && toCardinal(e.orientation_deg) !== orientFilter) return false;
    return true;
  };
  const visible = topLevel.filter(passes);
  const leftover = visible.filter(e => !SECTION_TYPES.has(e.element_type));

  const sections = [
    ...SECTIONS.map(s => ({ ...s, items: visible.filter(e => e.element_type === s.type) })),
    { type: '_other', nl: 'Overige elementen', en: 'Other', items: leftover },
  ].filter(s => s.items.length > 0);

  if (topLevel.length === 0) {
    return <p className="text-xs text-gray-400 italic">No elements defined for this zone</p>;
  }

  return (
    <div className="space-y-3">
      {(grenstOptions.length > 1 || orientOptions.length > 1) && (
        <div className="space-y-1.5">
          <ChipRow label="Grenzend aan" options={grenstOptions} active={grenstFilter}
                   onToggle={v => setGrenstFilter(cur => (cur === v ? null : v))} />
          <ChipRow label="Orientatie" options={orientOptions} active={orientFilter}
                   onToggle={v => setOrientFilter(cur => (cur === v ? null : v))} />
        </div>
      )}

      {sections.length === 0 && (
        <p className="text-xs text-gray-400 italic">No elements match the active filters</p>
      )}

      {sections.map(section => (
        <div key={section.type} className="rounded-lg border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-800">{section.nl}</h3>
            <span className="bg-gray-200 text-gray-700 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {section.items.length}
            </span>
            <span className="text-xs text-gray-400">{section.en}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {section.items.map(el => {
              const Row = ROW_BY_TYPE[el.element_type] ?? GenericRow;
              return (
                <div key={el.id} className="relative group/row">
                  {!readOnly && (
                    <button
                      onClick={() => setEditing(el)}
                      className="absolute right-3 top-3 p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600"
                      title="Element bewerken"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Row el={el} urls={photoUrls[el.id] ?? []} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!readOnly && editing && (
        <ElementEditPanel
          element={editing}
          opening={editing.element_type === 'transparant_deel' ? (editing.openings[0] ?? null) : null}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
