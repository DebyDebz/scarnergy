import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Animated, Easing, Alert
} from "react-native";
import { useBLE } from "../../lib/BLEContext";
import { GLMMeasurement } from "../../hooks/useBLEDevice";

interface Props {
  label:          string;
  measurementType: string;
  value:          string;
  unit?:          "mm" | "cm" | "m";
  onValueChange:  (value: string, raw_mm: number) => void;
  required?:      boolean;
  placeholder?:   string;
}

const UNIT_FACTORS: Record<string, number> = { mm: 1, cm: 0.1, m: 0.001 };

export function MeasurementInput({
  label, measurementType, value, unit = "mm", onValueChange, required, placeholder
}: Props) {
  const { setOnMeasurement, isConnected } = useBLE();
  const [listening, setListening] = useState(false);
  const [lastRawMm, setLastRawMm] = useState<number | null>(null);
  const [isAnomaly, setIsAnomaly] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const listenRef = useRef(false);

  // Pulse animation when listening
  useEffect(() => {
    if (listening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [listening]);

  const handleBLEPress = () => {
    if (!isConnected) {
      Alert.alert("No Device", "Connect a Bosch GLM 50C first from the Device screen.");
      return;
    }

    if (listening) {
      setListening(false);
      listenRef.current = false;
      setOnMeasurement(() => {});
      return;
    }

    setListening(true);
    listenRef.current = true;

    setOnMeasurement((m: GLMMeasurement) => {
      if (!listenRef.current) return;

      const factor   = UNIT_FACTORS[unit];
      const converted = parseFloat((m.value_mm * factor).toFixed(unit === "m" ? 3 : 1));
      const anomaly  = m.value_mm <= 0 || m.value_mm > 50_000;

      setLastRawMm(m.value_mm);
      setIsAnomaly(anomaly);
      onValueChange(String(converted), m.value_mm);

      setListening(false);
      listenRef.current = false;
      setOnMeasurement(() => {});
    });
  };

  const bleIconColor = listening ? "#2E86C1" : isConnected ? "#1E8449" : "#AAAAAA";

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}{required && <Text style={styles.required}> *</Text>}</Text>
        {lastRawMm !== null && (
          <Text style={[styles.rawLabel, isAnomaly && styles.anomalyLabel]}>
            {isAnomaly ? "⚠ anomaly" : `raw: ${lastRawMm}mm`}
          </Text>
        )}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, isAnomaly && styles.inputAnomaly]}
          value={value}
          onChangeText={v => onValueChange(v, parseFloat(v) / UNIT_FACTORS[unit])}
          keyboardType="decimal-pad"
          placeholder={placeholder ?? `Enter ${measurementType}...`}
          placeholderTextColor="#AAAAAA"
        />

        <Text style={styles.unitLabel}>{unit}</Text>

        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[styles.bleButton, listening && styles.bleButtonActive]}
            onPress={handleBLEPress}
            activeOpacity={0.7}
          >
            <Text style={[styles.bleIcon, { color: bleIconColor }]}>
              {listening ? "📡" : "📏"}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {listening && (
        <Text style={styles.listeningText}>Waiting for measurement from GLM 50C...</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { marginBottom: 16 },
  labelRow:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label:        { fontSize: 14, fontWeight: "600", color: "#1E3A5F" },
  required:     { color: "#E74C3C" },
  rawLabel:     { fontSize: 12, color: "#888888" },
  anomalyLabel: { color: "#E67E22", fontWeight: "600" },
  inputRow:     { flexDirection: "row", alignItems: "center" },
  input:        { flex: 1, height: 44, borderWidth: 1, borderColor: "#CCCCCC", borderRadius: 8,
                  paddingHorizontal: 12, fontSize: 16, color: "#1A1A2E", backgroundColor: "#F9F9F9" },
  inputAnomaly: { borderColor: "#E67E22", backgroundColor: "#FEF9E7" },
  unitLabel:    { width: 36, textAlign: "center", fontSize: 14, color: "#666", marginHorizontal: 4 },
  bleButton:    { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: "#CCCCCC",
                  alignItems: "center", justifyContent: "center", backgroundColor: "#F0F4FF" },
  bleButtonActive: { borderColor: "#2E86C1", backgroundColor: "#EBF5FB" },
  bleIcon:      { fontSize: 20 },
  listeningText: { marginTop: 4, fontSize: 12, color: "#2E86C1", fontStyle: "italic" },
});
