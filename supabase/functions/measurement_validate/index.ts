import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MeasurementPayload {
  id: string;
  value_mm: number;
  element_id?: string;
  session_id: string;
  measurement_type?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const aiServerUrl = Deno.env.get("AI_SERVER_URL") ?? "http://ai_server:8001";
    const { measurements }: { measurements: MeasurementPayload[] } = await req.json();

    if (!measurements?.length) {
      return new Response(JSON.stringify({ error: "measurements array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call the AI server batch validation endpoint
    let aiResults: any[] = [];
    try {
      const aiResponse = await fetch(`${aiServerUrl}/validate-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ measurements }),
      });
      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        aiResults = aiData.results ?? [];
      }
    } catch (_) {
      // AI server unavailable — apply rule-based validation only
      console.warn("AI server unreachable, falling back to rule-based validation");
    }

    // Apply rule-based cross-validation per element type
    const updates = measurements.map((m, i) => {
      const ai = aiResults[i] ?? {};
      const ruleResult = validateByRules(m);
      return {
        id: m.id,
        validation_result: ai.is_anomaly || ruleResult.is_anomaly ? "anomaly" : "pass",
        validation_message: ruleResult.message ?? ai.message ?? null,
        anomaly_score: ai.anomaly_score ?? null,
        classifier_label: ai.classifier_label ?? m.measurement_type ?? null,
        validated_at: new Date().toISOString(),
      };
    });

    // Bulk update measurements
    for (const update of updates) {
      await supabase
        .from("measurements")
        .update({
          validation_result: update.validation_result,
          validation_message: update.validation_message,
          anomaly_score: update.anomaly_score,
          classifier_label: update.classifier_label,
          validated_at: update.validated_at,
        })
        .eq("id", update.id);
    }

    const anomalyCount = updates.filter(u => u.validation_result === "anomaly").length;

    return new Response(
      JSON.stringify({
        processed: updates.length,
        anomalies: anomalyCount,
        pass: updates.length - anomalyCount,
        results: updates,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function validateByRules(m: MeasurementPayload): { is_anomaly: boolean; message?: string } {
  const v = m.value_mm;
  if (v <= 0) return { is_anomaly: true, message: "Non-positive measurement value" };
  if (v > 50000) return { is_anomaly: true, message: "Value exceeds 50m — likely error" };

  const type = m.measurement_type;
  if (type === "wall_height" && (v < 1800 || v > 5000))
    return { is_anomaly: true, message: `Wall height ${v}mm outside 1800–5000mm range` };
  if (type === "wall_width" && (v < 100 || v > 20000))
    return { is_anomaly: true, message: `Wall width ${v}mm outside 100–20000mm range` };
  if (type === "opening_height" && (v < 500 || v > 3000))
    return { is_anomaly: true, message: `Opening height ${v}mm outside 500–3000mm range` };

  return { is_anomaly: false };
}
