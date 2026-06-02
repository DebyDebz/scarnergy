import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Validate any unvalidated measurements for this session
    const { data: unvalidated } = await supabase
      .from("measurements")
      .select("id, value_mm, measurement_type, element_id, session_id")
      .eq("session_id", session_id)
      .is("validation_result", null)
      .eq("is_deleted", false);

    if (unvalidated && unvalidated.length > 0) {
      // Trigger batch validation
      const validateUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/measurement_validate`;
      await fetch(validateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ measurements: unvalidated }),
      });
    }

    // 2. Compute energy labels for all zones in the building
    const { data: session } = await supabase
      .from("inspection_sessions")
      .select("building_id")
      .eq("id", session_id)
      .single();

    if (session?.building_id) {
      const energyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/energy_label_estimate`;
      await fetch(energyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ building_id: session.building_id }),
      });
    }

    // 3. Close the session using the SQL function
    const { data: closedSession, error } = await supabase
      .rpc("close_inspection_session", { p_session_id: session_id });

    if (error) throw error;

    // 4. Write audit log entry
    await supabase.from("audit_log").insert({
      action: "session.closed",
      table_name: "inspection_sessions",
      record_id: session_id,
      new_values: { status: "completed", session_id },
    });

    return new Response(
      JSON.stringify({ success: true, session: closedSession }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
