import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { SessionStatusBadge } from '@/components/sessions/SessionStatusBadge';
import { LiveFeed } from '@/components/sessions/LiveFeed';
import { MeasurementChart } from '@/components/charts/MeasurementChart';
import { CloseSessionButton } from '@/components/sessions/CloseSessionButton';
import { ExportButtons } from '@/components/sessions/ExportButtons';
import { ElementsWithEdit } from '@/components/elements/ElementsWithEdit';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import type { SessionSummary, Measurement, UserProfile, Zone, BuildingElement, Opening, EnergyLabelSnapshot } from '@/lib/types';
import { fmtDate, fmtTime, fmtDuration } from '@/lib/format';
import { gevelpositie, toCardinal } from '@scarnergy/opname-calc';

interface Props {
  params: { id: string };
  searchParams: { anomalies?: string };
}

export default async function SessionDetailPage({ params, searchParams }: Props) {
  const supabase = await createClient();
  const anomaliesOnly = searchParams.anomalies === '1';

  const { data: { user } } = await supabase.auth.getUser();

  const [sessionResult, measurementsResult, profileResult, labelSnapshotResult] = await Promise.all([
    supabase.from('session_summary').select('*').eq('id', params.id).maybeSingle(),
    anomaliesOnly
      ? supabase.from('measurements').select('*').eq('session_id', params.id).eq('is_anomaly', true).order('measured_at', { ascending: false }).limit(200)
      : supabase.from('measurements').select('*').eq('session_id', params.id).order('measured_at', { ascending: false }).limit(200),
    user
      ? supabase.from('user_profiles').select('role').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    (supabase.from('energy_label_snapshots') as any)
      .select('*').eq('session_id', params.id).maybeSingle(),
  ]);

  const session = (sessionResult as unknown as { data: SessionSummary | null }).data;
  const measurements = (measurementsResult as unknown as { data: Measurement[] | null }).data ?? [];
  const profile = (profileResult as unknown as { data: Pick<UserProfile, 'role'> | null }).data;
  const labelSnapshot = (labelSnapshotResult as unknown as { data: EnergyLabelSnapshot | null }).data;

  if (!session) notFound();

  // Fetch zones, elements, and openings for the session's building
  const zonesResult = await (supabase.from('zones') as any)
    .select('*')
    .eq('building_id', session.building_id)
    .order('floor_level') as unknown as { data: Zone[] | null };

  const zones = zonesResult.data ?? [];
  const zoneIds = zones.map((z: Zone) => z.id);

  let elements: BuildingElement[] = [];
  let openings: Opening[] = [];

  if (zoneIds.length > 0) {
    const [elemRes, openRes] = await Promise.all([
      (supabase.from('building_elements') as any)
        .select('*').in('zone_id', zoneIds).order('sort_order') as unknown as { data: BuildingElement[] | null },
      (supabase.from('openings') as any)
        .select('*').eq('is_active', true) as unknown as { data: Opening[] | null },
    ]);
    elements = elemRes.data ?? [];
    const elementIds = new Set(elements.map(e => e.id));
    openings = (openRes.data ?? []).filter(o => elementIds.has((o as any).element_id));
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

  const canClose = (profile?.role === 'admin' || profile?.role === 'supervisor') && session.status === 'active';

  // Voorgevel orientation: the front-facade gevel's orientation as a cardinal,
  // derived the same way the VABI export does (gevelpositie + toCardinal).
  const voorgevel = elements.find(
    e => e.element_type === 'gevel' && gevelpositie(e) === 'Voorgevel' && e.orientation_deg != null,
  );
  const voorgevelOrientatie = voorgevel ? toCardinal(voorgevel.orientation_deg) : '—';

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
          <div className="flex items-center gap-2 shrink-0">
            <ExportButtons sessionId={params.id} sessionCode={session.session_code} />
            {canClose && <CloseSessionButton sessionId={params.id} buildingId={session.building_id} />}
          </div>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Started', value: fmtDate(session.started_at) },
          { label: 'Completed', value: fmtDate(session.completed_at) },
          // AppSheet header parity (GAP.md W1): Duur + Voorgevel Orientatie
          { label: 'Duur', en: 'Duration', value: fmtDuration(session.started_at, session.completed_at) },
          { label: 'Voorgevel Orientatie', en: 'Front facade', value: voorgevelOrientatie },
          { label: 'Measurements', value: session.total_measurements },
          { label: 'Anomalies', value: session.anomaly_count },
          { label: 'Predicted label', value: <EnergyLabelBadge label={labelSnapshot?.energy_label ?? null} /> },
        ].map(({ label, en, value }: { label: string; en?: string; value: React.ReactNode }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">
              {label}{en && <span className="text-gray-400"> · {en}</span>}
            </p>
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
                    <td className="px-4 py-2 text-gray-400">{fmtTime(m.measured_at)}</td>
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
        <ElementsWithEdit zones={zonesWithElements} />
      </div>
    </div>
  );
}
