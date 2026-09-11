import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../store/authStore";
import { supabase } from "../../lib/supabase";
import { useESP32Provisioning } from "../../hooks/useESP32Provisioning";

const STATE_COLOR: Record<string, string> = {
  idle: "#888", scanning: "#F39C12", connecting: "#F39C12", connected: "#2E86C1",
  writing: "#F39C12", done: "#1E8449", error: "#E74C3C",
};

// Good enough for a device identifier (not a security token) — avoids
// pulling in expo-crypto/uuid just for this one screen.
function generateUuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function ESP32ProvisioningScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const { state, errorMessage, deviceMac, provision, reset } = useESP32Provisioning();

  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [mqttHost, setMqttHost] = useState("");
  const [mqttPort, setMqttPort] = useState("1883");
  const [saving, setSaving] = useState(false);

  const busy = state === "scanning" || state === "connecting" || state === "writing" || saving;

  async function handleProvision() {
    if (!profile?.org_id) return;
    const deviceId = generateUuidV4();
    const result = await provision({
      ssid, password, mqttHost,
      mqttPort: parseInt(mqttPort, 10) || 1883,
      orgId: profile.org_id,
      deviceId,
    });

    if (!result.ok) {
      Alert.alert("Provisioning failed", result.message);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("ble_devices").upsert({
      id: deviceId,
      org_id: profile.org_id,
      device_type: "other",
      mac_address: deviceMac ?? deviceId,
      nickname: "ESP32 Gateway",
      is_active: true,
      metadata: {
        kind: "esp32_gateway",
        wifi_ssid: ssid,
        mqtt_host: mqttHost,
        mqtt_port: parseInt(mqttPort, 10) || 1883,
        provisioned_at: new Date().toISOString(),
      },
    });
    setSaving(false);

    if (error) {
      // The device itself is already configured and will come online — this
      // only means it won't show up in the app's device list yet.
      Alert.alert("Provisioned, but not registered", `The device is configured and should connect shortly, but saving it here failed: ${error.message}`);
      return;
    }

    Alert.alert("Device provisioned", "The ESP32 gateway is configured and restarting — it will connect to your WiFi and start bridging GLM measurements shortly.", [
      { text: "Done", onPress: () => router.back() },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: STATE_COLOR[state] ?? "#888" }]} />
        <View style={styles.statusInfo}>
          <Text style={styles.title}>ESP32 Gateway Setup</Text>
          <Text style={[styles.statusText, { color: STATE_COLOR[state] }]}>
            {state === "scanning" ? "Scanning for an unprovisioned ESP32…"
              : state === "connecting" ? "Connecting…"
              : state === "connected" ? "Connected — sending config…"
              : state === "writing" ? "Waiting for the device to confirm…"
              : state === "done" ? "Provisioned ✓"
              : state === "error" ? `Error: ${errorMessage}`
              : "Enter WiFi + MQTT details, then provision"}
          </Text>
        </View>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>WiFi network name (SSID)</Text>
        <TextInput style={styles.input} value={ssid} onChangeText={setSsid} placeholder="Office-WiFi" autoCapitalize="none" />

        <Text style={styles.label}>WiFi password</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry autoCapitalize="none" />

        <Text style={styles.label}>MQTT broker host</Text>
        <TextInput style={styles.input} value={mqttHost} onChangeText={setMqttHost} placeholder="192.168.1.100" autoCapitalize="none" />

        <Text style={styles.label}>MQTT broker port</Text>
        <TextInput style={styles.input} value={mqttPort} onChangeText={setMqttPort} placeholder="1883" keyboardType="number-pad" />
      </View>

      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, (busy || !ssid || !password || !mqttHost) && styles.btnDisabled]}
        onPress={handleProvision}
        disabled={busy || !ssid || !password || !mqttHost}
      >
        <Text style={styles.btnText}>{busy ? "Provisioning…" : "🔧  Provision ESP32"}</Text>
      </TouchableOpacity>

      {state === "error" && (
        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={reset}>
          <Text style={styles.btnSecondaryText}>Try again</Text>
        </TouchableOpacity>
      )}

      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>How this works</Text>
        <Text style={styles.instructionsText}>
          1. Power on a new, never-configured ESP32 gateway — it advertises itself over Bluetooth as "SCARNERGY-ESP32-SETUP"{"\n"}
          2. Enter your WiFi and MQTT broker details above{"\n"}
          3. Tap "Provision ESP32" — the app scans for it, connects, and sends the config over Bluetooth{"\n"}
          4. The device saves the config and restarts — it then joins your WiFi and starts bridging GLM 50C measurements to MQTT on its own, no phone needed{"\n\n"}
          A device that's already been provisioned won't show up in the scan — this screen is only for first-time setup or re-provisioning after a reset.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#F5F7FA" },
  content:     { padding: 20, gap: 16 },
  statusCard:  { backgroundColor: "#FFF", borderRadius: 16, padding: 20, flexDirection: "row", alignItems: "center", elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6 },
  statusDot:   { width: 16, height: 16, borderRadius: 8, marginRight: 14 },
  statusInfo:  { flex: 1 },
  title:       { fontSize: 16, fontWeight: "700", color: "#1E3A5F" },
  statusText:  { fontSize: 13, marginTop: 2, fontWeight: "600" },
  form:        { backgroundColor: "#FFF", borderRadius: 16, padding: 20, gap: 4 },
  label:       { fontSize: 13, color: "#555", fontWeight: "600", marginTop: 10 },
  input:       { borderWidth: 1, borderColor: "#DDD", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginTop: 4 },
  btn:         { borderRadius: 12, padding: 16, alignItems: "center" },
  btnPrimary:  { backgroundColor: "#1E3A5F" },
  btnSecondary:{ backgroundColor: "#FFF", borderWidth: 1, borderColor: "#DDD" },
  btnDisabled: { opacity: 0.5 },
  btnText:         { color: "#FFF", fontSize: 16, fontWeight: "700" },
  btnSecondaryText:{ color: "#1E3A5F", fontSize: 15, fontWeight: "700" },
  instructions:      { backgroundColor: "#FFF", borderRadius: 16, padding: 20 },
  instructionsTitle: { fontSize: 15, fontWeight: "700", color: "#1E3A5F", marginBottom: 12 },
  instructionsText:  { fontSize: 14, color: "#444", lineHeight: 22 },
});
