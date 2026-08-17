import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { appsheetFind } from '@/lib/appsheet/client';
import {
  mapObjectenRow, mapVerdiepingRow, mapRekenzoneRow, mapGevelRow, mapDakRow,
  mapVloerRow, mapInstallatieRow, mapTransparantDeelRow, firstZoneIdForRekenzone,
  escapeForSelector,
} from '@/lib/appsheet/mappers';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { FloorPlanButton } from '@/components/buildings/FloorPlanButton';
import { BuildingFloorPlanUpload } from '@/components/buildings/BuildingFloorPlanUpload';
import { FloorPlanViewer } from '@/components/buildings/FloorPlanViewer';
import { BuildingExportButtons } from '@/components/buildings/BuildingExportButtons';
import { BagPanel } from '@/components/buildings/BagPanel';
import { BuildingContactCard } from '@/components/buildings/BuildingContactCard';
import { MapPanel } from '@/components/buildings/MapPanel';
import { AppsheetZoneEditButton } from '@/components/buildings/AppsheetZoneEditButton';
import { AppsheetElementEditPanel } from '@/components/elements/AppsheetElementEditPanel';
import { geocodeAddress } from '@/lib/geocode';
import { ZoneEditButton } from '@/components/buildings/ZoneEditButton';
import { ElementTypeSections, type ElementWithRelations } from '@/components/elements/ElementTypeSections';
import { EnergyLabelTrendChart } from '@/components/charts/EnergyLabelTrendChart';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import type {
  BuildingSummary, Rekenzone, Zone, SessionSummary,
  BuildingElement, Opening, BuildingFacadePhoto, EnergyLabelSnapshot,
} from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { areaByFloor, totalZoneArea, fmtArea } from '@/lib/calc';

interface Props { params: { id: string } }

// label = original Dutch term (kept for continuity); en = English translation
// shown underneath. The `key` is a stored data value and must not change.
const DIRECTIONS: { key: BuildingFacadePhoto['direction']; label: string; en: string }[] = [
  { key: 'voor',   label: 'Voorgevel',   en: 'Front facade' },
  { key: 'achter', label: 'Achtergevel', en: 'Rear facade'  },
  { key: 'links',  label: 'Linkergevel', en: 'Left facade'  },
  { key: 'rechts', label: 'Rechtergevel', en: 'Right facade' },
];

export default async function BuildingDetailPage({ params }: Props) {
  const source = await getServerDataSource();
  if (source === 'appsheet') {
    return <AppsheetBuildingDetail objectId={params.id} />;
  }

  const supabase = await createClient();

  const [buildingResult, zonesResult, sessionsResult, facadeResult, rekenzonesResult, labelSnapshotsResult] = await Promise.all([
    supabase.from('building_summary').select('*').eq('id', params.id).single(),
    (supabase.from('zones') as any).select('*').eq('building_id', params.id).order('floor_level'),
    supabase.from('session_summary').select('*')
      .eq('building_id', params.id)
      .order('started_at', { ascending: false }).limit(20),
    (supabase.from('building_facade_photos') as any)
      .select('*').eq('building_id', params.id).order('direction'),
    (supabase.from('rekenzones') as any)
      .select('*').eq('building_id', params.id).eq('is_active', true).order('sort_order'),
    (supabase.from('energy_label_snapshots') as any)
      .select('*').eq('building_id', params.id).order('computed_at', { ascending: true }),
  ]);

  const building = (buildingResult as unknown as { data: BuildingSummary | null }).data;
  if (!building) notFound();

  const zones      = (zonesResult   as unknown as { data: Zone[] | null }).data ?? [];
  const rekenzones = (rekenzonesResult as unknown as { data: Rekenzone[] | null }).data ?? [];
  const sessions = (sessionsResult as unknown as { data: SessionSummary[] | null }).data ?? [];
  const facadePhotosRaw: BuildingFacadePhoto[] = (facadeResult as unknown as { data: BuildingFacadePhoto[] | null }).data ?? [];
  const labelSnapshots: EnergyLabelSnapshot[] = (labelSnapshotsResult as unknown as { data: EnergyLabelSnapshot[] | null }).data ?? [];

  // Sign facade photo storage paths (bucket: facade-photos)
  const facadeByDir: Record<string, string | null> = {};
  await Promise.all(
    facadePhotosRaw.map(async p => {
      const url = p.photo_url;
      // Already a full URL (http/https) — use directly
      if (url.startsWith('http')) {
        facadeByDir[p.direction] = url;
      } else {
        const { data } = await supabase.storage.from('facade-photos').createSignedUrl(url, 3600);
        facadeByDir[p.direction] = data?.signedUrl ?? null;
      }
    })
  );

  // Floor plan image URLs — stored as full public URLs by FloorPlanUploadModal
  const floorPlanUrls: Record<string, string> = {};
  for (const z of zones) {
    if (z.floor_plan_image_url) floorPlanUrls[z.id] = z.floor_plan_image_url;
  }

  // Elements + openings
  const zoneIds = zones.map((z: Zone) => z.id);
  let elements: BuildingElement[] = [];
  let openings: Opening[] = [];

  if (zoneIds.length > 0) {
    const [elemRes, openRes] = await Promise.all([
      (supabase.from('building_elements') as any)
        .select('*').in('zone_id', zoneIds).eq('is_active', true).order('sort_order'),
      (supabase.from('openings') as any)
        .select('*').eq('is_active', true),
    ]);
    elements = elemRes.data ?? [];
    const elIds = new Set(elements.map((e: BuildingElement) => e.id));
    openings = (openRes.data ?? []).filter((o: any) => elIds.has(o.element_id));
  }

  // ALL openings per element (the old view showed only one) + dakkapellen
  // nested under their parent dak — AppSheet parity (GAP.md W1).
  const openingsByElement = openings.reduce<Record<string, Opening[]>>((acc, o) => {
    const key = (o as any).element_id as string;
    (acc[key] ??= []).push(o);
    return acc;
  }, {});
  const dakkapellenByParent = elements
    .filter(e => e.element_type === 'dakkapel' && e.parent_element_id)
    .reduce<Record<string, BuildingElement[]>>((acc, dk) => {
      (acc[dk.parent_element_id as string] ??= []).push(dk);
      return acc;
    }, {});

  type ZoneWithElements = Zone & { elements: ElementWithRelations[] };
  const zonesWithElements: ZoneWithElements[] = zones.map((z: Zone) => ({
    ...z,
    elements: elements
      .filter(e => e.zone_id === z.id)
      .map(e => ({
        ...e,
        openings: openingsByElement[e.id] ?? [],
        dakkapellen: dakkapellenByParent[e.id] ?? [],
      })),
  }));

  // Sign element photos (inspection-photos bucket). Entries are storage paths;
  // http(s) entries are used as-is and file:// mobile-local fallbacks skipped.
  const elementPhotoUrls: Record<string, string[]> = {};
  await Promise.all(
    elements
      .filter(e => (e.photo_urls ?? []).length > 0)
      .map(async e => {
        const urls = await Promise.all(
          (e.photo_urls ?? []).map(async p => {
            if (p.startsWith('http')) return p;
            if (p.startsWith('file:')) return null;
            const { data } = await supabase.storage.from('inspection-photos').createSignedUrl(p, 3600);
            return data?.signedUrl ?? null;
          })
        );
        const signed = urls.filter((u): u is string => !!u);
        if (signed.length > 0) elementPhotoUrls[e.id] = signed;
      })
  );

  const hasFacadePhotos = facadePhotosRaw.length > 0;
  const hasFloorPlans   = zones.some((z: Zone) => z.floor_plan_image_url);

  // Derived floor-area aggregation (previously only in VABI export / print)
  const floorAreas = areaByFloor(zones);
  const totalArea  = totalZoneArea(zones);

  // ── Rekenzones: per-type element counts + grouped zone accordion ──────────
  // (AppSheet parity: Naam | Gevels | Daken | Vloeren | Installaties | Notities.
  // Elements roll up via element.zone_id → zone.rekenzone_id.)
  const rzZoneIds = new Map<string, Set<string>>(
    rekenzones.map(rz => [rz.id, new Set(zones.filter(z => z.rekenzone_id === rz.id).map(z => z.id))])
  );
  const rzCountRows = rekenzones.map(rz => {
    const zIds = rzZoneIds.get(rz.id)!;
    const counts = { gevel: 0, dak: 0, vloer: 0, installatie: 0 } as Record<string, number>;
    for (const e of elements) {
      if (zIds.has(e.zone_id) && counts[e.element_type] !== undefined) counts[e.element_type]++;
    }
    return { rz, counts };
  });

  type ZoneGroup = { key: string; title: string | null; zones: typeof zonesWithElements };
  const ungroupedZones = zonesWithElements.filter(
    z => !z.rekenzone_id || !rekenzones.some(rz => rz.id === z.rekenzone_id)
  );
  // Group the accordion only when a zone is actually assigned (same gate as
  // the VABI exporter) — otherwise a lone "Ongegroepeerd" header would imply
  // grouping the export doesn't apply.
  const anyAssigned = ungroupedZones.length < zonesWithElements.length;
  const zoneGroups: ZoneGroup[] = rekenzones.length && anyAssigned
    ? [
        ...rekenzones
          .map(rz => ({ key: rz.id, title: rz.name, zones: zonesWithElements.filter(z => z.rekenzone_id === rz.id) }))
          .filter(g => g.zones.length > 0),
        ...(ungroupedZones.length ? [{ key: 'none', title: 'Ongegroepeerd', zones: ungroupedZones }] : []),
      ]
    : [{ key: 'all', title: null, zones: zonesWithElements }];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <Link href="/buildings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Buildings
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{building.full_address}</h1>
            <p className="text-sm text-gray-500 font-mono mt-0.5">{building.reference_code}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <EnergyLabelBadge label={building.latest_energy_label} />
            <BuildingExportButtons buildingId={params.id} buildingCode={building.reference_code} />
          </div>
        </div>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Type',       value: building.building_type },
          { label: 'Built',      value: building.construction_year },
          { label: 'Floor area', value: `${building.gross_floor_area_m2} m²` },
          { label: 'Sessions',   value: building.session_count },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Contactpersoon (data-source toggle build) ───────────────────── */}
      <BuildingContactCard buildingId={params.id} />

      {/* ── BAG / 3DBAG registry data (GAP W3) ──────────────────────────── */}
      <BagPanel building={building} />

      {/* ── Locatie / map (GAP W3) ──────────────────────────────────────── */}
      <MapPanel building={building} />

      {/* ── Section 2 — Gevel Foto's ────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            Gevel Foto&apos;s buitenzijde
            <span className="ml-2 font-normal text-gray-400 text-sm">Facade photos (exterior)</span>
          </h2>
          <span className="text-xs text-gray-400">{facadePhotosRaw.length}/4 captured</span>
        </div>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {DIRECTIONS.map(({ key, label, en }) => {
            const signedUrl = facadeByDir[key] ?? null;
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <div className={`aspect-[4/3] rounded-lg overflow-hidden border-2 ${signedUrl ? 'border-emerald-300' : 'border-dashed border-gray-200'} bg-gray-50 flex items-center justify-center`}>
                  {signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signedUrl} alt={en} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-gray-300">📷</span>
                  )}
                </div>
                <div className="text-center">
                  <p className={`text-xs font-medium ${signedUrl ? 'text-emerald-700' : 'text-gray-400'}`}>
                    {label}
                    {signedUrl && <span className="ml-1 text-emerald-500">✓</span>}
                  </p>
                  <p className="text-[11px] text-gray-400">{en}</p>
                </div>
              </div>
            );
          })}
        </div>
        {!hasFacadePhotos && (
          <p className="px-5 pb-4 text-xs text-gray-400 italic">
            No facade photos captured yet. Capture them from the mobile app during a session.
          </p>
        )}
      </div>

      {/* ── Section 4 — Floor Plans ─────────────────────────────────────── */}
      {hasFloorPlans && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Overzicht Plattegronden</h2>
          </div>
          <div className="p-5 flex flex-wrap gap-5">
            {zones.filter((z: Zone) => z.floor_plan_image_url).map((z: Zone) => (
              <div key={z.id} className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-gray-700">{z.name}</p>
                <FloorPlanViewer zone={z} imageUrl={floorPlanUrls[z.id] ?? ''} width={320} />
                {z.gross_area_m2 != null && (
                  <p className="text-xs text-gray-400 text-center">{z.gross_area_m2} m²</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Floor area summary (derived) ────────────────────────────────── */}
      {zones.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Floor area</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {floorAreas.map(f => (
                <tr key={f.level}>
                  <td className="px-5 py-2.5 text-gray-700">{f.name}</td>
                  <td className="px-5 py-2.5 text-right text-gray-700">{fmtArea(f.area)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-5 py-2.5 font-semibold text-gray-900">Total</td>
                <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{fmtArea(totalArea)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Rekenzones (AppSheet parity) ────────────────────────────────── */}
      {rekenzones.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">
              Rekenzones
              <span className="ml-2 font-normal text-gray-400 text-sm">Calculation zones</span>
            </h2>
            <span className="bg-gray-200 text-gray-700 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {rekenzones.length}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-5 py-3 font-medium">Naam</th>
                <th className="px-5 py-3 font-medium">Gevels</th>
                <th className="px-5 py-3 font-medium">Daken</th>
                <th className="px-5 py-3 font-medium">Vloeren</th>
                <th className="px-5 py-3 font-medium">Installaties</th>
                <th className="px-5 py-3 font-medium">Notities</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rzCountRows.map(({ rz, counts }) => (
                <tr key={rz.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">
                    <Link
                      href={`/buildings/${params.id}/rekenzones/${rz.id}`}
                      className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                    >
                      {rz.name} <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">Gevels ({counts.gevel})</td>
                  <td className="px-5 py-3 text-gray-700">Daken ({counts.dak})</td>
                  <td className="px-5 py-3 text-gray-700">Vloeren ({counts.vloer})</td>
                  <td className="px-5 py-3 text-gray-700">Installaties ({counts.installatie})</td>
                  <td className="px-5 py-3 text-gray-500">{rz.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Zones & elements ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Zones &amp; elements</h2>
          <BuildingFloorPlanUpload zones={zones} buildingId={params.id} />
        </div>
        {/* Zone headers keep the existing FloorPlanButton for upload */}
        <div className="divide-y divide-gray-100">
          {zoneGroups.map(group => (
            <div key={group.key}>
              {group.title && (
                <div className="px-5 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {group.title}
                </div>
              )}
              <div className="divide-y divide-gray-100">
                {group.zones.map(zone => (
            <details key={zone.id} className="group">
              <summary className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 list-none">
                <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                <span className="font-medium text-gray-800">{zone.name}</span>
                <span className="text-xs text-gray-400 font-mono">{zone.zone_code}</span>
                <span className="ml-auto text-xs text-gray-500">Level {zone.floor_level}</span>
                <span className="text-xs text-gray-500 ml-4">{zone.elements.length} elements</span>
                {zone.energy_label && (
                  <span className="ml-2"><EnergyLabelBadge label={zone.energy_label} /></span>
                )}
                <span className="ml-2">
                  <FloorPlanButton zone={zone as Zone} buildingId={params.id} />
                </span>
                <span className="ml-1">
                  <ZoneEditButton
                    zoneId={zone.id}
                    zoneName={zone.name}
                    ceilingHeightM={zone.ceiling_height_m}
                    grossAreaM2={zone.gross_area_m2}
                    description={zone.description}
                    vloer={(() => {
                      const v = zone.elements.find(e => e.element_type === 'vloer');
                      return v ? {
                        id: v.id,
                        plafond_type: v.plafond_type,
                        warmtecap_vloer_klasse: v.warmtecap_vloer_klasse,
                        warmtecap_gevel_klasse: v.warmtecap_gevel_klasse,
                      } : null;
                    })()}
                  />
                </span>
              </summary>

              <div className="px-5 pb-4 pt-2 space-y-3">
                <p className="text-xs text-gray-500">
                  Area: <span className="font-medium text-gray-700">{fmtArea(zone.gross_area_m2)}</span>
                </p>

                {/* Inline floor plan if available */}
                {floorPlanUrls[zone.id] && (
                  <FloorPlanViewer zone={zone as Zone} imageUrl={floorPlanUrls[zone.id]} width={320} />
                )}

                <ElementTypeSections elements={zone.elements} photoUrls={elementPhotoUrls} />
              </div>
            </details>
                ))}
              </div>
            </div>
          ))}
          {!zones.length && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No zones defined</p>
          )}
        </div>
      </div>

      {/* ── Energy label history ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Energy label history</h2>
        <EnergyLabelTrendChart snapshots={labelSnapshots} />
      </div>

      {/* ── Inspection sessions ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Inspection sessions</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Code</th>
              <th className="px-5 py-3 font-medium">Inspector</th>
              <th className="px-5 py-3 font-medium">Started</th>
              <th className="px-5 py-3 font-medium">Measurements</th>
              <th className="px-5 py-3 font-medium">Anomalies</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sessions.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link href={`/sessions/${s.id}`} className="text-indigo-600 hover:underline">
                    {s.session_code}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-700">{s.inspector_name}</td>
                <td className="px-5 py-3 text-gray-500">{fmtDate(s.started_at)}</td>
                <td className="px-5 py-3 text-gray-700">{s.total_measurements}</td>
                <td className="px-5 py-3">
                  {s.anomaly_count > 0
                    ? <span className="text-amber-600 font-medium">{s.anomaly_count}</span>
                    : <span className="text-gray-400">0</span>}
                </td>
                <td className="px-5 py-3"><SessionStatusBadge status={s.status} /></td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-sm text-gray-400">No sessions</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// AppSheet-sourced building detail. Organisations/buildings/contacts and now
// zones/elements/rekenzones have an AppSheet-side read path (see
// docs/APPSHEET_SCANERGYV2_TOGGLE_ANALYSIS.md §6 for build history); facade
// photos, floor plans (AppSheet hosts sketches in its own file storage, not
// signable from here), energy label history, and inspection sessions have no
// AppSheet-side equivalent at all, so those stay an explicit notice instead
// of silently showing "no data".
async function AppsheetBuildingDetail({ objectId }: { objectId: string }) {
  const idFilter = escapeForSelector(objectId);
  const [
    objectenResult, bagResult, verdiepingenResult, rekenzonesResult,
    gevelsResult, dakenResult, vloerenResult, installatiesResult, openingenResult,
  ] = await Promise.all([
    appsheetFind('Objecten', `FILTER(Objecten, [Object ID] = "${idFilter}")`),
    appsheetFind('BAG Data', `FILTER("BAG Data", [Object ID] = "${idFilter}")`),
    appsheetFind('Verdiepingen', `FILTER(Verdiepingen, [Object ID] = "${idFilter}")`),
    appsheetFind('Rekenzones', `FILTER(Rekenzones, [Object ID] = "${idFilter}")`),
    appsheetFind('Gevels', `FILTER(Gevels, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Daken', `FILTER(Daken, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Vloeren', `FILTER(Vloeren, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Installaties', `FILTER(Installaties, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Transparante_Delen', `FILTER(Transparante_Delen, [Object ID virtual] = "${idFilter}")`),
  ]);
  const row = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
  if (!row) notFound();

  const bagRow = Array.isArray(bagResult) ? bagResult[0] : undefined;
  const building = mapObjectenRow(row, bagRow);
  const fullAddress = `${building.street} ${building.house_number}, ${building.postal_code} ${building.city}`.trim();

  // No AppSheet column caches resolved coordinates, so geocode live on every
  // render instead of the Scanergy button+persist flow (see lib/geocode.ts).
  let coords: { lat: number; lon: number } | null = null;
  try {
    coords = await geocodeAddress(building.street, building.house_number, null, building.postal_code, building.city);
  } catch {
    coords = null;
  }

  const rekenzoneRows: Record<string, unknown>[] = Array.isArray(rekenzonesResult) ? rekenzonesResult : [];
  const rekenzones: Rekenzone[] = rekenzoneRows.map(mapRekenzoneRow);
  // Daken/Vloeren/Installaties carry a Rekenzone ID but no Verdieping ID of
  // their own (unlike Gevels) — resolve a best-effort zone via the
  // rekenzone's first related floor (see firstZoneIdForRekenzone).
  const zoneIdByRekenzone = new Map<string, string>(
    rekenzoneRows.map(r => [String(r['Rekenzone ID'] ?? ''), firstZoneIdForRekenzone(r)])
  );

  const zones: Zone[] = (Array.isArray(verdiepingenResult) ? verdiepingenResult : []).map(mapVerdiepingRow);

  const gevels = (Array.isArray(gevelsResult) ? gevelsResult : []).map(mapGevelRow);
  const daken = (Array.isArray(dakenResult) ? dakenResult : []).map((r: Record<string, unknown>) =>
    mapDakRow(r, zoneIdByRekenzone.get(String(r['Rekenzone ID'] ?? '')) ?? ''));
  const vloeren = (Array.isArray(vloerenResult) ? vloerenResult : []).map((r: Record<string, unknown>) =>
    mapVloerRow(r, zoneIdByRekenzone.get(String(r['Rekenzone ID'] ?? '')) ?? ''));
  const installaties = (Array.isArray(installatiesResult) ? installatiesResult : []).map((r: Record<string, unknown>) =>
    mapInstallatieRow(r, zoneIdByRekenzone.get(String(r['Rekenzone ID'] ?? '')) ?? ''));
  const elements: BuildingElement[] = [...gevels, ...daken, ...vloeren, ...installaties];

  const openings: Opening[] = (Array.isArray(openingenResult) ? openingenResult : []).map(mapTransparantDeelRow);
  const openingsByElement = openings.reduce<Record<string, Opening[]>>((acc, o) => {
    (acc[o.element_id] ??= []).push(o);
    return acc;
  }, {});

  type ZoneWithElements = Zone & { elements: ElementWithRelations[] };
  const zonesWithElements: ZoneWithElements[] = zones.map(z => ({
    ...z,
    elements: elements
      .filter(e => e.zone_id === z.id)
      .map(e => ({ ...e, openings: openingsByElement[e.id] ?? [], dakkapellen: [] })),
  }));

  const floorAreas = areaByFloor(zones);
  const totalArea = totalZoneArea(zones);

  const rzZoneIds = new Map<string, Set<string>>(
    rekenzones.map(rz => [rz.id, new Set(zones.filter(z => z.rekenzone_id === rz.id).map(z => z.id))])
  );
  const rzCountRows = rekenzones.map(rz => {
    const zIds = rzZoneIds.get(rz.id)!;
    const counts = { gevel: 0, dak: 0, vloer: 0, installatie: 0 } as Record<string, number>;
    for (const e of elements) {
      if (zIds.has(e.zone_id) && counts[e.element_type] !== undefined) counts[e.element_type]++;
    }
    return { rz, counts };
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/buildings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Buildings
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{fullAddress}</h1>
            <p className="text-sm text-gray-500 font-mono mt-0.5">{building.reference_code}</p>
          </div>
          <div className="shrink-0">
            <BuildingExportButtons buildingId={objectId} buildingCode={building.reference_code} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Type', value: building.building_type || '—' },
          { label: 'Built', value: building.construction_year || '—' },
          { label: 'Floor area', value: building.gross_floor_area_m2 ? `${building.gross_floor_area_m2} m²` : '—' },
          { label: 'Zones', value: zones.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <BuildingContactCard buildingId={objectId} />

      <BagPanel building={building} showActions={false} />

      <MapPanel
        building={{ id: objectId, latitude: coords?.lat ?? null, longitude: coords?.lon ?? null }}
        showActions={false}
      />

      {zones.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Floor area</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {floorAreas.map(f => (
                <tr key={f.level}>
                  <td className="px-5 py-2.5 text-gray-700">{f.name}</td>
                  <td className="px-5 py-2.5 text-right text-gray-700">{fmtArea(f.area)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-5 py-2.5 font-semibold text-gray-900">Total</td>
                <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{fmtArea(totalArea)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {rekenzones.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">
              Rekenzones
              <span className="ml-2 font-normal text-gray-400 text-sm">Calculation zones</span>
            </h2>
            <span className="bg-gray-200 text-gray-700 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {rekenzones.length}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-5 py-3 font-medium">Naam</th>
                <th className="px-5 py-3 font-medium">Gevels</th>
                <th className="px-5 py-3 font-medium">Daken</th>
                <th className="px-5 py-3 font-medium">Vloeren</th>
                <th className="px-5 py-3 font-medium">Installaties</th>
                <th className="px-5 py-3 font-medium">Notities</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rzCountRows.map(({ rz, counts }) => (
                <tr key={rz.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{rz.name}</td>
                  <td className="px-5 py-3 text-gray-700">Gevels ({counts.gevel})</td>
                  <td className="px-5 py-3 text-gray-700">Daken ({counts.dak})</td>
                  <td className="px-5 py-3 text-gray-700">Vloeren ({counts.vloer})</td>
                  <td className="px-5 py-3 text-gray-700">Installaties ({counts.installatie})</td>
                  <td className="px-5 py-3 text-gray-500">{rz.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Zones &amp; elements</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {zonesWithElements.map(zone => (
            <details key={zone.id} className="group">
              <summary className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 list-none">
                <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                <span className="font-medium text-gray-800">{zone.name}</span>
                <span className="ml-auto text-xs text-gray-500">{zone.elements.length} elements</span>
                <span className="ml-2">
                  <AppsheetZoneEditButton
                    zoneId={zone.id}
                    zoneName={zone.name}
                    ceilingHeightM={zone.ceiling_height_m}
                    grossAreaM2={zone.gross_area_m2}
                    description={zone.description}
                    elementCount={zone.elements.length}
                  />
                </span>
              </summary>
              <div className="px-5 pb-4 pt-2 space-y-3">
                <p className="text-xs text-gray-500">
                  Area: <span className="font-medium text-gray-700">{fmtArea(zone.gross_area_m2)}</span>
                </p>
                <ElementTypeSections elements={zone.elements} photoUrls={{}} EditPanel={AppsheetElementEditPanel} />
              </div>
            </details>
          ))}
          {!zones.length && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No zones defined</p>
          )}
        </div>
      </div>

    </div>
  );
}
