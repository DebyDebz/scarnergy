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

    const { zone_id, building_id } = await req.json();

    if (!zone_id && !building_id) {
      return new Response(JSON.stringify({ error: "zone_id or building_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get zone IDs to process
    let zoneIds: string[] = [];
    if (zone_id) {
      zoneIds = [zone_id];
    } else {
      const { data: zones } = await supabase
        .from("zones")
        .select("id")
        .eq("building_id", building_id);
      zoneIds = zones?.map((z: any) => z.id) ?? [];
    }

    const results: Record<string, string> = {};

    for (const zid of zoneIds) {
      // Call the SQL function
      const { data, error } = await supabase.rpc("compute_zone_energy_label", { p_zone_id: zid });
      if (error) throw error;
      results[zid] = data;
    }

    // If building_id provided, also compute building-level label (worst zone)
    let buildingLabel = null;
    if (building_id && zoneIds.length > 0) {
      const labelOrder = ["A++++","A+++","A++","A+","A","B","C","D","E","F","G"];
      const labels = Object.values(results);
      buildingLabel = labels.reduce((worst, label) => {
        return labelOrder.indexOf(label) > labelOrder.indexOf(worst) ? label : worst;
      }, "A++++");
    }

    return new Response(
      JSON.stringify({ zone_labels: results, building_label: buildingLabel, processed: zoneIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
