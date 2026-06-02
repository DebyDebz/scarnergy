'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Building2, ChevronDown, ChevronRight } from 'lucide-react';
import { getOrgMeasurements } from '@/app/(dashboard)/dashboard/actions';
import type { RecentMeasurement } from '@/lib/types';

type OrgWithStats = {
  id: string;
  name: string;
  city: string;
  buildings: { count: number }[];
  inspection_sessions: { count: number }[];
};

export function RecentOrgsPanel({ orgs }: { orgs: OrgWithStats[] }) {
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<RecentMeasurement[]>([]);
  const [isPending, startTransition] = useTransition();

  function handleOrgClick(orgId: string) {
    if (expandedOrgId === orgId) {
      setExpandedOrgId(null);
      setMeasurements([]);
      return;
    }
    setExpandedOrgId(orgId);
    setMeasurements([]);
    startTransition(async () => {
      const data = await getOrgMeasurements(orgId);
      setMeasurements(data);
    });
  }

  if (!orgs.length) {
    return <p className="px-5 py-6 text-sm text-gray-400 text-center">No organizations yet</p>;
  }

  return (
    <div className="divide-y divide-gray-50">
      {orgs.map(org => {
        const buildingCount = org.buildings?.[0]?.count ?? 0;
        const sessionCount = org.inspection_sessions?.[0]?.count ?? 0;
        const isExpanded = expandedOrgId === org.id;

        return (
          <div key={org.id}>
            <button
              onClick={() => handleOrgClick(org.id)}
              className="w-full flex items-center gap-4 px-5 py-3 text-sm hover:bg-gray-50 transition-colors group text-left cursor-pointer"
            >
              <div className="bg-indigo-100 rounded-lg p-1.5 shrink-0">
                <Building2 className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 group-hover:text-indigo-600 truncate">{org.name}</p>
                <p className="text-xs text-gray-500">{org.city}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                <span><span className="font-semibold text-gray-700">{buildingCount}</span> buildings</span>
                <span><span className="font-semibold text-gray-700">{sessionCount}</span> sessions</span>
              </div>
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              }
            </button>

            {isExpanded && (
              <div className="bg-gray-50 border-t border-gray-100">
                {isPending ? (
                  <p className="px-8 py-4 text-sm text-gray-400">Loading measurements…</p>
                ) : measurements.length === 0 ? (
                  <p className="px-8 py-4 text-sm text-gray-400">No measurements for this organization</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {measurements.map(m => (
                      <div
                        key={m.id}
                        className={`flex items-center gap-4 px-8 py-2.5 text-sm ${m.is_anomaly ? 'bg-amber-50' : ''}`}
                      >
                        <span className={`font-mono font-bold text-sm shrink-0 ${m.is_anomaly ? 'text-amber-700' : 'text-gray-900'}`}>
                          {Math.round(m.value_mm)} mm
                        </span>
                        <span className="text-xs text-gray-400 capitalize shrink-0">{m.measurement_type ?? '—'}</span>
                        <span className="text-xs text-gray-500 truncate">{m.building_address}</span>
                        <Link
                          href={`/sessions/${m.session_id}`}
                          className="ml-auto text-xs text-indigo-500 hover:underline shrink-0 font-mono"
                          onClick={e => e.stopPropagation()}
                        >
                          session →
                        </Link>
                        {m.is_anomaly && (
                          <span className="text-xs bg-amber-100 text-amber-600 rounded px-1.5 py-0.5 font-medium shrink-0">ANOMALY</span>
                        )}
                        <span className="text-xs text-gray-400 shrink-0">
                          {new Date(m.measured_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
