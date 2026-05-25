import { createServiceClient } from '@/lib/supabase-server';
import { InfraHealthCheck } from '@/components/admin/InfraHealthCheck';
import { Database, Server, BarChart3 } from 'lucide-react';

export const revalidate = 0;

const MIGRATIONS = [
  '000 — Supabase roles bootstrap',
  '001 — Extensions (TimescaleDB, pgcrypto)',
  '002 — Core schema (organisations, user_profiles, ble_devices)',
  '003 — Building hierarchy (buildings, zones, building_elements, openings)',
  '004 — Sessions + measurements hypertable',
  '005 — RLS policies',
  '006 — Auth hooks + Realtime publication',
  '007 — Views + functions (building_summary, session_summary, close_inspection_session)',
  '008 — Seed data',
  '009 — Views update',
  '010 — device_id nullable on measurements',
];

const GRAFANA_URL = process.env.GRAFANA_URL ?? 'http://localhost:3001';

export default async function SystemPage() {
  const supabase = await createServiceClient();

  const [
    { count: totalMeasurements },
    { count: totalSessions },
  ] = await Promise.all([
    supabase.from('measurements').select('*', { count: 'exact', head: true }),
    supabase.from('inspection_sessions').select('*', { count: 'exact', head: true }),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System</h1>
        <p className="text-sm text-gray-500 mt-0.5">Infrastructure status, database state, and analytics</p>
      </div>

      <InfraHealthCheck />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total measurements', value: totalMeasurements?.toLocaleString() ?? '—', icon: Database, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Total sessions', value: totalSessions?.toLocaleString() ?? '—', icon: Server, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Migrations applied', value: MIGRATIONS.length, icon: BarChart3, color: 'text-amber-600 bg-amber-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div className={`rounded-xl p-2.5 ${color}`}><Icon className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Migration history</h2>
        <ul className="space-y-1.5">
          {MIGRATIONS.map((m, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
              <span className="text-gray-700 font-mono text-xs">{m}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Grafana analytics</h2>
          <a
            href={GRAFANA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-600 hover:underline"
          >
            Open full dashboard ↗
          </a>
        </div>
        <div className="p-2">
          <iframe
            src={`${GRAFANA_URL}/d/scarnergy-live/live-measurements?kiosk=1&refresh=5s`}
            className="w-full rounded-lg"
            height={400}
            title="Grafana — Live measurements"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Environment</h2>
        <p className="text-xs text-gray-500 mb-3">Key configuration (public vars only)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL ?? '—'],
            ['AI_SERVER_URL', process.env.AI_SERVER_URL ?? 'http://localhost:8001'],
            ['GRAFANA_URL', GRAFANA_URL],
            ['NODE_ENV', process.env.NODE_ENV ?? '—'],
          ].map(([k, v]) => (
            <div key={k} className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs font-mono font-medium text-gray-500">{k}</p>
              <p className="text-xs font-mono text-gray-900 truncate">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
