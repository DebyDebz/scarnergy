import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useBLE } from "../../lib/BLEContext";

const STATE_COLOR: Record<string, string> = {
  idle: "#888", scanning: "#F39C12", connecting: "#F39C12",
  connected: "#1E8449", disconnected: "#E74C3C", error: "#E74C3C",
};

export default function DeviceScreen() {
  const { state, lastMeasurement, deviceName, batteryLevel, errorMessage, scan, disconnect, isConnected } = useBLE();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status card */}
      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: STATE_COLOR[state] ?? "#888" }]} />
        <View style={styles.statusInfo}>
          <Text style={styles.deviceName}>{deviceName ?? "No device connected"}</Text>
          <Text style={[styles.statusText, { color: STATE_COLOR[state] }]}>
            {state === "scanning"    ? "Scanning for GLM devices..."
           : state === "connecting"  ? "Connecting..."
           : state === "connected"   ? "Connected"
           : state === "disconnected"? "Disconnected"
           : state === "error"       ? `Error: ${errorMessage}`
           : "Tap scan to connect"}
          </Text>
        </View>
        {batteryLevel !== null && (
          <View style={styles.battery}>
            <Text style={styles.batteryText}>{batteryLevel}%</Text>
            <Text style={styles.batteryIcon}>🔋</Text>
          </View>
        )}
      </View>

      {/* Action buttons */}
      {!isConnected ? (
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, state === "scanning" && styles.btnDisabled]}
          onPress={scan}
          disabled={state === "scanning" || state === "connecting"}
        >
          <Text style={styles.btnText}>
            {state === "scanning" ? "Scanning..." : "🔍  Scan for GLM 50C"}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={disconnect}>
          <Text style={styles.btnText}>Disconnect</Text>
        </TouchableOpacity>
      )}

      {/* Last measurement */}
      {lastMeasurement && (
        <View style={styles.measurementCard}>
          <Text style={styles.measurementLabel}>Last measurement</Text>
          <Text style={styles.measurementValue}>{lastMeasurement.value_mm.toFixed(1)} mm</Text>
          <Text style={styles.measurementMeta}>
            {new Date(lastMeasurement.timestamp).toLocaleTimeString("nl-NL")}
            {lastMeasurement.is_continuous ? "  •  continuous mode" : ""}
          </Text>
        </View>
      )}

      {/* Instructions */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>How to use</Text>
        <Text style={styles.instructionsText}>
          1. Make sure your Bosch GLM 50C is switched on{"\n"}
          2. Tap "Scan for GLM 50C" above{"\n"}
          3. The app will connect automatically{"\n"}
          4. In any inspection form, tap the 📏 icon next to a measurement field{"\n"}
          5. Pull the trigger on your GLM — the value auto-fills
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: "#F5F7FA" },
  content:            { padding: 20, gap: 16 },
  statusCard:         { backgroundColor: "#FFF", borderRadius: 16, padding: 20, flexDirection: "row", alignItems: "center", elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6 },
  statusDot:          { width: 16, height: 16, borderRadius: 8, marginRight: 14 },
  statusInfo:         { flex: 1 },
  deviceName:         { fontSize: 16, fontWeight: "700", color: "#1E3A5F" },
  statusText:         { fontSize: 13, marginTop: 2, fontWeight: "600" },
  battery:            { alignItems: "center" },
  batteryText:        { fontSize: 14, fontWeight: "700", color: "#1E3A5F" },
  batteryIcon:        { fontSize: 18 },
  btn:                { borderRadius: 12, padding: 16, alignItems: "center" },
  btnPrimary:         { backgroundColor: "#1E3A5F" },
  btnDanger:          { backgroundColor: "#E74C3C" },
  btnDisabled:        { opacity: 0.5 },
  btnText:            { color: "#FFF", fontSize: 16, fontWeight: "700" },
  measurementCard:    { backgroundColor: "#EBF5FB", borderRadius: 16, padding: 20, alignItems: "center", borderWidth: 1, borderColor: "#AED6F1" },
  measurementLabel:   { fontSize: 13, color: "#2E86C1", fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  measurementValue:   { fontSize: 48, fontWeight: "900", color: "#1E3A5F", marginVertical: 8 },
  measurementMeta:    { fontSize: 12, color: "#666" },
  instructions:       { backgroundColor: "#FFF", borderRadius: 16, padding: 20 },
  instructionsTitle:  { fontSize: 15, fontWeight: "700", color: "#1E3A5F", marginBottom: 12 },
  instructionsText:   { fontSize: 14, color: "#444", lineHeight: 22 },
});
