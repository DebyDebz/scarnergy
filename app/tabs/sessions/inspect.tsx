import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, Image,
  KeyboardAvoidingView, Platform,
} from "react-native";
let ImagePicker: typeof import("expo-image-picker") | null = null;
try { ImagePicker = require("expo-image-picker"); } catch { ImagePicker = null; }
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase, BuildingElement, Opening, PhotoRole, Rekenzone } from "../../../lib/supabase";
import { uploadImageToStorage } from "../../../lib/uploadImage";
import { syncToAppsheetIfLinked } from "../../../lib/appsheetSync";
import { useBLE } from "../../../lib/BLEContext";
import { useAuthStore } from "../../../store/authStore";
import { GLMMeasurement } from "../../../hooks/useBLEDevice";
import { nextSlotAfterFill } from "../../../hooks/bleDecoder";
import { floorPerimeterM, glassRatio, classifyGlazedDoor, GLAZED_DOOR_WINDOW_RATIO, roofSlopeLengthM } from "@scarnergy/opname-calc";
import { elementTypeLabel } from "../../../lib/elementTypes";
import {
  EMPTY_SWEEP, SweepState, addSweepSample,
  thicknessFromFaces, thicknessFromSweep, isUsableThickness,
} from "@scarnergy/opname-calc";
import { gridLengthMeters } from "../../../lib/floorplanGeometry";
import { parseTapwaterSegments, formatTapwaterSegments } from "../../../lib/tapwater";
import { FieldSelect } from "../../../components/ui/FieldSelect";
import { FieldToggle } from "../../../components/ui/FieldToggle";
import { ResponsiveContainer } from "../../../components/ResponsiveContainer";

// ── Types ─────────────────────────────────────────────────────────────────────

type SlotKey = "length_mm" | "height_mm" | "width_mm";
// `thickness` slots represent a depth/thickness dimension. A laser only returns
// distance-to-surface, so these are captured from TWO readings (front + back →
// |Δ| in point mode, or a min/max sweep in continuous mode) rather than one shot.
type SlotDef = { key: SlotKey; label: string; thickness?: boolean };
type ElementWithZone = BuildingElement & {
  zone_name?: string; zone_scale_m?: number | null; zone_ceiling_m?: number | null; zone_floor_level?: number | null;
  zone_rekenzone_id?: string | null; building_id?: string | null;
};

// ── Slot definitions — keys match the Dutch enum values stored in the DB ──────

const SLOT_MAP: Record<string, SlotDef[]> = {
  // Keys are the Dutch enum values stored in the DB; labels are display-only (English).
  gevel:           [{ key: "length_mm", label: "Width"     }, { key: "height_mm", label: "Height"    }, { key: "width_mm", label: "Thickness", thickness: true }],
  dak:             [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  dakkapel:        [{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }, { key: "length_mm", label: "Depth", thickness: true }],
  vloer:           [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  transparant_deel:[{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }],
  installatie:     [],   // no laser measurements — the inspect screen renders details-first
  // English fallbacks
  wall:    [{ key: "length_mm", label: "Length"    }, { key: "height_mm", label: "Height"    }, { key: "width_mm", label: "Thickness", thickness: true }],
  floor:   [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  ceiling: [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  roof:    [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  window:  [{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }],
  door:    [{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }],
};
const DEFAULT_SLOTS: SlotDef[] = [
  { key: "length_mm", label: "Length"    },
  { key: "height_mm", label: "Height"    },
  { key: "width_mm",  label: "Thickness", thickness: true },
];

// A wall's thickness only matters when it's shared with a neighbouring space
// (party wall). For outside-air / crawl-space walls the inspector shouldn't be
// asked for it (2026-09-22 walkthrough). Both "Aangrenzende …" values of the
// gevel "Adjacent to" field mean a neighbouring space.
const SHARED_WALL_PREFIX = 'Aangrenzende';
function slotsFor(elementType: string, details: Record<string, unknown>): SlotDef[] {
  const base = SLOT_MAP[elementType] ?? DEFAULT_SLOTS;
  if (elementType !== 'gevel') return base;
  const adjacent = String(details.description ?? '');
  return adjacent.startsWith(SHARED_WALL_PREFIX) ? base : base.filter(s => !s.thickness);
}


// ── Qualitative detail fields per element type ────────────────────────────────

type DetailType = 'select' | 'toggle' | 'number' | 'text';
// Options carry a Dutch `value` (stored in the DB / used by the VABI export) and an
// English `label` (shown in the dropdown). Plain strings are still accepted where
// value === label (e.g. codes like CW3, or already-English values).
type DetailOption = string | { value: string; label: string };
type DetailField = {
  key: string;
  label: string;
  type: DetailType;
  options?: DetailOption[];
  dependsOn?: { key: string; value: string | boolean };
  target?: 'element' | 'opening' | 'glass';  // element row, openings row, or the linked door-glass openings row
  advanced?: boolean;              // hidden behind the Advanced toggle (kept for the export)
};

const DETAIL_FIELDS: Record<string, DetailField[]> = {
  gevel: [
    { key: 'construction_type',    label: 'Position',                  type: 'select',
      options: [
        { value: 'Voorgevel',   label: 'Front facade' },
        { value: 'Achtergevel', label: 'Rear facade'  },
        { value: 'Linkergevel', label: 'Left facade'  },
        { value: 'Rechtergevel',label: 'Right facade' },
      ] },
    { key: 'description',          label: 'Adjacent to',               type: 'select',
      options: [
        { value: 'Buitenlucht',                        label: 'Outside air'           },
        { value: 'Kruipruimte',                        label: 'Crawl space'           },
        { value: 'Aangrenzende onverwarmde ruimte',    label: 'Adjacent unheated space' },
        { value: 'Aangrenzende verwarmde ruimte',      label: 'Adjacent heated space'   },
      ] },
    { key: 'insulation_type',      label: 'Insulation type',           type: 'select', advanced: true,
      options: [
        { value: 'Glaswol',     label: 'Glass wool' },
        { value: 'Spouwvulling',label: 'Cavity fill' },
        { value: 'PUR',         label: 'PUR' },
        { value: 'EPS',         label: 'EPS' },
        { value: 'Geen',        label: 'None' },
      ] },
    { key: 'dikte_vloer_boven_mm', label: 'Floor thickness above (mm)', type: 'number' },
    { key: 'dikte_vloer_onder_mm', label: 'Floor thickness below (mm)', type: 'number' },
    { key: 'dikte_muren_mm',       label: 'Adjacent wall thickness (mm)', type: 'number' },
    { key: 'perimeter_m',          label: 'Perimeter (m)',             type: 'number' },
    // Migration 024 NTA fields (GAP M / §2.1 + §6)
    { key: 'dikte_vloerconstructie_mm', label: 'Floor construction thickness (mm)', type: 'number' },
    { key: 'isolatie_dikte_mm',    label: 'Insulation thickness (mm)', type: 'number' },
    { key: 'na_isolatie',          label: 'Retrofit insulation',       type: 'toggle' },
    { key: 'na_isolatie_jaar',     label: 'Retrofit year',             type: 'number',
      dependsOn: { key: 'na_isolatie', value: true } },
    { key: 'rc_source',            label: 'Rc source',                 type: 'select',
      options: [
        { value: 'documented',        label: 'Documented' },
        { value: 'observed',          label: 'Observed' },
        { value: 'buildyear_forfait', label: 'Build-year forfait' },
      ] },
  ],
  transparant_deel: [
    { key: 'opening_type',          label: 'Type',                 type: 'select', target: 'opening',
      options: [
        { value: 'window',      label: 'Window' },
        { value: 'door',        label: 'Door' },
        { value: 'glazed_door', label: 'Door with glass panel' },
        { value: 'skylight',    label: 'Skylight' },
      ] },
    // Door with glass panel = two linked openings rows (the door + its glass), as in
    // the client's AppSheet app. The glass dims live on a second openings row of
    // type 'door_glass' (target: 'glass'). Automatic reclassification to a window
    // past a glass-ratio threshold needs the calc owner's rule — the ratio is
    // shown, not acted on (GAP.md).
    { key: 'glass_width_mm',  label: 'Glass panel width (mm)',  type: 'number', target: 'glass',
      dependsOn: { key: 'opening_type', value: 'glazed_door' } },
    { key: 'glass_height_mm', label: 'Glass panel height (mm)', type: 'number', target: 'glass',
      dependsOn: { key: 'opening_type', value: 'glazed_door' } },
    { key: 'frame_type',            label: 'Frame material',       type: 'select', target: 'opening',
      options: [
        { value: 'Hout',          label: 'Wood' },
        { value: 'Kunststof',     label: 'Plastic (uPVC)' },
        { value: 'Metaal',        label: 'Metal' },
        { value: 'Hout/Kunststof',label: 'Wood/Plastic' },
      ] },
    { key: 'glazing_type',          label: 'Glazing',              type: 'select', target: 'opening',
      options: [
        { value: 'Enkel', label: 'Single' },
        { value: 'Dubbel',label: 'Double' },
        { value: 'HR+',   label: 'HR+' },
        { value: 'HR++',  label: 'HR++' },
        { value: 'Triple',label: 'Triple' },
      ] },
    { key: 'thermisch_onderbroken', label: 'Thermally broken',     type: 'toggle', target: 'opening' },
    { key: 'has_shading',           label: 'Shading present',      type: 'toggle', target: 'opening' },
    { key: 'shading_type',          label: 'Shading type',         type: 'select', target: 'opening',
      options: [
        { value: 'Geen',          label: 'None' },
        { value: 'Knikarmscherm', label: 'Folding-arm awning' },
        { value: 'Uitvalscherm',  label: 'Drop-arm awning' },
        { value: 'Rolluik',       label: 'Roller shutter' },
        { value: 'Markies',       label: 'Awning' },
        { value: 'Zonnecel',      label: 'Solar cell' },
      ],
      dependsOn: { key: 'has_shading', value: true } },
    { key: 'overstek_m',            label: 'Overhang (m)',         type: 'number', target: 'opening' },
  ],
  vloer: [
    { key: 'description',   label: 'Adjacent to',     type: 'select',
      options: [
        { value: 'Kruipruimte',                     label: 'Crawl space' },
        { value: 'Buitenlucht',                     label: 'Outside air' },
        { value: 'Aangrenzende onverwarmde ruimte', label: 'Adjacent unheated space' },
      ] },
    { key: 'insulation_type', label: 'Floor insulation', type: 'select', advanced: true,
      options: [
        { value: 'Geen',    label: 'None' },
        { value: 'Glaswol', label: 'Glass wool' },
        { value: 'PUR',     label: 'PUR' },
        { value: 'EPS',     label: 'EPS' },
        { value: 'Kurk',    label: 'Cork' },
      ] },
    { key: 'bodemisolatie', label: 'Ground insulation', type: 'toggle' },
    { key: 'perimeter_m',   label: 'Perimeter (m)',   type: 'number' },
    // Migration 024 NTA fields (§5.2 + §6 + §1.3 — the storey's vloer element
    // carries the plafond/warmtecapaciteit classes, same as the web zone form)
    { key: 'kruipruimte_hoogte_m', label: 'Crawl space height (m)', type: 'number',
      dependsOn: { key: 'description', value: 'Kruipruimte' } },
    { key: 'isolatie_dikte_mm',    label: 'Insulation thickness (mm)', type: 'number' },
    { key: 'na_isolatie',          label: 'Retrofit insulation',       type: 'toggle' },
    { key: 'na_isolatie_jaar',     label: 'Retrofit year',             type: 'number',
      dependsOn: { key: 'na_isolatie', value: true } },
    { key: 'rc_source',            label: 'Rc source',                 type: 'select',
      options: [
        { value: 'documented',        label: 'Documented' },
        { value: 'observed',          label: 'Observed' },
        { value: 'buildyear_forfait', label: 'Build-year forfait' },
      ] },
    { key: 'plafond_type',         label: 'Ceiling type (storey)',     type: 'select',
      options: [
        { value: 'gesloten', label: 'Closed' },
        { value: 'open',     label: 'Open' },
        { value: 'overig',   label: 'Other' },
      ] },
    { key: 'warmtecap_vloer_klasse', label: 'Heat capacity — floor',   type: 'select',
      options: [
        { value: 'licht', label: 'Light' },
        { value: 'zwaar', label: 'Heavy' },
      ] },
    { key: 'warmtecap_gevel_klasse', label: 'Heat capacity — facade',  type: 'select',
      options: [
        { value: 'licht', label: 'Light' },
        { value: 'zwaar', label: 'Heavy' },
      ] },
  ],
  dakkapel: [
    { key: 'description', label: 'Name / description', type: 'text' },
  ],
  dak: [
    { key: 'construction_type', label: 'Roof type',      type: 'select',
      options: [
        { value: 'HellendDak', label: 'Pitched roof' },
        { value: 'PlatDak',    label: 'Flat roof' },
        { value: 'Zadeldak',   label: 'Gable roof' },
      ] },
    { key: 'tilt_deg',          label: 'Angle (°)',       type: 'number' },
    { key: 'nokhoogte_m',       label: 'Ridge height (m)', type: 'number' },
    { key: 'insulation_type',   label: 'Insulation type',  type: 'select', advanced: true,
      options: [
        { value: 'Glaswol', label: 'Glass wool' },
        { value: 'PUR',     label: 'PUR' },
        { value: 'EPS',     label: 'EPS' },
        { value: 'Geen',    label: 'None' },
      ] },
    // Migration 024 NTA fields (§6)
    { key: 'isolatie_dikte_mm',    label: 'Insulation thickness (mm)', type: 'number' },
    { key: 'na_isolatie',          label: 'Retrofit insulation',       type: 'toggle' },
    { key: 'na_isolatie_jaar',     label: 'Retrofit year',             type: 'number',
      dependsOn: { key: 'na_isolatie', value: true } },
    { key: 'rc_source',            label: 'Rc source',                 type: 'select',
      options: [
        { value: 'documented',        label: 'Documented' },
        { value: 'observed',          label: 'Observed' },
        { value: 'buildyear_forfait', label: 'Build-year forfait' },
      ] },
  ],
  installatie: [
    { key: 'installation_type', label: 'Installation type', type: 'select',
      options: [
        { value: 'Verwarming',       label: 'Heating' },
        { value: 'Tapwater',         label: 'Hot water' },
        { value: 'Ventilatie',       label: 'Ventilation' },
        { value: 'WarmtePomp',       label: 'Heat pump' },
        { value: 'ZonnePanelen',     label: 'Solar panels (PV)' },
        { value: 'ZonneCollectoren', label: 'Solar collectors' },
        { value: 'Koeling',          label: 'Cooling' },
      ] },
    { key: 'brand',     label: 'Brand',     type: 'text' },
    { key: 'model_nr',  label: 'Model',     type: 'text' },
    // These four were exported to VABI (<Locatie>, <Rendement>, <Vermogen>) and
    // stored in building_elements, but had no inputs — found in the 2026-09-22 walkthrough.
    { key: 'description',    label: 'Location (e.g. attic, kitchen)', type: 'text' },
    { key: 'year_installed', label: 'Year installed',                 type: 'number' },
    { key: 'capacity_kw',    label: 'Capacity (kW)',                  type: 'number' },
    { key: 'efficiency',     label: 'Efficiency (0–1, e.g. 0.93)',    type: 'number' },
    { key: 'notes',          label: 'Notes',                          type: 'text' },
    { key: 'cv_klasse', label: 'Boiler class', type: 'select',
      options: ['CW3','CW4','CW5','CW6'],
      dependsOn: { key: 'installation_type', value: 'Verwarming' } },
    { key: 'fuel_type', label: 'Fuel',      type: 'select',
      options: [
        { value: 'Gas',            label: 'Gas' },
        { value: 'Elektriciteit',  label: 'Electricity' },
        { value: 'Stadsverwarming',label: 'District heating' },
        { value: 'Biomassa',       label: 'Biomass' },
      ] },
    // Migration 024 NTA fields — PV params (§7.3), only for solar panels
    { key: 'pv_aantal_panelen',   label: 'Number of PV panels', type: 'number',
      dependsOn: { key: 'installation_type', value: 'ZonnePanelen' } },
    { key: 'pv_wp_per_paneel',    label: 'Wp per panel',        type: 'number',
      dependsOn: { key: 'installation_type', value: 'ZonnePanelen' } },
    { key: 'pv_orientatie_deg',   label: 'PV orientation (°)',  type: 'number',
      dependsOn: { key: 'installation_type', value: 'ZonnePanelen' } },
    { key: 'pv_hellingshoek_deg', label: 'PV tilt (°)',         type: 'number',
      dependsOn: { key: 'installation_type', value: 'ZonnePanelen' } },
    { key: 'pv_beschaduwing_klasse', label: 'PV shading class', type: 'text',
      dependsOn: { key: 'installation_type', value: 'ZonnePanelen' } },
    // Tapwater pipe segments (§7.1) — parsed to JSONB via lib/tapwater
    { key: 'tapwater_segments',   label: 'Pipe segments per room', type: 'text',
      dependsOn: { key: 'installation_type', value: 'Tapwater' } },
  ],
};

function clientUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function InspectScreen() {
  const router    = useRouter();
  const { elementId, sessionId } = useLocalSearchParams<{ elementId: string; sessionId: string }>();
  const { profile } = useAuthStore();
  const {
    deviceId, isConnected, cmdEnabled,
    setOnMeasurement, requestMeasurement, lastMeasurement,
  } = useBLE();

  // Track latest non-null deviceId in a ref so it survives GATT drops and
  // the async window between setState("connected") and the DB upsert resolving.
  const deviceIdRef = useRef<string | null>(deviceId);
  useEffect(() => {
    if (deviceId) deviceIdRef.current = deviceId;
  }, [deviceId]);

  const [element,       setElement]       = useState<ElementWithZone | null>(null);
  const [loading,       setLoading]       = useState(true);
  // Values stored as strings so TextInput stays controlled
  const [values,        setValues]        = useState<Partial<Record<SlotKey, string>>>({});
  const [activeSlot,    setActiveSlot]    = useState<SlotKey | null>(null);
  const [saving,        setSaving]        = useState(false);
  // Briefly highlights the slot card that was just auto-filled by a trigger press.
  const [flashedSlot,   setFlashedSlot]   = useState<SlotKey | null>(null);
  // Thickness capture (point mode): the first ("front") face reading, in mm, while
  // we wait for the second ("back") face. Null when no thickness capture is mid-flight.
  const [thicknessFaceA, setThicknessFaceA] = useState<number | null>(null);
  // Thickness capture (continuous mode): running min/max of the live stream sweep.
  const [sweep,          setSweep]          = useState<SweepState>(EMPTY_SWEEP);
  // Photos: local display URIs + optional uploaded storage paths
  const [photoUris,      setPhotoUris]      = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Qualitative detail fields (string | boolean | number keyed by field.key)
  const [details,       setDetails]       = useState<Record<string, string | boolean | number>>({});
  // Opening record for transparant_deel elements
  const [openingId,     setOpeningId]     = useState<string | null>(null);
  // Calculation zone (Nils, 2026-10-05): an element follows its floor's
  // rekenzone unless the inspector picks another — fixed at review time
  // instead of re-entering the wall. null = inherit.
  const [rekenzones,    setRekenzones]    = useState<Rekenzone[]>([]);
  const [rekenzoneId,   setRekenzoneId]   = useState<string | null>(null);
  // Photo roles: situational shot vs close-up (glass, crawl-space hatch).
  const [photoRoles,    setPhotoRoles]    = useState<Record<string, PhotoRole>>({});
  // Linked 'door_glass' openings row for a door with glass panel.
  const [glassOpeningId, setGlassOpeningId] = useState<string | null>(null);
  // NTA details accordion (collapsed by default — measurement flow first)
  const [showDetails,   setShowDetails]   = useState(false);
  // Insulation type: the inspector doesn't work with it day to day, but the VABI
  // export does, so it's tucked away rather than removed. Insulation λ was removed
  // 2026-09-24 — the Rc formula uses a fixed λ (see opname-calc/rules).
  const [showAdvanced,  setShowAdvanced]  = useState(false);

  const activeSlotRef = useRef<SlotKey | null>(null);
  // setActiveSlotSync keeps the ref in sync IMMEDIATELY so BLE callbacks that
  // fire in the same tick as toggleSlot always read the correct slot.
  const setActiveSlotSync = useCallback((slot: SlotKey | null) => {
    activeSlotRef.current = slot;
    setActiveSlot(slot);
  }, []);

  // Mirror the connection flags in refs so advanceAfterFill (called from the
  // BLE callback, which is registered once) reads current values.
  const isConnectedRef = useRef(isConnected);
  const cmdEnabledRef  = useRef(cmdEnabled);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);
  useEffect(() => { cmdEnabledRef.current  = cmdEnabled;  }, [cmdEnabled]);

  // Refs so the measurement callback always reads current values without stale closures.
  // liveValuesRef is updated SYNCHRONOUSLY in onChangeText so handleSubmitEditing
  // reads the correct value even when Enter arrives before React batches the state update.
  const liveValuesRef = useRef<Partial<Record<SlotKey, string>>>({});
  const valuesRef = useRef<Partial<Record<SlotKey, string>>>({});
  useEffect(() => { valuesRef.current = values; }, [values]);

  const slotsRef = useRef<SlotDef[]>(DEFAULT_SLOTS);
  useEffect(() => {
    if (element) slotsRef.current = slotsFor(element.element_type, details);
  }, [element, details]);

  // Auto-advance after any fill (trigger press, Capture, thickness, or Enter):
  // arm the next empty non-thickness slot so the following trigger press lands
  // there without a tap. The armed slot also gets focused by the activeSlot
  // effect below, and in GATT trigger mode we re-arm the device the same way
  // toggleSlot does. Clears the active slot when nothing is left to arm.
  const advanceAfterFill = useCallback((filled: SlotKey) => {
    const next = nextSlotAfterFill(filled, slotsRef.current, valuesRef.current);
    setActiveSlotSync(next);
    if (next && isConnectedRef.current && cmdEnabledRef.current) requestMeasurement();
  }, [setActiveSlotSync, requestMeasurement]);

  // Refs mirror the thickness-capture state so BLE callbacks read current values.
  const thicknessFaceARef = useRef<number | null>(null);
  const sweepRef          = useRef<SweepState>(sweep);
  useEffect(() => { sweepRef.current = sweep; }, [sweep]);
  const setFaceA = useCallback((v: number | null) => {
    thicknessFaceARef.current = v;
    setThicknessFaceA(v);
  }, []);

  // Records one face of a thickness/depth measurement (point mode). The first reading
  // is held as the front face; the second computes |back − front| and fills the slot.
  const captureThicknessFace = useCallback((slot: SlotKey, value_mm: number) => {
    if (thicknessFaceARef.current == null) {
      setFaceA(value_mm);
      setFlashedSlot(slot);
      setTimeout(() => setFlashedSlot(null), 800);
      return;
    }
    const t = thicknessFromFaces(thicknessFaceARef.current, value_mm);
    if (!isUsableThickness(t)) {
      Alert.alert("Same face?", "The two readings are almost identical (thickness ≈ 0). Re-measure the opposite face.");
      return;
    }
    setValues(prev => ({ ...prev, [slot]: (t / 1000).toFixed(3) }));
    setFaceA(null);
    advanceAfterFill(slot);
    setFlashedSlot(slot);
    setTimeout(() => setFlashedSlot(null), 1500);
  }, [advanceAfterFill, setFaceA]);

  // Continuous mode: fold each live streaming sample into the sweep's running min/max.
  // Only continuous heartbeat packets count — trigger packets are ignored here.
  useEffect(() => {
    if (!sweepRef.current.active) return;
    if (!lastMeasurement || !lastMeasurement.is_continuous) return;
    const v = lastMeasurement.value_mm;
    setSweep(prev => (prev.active ? addSweepSample(prev, v) : prev));
  }, [lastMeasurement]);

  // Start a sweep, or stop it and fill the slot with (max − min).
  const toggleSweep = useCallback((slot: SlotKey) => {
    const cur = sweepRef.current;
    if (!cur.active) {
      setSweep({ ...EMPTY_SWEEP, active: true });
      return;
    }
    const t = thicknessFromSweep(cur);
    setSweep(EMPTY_SWEEP);
    if (t == null) {
      const spread = cur.max_mm - cur.min_mm;
      Alert.alert("Sweep too short", `Need a clear front-to-back sweep across the edge.\nGot ${cur.samples} samples, spread ${isFinite(spread) ? spread.toFixed(0) : 0} mm.`);
      return;
    }
    setValues(prev => ({ ...prev, [slot]: (t / 1000).toFixed(3) }));
    advanceAfterFill(slot);
    setFlashedSlot(slot);
    setTimeout(() => setFlashedSlot(null), 1500);
  }, [advanceAfterFill]);

  // One ref per slot so we can programmatically focus the TextInput
  const inputRefs = useRef<Partial<Record<SlotKey, TextInput | null>>>({});

  // Focus the active TextInput after state settles — more reliable than a
  // setTimeout inside an event handler.
  useEffect(() => {
    if (!activeSlot) return;
    const timer = setTimeout(() => inputRefs.current[activeSlot]?.focus(), 80);
    return () => clearTimeout(timer);
  }, [activeSlot]);

  // Load element + zone name via PostgREST join
  useEffect(() => {
    if (!elementId) return;
    Promise.resolve(
      supabase
        .from("building_elements")
        .select("*, zones(name, floor_plan_scale_m, ceiling_height_m, floor_level, rekenzone_id, building_id)")
        .eq("id", elementId)
        .single()
    ).then(({ data }) => {
        if (data) {
          const { zones: zoneData, ...rest } = data as any;
          setElement({
            ...rest,
            zone_name: zoneData?.name ?? null,
            zone_scale_m: zoneData?.floor_plan_scale_m ?? null,
            zone_ceiling_m: zoneData?.ceiling_height_m ?? null,
            zone_floor_level: zoneData?.floor_level ?? null,
            zone_rekenzone_id: zoneData?.rekenzone_id ?? null,
            building_id: zoneData?.building_id ?? null,
          });
          setRekenzoneId(rest.rekenzone_id ?? null);
          setPhotoRoles((rest.photo_roles as Record<string, PhotoRole>) ?? {});
          setValues({
            ...(rest.length_mm != null ? { length_mm: (rest.length_mm / 1000).toFixed(3) } : {}),
            ...(rest.height_mm != null
              ? { height_mm: (rest.height_mm / 1000).toFixed(3) }
              // Auto height (AppSheet parity): a wall with no height yet inherits the
              // floor's ceiling height once one wall on that floor has been measured.
              // Measuring again overrides it for this wall only.
              : rest.element_type === 'gevel' && zoneData?.ceiling_height_m != null
                ? { height_mm: Number(zoneData.ceiling_height_m).toFixed(3) }
                : {}),
            ...(rest.width_mm  != null ? { width_mm:  (rest.width_mm  / 1000).toFixed(3) } : {}),
          });
          // Populate qualitative detail fields from existing element data
          const elementFields = (DETAIL_FIELDS[rest.element_type] ?? []).filter(f => f.target !== 'opening' && f.target !== 'glass');
          const initialDetails: Record<string, string | boolean | number> = {};
          for (const f of elementFields) {
            const v = rest[f.key];
            if (v == null) continue;
            // tapwater_segments is JSONB in the DB but edited as one text line
            initialDetails[f.key] = f.key === 'tapwater_segments' ? formatTapwaterSegments(v) : v;
          }
          setDetails(initialDetails);
          // Load existing photos: generate signed URLs for storage paths
          const existing: string[] = rest.photo_urls ?? [];
          if (existing.length > 0) {
            Promise.all(
              existing.map(async (path: string) => {
                // Local URI (captured offline) — use directly
                if (path.startsWith("file://") || path.startsWith("content://") || path.startsWith("ph://")) {
                  return path;
                }
                // Supabase Storage path — generate a 1-hour signed URL
                const { data: signed } = await supabase.storage
                  .from("inspection-photos")
                  .createSignedUrl(path, 3600);
                return signed?.signedUrl ?? null;
              })
            ).then(urls => {
              setPhotoUris(urls.filter(Boolean) as string[]);
            });
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [elementId]);

  // Rekenzones of this building, for the picker in the header.
  useEffect(() => {
    if (!element?.building_id) return;
    supabase.from("rekenzones").select("*")
      .eq("building_id", element.building_id).eq("is_active", true).order("sort_order")
      .then(({ data }) => setRekenzones((data ?? []) as Rekenzone[]));
  }, [element?.building_id]);

  // Load existing opening record for transparant_deel elements
  useEffect(() => {
    if (!element || element.element_type !== 'transparant_deel') return;
    supabase
      .from('openings')
      .select('*')
      .eq('element_id', element.id)
      .eq('is_active', true)
      .neq('opening_type', 'door_glass')   // the glass panel row is loaded separately below
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const o = data as Opening;
        setOpeningId(o.id);
        const openingFields = (DETAIL_FIELDS.transparant_deel ?? []).filter(f => f.target === 'opening');
        const od: Record<string, string | boolean | number> = {};
        for (const f of openingFields) {
          const v = (o as any)[f.key];
          if (v != null) od[f.key] = v;
        }
        setDetails(prev => ({ ...prev, ...od }));
      });
    // Door-with-glass: the linked glass panel row.
    supabase
      .from('openings')
      .select('id, width_mm, height_mm')
      .eq('element_id', element.id)
      .eq('is_active', true)
      .eq('opening_type', 'door_glass')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setGlassOpeningId((data as any).id);
        setDetails(prev => ({
          ...prev,
          ...((data as any).width_mm  != null ? { glass_width_mm:  String((data as any).width_mm) }  : {}),
          ...((data as any).height_mm != null ? { glass_height_mm: String((data as any).height_mm) } : {}),
        }));
      });
  }, [element]);

  // ── Floor perimeter (calc owner rule, ISSO 82.1/75.1): internal circumference
  // where the floor adjoins outside air or an unheated space outside the thermal
  // envelope; ground and basement floors only. Σ of this zone's qualifying wall
  // lengths (floorPerimeterM). Auto-filled on the floor element when empty;
  // the inspector can still overwrite it.
  const [zoneWalls, setZoneWalls] = useState<{ length_mm: number | null; description: string | null }[]>([]);
  useEffect(() => {
    if (!element || element.element_type !== 'vloer') return;
    supabase
      .from('building_elements')
      .select('length_mm, description')
      .eq('zone_id', element.zone_id)
      .eq('element_type', 'gevel')
      .eq('is_active', true)
      .then(({ data }) => setZoneWalls((data ?? []) as any));
  }, [element]);
  const autoPerimeterM = element?.element_type === 'vloer'
    ? floorPerimeterM(zoneWalls, element.zone_floor_level)
    : null;
  useEffect(() => {
    if (autoPerimeterM == null) return;
    setDetails(prev => (prev.perimeter_m != null && prev.perimeter_m !== '' ? prev : { ...prev, perimeter_m: autoPerimeterM.toFixed(2) }));
  }, [autoPerimeterM]);

  // Door with glass panel — 65 % rule (calc owner): below 65 % glass the element is
  // split into a door plus a window (the glass panel); at 65 % or more it is a window.
  const glazedDoorRatio = (() => {
    const gw = parseFloat(String(details.glass_width_mm ?? ''));
    const gh = parseFloat(String(details.glass_height_mm ?? ''));
    const dw = parseFloat(values.width_mm ?? '') * 1000;
    const dh = parseFloat(values.height_mm ?? '') * 1000;
    return glassRatio(dw, dh, gw, gh);
  })();
  const glassRatioPct = glazedDoorRatio == null ? null : Math.round(glazedDoorRatio * 100);

  // Capture a photo from camera or library and upload to Supabase Storage
  const capturePhoto = useCallback(async (source: "camera" | "library", role: PhotoRole = "situational") => {
    if (!ImagePicker) {
      Alert.alert("Not available", "Photo capture requires a dev build.");
      return;
    }
    const permResult = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permResult.granted) {
      Alert.alert("Permission required", `Please allow ${source} access in Settings.`);
      return;
    }

    const result = source === "camera"
      // Full frame, no crop UI (see facade-photos.tsx for the walkthrough rationale).
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: false });

    if (result.canceled || !result.assets?.[0]) return;
    const localUri = result.assets[0].uri;

    // Add local URI immediately for instant preview
    setPhotoUris(prev => [...prev, localUri]);

    // Upload to Supabase Storage in the background
    if (!element || !profile) return;
    setUploadingPhoto(true);
    try {
      const filename = `${Date.now()}.jpg`;
      const storagePath = `${profile.org_id}/${element.id}/${filename}`;

      const { error: upErr } = await uploadImageToStorage(
        "inspection-photos", storagePath, localUri, "image/jpeg", { upsert: false },
      );

      const storedPath = upErr ? localUri : storagePath;   // local URI kept as fallback
      const nextRoles = { ...(element.photo_roles ?? {}), ...photoRoles, [storedPath]: role };
      await supabase.from("building_elements")
        .update({ photo_urls: [...(element.photo_urls ?? []), storedPath], photo_roles: nextRoles })
        .eq("id", element.id);
      setPhotoRoles(nextRoles);
      if (!upErr) {
        // Update local element state so subsequent saves are correct
        setElement(prev => prev ? { ...prev, photo_urls: [...(prev.photo_urls ?? []), storagePath], photo_roles: nextRoles } : prev);

        // Best-effort push to AppSheet if this element's building is linked
        // (no-op otherwise). Never blocks or reverts the save above on failure.
        const { data: zoneRow } = await supabase.from("zones").select("building_id").eq("id", element.zone_id).maybeSingle();
        if (zoneRow?.building_id) syncToAppsheetIfLinked(zoneRow.building_id);
      }
    } catch (e: any) {
      Alert.alert("Photo upload failed", e.message ?? "Unknown error");
    } finally {
      setUploadingPhoto(false);
    }
  }, [element, profile, photoRoles]);

  // Wire GLM measurement — fires when the physical trigger is pressed (GATT mode).
  // Trigger-press packets always fill the slot; continuous heartbeats only fill when
  // pendingMeasurementRef was armed via requestMeasurement() (fallback path).
  useEffect(() => {
    setOnMeasurement((m: GLMMeasurement) => {
      const slot = activeSlotRef.current ?? slotsRef.current.find(s => {
        const v = parseFloat(valuesRef.current[s.key] ?? "");
        return isNaN(v) || v <= 0;
      })?.key ?? null;
      if (!slot) return;
      // Thickness/depth slots need two readings — route the trigger press into the
      // front/back face accumulator instead of filling the slot directly.
      const def = slotsRef.current.find(s => s.key === slot);
      if (def?.thickness) {
        captureThicknessFace(slot, m.value_mm);
        return;
      }
      console.log("[BLE] Filling slot:", slot, "→", m.value_mm.toFixed(1), "mm");
      setValues(prev => ({ ...prev, [slot]: (m.value_mm / 1000).toFixed(3) }));
      advanceAfterFill(slot);
      // Flash the filled slot for 1.5 s so the user gets clear visual feedback.
      setFlashedSlot(slot);
      setTimeout(() => setFlashedSlot(null), 1500);
    });
    return () => setOnMeasurement(() => {});
  }, [setOnMeasurement, advanceAfterFill, captureThicknessFace]);

  // Manually capture the current live GLM reading into the active (or first unfilled) slot.
  // Works in continuous mode without requiring CMD_ENABLE or trigger-press indications.
  const captureNow = useCallback((value_mm: number) => {
    const slot = activeSlotRef.current ?? slotsRef.current.find(s => {
      const v = parseFloat(valuesRef.current[s.key] ?? "");
      return isNaN(v) || v <= 0;
    })?.key ?? null;
    if (!slot) return;
    console.log("[BLE] Capture now:", slot, "→", value_mm.toFixed(1), "mm");
    setValues(prev => ({ ...prev, [slot]: (value_mm / 1000).toFixed(3) }));
    advanceAfterFill(slot);
    setFlashedSlot(slot);
    setTimeout(() => setFlashedSlot(null), 1500);
  }, [advanceAfterFill]);

  // GLM 50C can also be paired as a BLE keyboard in iOS Settings. Pressing its trigger
  // "types" the measurement (in metres) into whichever TextInput has first-responder focus.
  const toggleSlot = (key: SlotKey) => {
    const wasActive = activeSlot === key;
    const isThickness = !!((SLOT_MAP[element?.element_type ?? ""] ?? DEFAULT_SLOTS).find(s => s.key === key)?.thickness);
    setActiveSlotSync(wasActive ? null : key);
    // Switching slots abandons any half-finished thickness capture.
    setFaceA(null);
    setSweep(EMPTY_SWEEP);
    // Only arm the pendingRef when CMD_ENABLE was confirmed by the device (GATT trigger-press
    // mode active). In continuous-only mode arming pendingRef causes the very next 200ms
    // heartbeat to fill the slot before the user has aimed — use Capture button instead.
    // Thickness slots never arm: each face is an explicit trigger press / face button.
    if (!wasActive && isConnected && cmdEnabled && !isThickness) requestMeasurement();
  };

  // Called when the user presses Enter / GLM keyboard sends Return after typing.
  // GLM keyboard mode outputs metres (e.g. "2.430") — convert to mm automatically.
  const handleSubmitEditing = (key: SlotKey) => {
    const raw = liveValuesRef.current[key] ?? values[key] ?? "";
    const num = parseFloat(raw);
    if (isNaN(num) || num <= 0) return;

    const isMaybeMeters = raw.includes(".") && num < 100;
    const mm = isMaybeMeters ? Math.round(num * 1000) : Math.round(num);
    setValues(prev => ({ ...prev, [key]: String(mm) }));
    // Same advance rule as a laser fill; the activeSlot effect handles focus.
    advanceAfterFill(key);
  };

  const saveElement = useCallback(async () => {
    if (!element || !profile || !sessionId) return;
    setSaving(true);
    try {
      const slots = slotsFor(element.element_type, details);

      // Build the update object — only include slots that have a valid number
      const update: Record<string, unknown> = {};
      for (const s of slots) {
        const raw = values[s.key];
        if (raw === undefined || raw.trim() === "") continue;
        const num = parseFloat(raw);
        if (!isNaN(num) && num > 0) {
          // Values are always stored in metres (e.g. "0.646") — convert to mm for DB.
          // If user typed a large integer (e.g. "2500" without decimal) treat as mm directly.
          const isMaybeMeters = raw.includes(".") || num < 100;
          update[s.key] = isMaybeMeters ? Math.round(num * 1000) : Math.round(num);
        }
      }

      // Add qualitative element-level fields
      const elementDetailFields = (DETAIL_FIELDS[element.element_type] ?? []).filter(f => f.target !== 'opening' && f.target !== 'glass');
      for (const f of elementDetailFields) {
        const v = details[f.key];
        if (v == null || v === '') continue;
        if (f.key === 'tapwater_segments' && typeof v === 'string') {
          update[f.key] = parseTapwaterSegments(v);   // JSONB column — parse the text line
        } else if (f.type === 'number' && typeof v === 'string') {
          const n = parseFloat(v.replace(',', '.'));
          if (Number.isFinite(n)) update[f.key] = n;
        } else {
          update[f.key] = v;
        }
      }

      const allSlotsFilled = slots.every(s => {
        const raw = values[s.key];
        if (!raw) return false;
        const num = parseFloat(raw);
        return !isNaN(num) && num > 0;
      });
      // Completion is measurement-only for built elements. Installations have no
      // slots, so they're complete once the type is chosen.
      const isInstallation = element.element_type === 'installatie';
      if (isInstallation ? !!details.installation_type : allSlotsFilled) update.is_complete = true;
      // A quick-added installation starts life as "New installation"; once the
      // type is known, name it by type so the session list reads sensibly.
      if (isInstallation && details.installation_type && /^new installation$/i.test(element.name)) {
        const opt = (DETAIL_FIELDS.installatie ?? [])
          .find(fld => fld.key === 'installation_type')?.options
          ?.find(o => typeof o !== 'string' && o.value === details.installation_type);
        if (opt && typeof opt !== 'string') update.name = opt.label;
      }

      // Store the rekenzone only when it differs from the floor's; null keeps
      // "follow the floor" so re-grouping floors later still moves the element.
      const rzOverride = rekenzoneId && rekenzoneId !== element.zone_rekenzone_id ? rekenzoneId : null;
      if ((element.rekenzone_id ?? null) !== rzOverride) update.rekenzone_id = rzOverride;

      if (Object.keys(update).length > 0) {
        const { error } = await supabase
          .from("building_elements")
          .update(update)
          .eq("id", element.id);
        if (error) throw error;
      }

      // For transparant_deel: upsert qualitative fields into openings table
      if (element.element_type === 'transparant_deel') {
        const openingFields = (DETAIL_FIELDS.transparant_deel ?? []).filter(f => f.target === 'opening');
        const openingUpdate: Record<string, unknown> = {
          org_id:      profile.org_id,
          element_id:  element.id,
          width_mm:    update.width_mm ?? element.width_mm ?? null,
          height_mm:   update.height_mm ?? element.height_mm ?? null,
        };
        for (const f of openingFields) {
          const v = details[f.key];
          if (v != null && v !== '') openingUpdate[f.key] = v;
        }
        // Track the row id locally: setOpeningId won't have landed yet within this save.
        let currentOpeningId: string | null = openingId;
        if (openingId) {
          await supabase.from('openings').update(openingUpdate).eq('id', openingId);
        } else {
          const { data: newOpening } = await supabase.from('openings')
            .insert({ ...openingUpdate, opening_type: (details.opening_type as string) ?? 'window' })
            .select('id').single();
          if (newOpening) { currentOpeningId = (newOpening as any).id; setOpeningId(currentOpeningId); }
        }

        // Door with glass panel, 65 % rule (calc owner, ISSO 82.1/75.1):
        //  · < 65 % glass  → split: this row stays a door (area net of the glass)
        //                    plus a linked 'door_glass' row that exports as a window
        //  · ≥ 65 % glass  → the whole element is a window: this row becomes
        //                    'window' and any glass row is deactivated.
        const glassW = parseFloat(String(details.glass_width_mm ?? ''));
        const glassH = parseFloat(String(details.glass_height_mm ?? ''));
        const doorClass = details.opening_type === 'glazed_door' && glazedDoorRatio != null
          ? classifyGlazedDoor(glazedDoorRatio) : null;
        if (doorClass === 'window' && currentOpeningId) {
          await supabase.from('openings').update({ opening_type: 'window', area_m2: null }).eq('id', currentOpeningId);
          setDetails(prev => ({ ...prev, opening_type: 'window' }));
        } else if (doorClass === 'split' && currentOpeningId) {
          const dw = Number(openingUpdate.width_mm), dh = Number(openingUpdate.height_mm);
          const net = (dw * dh - glassW * glassH) / 1e6;
          await supabase.from('openings').update({ area_m2: net > 0 ? Math.round(net * 100) / 100 : null }).eq('id', currentOpeningId);
        }
        if (doorClass === 'split') {
          const glassRow = {
            org_id: profile.org_id, element_id: element.id, opening_type: 'door_glass',
            name: 'Door glass panel', width_mm: glassW, height_mm: glassH,
            glazing_type: (details.glazing_type as string) ?? null,
          };
          if (glassOpeningId) {
            await supabase.from('openings').update(glassRow).eq('id', glassOpeningId);
          } else {
            const { data: g } = await supabase.from('openings').insert(glassRow).select('id').single();
            if (g) setGlassOpeningId((g as any).id);
          }
        } else if (glassOpeningId) {
          await supabase.from('openings').update({ is_active: false }).eq('id', glassOpeningId);
          setGlassOpeningId(null);
        }
      }

      // Insert measurement audit records.
      // Prefer the live BLE device; fall back to any active org device.
      // device_id may be null for manual entries (migration 010 made the column nullable).
      if (Object.keys(update).length > 0) {
        let resolvedDeviceId = deviceIdRef.current;
        if (!resolvedDeviceId) {
          const { data: fallback } = await supabase
            .from("ble_devices")
            .select("id")
            .eq("org_id", profile.org_id)
            .eq("is_active", true)
            .limit(1)
            .single();
          resolvedDeviceId = fallback?.id ?? null;
        }

        const now = new Date().toISOString();
        const rows = slots
          .filter(s => update[s.key] !== undefined)
          .map(s => ({
            id:               clientUUID(),
            measured_at:      now,
            org_id:           profile.org_id,
            session_id:       sessionId,
            device_id:        resolvedDeviceId,
            inspector_id:     profile.id,
            element_id:       element.id,
            value_mm:         update[s.key] as number,
            unit:             "mm",
            is_anomaly:       false,
            is_deleted:       false,
            measurement_type: s.key.replace("_mm", ""),
            ingestion_path:   "mobile",
          }));
        if (rows.length > 0) {
          const { error: mErr } = await supabase.from("measurements").insert(rows);
          if (mErr) {
            Alert.alert(
              "Measurement record failed",
              `Dimensions saved but the audit record was rejected:\n\n${mErr.message}\n\nCode: ${mErr.code ?? "—"}`,
            );
          }
        }
      }

      // Auto height: the first measured wall height on a floor becomes the
      // floor's ceiling height and fills every other wall on that floor that
      // has no height yet. Per-wall override stays possible.
      if (element.element_type === 'gevel' && typeof update.height_mm === 'number' && element.zone_ceiling_m == null) {
        const hM = (update.height_mm as number) / 1000;
        const applyToFloor = await new Promise<boolean>(resolve => Alert.alert(
          "Use for the whole floor?",
          `Set ${hM.toFixed(2)} m as the height for every wall on this floor that hasn't been measured yet? You can still remeasure any wall.`,
          [
            { text: "Just this wall", style: "cancel", onPress: () => resolve(false) },
            { text: "Whole floor", onPress: () => resolve(true) },
          ],
          { cancelable: false },
        ));
        if (applyToFloor) {
          await supabase.from("zones").update({ ceiling_height_m: hM }).eq("id", element.zone_id);
          await supabase.from("building_elements")
            .update({ height_mm: update.height_mm })
            .eq("zone_id", element.zone_id).eq("element_type", "gevel").eq("is_active", true)
            .is("height_mm", null);
        }
      }

      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [element, profile, sessionId, values, details, router]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading)  return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (!element) return <Text style={styles.error}>Element not found.</Text>;

  const slots      = slotsFor(element.element_type, details);
  // Plan-derived in-plan length (metres) from the element's grid width × the zone
  // scale. Offered as a one-tap suggestion on the matching slot — never auto-filled,
  // so the measurement audit trail only records values the inspector accepts.
  const planLengthSlot: SlotKey = element.element_type === 'transparant_deel' ? 'width_mm' : 'length_mm';
  const planLengthM = gridLengthMeters(element.grid_w, element.zone_scale_m);
  const filledCount = slots.filter(s => {
    const v = parseFloat(values[s.key] ?? "");
    return !isNaN(v) && v > 0;
  }).length;
  const isInstallation  = element.element_type === 'installatie';
  const heightFromZone  = element.element_type === 'gevel' && element.height_mm == null
    && element.zone_ceiling_m != null && values.height_mm === Number(element.zone_ceiling_m).toFixed(3);
  const isFullyComplete = isInstallation ? !!details.installation_type : filledCount === slots.length;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.elementName}>{element.name}</Text>
          {element.zone_name
            ? <Text style={styles.zoneName}>Floor: {element.zone_name}</Text>
            : null}
          {rekenzones.length > 0 && (
            <TouchableOpacity
              onPress={() => Alert.alert(
                "Calculation zone",
                "Which calculation zone does this element belong to?",
                [
                  ...rekenzones.map(rz => ({ text: rz.name, onPress: () => setRekenzoneId(rz.id) })),
                  { text: "Cancel", style: "cancel" as const },
                ],
              )}
            >
              <Text style={styles.zoneName}>
                Calc zone: {rekenzones.find(rz => rz.id === (rekenzoneId ?? element.zone_rekenzone_id))?.name ?? "—"}
                {rekenzoneId && rekenzoneId !== element.zone_rekenzone_id ? " (overridden)" : ""} ›
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{elementTypeLabel(element.element_type).toUpperCase()}</Text>
        </View>
      </View>

      {/* ── GLM status + live reading banner (not for installations — nothing to measure) ── */}
      {!isInstallation && (
      <View style={[styles.glmBanner, isConnected && styles.glmBannerConnected]}>
        <View style={styles.glmBannerRow}>
          <Text style={styles.glmBannerText}>
            {isConnected
              ? cmdEnabled
                ? "GLM ready — press trigger, or tap Capture below"
                : "GLM streaming — tap Capture or enter manually"
              : "No GLM — scan from the session screen, or enter manually"}
          </Text>
          {isConnected && lastMeasurement && (
            <Text style={styles.glmLiveValue}>
              {(lastMeasurement.value_mm / 1000).toFixed(3)} m
            </Text>
          )}
        </View>
        {/* Bridge from a live decoded reading into the active/next slot. Shown
            regardless of cmdEnabled: even when CMD_ENABLE gets a GATT ACK, some
            GLM 50C units only ever emit 4-byte continuous packets and never a
            real trigger-press indication (PATH A in useBLEDevice never fires),
            so relying on cmdEnabled alone silently strands the reading in the
            console log and never fills a slot. Capture always works. */}
        {isConnected && lastMeasurement && (() => {
          const targetSlot = activeSlotRef.current ?? (slots.find(s => {
            const v = parseFloat(values[s.key] ?? "");
            return isNaN(v) || v <= 0;
          })?.key ?? null);
          if (!targetSlot) return null;
          const targetLabel = slots.find(s => s.key === targetSlot)?.label ?? targetSlot.replace("_mm", "");
          return (
            <TouchableOpacity style={styles.captureBtn} onPress={() => captureNow(lastMeasurement.value_mm)}>
              <Text style={styles.captureBtnText}>
                ⊙ Capture {lastMeasurement.value_mm.toFixed(0)} mm → {targetLabel}
              </Text>
            </TouchableOpacity>
          );
        })()}
      </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ResponsiveContainer>

        {!isInstallation && (<>
        {/* ── Progress ── */}
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>MEASUREMENTS</Text>
          <Text style={styles.progressCount}>{filledCount} / {slots.length} captured</Text>
        </View>

        {/* ── Measurement slots ── */}
        {slots.map(slot => {
          const raw       = values[slot.key] ?? "";
          const isActive  = activeSlot === slot.key;
          const isFlashed = flashedSlot === slot.key;
          const numVal    = parseFloat(raw);
          const isFilled  = !isNaN(numVal) && numVal > 0;

          return (
            <View
              key={slot.key}
              style={[
                styles.slotCard,
                isActive  && styles.slotCardActive,
                isFilled  && !isActive && !isFlashed && styles.slotCardFilled,
                isFlashed && styles.slotCardFlash,
              ]}
            >
              <Text style={styles.slotLabel}>{slot.label}</Text>

              <View style={styles.inputRow}>
                <TextInput
                  ref={ref => { inputRefs.current[slot.key] = ref; }}
                  style={[styles.input, isActive && styles.inputActive]}
                  value={raw}
                  onChangeText={v => {
                    liveValuesRef.current[slot.key] = v;
                    setValues(prev => ({ ...prev, [slot.key]: v }));
                  }}
                  onSubmitEditing={() => handleSubmitEditing(slot.key)}
                  onFocus={() => setActiveSlotSync(slot.key)}
                  onBlur={() => setActiveSlotSync(activeSlotRef.current === slot.key ? null : activeSlotRef.current)}
                  keyboardType="default"
                  placeholder="Tap or use GLM"
                  placeholderTextColor="#CCC"
                  returnKeyType="next"
                  selectTextOnFocus
                  allowFontScaling={false}
                />
                <Text style={styles.inputUnit} allowFontScaling={false}>m</Text>
                <TouchableOpacity
                  style={[styles.glmBtn, isActive && styles.glmBtnActive]}
                  onPress={() => toggleSlot(slot.key)}
                >
                  <Text style={styles.glmBtnText} allowFontScaling={false}>{isActive ? "⏸" : "▶ GLM"}</Text>
                </TouchableOpacity>
              </View>

              {element.element_type === 'dak' && slot.key === 'length_mm' && !isFilled && (() => {
                const slope = roofSlopeLengthM(
                  parseFloat(String(details.nokhoogte_m ?? '')), parseFloat(String(details.tilt_deg ?? '')));
                return slope == null ? null : (
                  <TouchableOpacity onPress={() => { setValues(prev => ({ ...prev, length_mm: slope.toFixed(3) })); setActiveSlotSync(null); }}>
                    <Text style={styles.planHintText}>
                      ⟋ From ridge height + angle ≈ {slope.toFixed(2)} m — tap to use
                    </Text>
                  </TouchableOpacity>
                );
              })()}
              {slot.key === 'height_mm' && heightFromZone && (
                <Text style={styles.planHintText}>
                  ↕ From floor height {Number(element.zone_ceiling_m).toFixed(2)} m — measure to override for this wall
                </Text>
              )}

              {/* Plan-derived suggestion — one tap to use, then editable */}
              {slot.key === planLengthSlot && planLengthM != null && !isFilled && (
                <TouchableOpacity
                  style={styles.planHint}
                  onPress={() => {
                    setValues(prev => ({ ...prev, [slot.key]: planLengthM.toFixed(3) }));
                    setActiveSlotSync(null);
                  }}
                >
                  <Text style={styles.planHintText}>📐 From plan ≈ {planLengthM.toFixed(2)} m — tap to use</Text>
                </TouchableOpacity>
              )}

              {/* Live GLM preview while this slot is active */}
              {isActive && isConnected && lastMeasurement && (
                <View style={styles.livePreview}>
                  <Text style={styles.livePreviewLabel}>Live: </Text>
                  <Text style={styles.livePreviewValue}>{(lastMeasurement.value_mm / 1000).toFixed(3)} m</Text>
                  <Text style={styles.livePreviewMode}>
                    {lastMeasurement.is_continuous ? " · streaming" : " · trigger"}
                  </Text>
                </View>
              )}

              {/* Thickness/depth capture — two faces (point) or a sweep (continuous) */}
              {slot.thickness && isActive && (
                <View style={styles.thicknessPanel}>
                  <Text style={styles.thicknessHint}>
                    Thickness needs two distances from one spot. Capture the front face,
                    then the back face — we take the difference. Or sweep across the edge
                    in continuous mode (max − min).
                  </Text>

                  {/* Point mode: front face → back face */}
                  <View style={styles.thicknessRow}>
                    <TouchableOpacity
                      style={[styles.faceBtn, thicknessFaceA == null && styles.faceBtnNext]}
                      onPress={() => {
                        const v = lastMeasurement?.value_mm;
                        if (v == null) { Alert.alert("No reading", "Aim the GLM at the front face first."); return; }
                        captureThicknessFace(slot.key, v);
                      }}
                    >
                      <Text style={styles.faceBtnText} allowFontScaling={false}>
                        {thicknessFaceA == null ? "① Front face" : `① Front ✓ ${(thicknessFaceA / 1000).toFixed(3)} m`}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.faceBtn, thicknessFaceA != null && styles.faceBtnNext]}
                      disabled={thicknessFaceA == null}
                      onPress={() => {
                        const v = lastMeasurement?.value_mm;
                        if (v == null) { Alert.alert("No reading", "Aim the GLM at the back face."); return; }
                        captureThicknessFace(slot.key, v);
                      }}
                    >
                      <Text style={[styles.faceBtnText, thicknessFaceA == null && styles.faceBtnTextDisabled]} allowFontScaling={false}>
                        ② Back face
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {cmdEnabled && (
                    <Text style={styles.thicknessSub}>Or press the GLM trigger twice — front, then back.</Text>
                  )}

                  {/* Continuous mode: min/max sweep */}
                  <TouchableOpacity
                    style={[styles.sweepBtn, sweep.active && styles.sweepBtnActive]}
                    onPress={() => toggleSweep(slot.key)}
                  >
                    <Text style={styles.sweepBtnText} allowFontScaling={false}>
                      {sweep.active ? "■ Stop sweep & use (max − min)" : "↔ Start continuous sweep"}
                    </Text>
                  </TouchableOpacity>
                  {sweep.active && (
                    <Text style={styles.thicknessSub}>
                      min {isFinite(sweep.min_mm) ? (sweep.min_mm / 1000).toFixed(3) : "—"} m ·
                      max {isFinite(sweep.max_mm) ? (sweep.max_mm / 1000).toFixed(3) : "—"} m ·
                      Δ {isFinite(sweep.max_mm - sweep.min_mm) ? ((sweep.max_mm - sweep.min_mm) / 1000).toFixed(3) : "0.000"} m ·
                      {" "}{sweep.samples} samples
                    </Text>
                  )}
                </View>
              )}

              {isActive && !slot.thickness && (
                <View style={styles.hint}>
                  <Text style={styles.hintText}>
                    {cmdEnabled
                      ? "● Slot armed — press the GLM trigger to auto-fill"
                      : "● Slot armed — tap Capture above, or type a value manually"}
                  </Text>
                  {!cmdEnabled && (
                    <Text style={styles.hintSub}>
                      Manual entry: type in metres (e.g. 2.430)
                    </Text>
                  )}
                </View>
              )}

              {isFlashed && (
                <Text style={styles.flashLabel}>
                  ✓ Captured
                  {activeSlot && activeSlot !== slot.key
                    ? ` — next: ${slots.find(s => s.key === activeSlot)?.label ?? ""}`
                    : ""}
                </Text>
              )}
            </View>
          );
        })}
        </>)}

        {/* ── Photos ── */}
        <View style={styles.photoSection}>
          <Text style={styles.photoLabel}>PHOTOS</Text>
          <Text style={styles.photoHint}>
            {element.element_type === 'vloer' && details.description === 'Kruipruimte'
              ? "Open the hatch and photograph the crawl space to show its insulation."
              : element.element_type === 'transparant_deel'
                ? "One situational shot of the window in the room, plus a close-up of the glass."
                : "A situational shot proves you were here; add a close-up for details."}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll} contentContainerStyle={styles.photoRow}>
            {photoUris.map((uri, i) => {
              const path = (element.photo_urls ?? [])[i] ?? uri;
              const role = photoRoles[path] ?? photoRoles[uri];
              return (
                <View key={`${uri}-${i}`}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  {role && role !== 'situational' && (
                    <Text style={styles.photoRoleTag}>{role === 'detail' ? 'close-up' : 'crawl space'}</Text>
                  )}
                </View>
              );
            })}
            <TouchableOpacity
              style={styles.photoAddBtn}
              onPress={() => {
                const isCrawl = element.element_type === 'vloer' && details.description === 'Kruipruimte';
                Alert.alert(
                  "Add Photo",
                  "What is this photo?",
                  [
                    { text: "Situational (camera)",  onPress: () => capturePhoto("camera", "situational") },
                    isCrawl
                      ? { text: "Crawl space (camera)", onPress: () => capturePhoto("camera", "crawlspace") }
                      : { text: "Close-up / detail (camera)", onPress: () => capturePhoto("camera", "detail") },
                    { text: "From library", onPress: () => capturePhoto("library", "situational") },
                    { text: "Cancel",  style: "cancel" },
                  ]
                );
              }}
              disabled={uploadingPhoto}
            >
              <Text style={styles.photoAddBtnText}>{uploadingPhoto ? "…" : "+"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* ── NTA details (collapsed by default — measurement-first flow stays primary;
               fields persist through the existing saveElement paths) ── */}
        {(DETAIL_FIELDS[element.element_type] ?? []).length > 0 && (
          <View style={styles.detailsSection}>
            <TouchableOpacity
              style={styles.detailsToggle}
              onPress={() => setShowDetails(v => !v)}
              disabled={isInstallation}
            >
              <Text style={styles.photoLabel}>{isInstallation ? "INSTALLATION" : "DETAILS"}</Text>
              {!isInstallation && (
                <Text style={styles.detailsToggleHint}>
                  {showDetails ? "hide ▲" : "show ▼"}
                </Text>
              )}
            </TouchableOpacity>

            {(showDetails || isInstallation) && (DETAIL_FIELDS[element.element_type] ?? []).map(f => {
              if (f.dependsOn && details[f.dependsOn.key] !== f.dependsOn.value) return null;
              if (f.advanced && !showAdvanced) return null;
              if (f.type === 'toggle') {
                return (
                  <FieldToggle
                    key={f.key}
                    label={f.label}
                    value={!!details[f.key]}
                    onChange={v => setDetails(prev => ({ ...prev, [f.key]: v }))}
                  />
                );
              }
              if (f.type === 'select') {
                return (
                  <FieldSelect
                    key={f.key}
                    label={f.label}
                    value={details[f.key] != null ? String(details[f.key]) : null}
                    options={f.options ?? []}
                    onSelect={v => setDetails(prev => ({ ...prev, [f.key]: v }))}
                  />
                );
              }
              return (
                <View key={f.key} style={styles.detailInputRow}>
                  <Text style={styles.detailInputLabel}>{f.label}</Text>
                  <TextInput
                    style={styles.detailInput}
                    value={details[f.key] != null ? String(details[f.key]) : ''}
                    onChangeText={v => setDetails(prev => ({ ...prev, [f.key]: v }))}
                    keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
                    placeholder={f.key === 'tapwater_segments' ? 'badkamer: 4.77, 2.39; keuken: 0.2' : f.type === 'number' ? '0' : '…'}
                    placeholderTextColor="#CCC"
                  />
                  {f.key === 'perimeter_m' && autoPerimeterM != null && (
                    <TouchableOpacity onPress={() => setDetails(prev => ({ ...prev, perimeter_m: autoPerimeterM.toFixed(2) }))}>
                      <Text style={styles.planHintText}>
                        Auto {autoPerimeterM.toFixed(2)} m — Σ walls on outside air / unheated space (tap to reset)
                      </Text>
                    </TouchableOpacity>
                  )}
                  {f.key === 'perimeter_m' && element.element_type === 'vloer' && autoPerimeterM == null
                    && element.zone_floor_level != null && element.zone_floor_level > 0 && (
                    <Text style={styles.planHintText}>Perimeter applies to ground and basement floors only</Text>
                  )}
                  {f.key === 'glass_height_mm' && glassRatioPct != null && (
                    <Text style={styles.planHintText}>
                      Glass ≈ {glassRatioPct}% of the door — {glassRatioPct >= GLAZED_DOOR_WINDOW_RATIO * 100
                        ? "≥ 65%: saved as a window"
                        : "< 65%: saved as a door plus a window for the glass panel"}
                    </Text>
                  )}
                </View>
              );
            })}
            {(showDetails || isInstallation) && (DETAIL_FIELDS[element.element_type] ?? []).some(fld => fld.advanced) && (
              <TouchableOpacity style={styles.detailsToggle} onPress={() => setShowAdvanced(v => !v)}>
                <Text style={styles.detailsToggleHint}>
                  {showAdvanced ? "Hide advanced (insulation type) ▲" : "Advanced: insulation type ▼"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Save ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={saveElement}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>
            {saving ? "Saving…" : isFullyComplete ? "✓  Save & Complete Element" : "Save Progress"}
          </Text>
        </TouchableOpacity>

        {!deviceId && !isInstallation && (
          <Text style={styles.noDeviceNote}>
            No GLM device registered — values entered manually will still be saved.
          </Text>
        )}

        </ResponsiveContainer>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#F5F7FA" },
  loader:         { flex: 1 },
  error:          { flex: 1, textAlign: "center", color: "#E74C3C", padding: 40, marginTop: 40 },

  header:         { backgroundColor: "#1E3A5F", padding: 16, paddingTop: 20,
                    flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:        { padding: 4 },
  backArrow:      { fontSize: 22, color: "#fff", fontWeight: "700" },
  headerText:     { flex: 1 },
  elementName:    { fontSize: 17, fontWeight: "700", color: "#fff" },
  zoneName:       { fontSize: 12, color: "#A9C4E4", marginTop: 2 },
  typeBadge:      { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 6,
                    paddingHorizontal: 8, paddingVertical: 4 },
  typeText:       { fontSize: 11, fontWeight: "700", color: "#fff", letterSpacing: 0.5 },

  glmBanner:          { backgroundColor: "#F5F5F5", paddingHorizontal: 16, paddingVertical: 10,
                        borderBottomWidth: 1, borderBottomColor: "#DDD" },
  glmBannerConnected: { backgroundColor: "#EBF5FB", borderBottomColor: "#AED6F1" },
  glmBannerRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  glmBannerText:      { fontSize: 13, color: "#2E86C1", fontWeight: "600", flex: 1 },
  glmLiveValue:       { fontSize: 18, fontWeight: "800", color: "#1E3A5F", marginLeft: 8 },
  captureBtn:         { marginTop: 8, backgroundColor: "#1E3A5F", borderRadius: 8,
                        paddingVertical: 8, paddingHorizontal: 14, alignSelf: "stretch",
                        alignItems: "center" },
  captureBtnText:     { color: "#fff", fontWeight: "700", fontSize: 14 },

  scroll:         { flex: 1 },
  content:        { padding: 16, gap: 14 },

  progressRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel:  { fontSize: 11, fontWeight: "700", color: "#888", letterSpacing: 1 },
  progressCount:  { fontSize: 12, fontWeight: "600", color: "#2E86C1" },

  slotCard:       { backgroundColor: "#fff", borderRadius: 12, padding: 16,
                    borderWidth: 2, borderColor: "transparent",
                    elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  slotCardActive: { borderColor: "#2E86C1", backgroundColor: "#EBF5FB" },
  slotCardFilled: { borderColor: "#D5F0E3" },

  slotLabel:      { fontSize: 13, fontWeight: "700", color: "#555", marginBottom: 8,
                    textTransform: "uppercase", letterSpacing: 0.5 },

  inputRow:       { flexDirection: "row", alignItems: "center" },
  input:          { flex: 1, fontSize: 20, fontWeight: "700", color: "#1E3A5F",
                    borderWidth: 1, borderColor: "#DDE", borderRadius: 8,
                    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#F8FAFC" },
  inputActive:    { borderColor: "#2E86C1", backgroundColor: "#fff" },
  inputUnit:      { fontSize: 14, color: "#888", fontWeight: "600", width: 30,
                    textAlign: "center", marginLeft: 6 },
  glmBtn:         { paddingVertical: 10, borderRadius: 8, marginLeft: 6,
                    backgroundColor: "#1E3A5F", width: 72, alignItems: "center" },
  glmBtnActive:   { backgroundColor: "#2E86C1" },
  glmBtnText:     { color: "#fff", fontWeight: "700", fontSize: 13 },

  planHint:       { marginTop: 8, alignSelf: "flex-start", backgroundColor: "#EEF2F7",
                    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  planHintText:   { fontSize: 12, color: "#1E3A5F", fontWeight: "600" },

  hint:           { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#AED6F1" },
  hintText:       { fontSize: 12, color: "#2E86C1", fontStyle: "italic" },
  hintSub:        { fontSize: 11, color: "#7FB3D3", marginTop: 3 },

  thicknessPanel:    { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#AED6F1" },
  thicknessHint:     { fontSize: 12, color: "#2E86C1", fontStyle: "italic", marginBottom: 10, lineHeight: 17 },
  thicknessRow:      { flexDirection: "row", gap: 8 },
  faceBtn:           { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center",
                       borderWidth: 1, borderColor: "#DDE", backgroundColor: "#F8FAFC" },
  faceBtnNext:       { borderColor: "#2E86C1", backgroundColor: "#EBF5FB" },
  faceBtnText:       { fontSize: 13, fontWeight: "700", color: "#1E3A5F" },
  faceBtnTextDisabled:{ color: "#AAB" },
  thicknessSub:      { fontSize: 11, color: "#7FB3D3", marginTop: 6 },
  sweepBtn:          { marginTop: 10, paddingVertical: 12, borderRadius: 8, alignItems: "center",
                       borderWidth: 1, borderColor: "#1E3A5F", backgroundColor: "#1E3A5F" },
  sweepBtnActive:    { borderColor: "#C0392B", backgroundColor: "#C0392B" },
  sweepBtnText:      { fontSize: 13, fontWeight: "700", color: "#fff" },

  saveBtn:        { backgroundColor: "#1E8449", borderRadius: 12, padding: 18,
                    alignItems: "center", marginTop: 4 },
  saveBtnDisabled:{ opacity: 0.5 },
  saveBtnText:    { color: "#fff", fontSize: 16, fontWeight: "700" },

  noDeviceNote:   { fontSize: 12, color: "#E67E22", textAlign: "center",
                    paddingHorizontal: 20, lineHeight: 18, marginTop: -4 },

  slotCardFlash:  { borderColor: "#1E8449", backgroundColor: "#EAFAF1" },
  livePreview:    { flexDirection: "row", alignItems: "baseline", marginTop: 8,
                    paddingTop: 8, borderTopWidth: 1, borderTopColor: "#AED6F1" },
  livePreviewLabel:{ fontSize: 12, color: "#7FB3D3", fontWeight: "600" },
  livePreviewValue:{ fontSize: 16, fontWeight: "800", color: "#1E3A5F" },
  livePreviewMode: { fontSize: 11, color: "#AAA" },
  flashLabel:     { fontSize: 12, color: "#1E8449", fontWeight: "700", marginTop: 6,
                    textAlign: "center" },

  detailsSection: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 6,
                    marginTop: 12, borderWidth: 1, borderColor: "#EBEBEB", overflow: "hidden" },
  detailsToggle:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    paddingHorizontal: 14, paddingVertical: 8 },
  detailsToggleHint: { fontSize: 11, color: "#2E86C1", fontWeight: "600" },
  detailInputRow: { flexDirection: "row", alignItems: "center", gap: 10,
                    paddingHorizontal: 16, paddingVertical: 8,
                    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  detailInputLabel: { flex: 1, fontSize: 14, color: "#374151", fontWeight: "500" },
  detailInput:    { minWidth: 120, maxWidth: 180, borderWidth: 1, borderColor: "#D1D5DB",
                    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                    fontSize: 14, color: "#111827", textAlign: "right" },
  photoSection:   { backgroundColor: "#fff", borderRadius: 12, padding: 14,
                    elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  photoLabel:     { fontSize: 11, fontWeight: "700", color: "#888",
                    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  photoScroll:    { flexGrow: 0 },
  photoRow:       { gap: 8, alignItems: "center" },
  photoThumb:     { width: 72, height: 72, borderRadius: 8, backgroundColor: "#EEF2F7" },
  photoHint:      { fontSize: 12, color: "#6b7280", marginBottom: 8 },
  photoRoleTag:   { fontSize: 10, color: "#1E3A5F", fontWeight: "600", textAlign: "center", marginTop: 2 },
  photoAddBtn:    { width: 72, height: 72, borderRadius: 8, borderWidth: 2,
                    borderColor: "#DDE", borderStyle: "dashed",
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: "#F8FAFC" },
  photoAddBtnText:{ fontSize: 28, color: "#2E86C1", lineHeight: 34, fontWeight: "300" },
});
