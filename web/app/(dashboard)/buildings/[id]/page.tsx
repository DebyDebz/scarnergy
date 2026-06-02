import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { FloorPlanButton } from '@/components/buildings/FloorPlanButton';
import { FloorPlanViewer } from '@/components/buildings/FloorPlanViewer';
import { BuildingExportButtons } from '@/components/buildings/BuildingExportButtons';
import { ElementsWithEdit } from '@/components/elements/ElementsWithEdit';
import { ArrowLeft, ChevronDown, TriangleAlert } from 'lucide-react';
import type {
  BuildingSummary, Zone, SessionSummary,
  BuildingElement, Opening, BuildingFacadePhoto,
} from '@/lib/types';
import { fmtDate } from '@/lib/format';

interface Props { params: { id: string } }

const DIRECTIONS: { key: BuildingFacadePhoto['direction']; label: string }[] = [
  { key: 'voor',   label: 'Voorgevel'   },
  { key: 'achter', label: 'Achtergevel' },
  { key: 'links',  label: 'Linkergevel' },
  { key: 'rechts', label: 'Rechtergevel'},
];

export default async function BuildingDetailPage({ params }: Props) {
  const supabase = await createClient();

  const [buildingResult, zonesResult, sessionsResult, facadeResult] = await Promise.all([
    supabase.from('building_summary').select('*').eq('id', params.id).single(),
    (supabase.from('zones') as any).select('*').eq('building_id', params.id).order('floor_level'),
    supabase.from('session_summary').select('*')
      .eq('building_id', params.id)
      .order('started_at', { ascending: false }).limit(20),
    (supabase.from('building_facade_photos') as any)
      .select('*').eq('building_id', params.id).order('direction'),
  ]);

  const building = (buildingResult as unknown as { data: BuildingSummary | null }).data;
  if (!building) notFound();

  const zones    = (zonesResult   as unknown as { data: Zone[] | null }).data ?? [];
  const sessions = (sessionsResult as unknown as { data: SessionSummary[] | null }).data ?? [];
  const facadePhotosRaw: BuildingFacadePhoto[] = (facadeResult as unknown as { data: BuildingFacadePhoto[] | null }).data ?? [];

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
        .select('*').in('zone_id', zoneIds).order('sort_order'),
      (supabase.from('openings') as any)
        .select('*').eq('is_active', true),
    ]);
    elements = elemRes.data ?? [];
    const elIds = new Set(elements.map((e: BuildingElement) => e.id));
    openings = (openRes.data ?? []).filter((o: any) => elIds.has(o.element_id));
  }

  const openingByElement = openings.reduce<Record<string, Opening>>((acc, o) => {
    acc[(o as any).element_id] = o;
    return acc;
  }, {});

  type ZoneWithElements = Zone & { elements: (BuildingElement & { opening: Opening | null })[] };
  const zonesWithElements: ZoneWithElements[] = zones.map((z: Zone) => ({
    ...z,
    elements: elements
      .filter(e => e.zone_id === z.id)
      .map(e => ({ ...e, opening: openingByElement[e.id] ?? null })),
  }));

  const hasFacadePhotos = facadePhotosRaw.length > 0;
  const hasFloorPlans   = zones.some((z: Zone) => z.floor_plan_image_url);

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

      {/* ── Section 2 — Gevel Foto's ────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Gevel Foto&apos;s buitenzijde</h2>
          <span className="text-xs text-gray-400">{facadePhotosRaw.length}/4 captured</span>
        </div>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {DIRECTIONS.map(({ key, label }) => {
            const signedUrl = facadeByDir[key] ?? null;
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <div className={`aspect-[4/3] rounded-lg overflow-hidden border-2 ${signedUrl ? 'border-emerald-300' : 'border-dashed border-gray-200'} bg-gray-50 flex items-center justify-center`}>
                  {signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signedUrl} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-gray-300">📷</span>
                  )}
                </div>
                <p className={`text-xs text-center font-medium ${signedUrl ? 'text-emerald-700' : 'text-gray-400'}`}>
                  {label}
                  {signedUrl && <span className="ml-1 text-emerald-500">✓</span>}
                </p>
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

      {/* ── Zones & elements ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Zones &amp; elements</h2>
        </div>
        {/* Zone headers keep the existing FloorPlanButton for upload */}
        <div className="divide-y divide-gray-100">
          {zonesWithElements.map(zone => (
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
              </summary>

              <div className="px-5 pb-4 pt-2 space-y-3">
                <p className="text-xs text-gray-500">
                  Area: <span className="font-medium text-gray-700">{zone.gross_area_m2} m²</span>
                </p>

                {/* Inline floor plan if available */}
                {floorPlanUrls[zone.id] && (
                  <FloorPlanViewer zone={zone as Zone} imageUrl={floorPlanUrls[zone.id]} width={320} />
                )}

                {zone.elements.length > 0 ? (
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Type</th>
                          <th className="px-4 py-2 font-medium">Dimensions</th>
                          <th className="px-4 py-2 font-medium">Rc</th>
                          <th className="px-4 py-2 font-medium">U</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {zone.elements.map(el => {
                          const dims = [
                            el.length_mm ? `${el.length_mm}mm` : null,
                            el.width_mm  ? `${el.width_mm}mm`  : null,
                            el.height_mm ? `${el.height_mm}mm` : null,
                          ].filter(Boolean).join(' × ');
                          return (
                            <tr key={el.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium text-gray-900">{el.name}</td>
                              <td className="px-4 py-2 text-gray-500 capitalize">{el.element_type}</td>
                              <td className="px-4 py-2 text-gray-500 font-mono">{dims || '—'}</td>
                              <td className="px-4 py-2 text-gray-700">{el.rc_value ?? '—'}</td>
                              <td className="px-4 py-2 text-gray-700">{el.u_value ?? '—'}</td>
                              <td className="px-4 py-2">
                                {!el.is_complete ? (
                                  <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium text-xs">
                                    <TriangleAlert className="w-3 h-3" /> incomplete
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 font-medium">✓</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No elements defined for this zone</p>
                )}
              </div>
            </details>
          ))}
          {!zones.length && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No zones defined</p>
          )}
        </div>
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
