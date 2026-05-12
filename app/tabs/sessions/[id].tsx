import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase, SessionSummary, Measurement } from "../../../lib/supabase";
import { useBLE } from "../../../lib/BLEContext";
import { useSyncQueue } from "../../../hooks/useSyncQueue";
import { useLiveMeasurements } from "../../../hooks/useLiveMeasurements";
import { useAuthStore } from "../../../store/authStore";
import { GLMMeasurement } from "../../../hooks/useBLEDevice";

function clientUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export default function SessionDetailScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuthStore();
  const { state: bleState, deviceName, deviceId, isConnected, scan, disconnect, setOnMeasurement } = useBLE();
  const { enqueue } = useSyncQueue();
  const { measurements, loading: measLoading } = useLiveMeasurements(sessionId ?? null);

  const [session, setSession] = useState<SessionSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [anomalyCount, setAnomalyCount] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from("session_summary")
      .select("*")
      .eq("id", sessionId)
      .single()
      .then(({ data }) => { setSession(data); setSessionLoading(false); });
  }, [sessionId]);

  // Sync live count from the realtime feed
  useEffect(() => {
    setSavedCount(measurements.length);
    setAnomalyCount(measurements.filter(m => m.is_anomaly).length);
  }, [measurements]);

  const saveMeasurement = useCallback(async (m: GLMMeasurement) => {
    if (!profile || !sessionId || !deviceId) return;

    const isAnomaly = m.value_mm <= 0 || m.value_mm > 50_000;
    const now = new Date().toISOString();
    const row = {
      id:               clientUUID(),
      measured_at:      now,
      org_id:           profile.org_id,
      session_id:       sessionId,
      device_id:        deviceId,
      inspector_id:     profile.id,
      value_mm:         m.value_mm,
      unit:             "mm",
      is_anomaly:       isAnomaly,
      ingestion_path:   "mobile",
      client_timestamp: m.timestamp,
    };

    const { error } = await supabase.from("measurements").insert(row);
    if (error) {
      // Offline — queue for later sync
      await enqueue({ table: "measurements", operation: "INSERT", payload: row });
    }
  }, [profile, sessionId, deviceId, enqueue]);

  const startStreaming = useCallback(() => {
    if (!isConnected) { Alert.alert("Not Connected", "Connect a GLM 50C first."); return; }
    if (!deviceId) { Alert.alert("Device Not Registered", "This device is not in the database. Register it from the Device tab first."); return; }
    setStreaming(true);
    setOnMeasurement(saveMeasurement);
  }, [isConnected, deviceId, setOnMeasurement, saveMeasurement]);

  const stopStreaming = useCallback(() => {
    setStreaming(false);
    setOnMeasurement(() => {});
  }, [setOnMeasurement]);

  // Stop streaming when BLE disconnects
  useEffect(() => {
    if (!isConnected && streaming) stopStreaming();
  }, [isConnected, streaming, stopStreaming]);

  if (sessionLoading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (!session)       return <Text style={styles.error}>Session not found.</Text>;

  const bleLabel = bleState === "scanning"    ? "Scanning..."
                 : bleState === "connecting"  ? "Connecting..."
                 : isConnected               ? `${deviceName ?? "GLM 50C"}`
                 : "No device";

  return (
    <View style={styles.container}>
      {/* ── Session header ── */}
      <View style={styles.header}>
        <Text style={styles.code}>{session.session_code}</Text>
        <Text style={styles.address}>{session.building_address}, {session.building_city}</Text>
      </View>

      {/* ── BLE status bar ── */}
      <View style={styles.bleBar}>
        <View style={[styles.bleDot, { backgroundColor: isConnected ? "#1E8449" : "#AAAAAA" }]} />
        <Text style={styles.bleLabel}>{bleLabel}</Text>
        <View style={styles.bleSpacer} />
        {isConnected
          ? <TouchableOpacity onPress={disconnect} style={styles.bleBtn}>
              <Text style={styles.bleBtnText}>Disconnect</Text>
            </TouchableOpacity>
          : <TouchableOpacity onPress={scan} style={[styles.bleBtn, styles.bleBtnPrimary]}>
              <Text style={[styles.bleBtnText, { color: "#fff" }]}>Scan</Text>
            </TouchableOpacity>
        }
      </View>

      {/* ── Stats ── */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{savedCount}</Text>
          <Text style={styles.statLabel}>measurements</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, anomalyCount > 0 && styles.statAnomaly]}>{anomalyCount}</Text>
          <Text style={styles.statLabel}>anomalies</Text>
        </View>
        <TouchableOpacity
          style={[styles.streamBtn, streaming && styles.streamBtnActive]}
          onPress={streaming ? stopStreaming : startStreaming}
        >
          <Text style={styles.streamBtnText}>{streaming ? "⏹ Stop" : "▶ Stream"}</Text>
        </TouchableOpacity>
      </View>

      {streaming && (
        <View style={styles.streamingBanner}>
          <Text style={styles.streamingText}>● Streaming — every GLM reading is saved automatically</Text>
        </View>
      )}

      {/* ── Live feed ── */}
      {measLoading
        ? <ActivityIndicator style={{ marginTop: 24 }} color="#1E3A5F" />
        : <FlatList
            data={measurements}
            keyExtractor={m => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>No measurements yet.{"\n"}Connect a GLM 50C and tap Stream.</Text>
            }
            renderItem={({ item }) => (
              <View style={[styles.row, item.is_anomaly && styles.rowAnomaly]}>
                <Text style={styles.rowVal}>{item.value_mm.toFixed(1)} mm</Text>
                <Text style={styles.rowTime}>
                  {new Date(item.measured_at).toLocaleTimeString("nl-NL")}
                </Text>
                {item.is_anomaly && <Text style={styles.rowAnomalyBadge}>⚠</Text>}
              </View>
            )}
          />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: "#F5F7FA" },
  loader:            { flex: 1 },
  error:             { flex: 1, textAlign: "center", color: "#E74C3C", padding: 40, marginTop: 40 },
  header:            { backgroundColor: "#1E3A5F", padding: 16, paddingTop: 20 },
  code:              { fontSize: 18, fontWeight: "700", color: "#fff" },
  address:           { fontSize: 13, color: "#A9C4E4", marginTop: 2 },
  bleBar:            { flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
                       paddingHorizontal: 16, paddingVertical: 10,
                       borderBottomWidth: 1, borderBottomColor: "#EEE" },
  bleDot:            { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  bleLabel:          { fontSize: 14, color: "#333", flex: 1 },
  bleSpacer:         { flex: 1 },
  bleBtn:            { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
                       borderWidth: 1, borderColor: "#CCC" },
  bleBtnPrimary:     { backgroundColor: "#1E3A5F", borderColor: "#1E3A5F" },
  bleBtnText:        { fontSize: 13, fontWeight: "600", color: "#333" },
  statsRow:          { flexDirection: "row", alignItems: "center", padding: 12,
                       backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#EEE" },
  statBox:           { alignItems: "center", marginRight: 24 },
  statNum:           { fontSize: 22, fontWeight: "700", color: "#1E3A5F" },
  statAnomaly:       { color: "#E67E22" },
  statLabel:         { fontSize: 11, color: "#888", marginTop: 1 },
  streamBtn:         { marginLeft: "auto", paddingHorizontal: 16, paddingVertical: 8,
                       borderRadius: 8, backgroundColor: "#1E8449" },
  streamBtnActive:   { backgroundColor: "#C0392B" },
  streamBtnText:     { color: "#fff", fontWeight: "700", fontSize: 14 },
  streamingBanner:   { backgroundColor: "#EBF5FB", paddingVertical: 6, paddingHorizontal: 16 },
  streamingText:     { fontSize: 12, color: "#2E86C1", fontStyle: "italic" },
  list:              { padding: 12, gap: 6 },
  row:               { flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
                       borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
                       elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 2 },
  rowAnomaly:        { backgroundColor: "#FEF9E7", borderLeftWidth: 3, borderLeftColor: "#E67E22" },
  rowVal:            { fontSize: 16, fontWeight: "600", color: "#1A1A2E", flex: 1 },
  rowTime:           { fontSize: 12, color: "#888" },
  rowAnomalyBadge:   { marginLeft: 8, fontSize: 16 },
  empty:             { textAlign: "center", color: "#AAA", padding: 40, lineHeight: 22 },
});
