import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, Image,
  KeyboardAvoidingView, Platform,
} from "react-native";
let ImagePicker: typeof import("expo-image-picker") | null = null;
try { ImagePicker = require("expo-image-picker"); } catch { ImagePicker = null; }
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase, BuildingElement } from "../../../lib/supabase";
import { useBLE } from "../../../lib/BLEContext";
import { useAuthStore } from "../../../store/authStore";
import { GLMMeasurement } from "../../../hooks/useBLEDevice";

// ── Types ─────────────────────────────────────────────────────────────────────

type SlotKey = "length_mm" | "height_mm" | "width_mm";
type SlotDef = { key: SlotKey; label: string };
type ElementWithZone = BuildingElement & { zone_name?: string };

// ── Slot definitions — keys match the Dutch enum values stored in the DB ──────

const SLOT_MAP: Record<string, SlotDef[]> = {
  // Dutch schema enum values
  gevel:           [{ key: "length_mm", label: "Length"    }, { key: "height_mm", label: "Height"    }, { key: "width_mm", label: "Thickness" }],
  dak:             [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  vloer:           [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  transparant_deel:[{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }],
  installatie:     [{ key: "length_mm", label: "Length"    }],
  // English fallbacks
  wall:    [{ key: "length_mm", label: "Length"    }, { key: "height_mm", label: "Height"    }, { key: "width_mm", label: "Thickness" }],
  floor:   [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  ceiling: [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  roof:    [{ key: "length_mm", label: "Length"    }, { key: "width_mm",  label: "Width"     }],
  window:  [{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }],
  door:    [{ key: "width_mm",  label: "Width"     }, { key: "height_mm", label: "Height"    }],
};
const DEFAULT_SLOTS: SlotDef[] = [
  { key: "length_mm", label: "Length"    },
  { key: "height_mm", label: "Height"    },
  { key: "width_mm",  label: "Thickness" },
];

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
    deviceId, isConnected,
    setOnMeasurement, requestMeasurement,
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
  // Photos: local display URIs + optional uploaded storage paths
  const [photoUris,      setPhotoUris]      = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const activeSlotRef = useRef<SlotKey | null>(null);
  useEffect(() => { activeSlotRef.current = activeSlot; }, [activeSlot]);

  // Refs so the measurement callback always reads current values without stale closures.
  // liveValuesRef is updated SYNCHRONOUSLY in onChangeText so handleSubmitEditing
  // reads the correct value even when Enter arrives before React batches the state update.
  const liveValuesRef = useRef<Partial<Record<SlotKey, string>>>({});
  const valuesRef = useRef<Partial<Record<SlotKey, string>>>({});
  useEffect(() => { valuesRef.current = values; }, [values]);

  const slotsRef = useRef<SlotDef[]>(DEFAULT_SLOTS);
  useEffect(() => {
    if (element) slotsRef.current = SLOT_MAP[element.element_type] ?? DEFAULT_SLOTS;
  }, [element]);

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
        .select("*, zones(name)")
        .eq("id", elementId)
        .single()
    ).then(({ data }) => {
        if (data) {
          const { zones: zoneData, ...rest } = data as any;
          setElement({ ...rest, zone_name: zoneData?.name ?? null });
          setValues({
            ...(rest.length_mm != null ? { length_mm: String(rest.length_mm) } : {}),
            ...(rest.height_mm != null ? { height_mm: String(rest.height_mm) } : {}),
            ...(rest.width_mm  != null ? { width_mm:  String(rest.width_mm)  } : {}),
          });
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

  // Capture a photo from camera or library and upload to Supabase Storage
  const capturePhoto = useCallback(async (source: "camera" | "library") => {
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
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [4, 3] })
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

      const response = await fetch(localUri);
      const blob     = await response.blob();
      const { error: upErr } = await supabase.storage
        .from("inspection-photos")
        .upload(storagePath, blob, { contentType: "image/jpeg", upsert: false });

      if (upErr) {
        // Keep the local URI in photo_urls as fallback
        await supabase.from("building_elements")
          .update({ photo_urls: [...(element.photo_urls ?? []), localUri] })
          .eq("id", element.id);
      } else {
        // Replace the local URI with the storage path in DB
        await supabase.from("building_elements")
          .update({ photo_urls: [...(element.photo_urls ?? []), storagePath] })
          .eq("id", element.id);
        // Update local element state so subsequent saves are correct
        setElement(prev => prev ? { ...prev, photo_urls: [...(prev.photo_urls ?? []), storagePath] } : prev);
      }
    } catch (e: any) {
      Alert.alert("Photo upload failed", e.message ?? "Unknown error");
    } finally {
      setUploadingPhoto(false);
    }
  }, [element, profile]);

  // Wire GLM measurement — fires when physical button is pressed
  useEffect(() => {
    setOnMeasurement((m: GLMMeasurement) => {
      // Use active slot, or auto-advance to the first unfilled slot
      const slot = activeSlotRef.current ?? slotsRef.current.find(s => {
        const v = parseFloat(valuesRef.current[s.key] ?? "");
        return isNaN(v) || v <= 0;
      })?.key ?? null;
      if (!slot) return;
      console.log("[BLE] Filling slot:", slot, "→", m.value_mm.toFixed(1), "mm");
      setValues(prev => ({ ...prev, [slot]: m.value_mm.toFixed(1) }));
      setActiveSlot(null);
    });
    return () => setOnMeasurement(() => {});
  }, [setOnMeasurement]);

  // GLM 50C is paired as a BLE keyboard in iOS Settings. Pressing its trigger
  // "types" the measurement into whichever TextInput holds first-responder status.
  // Setting activeSlot triggers the useEffect above which focuses the right field.
  const toggleSlot = (key: SlotKey) => {
    const wasActive = activeSlot === key;
    setActiveSlot(wasActive ? null : key);
    // Also send a GATT request in case this firmware supports measurement-pull
    if (!wasActive && isConnected) requestMeasurement();
  };

  // Called when the user presses Enter / GLM sends Return after typing the value.
  // GLM keyboard mode outputs in meters by default (e.g. "2.430").
  // If the value has a decimal point and is < 100, treat as meters and convert.
  const handleSubmitEditing = (key: SlotKey) => {
    const raw = liveValuesRef.current[key] ?? values[key] ?? "";
    const num = parseFloat(raw);
    if (isNaN(num) || num <= 0) return;

    const isMaybeMeters = raw.includes(".") && num < 100;
    const mm = isMaybeMeters ? Math.round(num * 1000) : Math.round(num);
    setValues(prev => ({ ...prev, [key]: String(mm) }));
    setActiveSlot(null);

    // Auto-advance to the next unfilled slot
    const slots = SLOT_MAP[element?.element_type ?? ""] ?? DEFAULT_SLOTS;
    const idx   = slots.findIndex(s => s.key === key);
    const next  = slots.slice(idx + 1).find(s => {
      const v = parseFloat(values[s.key] ?? "");
      return isNaN(v) || v <= 0;
    });
    if (next) {
      setActiveSlot(next.key);
      setTimeout(() => inputRefs.current[next.key]?.focus(), 100);
    }
  };

  const saveElement = useCallback(async () => {
    if (!element || !profile || !sessionId) return;
    setSaving(true);
    try {
      const slots = SLOT_MAP[element.element_type] ?? DEFAULT_SLOTS;

      // Build the update object — only include slots that have a valid number
      const update: Record<string, unknown> = {};
      for (const s of slots) {
        const raw = values[s.key];
        if (raw === undefined || raw.trim() === "") continue;
        const num = parseFloat(raw);
        if (!isNaN(num) && num > 0) {
          // Mirror handleSubmitEditing: GLM keyboard outputs metres (e.g. "2.430") —
          // convert to mm if the value looks like metres (has a decimal and is < 100).
          const isMaybeMeters = raw.includes(".") && num < 100;
          update[s.key] = isMaybeMeters ? Math.round(num * 1000) : Math.round(num);
        }
      }

      const allFilled = slots.every(s => {
        const raw = values[s.key];
        if (!raw) return false;
        const num = parseFloat(raw);
        return !isNaN(num) && num > 0;
      });
      if (allFilled) update.is_complete = true;

      if (Object.keys(update).length > 0) {
        const { error } = await supabase
          .from("building_elements")
          .update(update)
          .eq("id", element.id);
        if (error) throw error;
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
            measurement_type: s.key.replace("_mm", ""),
            ingestion_path:   "mobile",
            client_timestamp: now,
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

      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [element, profile, sessionId, values, router]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading)  return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (!element) return <Text style={styles.error}>Element not found.</Text>;

  const slots      = SLOT_MAP[element.element_type] ?? DEFAULT_SLOTS;
  const filledCount = slots.filter(s => {
    const v = parseFloat(values[s.key] ?? "");
    return !isNaN(v) && v > 0;
  }).length;

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
            ? <Text style={styles.zoneName}>Zone: {element.zone_name}</Text>
            : null}
        </View>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{element.element_type.toUpperCase()}</Text>
        </View>
      </View>

      {/* ── GLM status banner ── */}
      <View style={[styles.glmBanner, isConnected && styles.glmBannerConnected]}>
        <Text style={styles.glmBannerText}>
          {isConnected
            ? "📏 GLM connected — tap a field, then press the trigger"
            : "📏 No GLM — go back and scan, or enter values manually"}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Progress ── */}
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>MEASUREMENTS</Text>
          <Text style={styles.progressCount}>{filledCount} / {slots.length} captured</Text>
        </View>

        {/* ── Measurement slots ── */}
        {slots.map(slot => {
          const raw      = values[slot.key] ?? "";
          const isActive = activeSlot === slot.key;
          const numVal   = parseFloat(raw);
          const isFilled = !isNaN(numVal) && numVal > 0;

          return (
            <View key={slot.key} style={[styles.slotCard, isActive && styles.slotCardActive, isFilled && !isActive && styles.slotCardFilled]}>

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
                  onFocus={() => setActiveSlot(slot.key)}
                  onBlur={() => setActiveSlot(prev => prev === slot.key ? null : prev)}
                  keyboardType="default"
                  placeholder="Tap or use GLM"
                  placeholderTextColor="#CCC"
                  returnKeyType="next"
                  selectTextOnFocus
                  allowFontScaling={false}
                />
                <Text style={styles.inputUnit} allowFontScaling={false}>mm</Text>
                <TouchableOpacity
                  style={[styles.glmBtn, isActive && styles.glmBtnActive]}
                  onPress={() => toggleSlot(slot.key)}
                >
                  <Text style={styles.glmBtnText} allowFontScaling={false}>{isActive ? "⏸" : "▶ GLM"}</Text>
                </TouchableOpacity>
              </View>

              {isActive && (
                <View style={styles.hint}>
                  <Text style={styles.hintText}>
                    ● Field is active — press the GLM trigger to type the measurement
                  </Text>
                  <Text style={styles.hintSub}>
                    GLM outputs in metres (e.g. 2.430) — app converts to mm automatically
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        {/* ── Photos ── */}
        <View style={styles.photoSection}>
          <Text style={styles.photoLabel}>PHOTOS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll} contentContainerStyle={styles.photoRow}>
            {photoUris.map((uri, i) => (
              <Image key={`${uri}-${i}`} source={{ uri }} style={styles.photoThumb} />
            ))}
            <TouchableOpacity
              style={styles.photoAddBtn}
              onPress={() => Alert.alert(
                "Add Photo",
                "Choose source",
                [
                  { text: "Camera",  onPress: () => capturePhoto("camera")  },
                  { text: "Library", onPress: () => capturePhoto("library") },
                  { text: "Cancel",  style: "cancel" },
                ]
              )}
              disabled={uploadingPhoto}
            >
              <Text style={styles.photoAddBtnText}>{uploadingPhoto ? "…" : "+"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* ── Save ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={saveElement}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>
            {saving ? "Saving…" : filledCount === slots.length ? "✓  Save & Complete Element" : "Save Progress"}
          </Text>
        </TouchableOpacity>

        {!deviceId && (
          <Text style={styles.noDeviceNote}>
            No GLM device registered — values entered manually will still be saved.
          </Text>
        )}

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
  glmBannerText:      { fontSize: 13, color: "#2E86C1", fontWeight: "600" },

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

  hint:           { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#AED6F1" },
  hintText:       { fontSize: 12, color: "#2E86C1", fontStyle: "italic" },
  hintSub:        { fontSize: 11, color: "#7FB3D3", marginTop: 3 },

  saveBtn:        { backgroundColor: "#1E8449", borderRadius: 12, padding: 18,
                    alignItems: "center", marginTop: 4 },
  saveBtnDisabled:{ opacity: 0.5 },
  saveBtnText:    { color: "#fff", fontSize: 16, fontWeight: "700" },

  noDeviceNote:   { fontSize: 12, color: "#E67E22", textAlign: "center",
                    paddingHorizontal: 20, lineHeight: 18, marginTop: -4 },

  photoSection:   { backgroundColor: "#fff", borderRadius: 12, padding: 14,
                    elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  photoLabel:     { fontSize: 11, fontWeight: "700", color: "#888",
                    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  photoScroll:    { flexGrow: 0 },
  photoRow:       { gap: 8, alignItems: "center" },
  photoThumb:     { width: 72, height: 72, borderRadius: 8, backgroundColor: "#EEF2F7" },
  photoAddBtn:    { width: 72, height: 72, borderRadius: 8, borderWidth: 2,
                    borderColor: "#DDE", borderStyle: "dashed",
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: "#F8FAFC" },
  photoAddBtnText:{ fontSize: 28, color: "#2E86C1", lineHeight: 34, fontWeight: "300" },
});
