'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

interface Service {
  name: string;
  url: string;
  label: string;
}

const SERVICES: Service[] = [
  { name: 'kong', label: 'API Gateway (Kong)', url: '/api/health/kong' },
  { name: 'auth', label: 'Auth (GoTrue)', url: '/api/health/auth' },
  { name: 'db', label: 'Database (TimescaleDB)', url: '/api/health/db' },
  { name: 'realtime', label: 'Realtime (WebSocket)', url: '/api/health/realtime' },
  { name: 'storage', label: 'Storage API', url: '/api/health/storage' },
  { name: 'ai', label: 'AI Server (FastAPI)', url: '/api/health/ai' },
];

type Status = 'idle' | 'checking' | 'ok' | 'error';

export function InfraHealthCheck() {
  const [statuses, setStatuses] = useState<Record<string, { status: Status; latency?: number; detail?: string }>>({});

  async function checkAll() {
    setStatuses(Object.fromEntries(SERVICES.map(s => [s.name, { status: 'checking' as Status }])));
    await Promise.all(SERVICES.map(async svc => {
      const t0 = Date.now();
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json().catch(() => ({}));
        setStatuses(prev => ({
          ...prev,
          [svc.name]: { status: res.ok ? 'ok' : 'error', latency: Date.now() - t0, detail: data.error ?? undefined },
        }));
      } catch (e: unknown) {
        setStatuses(prev => ({
          ...prev,
          [svc.name]: { status: 'error', detail: e instanceof Error ? e.message : 'timeout' },
        }));
      }
    }));
  }

  useEffect(() => { checkAll(); }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">Infrastructure health</h2>
        <button onClick={checkAll} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
          <RefreshCw className="w-3.5 h-3.5" /> Re-check
        </button>
      </div>
      <div className="space-y-2">
        {SERVICES.map(svc => {
          const s = statuses[svc.name];
          return (
            <div key={svc.name} className="flex items-center gap-3">
              {!s || s.status === 'idle' ? (
                <span className="w-4 h-4 rounded-full bg-gray-200" />
              ) : s.status === 'checking' ? (
                <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
              ) : s.status === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="text-sm text-gray-700 flex-1">{svc.label}</span>
              {s?.latency && (
                <span className="text-xs text-gray-400">{s.latency} ms</span>
              )}
              {s?.detail && (
                <span className="text-xs text-red-500 truncate max-w-xs">{s.detail}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
