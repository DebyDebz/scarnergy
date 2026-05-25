import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { ArrowLeft, ChevronDown, TriangleAlert } from 'lucide-react';
import type { BuildingSummary, Zone, SessionSummary, BuildingElement } from '@/lib/types';

interface Props {
  params: { id: string };
}

type ZoneWithCount = Zone & { building_elements: { count: number }[] };
type ElementWithOpenings = BuildingElement & { openings: { count: number }[] };

export default async function BuildingDetailPage({ params }: Props) {
  const supabase = await createClient();

  const [buildingResult, zonesResult, sessionsResult] = await Promise.all([
    supabase.from('building_summary').select('*').eq('id', params.id).single(),
    supabase.from('zones').select('*, building_elements(count)').eq('building_id', params.id).order('floor_level'),
    supabase.from('session_summary').select('*').eq('building_id', params.id).order('started_at', { ascending: false }).limit(20),
  ]);

  const building = (buildingResult as unknown as { data: BuildingSummary | null }).data;
  const zones = (zonesResult as unknown as { data: ZoneWithCount[] | null }).data;
  const sessions = (sessionsResult as unknown as { data: SessionSummary[] | null }).data;

  if (!building) notFound();

  const zoneIds = zones?.map(z => z.id) ?? [];
  let elements: ElementWithOpenings[] = [];
  if (zoneIds.length > 0) {
    const elementsResult = await (supabase.from('building_elements') as any)
      .select('*, openings(count)')
      .in('zone_id', zoneIds)
      .order('sort_order') as unknown as { data: ElementWithOpenings[] | null };
    elements = elementsResult.data ?? [];
  }

  const elementsByZone = elements.reduce<Record<string, ElementWithOpenings[]>>((acc, el) => {
    (acc[el.zone_id] ??= []).push(el);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/buildings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Buildings
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{building.full_address}</h1>
            <p className="text-sm text-gray-500 font-mono mt-0.5">{building.reference_code}</p>
          </div>
          <EnergyLabelBadge label={building.latest_energy_label} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Type', value: building.building_type },
          { label: 'Built', value: building.construction_year },
          { label: 'Floor area', value: `${building.gross_floor_area_m2} m²` },
          { label: 'Sessions', value: building.session_count },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Zones &amp; elements</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {(zones ?? []).map(zone => {
            const elementCount = zone.building_elements?.[0]?.count ?? 0;
            const zoneElements = elementsByZone[zone.id] ?? [];
            return (
              <details key={zone.id} className="group">
                <summary className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 list-none">
                  <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                  <span className="font-medium text-gray-800">{zone.name}</span>
                  <span className="text-xs text-gray-400 font-mono">{zone.zone_code}</span>
                  <span className="ml-auto text-xs text-gray-500">Level {zone.floor_level}</span>
                  <span className="text-xs text-gray-500 ml-4">{elementCount} elements</span>
                  {zone.energy_label && (
                    <span className="ml-2">
                      <EnergyLabelBadge label={zone.energy_label} />
                    </span>
                  )}
                </summary>

                <div className="px-5 pb-4 pt-1">
                  <p className="text-xs text-gray-500 mb-3">
                    Area: <span className="font-medium text-gray-700">{zone.gross_area_m2} m²</span>
                  </p>

                  {zoneElements.length > 0 ? (
                    <div className="rounded-lg border border-gray-100 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-100">
                            <th className="px-4 py-2 font-medium">Name</th>
                            <th className="px-4 py-2 font-medium">Type</th>
                            <th className="px-4 py-2 font-medium">Dimensions</th>
                            <th className="px-4 py-2 font-medium">Rc (m²K/W)</th>
                            <th className="px-4 py-2 font-medium">U (W/m²K)</th>
                            <th className="px-4 py-2 font-medium">Openings</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {zoneElements.map(el => {
                            const dims = [
                              el.length_mm ? `${el.length_mm}mm` : null,
                              el.width_mm ? `${el.width_mm}mm` : null,
                              el.height_mm ? `${el.height_mm}mm` : null,
                            ].filter(Boolean).join(' × ');
                            const openingCount = el.openings?.[0]?.count ?? 0;
                            return (
                              <tr key={el.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2 font-medium text-gray-900">{el.name}</td>
                                <td className="px-4 py-2 text-gray-500 capitalize">{el.element_type}</td>
                                <td className="px-4 py-2 text-gray-500 font-mono">{dims || '—'}</td>
                                <td className="px-4 py-2 text-gray-700">{el.rc_value ?? '—'}</td>
                                <td className="px-4 py-2 text-gray-700">{el.u_value ?? '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{openingCount}</td>
                                <td className="px-4 py-2">
                                  {!el.is_complete ? (
                                    <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
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
            );
          })}
          {!zones?.length && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No zones defined</p>
          )}
        </div>
      </div>

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
            {(sessions ?? []).map(s => (
              <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link href={`/sessions/${s.id}`} className="text-indigo-600 hover:underline">
                    {s.session_code}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-700">{s.inspector_name}</td>
                <td className="px-5 py-3 text-gray-500">
                  {new Date(s.started_at).toLocaleDateString('en-GB')}
                </td>
                <td className="px-5 py-3 text-gray-700">{s.total_measurements}</td>
                <td className="px-5 py-3">
                  {s.anomaly_count > 0 ? (
                    <span className="text-amber-600 font-medium">{s.anomaly_count}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <SessionStatusBadge status={s.status} />
                </td>
              </tr>
            ))}
            {!sessions?.length && (
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
