import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { LiveFeed } from '@/components/sessions/LiveFeed';
import { MeasurementChart } from '@/components/charts/MeasurementChart';
import { CloseSessionButton } from '@/components/sessions/CloseSessionButton';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { ArrowLeft, ChevronDown, TriangleAlert } from 'lucide-react';
import type { SessionSummary, Measurement, UserProfile, Zone, BuildingElement } from '@/lib/types';

type ZoneWithCount    = Zone & { building_elements: { count: number }[] };
type ElementWithOpenings = BuildingElement & { openings: { count: number }[] };

interface Props {
  params: { id: string };
  searchParams: { anomalies?: string };
}

export default async function SessionDetailPage({ params, searchParams }: Props) {
  const supabase = await createClient();
  const anomaliesOnly = searchParams.anomalies === '1';

  const [sessionResult, measurementsResult, profileResult] = await Promise.all([
    supabase.from('session_summary').select('*').eq('id', params.id).single(),
    anomaliesOnly
      ? supabase.from('measurements').select('*').eq('session_id', params.id).eq('is_anomaly', true).order('measured_at', { ascending: false }).limit(200)
      : supabase.from('measurements').select('*').eq('session_id', params.id).order('measured_at', { ascending: false }).limit(200),
    supabase.from('user_profiles').select('role').single(),
  ]);

  const session = (sessionResult as unknown as { data: SessionSummary | null }).data;
  const measurements = (measurementsResult as unknown as { data: Measurement[] | null }).data ?? [];
  const profile = (profileResult as unknown as { data: Pick<UserProfile, 'role'> | null }).data;

  if (!session) notFound();

  // Fetch zones for the session's building, then elements for those zones
  const zonesResult = await supabase
    .from('zones')
    .select('*, building_elements(count)')
    .eq('building_id', session.building_id)
    .order('floor_level') as unknown as { data: ZoneWithCount[] | null };

  const zones = zonesResult.data ?? [];
  const zoneIds = zones.map(z => z.id);

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

  const canClose = (profile?.role === 'admin' || profile?.role === 'supervisor') && session.status === 'active';

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/sessions" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Sessions
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">{session.session_code}</h1>
              <SessionStatusBadge status={session.status} />
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              <Link href={`/buildings/${session.building_id}`} className="hover:text-indigo-600 hover:underline">
                {session.building_address}, {session.building_city}
              </Link>
              {' · '}{session.inspector_name}
            </p>
          </div>
          {canClose && <CloseSessionButton sessionId={params.id} />}
        </div>
      </div>

      {session.anomaly_count > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <TriangleAlert className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{session.anomaly_count} anomalous measurement{session.anomaly_count > 1 ? 's' : ''}</span> detected in this session.
          </p>
          <Link
            href={`/sessions/${params.id}?anomalies=1`}
            className="ml-auto text-xs text-amber-700 underline underline-offset-2 shrink-0"
          >
            Filter anomalies
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Started', value: new Date(session.started_at).toLocaleDateString('en-GB') },
          { label: 'Completed', value: session.completed_at ? new Date(session.completed_at).toLocaleDateString('en-GB') : '—' },
          { label: 'Measurements', value: session.total_measurements },
          { label: 'Anomalies', value: session.anomaly_count },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Measurement chart</h2>
          <div className="flex gap-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-500 inline-block rounded" /> value_mm</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> anomaly</span>
          </div>
        </div>
        <MeasurementChart measurements={measurements} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <LiveFeed sessionId={params.id} initialMeasurements={measurements.slice(0, 20)} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">Measurements table</h2>
            <div className="flex gap-2">
              {anomaliesOnly ? (
                <Link href={`/sessions/${params.id}`} className="text-xs text-gray-500 hover:text-gray-800 underline">Show all</Link>
              ) : (
                <Link href={`/sessions/${params.id}?anomalies=1`} className="text-xs text-amber-600 hover:underline">Anomalies only</Link>
              )}
            </div>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {measurements.map(m => (
                  <tr key={m.id} className={m.is_anomaly ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-2 font-mono font-medium text-gray-900">{Math.round(m.value_mm)} mm</td>
                    <td className="px-4 py-2 text-gray-500 capitalize">{m.measurement_type ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-400">{new Date(m.measured_at).toLocaleTimeString('en-GB')}</td>
                    <td className="px-4 py-2">
                      {m.is_anomaly && <span className="text-amber-600 font-medium">⚠</span>}
                    </td>
                  </tr>
                ))}
                {!measurements.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No measurements</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Zones & elements */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Zones &amp; elements</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {zones.map(zone => {
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
                              el.width_mm  ? `${el.width_mm}mm`  : null,
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
          {!zones.length && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No zones defined for this building</p>
          )}
        </div>
      </div>
    </div>
  );
}
