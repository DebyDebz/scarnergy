import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ExpoRoomScannerView, DetectedOpening } from "expo-room-scanner";
import { useAuthStore } from "../../../store/authStore";
import { useRoomScanner } from "../../../hooks/useRoomScanner";
import { OpeningReviewList, ReviewItem } from "../../../components/inspection/OpeningReviewList";
import { clientUUID, OpeningType, saveOpenings } from "../../../lib/saveOpenings";

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

  const setItemType = (id: string, type: OpeningType) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, type } : it)));
  };
  const toggleKeep = (id: string) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, keep: !it.keep } : it)));
  };
  const setDims = (id: string, widthMm: number, heightMm: number, confirmedByLaser: boolean) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, widthMm, heightMm, confirmedByLaser } : it)));
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
      await saveOpenings(toSave, {
        sessionId, zoneId, orgId: profile.org_id, inspectorId: profile.id, source: "LiDAR",
      });
      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [items, profile, sessionId, zoneId, router]);

  const tryAgain = useCallback(() => {
    scanner.reset();
    scanner.startScan();
  }, [scanner]);

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
      {scanner.state === "error" ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>Scan failed</Text>
          <Text style={styles.errorMessage}>{scanner.errorMessage}</Text>
          <TouchableOpacity style={styles.startBtn} onPress={tryAgain}>
            <Text style={styles.startBtnText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.errorBackBtn} onPress={() => router.back()}>
            <Text style={styles.errorBackBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : scanner.state !== "done" ? (
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
        <OpeningReviewList
          items={items}
          saving={saving}
          onSetType={setItemType}
          onToggleKeep={toggleKeep}
          onSetDims={setDims}
          onSave={save}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F5F7FA" },
  centerText: { fontSize: 15, color: "#374151", textAlign: "center", marginBottom: 20 },
  errorWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F5F7FA", gap: 12 },
  errorTitle: { fontSize: 18, fontWeight: "700", color: "#C0392B" },
  errorMessage: { fontSize: 14, color: "#374151", textAlign: "center", lineHeight: 20, marginBottom: 12 },
  errorBackBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  errorBackBtnText: { color: "#6b7280", fontWeight: "600", fontSize: 14 },
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
});
