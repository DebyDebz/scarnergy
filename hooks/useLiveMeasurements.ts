import { useEffect, useRef, useState } from "react";
import { supabase, Measurement } from "../lib/supabase";

export function useLiveMeasurements(sessionId: string | null) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }

    supabase
      .from("measurements")
      .select("id, measured_at, value_mm, unit, is_anomaly, measurement_type")
      .eq("session_id", sessionId)
      .eq("is_deleted", false)
      .order("measured_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setMeasurements((data ?? []) as Measurement[]);
        setLoading(false);
      });

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
          setMeasurements(prev => [payload.new as Measurement, ...prev]);
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [sessionId]);

  return { measurements, loading };
}
