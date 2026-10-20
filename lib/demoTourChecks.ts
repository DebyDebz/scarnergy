import { supabase } from "./supabase";
import { DemoTourCheck } from "./demoTour";

// Database checks behind the from-scratch guide. Each answers "has the user
// done this during this demo run?" — only rows created or updated since the
// guide started count (with a two-minute margin for phone/server clock skew),
// so a second demo on the same address doesn't skip steps because of the first.
export async function isStepDone(check: DemoTourCheck, buildingId: string, startedAt: string): Promise<boolean> {
  const since = new Date(new Date(startedAt).getTime() - 2 * 60 * 1000).toISOString();

  const elements = () =>
    supabase
      .from("building_elements")
      .select("id, photo_roles, zones!inner(building_id)")
      .eq("zones.building_id", buildingId)
      .eq("is_active", true);

  switch (check) {
    case "facade_entrance": {
      const { data } = await supabase
        .from("building_facade_photos").select("id")
        .eq("building_id", buildingId).eq("direction", "entree").gte("captured_at", since).limit(1);
      return (data?.length ?? 0) > 0;
    }
    case "floor_plan": {
      const { data } = await supabase
        .from("zones").select("floor_plan_points, floor_plan_image_url")
        .eq("building_id", buildingId).eq("is_active", true).gte("updated_at", since);
      return (data ?? []).some(z =>
        !!z.floor_plan_image_url || (Array.isArray(z.floor_plan_points) && z.floor_plan_points.length >= 3));
    }
    case "wizard_finished":
      // Screen-based; the guide decides this from the current route, not the database.
      return false;
    case "wall_measured": {
      const { data } = await elements().eq("element_type", "gevel")
        .not("length_mm", "is", null).not("height_mm", "is", null).gte("updated_at", since).limit(1);
      return (data?.length ?? 0) > 0;
    }
    case "window_measured": {
      const { data } = await elements().eq("element_type", "transparant_deel")
        .not("width_mm", "is", null).not("height_mm", "is", null).gte("updated_at", since).limit(1);
      return (data?.length ?? 0) > 0;
    }
    case "closeup_photo": {
      const { data } = await elements().gte("updated_at", since);
      return (data ?? []).some(e =>
        Object.values((e.photo_roles as Record<string, string> | null) ?? {}).includes("detail"));
    }
    case "installation": {
      const { data } = await elements().eq("element_type", "installatie")
        .not("installation_type", "is", null).gte("updated_at", since).limit(1);
      return (data?.length ?? 0) > 0;
    }
  }
}
