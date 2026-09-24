import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, TextInput,
} from "react-native";
import { FieldSelect } from "../ui/FieldSelect";
import { OpeningType, OpeningToSave, OpeningSource, meetsTolerance } from "../../lib/saveOpenings";
import { useBLE } from "../../lib/BLEContext";
import { GLMMeasurement } from "../../hooks/useBLEDevice";

// A captured opening is editable/removable before it's written — both RoomPlan and a
// hand-tapped AR rectangle can misclassify or pick up a false positive, and this is the
// inspector's only chance to correct that before it becomes a permanent building_elements row.
export type ReviewItem = OpeningToSave & { id: string; keep: boolean };

type Dim = "width" | "height";

interface Props {
  items: ReviewItem[];
  saving: boolean;
  /** Capture path — decides whether unconfirmed values meet the 3 % tolerance. */
  source: OpeningSource;
  onSetType: (id: string, type: OpeningType) => void;
  onToggleKeep: (id: string) => void;
  /** Called when the inspector overwrites the detected dimensions (laser or typed). */
  onSetDims: (id: string, widthMm: number, heightMm: number, confirmedByLaser: boolean) => void;
  onSave: () => void;
  /** Optional per-item hint, e.g. the AR measurement distance. */
  renderMeta?: (item: ReviewItem) => string | null;
}

const fmt = (mm: number) => (mm / 1000).toFixed(3);
const parseM = (s: string) => {
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : Math.round(n * 1000);
};

export function OpeningReviewList({ items, saving, source, onSetType, onToggleKeep, onSetDims, onSave, renderMeta }: Props) {
  const { isConnected, cmdEnabled, lastMeasurement, setOnMeasurement, requestMeasurement } = useBLE();
  const keptCount = items.filter(i => i.keep).length;

  // ── Remeasure state: one item at a time, width then height ──
  // Detection gives a rough size; the inspector confirms it with the laser. Each
  // trigger press fills the armed dimension and arms the other, so both come in
  // with no taps (same auto-advance as the inspect screen). Values can also be
  // typed, for when the laser isn't connected.
  const [remeasureId, setRemeasureId] = useState<string | null>(null);
  const [armed, setArmed] = useState<Dim | null>(null);
  const [draft, setDraft] = useState<{ width: string; height: string }>({ width: "", height: "" });
  const [laserFilled, setLaserFilled] = useState<{ width: boolean; height: boolean }>({ width: false, height: false });
  const armedRef = useRef<Dim | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const setArmedSync = useCallback((d: Dim | null) => { armedRef.current = d; setArmed(d); }, []);

  const arm = useCallback((d: Dim | null) => {
    setArmedSync(d);
    // Only re-arm the device in GATT trigger-press mode; in continuous-only mode an
    // armed pending ref would fill from the next 200 ms heartbeat before the user aims.
    if (d && isConnected && cmdEnabled) requestMeasurement();
  }, [setArmedSync, isConnected, cmdEnabled, requestMeasurement]);

  const fill = useCallback((d: Dim, valueMm: number) => {
    setDraft(prev => ({ ...prev, [d]: fmt(valueMm) }));
    setLaserFilled(prev => ({ ...prev, [d]: true }));
    // Advance to the other dimension if it's still empty; otherwise we're done arming.
    const other: Dim = d === "width" ? "height" : "width";
    arm(parseM(draftRef.current[other]) == null ? other : null);
  }, [arm]);

  // Trigger-press packets always dispatch (explicit user intent); fill the armed slot.
  useEffect(() => {
    if (!remeasureId) return;
    setOnMeasurement((m: GLMMeasurement) => {
      const d = armedRef.current;
      if (!d) return;
      fill(d, m.value_mm);
    });
    return () => setOnMeasurement(() => {});
  }, [remeasureId, setOnMeasurement, fill]);

  const startRemeasure = (item: ReviewItem) => {
    setDraft({ width: fmt(item.widthMm), height: fmt(item.heightMm) });
    setLaserFilled({ width: false, height: false });
    setRemeasureId(item.id);
    arm("width");
  };

  const cancelRemeasure = () => { setRemeasureId(null); setArmedSync(null); };

  const applyRemeasure = (item: ReviewItem) => {
    const w = parseM(draft.width);
    const h = parseM(draft.height);
    if (w == null || h == null) return;
    onSetDims(item.id, w, h, laserFilled.width && laserFilled.height);
    cancelRemeasure();
  };

  return (
    <View style={styles.reviewWrap}>
      <Text style={styles.reviewTitle}>
        {items.length} opening{items.length === 1 ? "" : "s"} captured
      </Text>
      <Text style={styles.reviewSub}>
        {source === "AR"
          ? "Camera estimates are outside the 3 % limit — remeasure with the laser to mark them complete."
          : "Detected sizes are estimates — use Remeasure to confirm with the laser."}
      </Text>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.reviewList}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const meta = renderMeta?.(item);
          const isRemeasuring = remeasureId === item.id;
          const canApply = parseM(draft.width) != null && parseM(draft.height) != null;
          return (
            <View style={[styles.reviewCard, !item.keep && styles.reviewCardOff]}>
              <View style={styles.reviewCardTop}>
                <View style={{ flex: 1 }}>
                  {item.type === "wall" ? (
                    <Text style={styles.wallLabel}>Wall</Text>
                  ) : (
                    <FieldSelect
                      label="Type"
                      value={item.type}
                      options={["window", "door"]}
                      onSelect={v => onSetType(item.id, v as OpeningType)}
                    />
                  )}
                </View>
                <TouchableOpacity onPress={() => onToggleKeep(item.id)} style={styles.keepBtn}>
                  <Text style={styles.keepBtnText}>{item.keep ? "Remove" : "Restore"}</Text>
                </TouchableOpacity>
              </View>

              {!isRemeasuring ? (
                <View style={styles.dimsRow}>
                  <Text style={styles.dims}>
                    {item.type === "wall" ? "L " : ""}{item.widthMm} mm × {item.type === "wall" ? "H " : ""}{item.heightMm} mm
                    {meta ? `  ·  ${meta}` : ""}
                    {!meetsTolerance(item, source) ? "  ·  estimate" : ""}
                  </Text>
                  {item.confirmedByLaser
                    ? <Text style={styles.confirmedTag}>✓ laser</Text>
                    : item.keep && (
                      <TouchableOpacity
                        style={styles.remeasureBtn}
                        onPress={() => startRemeasure(item)}
                        disabled={remeasureId != null}
                      >
                        <Text style={styles.remeasureBtnText}>📏 Remeasure</Text>
                      </TouchableOpacity>
                    )}
                </View>
              ) : (
                <View style={styles.remeasurePanel}>
                  {(["width", "height"] as Dim[]).map(d => {
                    const isArmed = armed === d;
                    return (
                      <View key={d} style={[styles.dimRow, isArmed && styles.dimRowArmed]}>
                        <TouchableOpacity onPress={() => arm(d)} style={styles.dimLabelBtn}>
                          <Text style={[styles.dimLabel, isArmed && styles.dimLabelArmed]}>
                            {isArmed ? "● " : ""}{d === "width" ? "Width" : "Height"}
                          </Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.dimInput, isArmed && styles.dimInputArmed]}
                          value={draft[d]}
                          onChangeText={v => {
                            setDraft(prev => ({ ...prev, [d]: v }));
                            setLaserFilled(prev => ({ ...prev, [d]: false }));
                          }}
                          onFocus={() => setArmedSync(d)}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          allowFontScaling={false}
                        />
                        <Text style={styles.dimUnit}>m</Text>
                        {laserFilled[d] && <Text style={styles.confirmedTag}>✓</Text>}
                      </View>
                    );
                  })}

                  <Text style={styles.hint}>
                    {!isConnected
                      ? "No measuring device connected — type the values, or connect the laser from the session screen."
                      : cmdEnabled
                        ? `Aim at the ${armed ?? "next"} edge and press the laser trigger.`
                        : `Aim at the ${armed ?? "next"} edge, then tap Capture.`}
                  </Text>

                  {isConnected && !cmdEnabled && armed && lastMeasurement && (
                    <TouchableOpacity
                      style={styles.captureBtn}
                      onPress={() => fill(armed, lastMeasurement.value_mm)}
                    >
                      <Text style={styles.captureBtnText}>
                        Capture live {fmt(lastMeasurement.value_mm)} m
                      </Text>
                    </TouchableOpacity>
                  )}

                  <View style={styles.remeasureActions}>
                    <TouchableOpacity style={styles.linkBtn} onPress={cancelRemeasure}>
                      <Text style={styles.linkBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.applyBtn, !canApply && styles.applyBtnDisabled]}
                      disabled={!canApply}
                      onPress={() => applyRemeasure(item)}
                    >
                      <Text style={styles.applyBtnText}>Use these</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        }}
      />
      <TouchableOpacity
        style={[styles.saveBtn, (saving || remeasureId != null) && styles.saveBtnDisabled]}
        onPress={onSave}
        disabled={saving || remeasureId != null}
      >
        {saving ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.saveBtnText}>Save {keptCount} to Zone</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const PRIMARY = "#1E3A5F";

const styles = StyleSheet.create({
  reviewWrap: { flex: 1, backgroundColor: "#F5F7FA", paddingTop: 16 },
  reviewTitle: { fontSize: 18, fontWeight: "700", color: PRIMARY, textAlign: "center" },
  reviewSub: { fontSize: 12, color: "#6b7280", textAlign: "center", marginTop: 4, marginBottom: 12, paddingHorizontal: 24 },
  reviewList: { paddingHorizontal: 16, paddingBottom: 100 },
  reviewCard: {
    backgroundColor: "#fff", borderRadius: 12, marginBottom: 12, overflow: "hidden",
    elevation: 1, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  reviewCardOff: { opacity: 0.45 },
  reviewCardTop: { flexDirection: "row", alignItems: "center" },
  keepBtn: { paddingHorizontal: 16 },
  keepBtnText: { color: "#C0392B", fontWeight: "600", fontSize: 13 },
  wallLabel: { fontSize: 14, fontWeight: "600", color: "#374151", paddingVertical: 12, paddingHorizontal: 16 },

  dimsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  dims: { flex: 1, fontSize: 13, color: "#6b7280" },
  remeasureBtn: { borderWidth: 1, borderColor: "#2E86C1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  remeasureBtnText: { color: "#2E86C1", fontWeight: "700", fontSize: 12 },
  confirmedTag: { color: "#1E8449", fontWeight: "700", fontSize: 12 },

  remeasurePanel: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  dimRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, padding: 6, borderWidth: 1, borderColor: "transparent" },
  dimRowArmed: { borderColor: "#2E86C1", backgroundColor: "#EBF5FB" },
  dimLabelBtn: { width: 70 },
  dimLabel: { fontSize: 13, fontWeight: "600", color: "#374151" },
  dimLabelArmed: { color: "#2E86C1" },
  dimInput: { flex: 1, height: 40, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 10, fontSize: 16, color: "#111827", backgroundColor: "#fff" },
  dimInputArmed: { borderColor: "#2E86C1" },
  dimUnit: { width: 18, fontSize: 13, color: "#6b7280" },
  hint: { fontSize: 12, color: "#2E86C1", fontStyle: "italic" },
  captureBtn: { backgroundColor: "#2E86C1", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  captureBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  remeasureActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 4 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 8 },
  linkBtnText: { color: "#6b7280", fontWeight: "600", fontSize: 14 },
  applyBtn: { backgroundColor: "#1E8449", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  applyBtnDisabled: { opacity: 0.5 },
  applyBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  saveBtn: {
    position: "absolute", left: 16, right: 16, bottom: 24,
    backgroundColor: "#1E8449", borderRadius: 12, paddingVertical: 16, alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
