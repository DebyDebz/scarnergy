import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ExpoRoomScannerView, DetectedOpening, DetectedOpeningType } from "expo-room-scanner";
import { supabase } from "../../../lib/supabase";
import { useAuthStore } from "../../../store/authStore";
import { useRoomScanner } from "../../../hooks/useRoomScanner";
import { FieldSelect } from "../../../components/ui/FieldSelect";

function clientUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const TYPE_LABEL: Record<DetectedOpeningType, string> = { window: "Window", door: "Door" };

// A detected opening is editable/removable before it's written — RoomPlan can
// misclassify or pick up a false positive, and this is the inspector's only
// chance to correct that before it becomes a permanent building_elements row.
type ReviewItem = DetectedOpening & { id: string; keep: boolean };

export default function RoomScanScreen() {
  const router = useRouter();
  const { sessionId, zoneId } = useLocalSearchParams<{ sessionId: string; zoneId: string }>();
  const profile = useAuthStore(s => s.profile);
  const scanner = useRoomScanner();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [saving, setSaving] = useState(false);

  const onCaptureFinish = useCallback((event: { nativeEvent: { openings: DetectedOpening[] } }) => {
    const openings = event.nativeEvent.openings ?? [];
    setItems(openings.map(o => ({ ...o, id: clientUUID(), keep: true })));
    scanner.handleCaptureFinish(openings);
  }, [scanner]);

  const onCaptureError = useCallback((event: { nativeEvent: { message: string } }) => {
    scanner.handleCaptureError(event.nativeEvent.message);
    Alert.alert("Scan failed", event.nativeEvent.message);
  }, [scanner]);

  const setItemType = (id: string, type: DetectedOpeningType) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, type } : it)));
  };
  const toggleKeep = (id: string) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, keep: !it.keep } : it)));
  };

  const save = useCallback(async () => {
    if (!profile || !sessionId || !zoneId) return;
    const toSave = items.filter(i => i.keep);
    if (toSave.length === 0) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const item of toSave) {
        const label = `${TYPE_LABEL[item.type]} (LiDAR)`;

        const { data: element, error: elErr } = await supabase
          .from("building_elements")
          .insert({
            zone_id: zoneId,
            element_type: "transparant_deel",
            name: label,
            width_mm: item.widthMm,
            height_mm: item.heightMm,
            is_complete: true,
          })
          .select("id")
          .single();
        if (elErr) throw elErr;

        const { error: opErr } = await supabase.from("openings").insert({
          org_id: profile.org_id,
          element_id: element.id,
          opening_type: item.type,
          width_mm: item.widthMm,
          height_mm: item.heightMm,
        });
        if (opErr) throw opErr;

        const { error: mErr } = await supabase.from("measurements").insert([
          {
            id: clientUUID(), measured_at: now, org_id: profile.org_id,
            session_id: sessionId, device_id: null, inspector_id: profile.id,
            element_id: element.id, value_mm: item.widthMm, unit: "mm",
            is_anomaly: false, is_deleted: false, measurement_type: "width",
            ingestion_path: "mobile",
          },
          {
            id: clientUUID(), measured_at: now, org_id: profile.org_id,
            session_id: sessionId, device_id: null, inspector_id: profile.id,
            element_id: element.id, value_mm: item.heightMm, unit: "mm",
            is_anomaly: false, is_deleted: false, measurement_type: "height",
            ingestion_path: "mobile",
          },
        ]);
        if (mErr) throw mErr;
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [items, profile, sessionId, zoneId, router]);

  if (!scanner.isSupported) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>
          Room scanning needs a LiDAR-equipped iPhone/iPad (Pro models) and a development or
          production build — it isn't available here.
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {scanner.state !== "done" ? (
        <>
          <ExpoRoomScannerView
            style={styles.scannerView}
            isScanning={scanner.state === "scanning"}
            onCaptureFinish={onCaptureFinish}
            onCaptureError={onCaptureError}
          />
          <View style={styles.controls}>
            {scanner.state === "finishing" ? (
              <View style={styles.finishingRow}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.hint}>Processing scan…</Text>
              </View>
            ) : scanner.state === "scanning" ? (
              <TouchableOpacity style={styles.stopBtn} onPress={scanner.stopScan}>
                <Text style={styles.stopBtnText}>Finish Scan</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.startBtn} onPress={scanner.startScan}>
                <Text style={styles.startBtnText}>Start Scan</Text>
              </TouchableOpacity>
            )}
            {scanner.state !== "finishing" && (
              <Text style={styles.hint}>
                Walk slowly around the room, keeping doors and windows in view.
              </Text>
            )}
          </View>
        </>
      ) : (
        <View style={styles.reviewWrap}>
          <Text style={styles.reviewTitle}>
            {items.length} opening{items.length === 1 ? "" : "s"} detected
          </Text>
          <FlatList
            data={items}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.reviewList}
            renderItem={({ item }) => (
              <View style={[styles.reviewCard, !item.keep && styles.reviewCardOff]}>
                <View style={styles.reviewCardTop}>
                  <FieldSelect
                    label="Type"
                    value={item.type}
                    options={["window", "door"]}
                    onSelect={v => setItemType(item.id, v as DetectedOpeningType)}
                  />
                  <TouchableOpacity onPress={() => toggleKeep(item.id)} style={styles.keepBtn}>
                    <Text style={styles.keepBtnText}>{item.keep ? "Remove" : "Restore"}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.dims}>
                  {item.widthMm} mm × {item.heightMm} mm
                </Text>
              </View>
            )}
          />
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={save}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.saveBtnText}>
                Save {items.filter(i => i.keep).length} to Zone
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F5F7FA" },
  centerText: { fontSize: 15, color: "#374151", textAlign: "center", marginBottom: 20 },
  scannerView: { flex: 1 },
  controls: { padding: 20, backgroundColor: "#1E3A5F" },
  finishingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14 },
  hint: { color: "#cbd5e1", fontSize: 13, textAlign: "center", marginTop: 10 },
  startBtn: { backgroundColor: "#2E86C1", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  startBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  stopBtn: { backgroundColor: "#E74C3C", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  stopBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  doneBtn: { backgroundColor: "#2E86C1", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  doneBtnText: { color: "#fff", fontWeight: "700" },
  reviewWrap: { flex: 1, backgroundColor: "#F5F7FA", paddingTop: 16 },
  reviewTitle: { fontSize: 18, fontWeight: "700", color: "#1E3A5F", textAlign: "center", marginBottom: 12 },
  reviewList: { paddingHorizontal: 16, paddingBottom: 100 },
  reviewCard: {
    backgroundColor: "#fff", borderRadius: 12, marginBottom: 12, overflow: "hidden",
    elevation: 1, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  reviewCardOff: { opacity: 0.45 },
  reviewCardTop: { flexDirection: "row", alignItems: "center" },
  keepBtn: { paddingHorizontal: 16 },
  keepBtnText: { color: "#C0392B", fontWeight: "600", fontSize: 13 },
  dims: { fontSize: 13, color: "#6b7280", paddingHorizontal: 16, paddingBottom: 12 },
  saveBtn: {
    position: "absolute", left: 16, right: 16, bottom: 24,
    backgroundColor: "#1E8449", borderRadius: 12, paddingVertical: 16, alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
