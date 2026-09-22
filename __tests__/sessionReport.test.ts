import { buildSessionReportHtml, esc } from "../lib/sessionReport";

const session: any = {
  id: "s1", session_code: "SES-001", status: "active", started_at: "2026-09-22T09:00:00Z",
  building_address: "Kerkstraat 1", building_city: "Amsterdam", inspector_name: "A. Inspector",
};
const zones: any[] = [
  { id: "z1", name: "Ground floor", floor_level: 0, ceiling_height_m: 2.6 },
  { id: "z2", name: "First floor", floor_level: 1, ceiling_height_m: null },
];
const elements: any[] = [
  { id: "e1", zone_id: "z1", element_type: "gevel", name: "Front <wall>", length_mm: 4200, height_mm: 2600, width_mm: null, description: "Buitenlucht", is_complete: true },
  { id: "e2", zone_id: "z1", element_type: "transparant_deel", name: "Window 1", width_mm: 1200, height_mm: 900, is_complete: false },
  { id: "e3", zone_id: "z2", element_type: "installatie", name: "Heating", installation_type: "Verwarming", brand: "Intergas", model_nr: "HRE", fuel_type: "Gas", capacity_kw: 28, efficiency: 0.93, year_installed: 2015, description: "Attic", is_complete: true },
];
const openings: any[] = [
  { id: "o1", element_id: "e2", opening_type: "window", width_mm: 1200, height_mm: 900, glazing_type: "HR++", frame_type: "Hout" },
];

test("report carries header, zones, elements, openings, installations and completeness", () => {
  const html = buildSessionReportHtml({ session, zones, elements, openings, orgName: "Krontiva", generatedAt: new Date("2026-09-22T10:00:00Z") });
  expect(html).toContain("Kerkstraat 1, Amsterdam");
  expect(html).toContain("SES-001");
  expect(html).toContain("Ground floor");
  expect(html).toContain("height 2.60 m");
  expect(html).toContain("2 / 3 elements complete");
  expect(html).toContain("Front &lt;wall&gt;");           // escaped
  expect(html).not.toContain("Front <wall>");
  expect(html).toContain("<td>window</td>");
  expect(html).toContain("1.08");                         // 1.2 × 0.9 m²
  expect(html).toContain("Intergas HRE");
  expect(html).toContain("not an energy label");
});

test("installations are listed under Installations, not inside their zone table", () => {
  const html = buildSessionReportHtml({ session, zones, elements, openings });
  const firstFloor = html.indexOf("First floor");
  const installHeading = html.indexOf("<h2>Installations</h2>");
  expect(html.slice(firstFloor, installHeading)).toContain("No elements.");
  expect(html.slice(installHeading)).toContain("Verwarming");
});

test("esc neutralises markup", () => {
  expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});
