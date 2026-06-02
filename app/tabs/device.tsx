import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useBLE } from "../../lib/BLEContext";

const STATE_COLOR: Record<string, string> = {
  idle: "#888", scanning: "#F39C12", connecting: "#F39C12",
  connected: "#1E8449", disconnected: "#E74C3C", error: "#E74C3C",
};

export default function DeviceScreen() {
  const {
    state, lastMeasurement, lastTriggerMeasurement,
    deviceName, deviceId, batteryLevel, errorMessage,
    rawPacketCount, cmdEnabled,
    scan, disconnect, isConnected,
  } = useBLE();

  // Primary card shows the last trigger-press (stable) if one exists,
  // otherwise falls back to the live streaming value.
  const displayM        = lastTriggerMeasurement ?? lastMeasurement;
  const displayIsTrigger = !!lastTriggerMeasurement;

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
          {isConnected && (
            <Text style={[styles.regBadge, { color: deviceId ? "#1E8449" : "#E67E22" }]}>
              {deviceId ? "Registered" : "Registering…"}
            </Text>
          )}
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

      {/* BLE packet counter — shows whether button presses trigger notifications */}
      {isConnected && (
        <>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>BLE packets received</Text>
            <Text style={styles.debugValue}>{rawPacketCount}</Text>
          </View>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>Trigger-press GATT mode</Text>
            <Text style={[styles.debugValue, { color: cmdEnabled ? "#1E8449" : "#E67E22" }]}>
              {cmdEnabled ? "Active ✓" : "Fallback (continuous)"}
            </Text>
          </View>
        </>
      )}

      {/* Primary measurement card — stable trigger-press OR live stream if no trigger yet */}
      {displayM && (
        <View style={[styles.measurementCard, displayIsTrigger && styles.measurementCardTrigger]}>
          <View style={styles.measurementHeader}>
            <Text style={[styles.measurementLabel, displayIsTrigger && styles.measurementLabelTrigger]}>
              {displayIsTrigger ? "LAST CAPTURED" : "LIVE STREAM"}
            </Text>
            <View style={[styles.modeBadge, displayIsTrigger && styles.modeBadgeTrigger]}>
              <Text style={[styles.modeBadgeText, displayIsTrigger && styles.modeBadgeTextTrigger]}>
                {displayIsTrigger ? "✓ TRIGGER PRESS" : "● STREAMING"}
              </Text>
            </View>
          </View>
          <View style={styles.measurementValueRow}>
            <Text style={styles.measurementValue}>
              {(displayM.value_mm / 1000).toFixed(3)}
            </Text>
            <Text style={[styles.measurementUnit, displayIsTrigger && styles.measurementUnitTrigger]}>m</Text>
          </View>
          <Text style={styles.measurementMeta}>
            {displayM.value_mm.toFixed(1)} mm{"  •  "}
            {new Date(displayM.timestamp).toLocaleTimeString("nl-NL", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
            {displayM.battery_level > 0 && `  •  🔋 ${displayM.battery_level}%`}
          </Text>
        </View>
      )}

      {/* Live stream strip — only shown alongside a captured value so the user can
          see what the device currently points at while a prior measurement stays stable */}
      {lastTriggerMeasurement && lastMeasurement?.is_continuous && (
        <View style={styles.liveStrip}>
          <View style={styles.liveStripDot} />
          <Text style={styles.liveStripLabel}>Live  </Text>
          <Text style={styles.liveStripValue}>
            {(lastMeasurement.value_mm / 1000).toFixed(3)} m
          </Text>
          <Text style={styles.liveStripMm}> · {lastMeasurement.value_mm.toFixed(1)} mm</Text>
        </View>
      )}

      {/* Instructions */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>How to use</Text>
        <Text style={styles.instructionsText}>
          1. Make sure your Bosch GLM 50C is switched on and Bluetooth active{"\n"}
          2. Tap "Scan for GLM 50C" above{"\n"}
          3. The app connects and attempts to activate trigger-press mode{"\n"}
          {"\n"}
          {"  "}If "Trigger-press GATT mode" shows Active:{"\n"}
          {"  "}4a. In an inspection, tap ▶ GLM next to a field{"\n"}
          {"  "}5a. Aim at the surface and press the GLM trigger — slot auto-fills{"\n"}
          {"\n"}
          {"  "}If mode shows Fallback (continuous):{"\n"}
          {"  "}4b. Aim the GLM at the surface first{"\n"}
          {"  "}5b. Watch the banner at the top of the inspect screen{"\n"}
          {"  "}6b. Tap ⊙ Capture when the correct value is shown{"\n"}
          {"\n"}
          {"  "}Alternative — GLM as keyboard (always reliable):{"\n"}
          {"  "}iOS: Settings → Bluetooth → pair the GLM 50C{"\n"}
          {"  "}Then tap a measurement field, aim, press trigger — value types in metres{"\n"}
          {"  "}The app auto-converts metres → mm on Enter
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
  measurementCard:        { backgroundColor: "#EBF5FB", borderRadius: 16, padding: 20, alignItems: "center", borderWidth: 1, borderColor: "#AED6F1" },
  measurementCardTrigger: { backgroundColor: "#EAFAF1", borderColor: "#A9DFBF" },
  measurementHeader:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 4 },
  measurementLabel:        { fontSize: 13, color: "#2E86C1", fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  measurementLabelTrigger: { color: "#1E8449" },
  measurementValueRow:    { flexDirection: "row", alignItems: "flex-end", marginVertical: 8 },
  measurementValue:       { fontSize: 48, fontWeight: "900", color: "#1E3A5F" },
  measurementUnit:        { fontSize: 22, fontWeight: "700", color: "#2E86C1", marginLeft: 6, marginBottom: 7 },
  measurementUnitTrigger: { color: "#1E8449" },
  measurementMeta:        { fontSize: 12, color: "#666" },
  modeBadge:              { backgroundColor: "#2E86C122", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  modeBadgeTrigger:       { backgroundColor: "#1E844922" },
  modeBadgeText:          { fontSize: 10, fontWeight: "700", color: "#2E86C1", letterSpacing: 0.5 },
  modeBadgeTextTrigger:   { color: "#1E8449" },

  liveStrip:      { backgroundColor: "#EBF5FB", borderRadius: 10, paddingVertical: 10,
                    paddingHorizontal: 14, flexDirection: "row", alignItems: "center",
                    borderWidth: 1, borderColor: "#AED6F1" },
  liveStripDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2E86C1", marginRight: 8 },
  liveStripLabel: { fontSize: 12, color: "#2E86C1", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  liveStripValue: { fontSize: 15, fontWeight: "800", color: "#1E3A5F" },
  liveStripMm:    { fontSize: 12, color: "#888", marginLeft: 2 },
  instructions:       { backgroundColor: "#FFF", borderRadius: 16, padding: 20 },
  instructionsTitle:  { fontSize: 15, fontWeight: "700", color: "#1E3A5F", marginBottom: 12 },
  instructionsText:   { fontSize: 14, color: "#444", lineHeight: 22 },
  regBadge:           { fontSize: 11, fontWeight: "700", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  debugRow:           { backgroundColor: "#FFF", borderRadius: 12, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  debugLabel:         { fontSize: 13, color: "#888" },
  debugValue:         { fontSize: 16, fontWeight: "700", color: "#1E3A5F" },

});
