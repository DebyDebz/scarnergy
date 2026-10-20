// Guided walkthrough for the Demostraat 1 demo house (seeded 2026-10-15, every
// row tagged metadata.demo). It only offers itself on inspections carrying that
// tag, so real inspections never see it. Element and floor names below must
// match the seeded rows — Next / Back open each step's screen by looking them up by name.

export type DemoTourTarget =
  | { kind: "session"; zone?: string }   // the inspection screen, optionally on one floor
  | { kind: "flow" }                     // the setup wizard (floor plan, zones, scale, placing elements)
  | { kind: "facade" }                   // the building's facade photos
  | { kind: "element"; name: string };   // one element's inspect screen

/**
 * Things the from-scratch guide can see the user has actually done, checked
 * against the database (lib/demoTourChecks.ts). When the current step's check
 * passes, the guide moves on by itself.
 */
export type DemoTourCheck =
  | "facade_entrance" | "floor_plan" | "elements_placed"
  | "wall_measured" | "window_measured" | "closeup_photo" | "installation";

export interface DemoTourStep {
  id: string;
  title: string;
  body: string;
  see: string;
  target: DemoTourTarget;
  /** From-scratch guide only: advance automatically once this is done. */
  doneWhen?: DemoTourCheck;
}

/** "house" tours the seeded Demostraat 1; "scratch" guides a real inspection of the bare Demostraat 2. */
export type DemoTourKind = "house" | "scratch";

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

// From scratch on the bare Demostraat 2: the user does every task for real and
// the guide moves on when it sees the result. Order follows Nils's route:
// proof of visit outside first, then the plan, then measuring room by room.
export const SCRATCH_TOUR_STEPS: DemoTourStep[] = [
  {
    id: "scratch-facade",
    title: "Proof of visit first",
    body: "Photograph the front of the house, then the entrance with the house number visible.",
    see: "Five photo slots. As soon as the entrance photo is saved, the guide moves on by itself.",
    target: { kind: "facade" },
    doneWhen: "facade_entrance",
  },
  {
    id: "scratch-plan",
    title: "Draw the floor plan",
    body: "Back in the setup, photograph an existing floor plan or draw the outline by hand, then save it.",
    see: "The outline of the floor. Once it's saved, the guide moves on.",
    target: { kind: "flow" },
    doneWhen: "floor_plan",
  },
  {
    id: "scratch-place",
    title: "Place walls, windows and installations",
    body: "Name the floor and set the scale. Then drag walls, windows and the boiler onto the plan and save.",
    see: "You land on the inspection, with everything you placed listed.",
    target: { kind: "flow" },
    doneWhen: "elements_placed",
  },
  {
    id: "scratch-wall",
    title: "Measure a wall with the laser",
    body: "Connect the laser. Open a wall, press the trigger for the length, then for the height, and save.",
    see: "Each reading jumps to the next field by itself. The wall turns complete.",
    target: { kind: "session" },
    doneWhen: "wall_measured",
  },
  {
    id: "scratch-window",
    title: "Measure a window",
    body: "Open a window, measure its width and height, and save.",
    see: "The window's size on its card in the list.",
    target: { kind: "session" },
    doneWhen: "window_measured",
  },
  {
    id: "scratch-photo",
    title: "Photograph the window",
    body: "On the window, tap + under Photos. Take a situational shot, then a close-up of the glass.",
    see: "The close-up gets a tag on its thumbnail.",
    target: { kind: "session" },
    doneWhen: "closeup_photo",
  },
  {
    id: "scratch-installation",
    title: "Record the boiler",
    body: "Open the installation you placed, or tap + Add installation. Choose its type, fill in brand and model, and save.",
    see: "The installation shows as complete.",
    target: { kind: "session" },
    doneWhen: "installation",
  },
  {
    id: "scratch-report",
    title: "Create the report",
    body: "Scroll to the bottom of the inspection and tap PDF report.",
    see: "A PDF with everything you just captured.",
    target: { kind: "session" },
  },
];

export const DEMO_TOURS: Record<DemoTourKind, DemoTourStep[]> = {
  house: DEMO_TOUR_STEPS,
  scratch: SCRATCH_TOUR_STEPS,
};

export function clampTourStep(step: number, steps: DemoTourStep[] = DEMO_TOUR_STEPS): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(Math.max(Math.trunc(step), 0), steps.length - 1);
}

/** True for inspections created for a demo (metadata.demo is a non-empty string). */
export function isDemoSession(metadata: unknown): boolean {
  const demo = (metadata as { demo?: unknown } | null | undefined)?.demo;
  return typeof demo === "string" && demo.length > 0;
}

/** Which tour an inspection gets: null for real inspections. */
export function demoTourKind(metadata: unknown): DemoTourKind | null {
  if (!isDemoSession(metadata)) return null;
  return (metadata as { tour?: unknown }).tour === "scratch" ? "scratch" : "house";
}

/** True for the bare demo address, where starting an inspection starts the guided setup. */
export function isBlankDemoBuilding(metadata: unknown): boolean {
  return isDemoSession(metadata) && (metadata as { blank?: unknown }).blank === true;
}

/**
 * How long auto-play stays on a step: a base for the screen to load plus
 * reading time for the title and "you should see" text, kept between 7 s and 15 s.
 * The 16 steps play in roughly three minutes.
 */
export function autoplayDwellMs(step: number): number {
  const s = DEMO_TOUR_STEPS[clampTourStep(step)];
  const chars = s.title.length + s.see.length;
  return Math.min(15000, Math.max(7000, 5000 + chars * 45));
}
