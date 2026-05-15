"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { MeasurementChart } from "./MeasurementChart";
import { BridgeConnector } from "./BridgeConnector";
import type { Measurement } from "@/lib/types";

interface Props {
  sessionId: string;
  initialMeasurements: Measurement[];
  isActive: boolean;
}

export function LiveFeed({ sessionId, initialMeasurements, isActive }: Props) {
  const [measurements, setMeasurements] = useState<Measurement[]>(initialMeasurements);
  const [lastReceived, setLastReceived] = useState<Date | null>(null);

  // Track seen IDs so measurements arriving via both WebSocket and Realtime
  // are deduplicated — whichever path wins, the other is silently dropped.
  const seenIds = useRef(new Set(initialMeasurements.map(m => m.id)));

  function addMeasurement(m: Measurement) {
    if (seenIds.current.has(m.id)) return;
    seenIds.current.add(m.id);
    setMeasurements(prev => [m, ...prev]);
    setLastReceived(new Date());
  }

  // Supabase Realtime — catches measurements from mobile app, bridge, and manual entry
  useEffect(() => {
    if (!isActive) return;

    const supabase = createClient();
    const channel  = supabase
      .channel(`session-live:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "measurements",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => addMeasurement(payload.new as Measurement)
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const anomalyCount = measurements.filter(m => m.is_anomaly).length;

  return (
    <div className="space-y-4">
      {/* Bridge WebSocket connector — appears only on active sessions */}
      {isActive && (
        <div className="space-y-1">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-widest">
            GLM Device (direct)
          </p>
          <BridgeConnector onMeasurement={addMeasurement} />
          <p className="text-xs text-gray-400">
            Run <code className="bg-gray-100 px-1 rounded font-mono">./start-bridge.sh</code> on
            the machine with Bluetooth, then connect here. Measurements arrive via WebSocket
            and are also saved to the database simultaneously.
          </p>
        </div>
      )}

      {/* Live indicator */}
      {isActive && (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-xs font-medium text-green-700">
            Live · {measurements.length} measurement{measurements.length !== 1 ? "s" : ""}
            {lastReceived && ` · last at ${lastReceived.toLocaleTimeString("nl-NL")}`}
          </span>
        </div>
      )}

      {/* Chart */}
      <MeasurementChart measurements={measurements.slice(0, 200)} />

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="text-left py-2 pr-4 font-semibold text-gray-500">Time</th>
              <th className="text-right py-2 pr-4 font-semibold text-gray-500">Value (mm)</th>
              <th className="text-left py-2 pr-4 font-semibold text-gray-500">Path</th>
              <th className="text-left py-2 font-semibold text-gray-500">Flag</th>
            </tr>
          </thead>
          <tbody>
            {measurements.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-gray-300 italic">
                  No measurements yet — pull the GLM trigger or add one manually
                </td>
              </tr>
            )}
            {measurements.slice(0, 100).map(m => (
              <tr
                key={m.id}
                className={`border-b border-gray-50 ${m.is_anomaly ? "bg-orange-50" : "hover:bg-gray-50"}`}
              >
                <td className="py-2 pr-4 text-gray-400 text-xs tabular-nums">
                  {new Date(m.measured_at).toLocaleTimeString("nl-NL")}
                </td>
                <td className="py-2 pr-4 text-right font-mono font-semibold text-gray-800">
                  {Number(m.value_mm).toFixed(1)}
                </td>
                <td className="py-2 pr-4 text-xs text-gray-400">{m.ingestion_path ?? "—"}</td>
                <td className="py-2 text-xs">
                  {m.is_anomaly && (
                    <span className="text-orange-500 font-semibold">⚠ anomaly</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {measurements.length > 100 && (
          <p className="text-xs text-gray-300 text-center pt-2">
            Showing 100 of {measurements.length.toLocaleString()} measurements
          </p>
        )}
      </div>
    </div>
  );
}
