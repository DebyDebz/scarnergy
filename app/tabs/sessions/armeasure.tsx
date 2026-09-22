import { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Pressable, Switch,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ExpoArMeasureView, ExpoArMeasureViewRef, ArMeasureResult, DetectionBox, TrackingStateEvent,
} from "expo-ar-measure";
import { useAuthStore } from "../../../store/authStore";
import { useArMeasure } from "../../../hooks/useArMeasure";
import { OpeningReviewList, ReviewItem } from "../../../components/inspection/OpeningReviewList";
import { clientUUID, OpeningType, saveOpenings } from "../../../lib/saveOpenings";

type Point = { x: number; y: number };
type ArItem = ReviewItem & { distanceMm: number };
type Pending = ArMeasureResult & { presetType?: OpeningType };

// Camera-only door/window measurement for devices without LiDAR. The inspector taps two
// opposite corners of an opening on the live camera view (or taps a box proposed by the
// bundled CoreML detector); the native view raycasts both onto the wall and returns mm.
export default function ArMeasureScreen() {
  const router = useRouter();
  const { sessionId, zoneId } = useLocalSearchParams<{ sessionId: string; zoneId: string }>();
  const profile = useAuthStore(s => s.profile);
  const { isSupported, isDetectorAvailable } = useArMeasure();
  const viewRef = useRef<ExpoArMeasureViewRef>(null);

  const [phase, setPhase] = useState<"measure" | "review">("measure");
  const [sessionKey, setSessionKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingStateEvent | null>(null);
  const [autoDetect, setAutoDetect] = useState(isDetectorAvailable);
  const [boxes, setBoxes] = useState<DetectionBox[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [items, setItems] = useState<ArItem[]>([]);
  const [saving, setSaving] = useState(false);

  const measure = useCallback(async (a: Point, b: Point, presetType?: OpeningType) => {
    if (!viewRef.current) return;
    setMeasuring(true);
    try {
      const result = await viewRef.current.measureRect(a.x, a.y, b.x, b.y);
      if (result.widthMm < 50 || result.heightMm < 50) {
        Alert.alert("Too small", "Those two points are almost on top of each other — tap opposite corners of the opening.");
        setPoints([]);
        return;
      }
      setPending({ ...result, presetType });
    } catch (e: any) {
      Alert.alert("Couldn't measure", e?.message ?? "Unknown error");
      setPoints([]);
    } finally {
      setMeasuring(false);
    }
  }, []);

  const onTap = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (pending || measuring) return;
    const next = [...points, { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
    setPoints(next);
    if (next.length === 2) measure(next[0], next[1]);
  }, [pending, measuring, points, measure]);

  const onBoxTap = useCallback((box: DetectionBox) => {
    if (pending || measuring) return;
    const a = { x: box.x, y: box.y };
    const b = { x: box.x + box.width, y: box.y + box.height };
    setPoints([a, b]);
    measure(a, b, box.label === "unknown" ? undefined : box.label);
  }, [pending, measuring, measure]);

  const addPending = useCallback((type: OpeningType) => {
    if (!pending) return;
    setItems(prev => [...prev, {
      id: clientUUID(), keep: true, type,
      widthMm: pending.widthMm, heightMm: pending.heightMm, distanceMm: pending.distanceMm,
    }]);
    setPending(null);
    setPoints([]);
  }, [pending]);

  const retake = useCallback(() => { setPending(null); setPoints([]); }, []);

  const tryAgain = useCallback(() => {
    setErrorMessage(null);
    setPoints([]);
    setPending(null);
    setSessionKey(k => k + 1);
  }, []);

  const setItemType = (id: string, type: OpeningType) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, type } : it)));
  const toggleKeep = (id: string) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, keep: !it.keep } : it)));
  const setDims = (id: string, widthMm: number, heightMm: number, confirmedByLaser: boolean) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, widthMm, heightMm, confirmedByLaser } : it)));

  const save = useCallback(async () => {
    if (!profile || !sessionId || !zoneId) return;
    const toSave = items.filter(i => i.keep);
    if (toSave.length === 0) { router.back(); return; }
    setSaving(true);
    try {
      await saveOpenings(toSave, {
        sessionId, zoneId, orgId: profile.org_id, inspectorId: profile.id, source: "AR",
      });
      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [items, profile, sessionId, zoneId, router]);

  if (!isSupported) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>
          AR measurement needs an iPhone or iPad that supports ARKit and a development or
          production build — it isn't available here.
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorTitle}>AR failed</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={tryAgain}>
          <Text style={styles.primaryBtnText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()}>
          <Text style={styles.linkBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "review") {
    return (
      <View style={styles.container}>
        <OpeningReviewList
          items={items}
          saving={saving}
          onSetType={setItemType}
          onToggleKeep={toggleKeep}
          onSetDims={setDims}
          onSave={save}
          renderMeta={it => `from ${((it as ArItem).distanceMm / 1000).toFixed(1)} m`}
        />
        <TouchableOpacity style={styles.backToCameraBtn} onPress={() => setPhase("measure")}>
          <Text style={styles.linkBtnText}>Measure more</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hint = hintFor(tracking, points.length, !!pending);

  return (
    <View style={styles.container}>
      <View style={styles.cameraWrap}>
        <ExpoArMeasureView
          key={sessionKey}
          ref={viewRef}
          style={StyleSheet.absoluteFill}
          isActive
          detectionEnabled={autoDetect}
          onTrackingState={e => setTracking(e.nativeEvent)}
          onDetections={e => setBoxes(e.nativeEvent.boxes ?? [])}
          onError={e => setErrorMessage(e.nativeEvent.message)}
        />

        {/* Tap layer: collects the two corner points (or a detector box) in view coordinates. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onTap}>
          {autoDetect && !pending && boxes.map((box, i) => (
            <Pressable
              key={i}
              onPress={() => onBoxTap(box)}
              style={[styles.box, { left: box.x, top: box.y, width: box.width, height: box.height }]}
            >
              <Text style={styles.boxLabel}>
                {box.label === "unknown" ? "opening" : box.label} {Math.round(box.confidence * 100)}%
              </Text>
            </Pressable>
          ))}
          {points.map((p, i) => (
            <View key={i} pointerEvents="none" style={[styles.marker, { left: p.x - 10, top: p.y - 10 }]} />
          ))}
          {points.length === 2 && (
            <View
              pointerEvents="none"
              style={[styles.rect, {
                left: Math.min(points[0].x, points[1].x), top: Math.min(points[0].y, points[1].y),
                width: Math.abs(points[1].x - points[0].x), height: Math.abs(points[1].y - points[0].y),
              }]}
            />
          )}
        </Pressable>

        <View style={styles.topBar} pointerEvents="box-none">
          <Text style={styles.hint}>{hint}</Text>
          {isDetectorAvailable && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Auto-detect</Text>
              <Switch value={autoDetect} onValueChange={setAutoDetect} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.controls}>
        {measuring ? (
          <View style={styles.row}><ActivityIndicator color="#fff" /><Text style={styles.controlsHint}>Measuring…</Text></View>
        ) : pending ? (
          <>
            <Text style={styles.pendingDims}>{pending.widthMm} mm × {pending.heightMm} mm</Text>
            <Text style={styles.controlsHint}>measured from {(pending.distanceMm / 1000).toFixed(1)} m away</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.typeBtn, pending.presetType === "window" && styles.typeBtnPreset]}
                onPress={() => addPending("window")}
              >
                <Text style={styles.typeBtnText}>Add Window</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, pending.presetType === "door" && styles.typeBtnPreset]}
                onPress={() => addPending("door")}
              >
                <Text style={styles.typeBtnText}>Add Door</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.linkBtn} onPress={retake}>
              <Text style={styles.linkBtnTextLight}>Retake</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.row}>
            {points.length > 0 && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPoints([])}>
                <Text style={styles.secondaryBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }, items.length === 0 && styles.primaryBtnDisabled]}
              disabled={items.length === 0}
              onPress={() => setPhase("review")}
            >
              <Text style={styles.primaryBtnText}>
                {items.length === 0 ? "No openings yet" : `Review ${items.length} & Save`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {!pending && !measuring && (
          <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()}>
            <Text style={styles.linkBtnTextLight}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function hintFor(tracking: TrackingStateEvent | null, pointCount: number, hasPending: boolean): string {
  if (hasPending) return "Confirm the opening type below, or retake.";
  if (tracking?.coaching) return "Follow the on-screen guide to find a wall.";
  if (tracking?.state === "limited") {
    switch (tracking.reason) {
      case "excessiveMotion": return "Move the phone more slowly.";
      case "insufficientFeatures": return "Point at a wall with more visible detail.";
      case "initializing": return "Starting up — move the phone slowly across the wall.";
      default: return "Tracking is limited — keep the wall in view.";
    }
  }
  if (tracking?.state === "notAvailable") return "Waiting for the camera…";
  return pointCount === 0
    ? "Tap the top-left corner of a door or window."
    : "Now tap the opposite (bottom-right) corner.";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  cameraWrap: { flex: 1, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F5F7FA" },
  centerText: { fontSize: 15, color: "#374151", textAlign: "center", marginBottom: 20 },
  errorWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F5F7FA", gap: 12 },
  errorTitle: { fontSize: 18, fontWeight: "700", color: "#C0392B" },
  errorMessage: { fontSize: 14, color: "#374151", textAlign: "center", lineHeight: 20, marginBottom: 12 },

  topBar: { position: "absolute", top: 0, left: 0, right: 0, padding: 16, gap: 8 },
  hint: { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, overflow: "hidden" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  toggleLabel: { color: "#fff", fontSize: 13, fontWeight: "600", textShadowColor: "#000", textShadowRadius: 4 },

  marker: { position: "absolute", width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: "#F1C40F", backgroundColor: "rgba(241,196,15,0.35)" },
  rect: { position: "absolute", borderWidth: 2, borderColor: "#F1C40F", backgroundColor: "rgba(241,196,15,0.12)" },
  box: { position: "absolute", borderWidth: 2, borderColor: "#2ECC71", backgroundColor: "rgba(46,204,113,0.10)", borderRadius: 4 },
  boxLabel: { alignSelf: "flex-start", backgroundColor: "#2ECC71", color: "#0B3D20", fontSize: 11, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderBottomRightRadius: 4 },

  controls: { padding: 20, backgroundColor: "#1E3A5F", gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  controlsHint: { color: "#cbd5e1", fontSize: 13, textAlign: "center" },
  pendingDims: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center" },
  primaryBtn: { backgroundColor: "#2E86C1", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: "center" },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: "#cbd5e1" },
  secondaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  typeBtn: { flex: 1, backgroundColor: "#1E8449", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  typeBtnPreset: { borderWidth: 2, borderColor: "#F1C40F" },
  typeBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  linkBtn: { paddingVertical: 8, alignItems: "center" },
  linkBtnText: { color: "#6b7280", fontWeight: "600", fontSize: 14 },
  linkBtnTextLight: { color: "#cbd5e1", fontWeight: "600", fontSize: 14 },
  backToCameraBtn: { position: "absolute", top: 16, right: 16 },
  doneBtn: { backgroundColor: "#2E86C1", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  doneBtnText: { color: "#fff", fontWeight: "700" },
});
