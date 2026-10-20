// Guided walkthrough for the Demostraat 1 demo house (seeded 2026-10-15, every
// row tagged metadata.demo). It only offers itself on inspections carrying that
// tag, so real inspections never see it. Element and floor names below must
// match the seeded rows — Next / Back open each step's screen by looking them up by name.

export type DemoTourTarget =
  | { kind: "session"; zone?: string }   // the inspection screen, optionally on one floor
  | { kind: "facade" }                   // the building's facade photos
  | { kind: "element"; name: string };   // one element's inspect screen

export interface DemoTourStep {
  id: string;
  title: string;
  body: string;
  see: string;
  target: DemoTourTarget;
}

export const DEMO_TOUR_STEPS: DemoTourStep[] = [
  {
    id: "start",
    title: "Start from the building",
    body: "This inspection was opened from the address, the way you arrive on site. Tap Try it to use the screen; tap the bar at the bottom to see these instructions again. Next takes you to each screen.",
    see: "Demostraat 1 as the title, with the inspection number and date underneath.",
    target: { kind: "session" },
  },
  {
    id: "entrance",
    title: "Proof of visit: the entrance",
    body: "Facade photos have a fifth slot for the entrance with the house number.",
    see: "Five slots, the last one \"Entrance + house no.\". The full photo is kept, no crop step.",
    target: { kind: "facade" },
  },
  {
    id: "roof",
    title: "Roof length from inside the attic",
    body: "Angle and ridge height are filled in. The length is not, as if you couldn't measure across.",
    see: "Under Length: \"From ridge height + angle ≈ 3.96 m — tap to use\".",
    target: { kind: "element", name: "Dakvlak voor" },
  },
  {
    id: "boiler",
    title: "Installations open details-first",
    body: "No laser fields for a boiler. The installation details open straight away.",
    see: "Intergas HRE 36/30, gas, CW5, 30 kW, efficiency 0.93, from 2016, in the attic.",
    target: { kind: "element", name: "CV-ketel" },
  },
  {
    id: "add-installation",
    title: "Add an installation anywhere",
    body: "Installations turn up in surprising places. Tap \"+ Add installation\" to record one without placing it on the plan.",
    see: "A new installation in the list, named after the type you pick.",
    target: { kind: "session", zone: "Zolder" },
  },
  {
    id: "plan",
    title: "A cleaner floor plan",
    body: "Windows and doors belong to a wall, so the plan shows walls, roofs, floors and installations.",
    see: "A \"Show 2 windows/doors on the plan\" link above the plan.",
    target: { kind: "session", zone: "Eerste verdieping" },
  },
  {
    id: "calc-zone",
    title: "A room in its own calculation zone",
    body: "This bedroom has air conditioning, so its wall sits in a separate calculation zone.",
    see: "\"Calc zone: Slaapkamer met airco (overridden)\" under the title.",
    target: { kind: "element", name: "Achtergevel 1e (slaapkamer airco)" },
  },
  {
    id: "move-wall",
    title: "Move a wall instead of re-entering it",
    body: "Tap the Calc zone line, pick Slaapkamer met airco and save. Then open it again and move it back to Woning.",
    see: "A purple calculation-zone label on the wall's card, then gone again.",
    target: { kind: "element", name: "Voorgevel 1e" },
  },
  {
    id: "photo-roles",
    title: "Situational shot or close-up",
    body: "Tap + under Photos.",
    see: "The app asks what the photo is. A close-up gets a tag on its thumbnail.",
    target: { kind: "element", name: "Raam slaapkamer voor" },
  },
  {
    id: "laser",
    title: "Measure hands-free with the laser",
    body: "Press the laser trigger for the length.",
    see: "\"✓ Captured — next: Height\". The next press goes straight into Height.",
    target: { kind: "element", name: "Rechtergevel BG (buren)" },
  },
  {
    id: "thickness",
    title: "Thickness only for shared walls",
    body: "The last wall borders the neighbours, so it asked for thickness. This one faces outside air.",
    see: "No thickness field.",
    target: { kind: "element", name: "Voorgevel BG" },
  },
  {
    id: "auto-height",
    title: "Floor height reused",
    body: "Measure only the length, then save.",
    see: "Height is already 2.600, \"From floor height 2.60 m\".",
    target: { kind: "element", name: "Achtergevel BG" },
  },
  {
    id: "door",
    title: "The 65% rule",
    body: "Show the details and enter a glass panel of 600 × 1500 mm. Then try 800 × 1900 mm.",
    see: "46%: saved as a door plus a window. 78%: saved as a window.",
    target: { kind: "element", name: "Voordeur met glas" },
  },
  {
    id: "floor",
    title: "Perimeter and crawl space",
    body: "Show the details, then add a photo.",
    see: "Perimeter filled from the walls on outside air. The photo menu offers \"Crawl space\".",
    target: { kind: "element", name: "Vloer BG" },
  },
  {
    id: "scan",
    title: "Scan a room",
    body: "Tap 📡 Scan next to the floor name. LiDAR on Pro devices, camera measure on others.",
    see: "A review list of what was found. Remeasure confirms a size with two laser presses.",
    target: { kind: "session", zone: "Begane grond" },
  },
  {
    id: "export",
    title: "Export",
    body: "Scroll to the bottom for Export XML and PDF report.",
    see: "The airco wall exported in its own calculation zone, and a PDF of the whole house.",
    target: { kind: "session" },
  },
];

export function clampTourStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(Math.max(Math.trunc(step), 0), DEMO_TOUR_STEPS.length - 1);
}

/** True for inspections created for a demo (metadata.demo is a non-empty string). */
export function isDemoSession(metadata: unknown): boolean {
  const demo = (metadata as { demo?: unknown } | null | undefined)?.demo;
  return typeof demo === "string" && demo.length > 0;
}
