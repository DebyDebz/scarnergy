'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import type { Measurement } from '@/lib/types';
import { Wifi } from 'lucide-react';

interface Props {
  sessionId: string;
  initialMeasurements: Measurement[];
}

export function LiveFeed({ sessionId, initialMeasurements }: Props) {
  const [measurements, setMeasurements] = useState<Measurement[]>(initialMeasurements);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`session-live:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'measurements',
          filter: `session_id=eq.${sessionId}`,
        },
        payload => {
          setMeasurements(prev => [payload.new as Measurement, ...prev.slice(0, 199)]);
        }
      )
      .subscribe(status => setConnected(status === 'SUBSCRIBED'));

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold text-gray-900 text-sm">Live measurements</h3>
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          <Wifi className="w-3 h-3" />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {measurements.slice(0, 50).map(m => (
          <div
            key={m.id}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${m.is_anomaly ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}
          >
            <span className={`font-mono font-bold ${m.is_anomaly ? 'text-amber-700' : 'text-gray-900'}`}>
              {Math.round(m.value_mm)} mm
            </span>
            {m.measurement_type && (
              <span className="text-xs text-gray-400 capitalize">{m.measurement_type}</span>
            )}
            {m.is_anomaly && (
              <span className="ml-auto text-xs bg-amber-100 text-amber-600 rounded px-1.5 py-0.5 font-medium">
                ANOMALY
              </span>
            )}
            <span className="ml-auto text-xs text-gray-400">
              {new Date(m.measured_at).toLocaleTimeString('en-GB')}
            </span>
          </div>
        ))}
        {!measurements.length && (
          <p className="text-sm text-gray-400 text-center py-4">No measurements yet</p>
        )}
      </div>
    </div>
  );
}
