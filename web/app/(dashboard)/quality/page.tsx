import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { TriangleAlert, Ruler, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { RecentMeasurement } from '@/lib/types';

export const revalidate = 60;

export default async function QualityPage() {
  const supabase = await createClient();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: anomalies7d },
    { count: measurements7d },
    recentAnomaliesResult,
  ] = await Promise.all([
    supabase.from('measurements').select('*', { count: 'exact', head: true }).eq('is_anomaly', true).gte('measured_at', sevenDaysAgo),
    supabase.from('measurements').select('*', { count: 'exact', head: true }).gte('measured_at', sevenDaysAgo),
    (supabase.from('recent_measurements') as any).select('*').eq('is_anomaly', true).order('measured_at', { ascending: false }).limit(50),
  ]);

  const recentAnomalies = (recentAnomaliesResult as unknown as { data: RecentMeasurement[] | null }).data ?? [];
  const total = measurements7d ?? 0;
  const anomalies = anomalies7d ?? 0;
  const anomalyRate = total > 0 ? ((anomalies / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quality Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Anomaly analysis — last 7 days</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Anomalies (7d)" value={anomalies} sub="flagged by AI" icon={TriangleAlert} color="amber" />
        <KpiCard label="Measurements (7d)" value={total} sub="total captured" icon={Ruler} color="indigo" />
        <KpiCard label="Anomaly rate" value={`${anomalyRate}%`} sub="of all measurements" icon={ShieldCheck} color="rose" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent anomalies</h2>
          <Link href="/measurements?anomalies_only=1" className="text-sm text-indigo-600 hover:underline">
            View all →
          </Link>
        </div>

        {recentAnomalies.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <p className="font-semibold text-gray-700">No anomalies in the last 7 days</p>
            <p className="text-sm text-gray-400">All measurements are within expected ranges</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-5 py-3 font-medium">Value</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Element</th>
                <th className="px-5 py-3 font-medium">Zone</th>
                <th className="px-5 py-3 font-medium">Building</th>
                <th className="px-5 py-3 font-medium">Session</th>
                <th className="px-5 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentAnomalies.map(m => (
                <tr key={m.id} className="bg-amber-50 hover:bg-amber-100 transition-colors">
                  <td className="px-5 py-3 font-mono font-bold text-amber-800">
                    {Math.round(m.value_mm)} mm
                  </td>
                  <td className="px-5 py-3 text-gray-500 capitalize">{m.measurement_type ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-700">{m.element_name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{m.zone_name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-700">{m.building_address}</td>
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link href={`/sessions/${m.session_id}`} className="text-indigo-600 hover:underline">
                      session →
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap text-xs">
                    {new Date(m.measured_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
