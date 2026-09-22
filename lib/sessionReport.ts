import type { SessionSummary, Zone, BuildingElement, Opening } from "./supabase";
import { elementTypeLabel } from "./elementTypes";

// HTML for the one-tap PDF report (expo-print renders it). Mirrors the web
// print page's sections in a form that fits a phone-generated A4: header,
// zones, elements per zone, openings, installations, completeness. Photos are
// not embedded (they'd need signed URLs fetched and inlined; follow-up).

export interface SessionReportInput {
  session: SessionSummary;
  zones: Zone[];
  elements: BuildingElement[];
  openings: Opening[];
  orgName?: string;
  generatedAt?: Date;
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const mm = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}`);
const m2 = (w: number | null | undefined, h: number | null | undefined) =>
  w != null && h != null ? ((w / 1000) * (h / 1000)).toFixed(2) : "—";

export function buildSessionReportHtml(input: SessionReportInput): string {
  const { session, zones, elements, openings, orgName = "", generatedAt = new Date() } = input;
  const byZone = new Map<string, BuildingElement[]>();
  for (const e of elements) (byZone.get(e.zone_id) ?? byZone.set(e.zone_id, []).get(e.zone_id)!).push(e);
  const elementName = new Map(elements.map(e => [e.id, e.name]));
  const complete = elements.filter(e => e.is_complete).length;
  const installations = elements.filter(e => e.element_type === "installatie");
  const started = session.started_at ? new Date(session.started_at).toLocaleDateString("nl-NL") : "—";

  const zoneSections = zones.map(z => {
    const els = (byZone.get(z.id) ?? []).filter(e => e.element_type !== "installatie");
    const rows = els.map(e => `
      <tr>
        <td>${esc(elementTypeLabel(e.element_type))}</td>
        <td>${esc(e.name)}</td>
        <td class="r">${mm(e.length_mm)}</td>
        <td class="r">${mm(e.height_mm)}</td>
        <td class="r">${mm(e.width_mm)}</td>
        <td>${esc(e.description ?? "")}</td>
        <td class="c">${e.is_complete ? "✓" : ""}</td>
      </tr>`).join("");
    return `
    <h2>${esc(z.name)} <span class="muted">· floor ${esc(z.floor_level)}${z.ceiling_height_m != null ? ` · height ${Number(z.ceiling_height_m).toFixed(2)} m` : ""}</span></h2>
    ${els.length === 0 ? `<p class="muted">No elements.</p>` : `
    <table>
      <thead><tr><th>Type</th><th>Name</th><th class="r">L (mm)</th><th class="r">H (mm)</th><th class="r">W / T (mm)</th><th>Adjacent to</th><th class="c">Done</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}`;
  }).join("");

  const openingRows = openings.map(o => `
      <tr>
        <td>${esc(elementName.get(o.element_id) ?? "")}</td>
        <td>${esc(o.opening_type)}</td>
        <td class="r">${mm(o.width_mm)}</td>
        <td class="r">${mm(o.height_mm)}</td>
        <td class="r">${m2(o.width_mm, o.height_mm)}</td>
        <td>${esc(o.glazing_type ?? "")}</td>
        <td>${esc(o.frame_type ?? "")}</td>
      </tr>`).join("");

  const installRows = installations.map(e => `
      <tr>
        <td>${esc(e.installation_type ?? "")}</td>
        <td>${esc(e.name)}</td>
        <td>${esc([e.brand, e.model_nr].filter(Boolean).join(" "))}</td>
        <td>${esc(e.fuel_type ?? "")}</td>
        <td class="r">${e.capacity_kw ?? "—"}</td>
        <td class="r">${e.efficiency ?? "—"}</td>
        <td class="r">${e.year_installed ?? "—"}</td>
        <td>${esc(e.description ?? "")}</td>
      </tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 10pt; color: #1A1A2E; }
  h1 { font-size: 18pt; margin: 0 0 2pt; color: #1E3A5F; }
  h2 { font-size: 12pt; margin: 16pt 0 6pt; color: #1E3A5F; border-bottom: 1px solid #D5DBE3; padding-bottom: 3pt; }
  .sub { color: #555; margin: 0 0 10pt; }
  .muted { color: #777; font-weight: normal; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
  th, td { border: 1px solid #D5DBE3; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #F0F4F8; font-size: 9pt; }
  td.r, th.r { text-align: right; } td.c, th.c { text-align: center; }
  .kv td { border: none; padding: 1pt 8pt 1pt 0; }
  .foot { margin-top: 14pt; color: #777; font-size: 8pt; }
</style></head><body>
  <h1>Inspection report</h1>
  <p class="sub">${esc(session.building_address)}, ${esc(session.building_city)}</p>
  <table class="kv"><tbody>
    <tr><td>Session</td><td>${esc(session.session_code)}</td></tr>
    <tr><td>Inspector</td><td>${esc(session.inspector_name)}</td></tr>
    <tr><td>Started</td><td>${esc(started)}</td></tr>
    <tr><td>Status</td><td>${esc(session.status)}</td></tr>
    ${orgName ? `<tr><td>Organisation</td><td>${esc(orgName)}</td></tr>` : ""}
    <tr><td>Completeness</td><td>${complete} / ${elements.length} elements complete</td></tr>
  </tbody></table>

  ${zoneSections || `<p class="muted">No zones.</p>`}

  <h2>Windows &amp; doors</h2>
  ${openings.length === 0 ? `<p class="muted">None captured.</p>` : `
  <table>
    <thead><tr><th>Element</th><th>Type</th><th class="r">W (mm)</th><th class="r">H (mm)</th><th class="r">Area (m²)</th><th>Glazing</th><th>Frame</th></tr></thead>
    <tbody>${openingRows}</tbody>
  </table>`}

  <h2>Installations</h2>
  ${installations.length === 0 ? `<p class="muted">None captured.</p>` : `
  <table>
    <thead><tr><th>Type</th><th>Name</th><th>Brand / model</th><th>Fuel</th><th class="r">kW</th><th class="r">η</th><th class="r">Year</th><th>Location</th></tr></thead>
    <tbody>${installRows}</tbody>
  </table>`}

  <p class="foot">Generated ${esc(generatedAt.toLocaleString("nl-NL"))} by Scarnergy. Data-completeness overview — not an energy label.</p>
</body></html>`;
}
