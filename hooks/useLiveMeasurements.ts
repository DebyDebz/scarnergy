import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, Measurement } from "../lib/supabase";

// Pure prepend-with-dedupe used by both the realtime INSERT callback and the
// optimistic addMeasurement below: the optimistic add and the Realtime echo of
// the same row must produce exactly one list entry. Exported for the
// BLE → insert → realtime pipeline test.
export function mergeMeasurement(prev: Measurement[], incoming: Measurement): Measurement[] {
  if (prev.some(p => p.id === incoming.id)) return prev;
  return [incoming, ...prev];
}

export function useLiveMeasurements(sessionId: string | null) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }

    const fetchInitial = async () => {
      try {
        const { data, error } = await supabase
          .from("measurements")
          .select("id, measured_at, value_mm, unit, is_anomaly, measurement_type")
          .eq("session_id", sessionId)
          .eq("is_deleted", false)
          .order("measured_at", { ascending: false })
          .limit(100);
        if (error) console.warn("[Measurements] initial load error:", error.message);
        setMeasurements((data ?? []) as Measurement[]);
      } catch (e) {
        console.warn("[Measurements] fetch failed:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchInitial();

    const channel = supabase
      .channel(`session-live:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "measurements",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          // Deduplicate: optimistic add may have already inserted this id
          setMeasurements(prev => mergeMeasurement(prev, payload.new as Measurement));
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [sessionId]);

  // Optimistic insert — shows the row immediately without waiting for Realtime
  const addMeasurement = useCallback((m: Measurement) => {
    setMeasurements(prev => mergeMeasurement(prev, m));
  }, []);

  return { measurements, loading, addMeasurement };
}
