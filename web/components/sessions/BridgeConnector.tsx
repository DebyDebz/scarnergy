"use client";

import { useEffect, useRef, useState } from "react";
import type { Measurement } from "@/lib/types";

// Default to same host the browser is connected to, port 8765
const DEFAULT_WS =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:8765`
    : "ws://localhost:8765";

interface Props {
  onMeasurement: (m: Measurement) => void;
}

export function BridgeConnector({ onMeasurement }: Props) {
  const [url, setUrl]       = useState(DEFAULT_WS);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const wsRef               = useRef<WebSocket | null>(null);

  // Keep onMeasurement stable inside the ws.onmessage handler across re-renders
  const cbRef = useRef(onMeasurement);
  useEffect(() => { cbRef.current = onMeasurement; }, [onMeasurement]);

  function connect() {
    if (wsRef.current) return;
    setStatus("connecting");
    setErrMsg(null);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onerror = () => {
      setErrMsg(`Could not reach ${url}. Is the bridge running on that machine?`);
      setStatus("error");
      wsRef.current = null;
    };

    ws.onclose = () => {
      setStatus("idle");
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const d = JSON.parse(event.data as string);
        // Map bridge payload → Measurement shape
        cbRef.current({
          id:               d.id,
          session_id:       d.session_id    ?? "",
          device_id:        d.device_id     ?? null,
          element_id:       d.element_id    ?? null,
          value_mm:         d.value_mm,
          unit:             d.unit          ?? "mm",
          measurement_type: d.measurement_type ?? null,
          is_anomaly:       d.is_anomaly    ?? false,
          measured_at:      d.measured_at,
          ingestion_path:   d.ingestion_path ?? "python_bridge",
        } as Measurement);
      } catch {
        // ignore non-JSON frames
      }
    };
  }

  function disconnect() {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
  }

  // Cleanup on unmount
  useEffect(() => () => { wsRef.current?.close(); }, []);

  if (status === "connected") {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative h-2 w-2 rounded-full bg-green-500" />
        </span>
        <span className="font-medium text-green-700">GLM bridge connected — {url}</span>
        <button
          onClick={disconnect}
          className="ml-auto px-2 py-0.5 rounded border border-green-300 text-green-600 hover:bg-green-100 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="ws://localhost:8765"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 font-mono
                     focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={connect}
          disabled={status === "connecting"}
          className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-semibold
                     hover:bg-brand-700 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {status === "connecting" ? "Connecting…" : "Connect GLM bridge"}
        </button>
      </div>
      {errMsg && (
        <p className="text-xs text-red-500 pl-1">{errMsg}</p>
      )}
    </div>
  );
}
