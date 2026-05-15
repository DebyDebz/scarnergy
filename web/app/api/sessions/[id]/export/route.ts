import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, value: unknown, attrs: Record<string, unknown> = {}): string {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  const content = value != null ? esc(value) : "";
  return `<${name}${attrStr}>${content}</${name}>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Session + building ────────────────────────────────────────────────────
  const { data: session, error: sErr } = await supabase
    .from("session_summary")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sErr || !session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { data: building } = await supabase
    .from("buildings")
    .select("*")
    .eq("id", session.building_id)
    .single();

  // ── Zones + elements + measurements ──────────────────────────────────────
  const { data: zones } = await supabase
    .from("zones")
    .select("*")
    .eq("building_id", session.building_id)
    .order("floor_level", { ascending: true });

  const zoneIds = (zones ?? []).map((z: any) => z.id);

  const { data: elements } = zoneIds.length
    ? await supabase
        .from("building_elements")
        .select("*")
        .in("zone_id", zoneIds)
        .order("name", { ascending: true })
    : { data: [] };

  const elementIds = (elements ?? []).map((e: any) => e.id);

  const { data: measurements } = elementIds.length
    ? await supabase
        .from("measurements")
        .select("*, ble_devices(nickname)")
        .eq("session_id", sessionId)
        .in("element_id", elementIds)
        .eq("is_deleted", false)
        .order("measured_at", { ascending: true })
    : { data: [] };

  // ── Build XML ─────────────────────────────────────────────────────────────
  const msrByElement: Record<string, any[]> = {};
  for (const m of measurements ?? []) {
    (msrByElement[m.element_id] ??= []).push(m);
  }
  const elemByZone: Record<string, any[]> = {};
  for (const e of elements ?? []) {
    (elemByZone[e.zone_id] ??= []).push(e);
  }

  const zonesXml = (zones ?? []).map((z: any) => {
    const zoneElems = elemByZone[z.id] ?? [];
    const elemsXml = zoneElems.map((e: any) => {
      const emsrs = msrByElement[e.id] ?? [];
      const msrsXml = emsrs.map((m: any) => `
        <Measurement>
          ${tag("MeasurementType", m.measurement_type)}
          ${tag("ValueMM", m.value_mm)}
          ${tag("MeasuredAt", m.measured_at)}
          ${tag("Device", m.ble_devices?.nickname ?? "manual")}
          ${tag("IsAnomaly", m.is_anomaly)}
          ${tag("IngestionPath", m.ingestion_path)}
        </Measurement>`).join("");

      return `
      <Element id="${esc(e.id)}" type="${esc(e.element_type)}">
        ${tag("Name", e.name)}
        ${e.length_mm != null ? tag("LengthMM", e.length_mm) : ""}
        ${e.height_mm != null ? tag("HeightMM", e.height_mm) : ""}
        ${e.width_mm  != null ? tag("WidthMM",  e.width_mm)  : ""}
        ${tag("IsComplete", e.is_complete)}
        ${msrsXml ? `<Measurements>${msrsXml}\n      </Measurements>` : "<Measurements/>"}
      </Element>`;
    }).join("");

    return `
    <Zone id="${esc(z.id)}" code="${esc(z.zone_code)}">
      ${tag("Name", z.name)}
      ${tag("FloorLevel", z.floor_level)}
      ${z.gross_area_m2   != null ? tag("GrossAreaM2",   z.gross_area_m2)   : ""}
      ${z.net_area_m2     != null ? tag("NetAreaM2",     z.net_area_m2)     : ""}
      ${z.ceiling_height_m != null ? tag("CeilingHeightM", z.ceiling_height_m) : ""}
      ${tag("IsHeated", z.is_heated)}
      ${z.energy_label ? tag("EnergyLabel", z.energy_label) : ""}
      ${elemsXml ? `<Elements>${elemsXml}\n    </Elements>` : "<Elements/>"}
    </Zone>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ScanergyExport version="1.0" generated_at="${new Date().toISOString()}">
  <Session id="${esc(session.id)}">
    ${tag("SessionCode", session.session_code)}
    ${tag("Status", session.status)}
    ${tag("StartedAt", session.started_at)}
    ${session.completed_at ? tag("CompletedAt", session.completed_at) : ""}
    ${tag("Inspector", session.inspector_name)}
    ${session.notes ? tag("Notes", session.notes) : ""}

    <Summary>
      ${tag("TotalMeasurements", session.total_measurements)}
      ${tag("AnomalyCount", session.anomaly_count)}
      ${session.completion_pct != null ? tag("CompletionPct", session.completion_pct) : ""}
    </Summary>

    <Building id="${esc(building?.id ?? "")}">
      ${building?.reference_code ? tag("ReferenceCode", building.reference_code) : ""}
      ${building?.bag_id         ? tag("BAGId",          building.bag_id)         : ""}
      ${tag("Street",       building?.street)}
      ${tag("HouseNumber",  building?.house_number)}
      ${building?.house_number_addition ? tag("HouseNumberAddition", building.house_number_addition) : ""}
      ${tag("PostalCode",   building?.postal_code)}
      ${tag("City",         building?.city)}
      ${building?.municipality ? tag("Municipality", building.municipality) : ""}
      ${tag("Country",      building?.country ?? "NL")}
      ${tag("BuildingType", building?.building_type)}
      ${building?.construction_year  != null ? tag("ConstructionYear",   building.construction_year)   : ""}
      ${building?.gross_floor_area_m2 != null ? tag("GrossFloorAreaM2",  building.gross_floor_area_m2)  : ""}
      ${building?.compactness_factor  != null ? tag("CompactnessFactor", building.compactness_factor)  : ""}
      ${building?.nta_building_category ? tag("NTABuildingCategory", building.nta_building_category) : ""}
    </Building>

    <Zones>${zonesXml}
    </Zones>
  </Session>
</ScanergyExport>`;

  const filename = `${session.session_code ?? sessionId}.xml`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
