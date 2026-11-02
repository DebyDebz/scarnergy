import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";

export interface FlowStepItem {
  key: string;
  title: string;
  status?: string;
  done?: boolean;
  busy?: boolean;
  /** Omit for an informational step (e.g. one done outside the app). */
  onPress?: () => void;
  cta?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  steps: FlowStepItem[];
  collapsible?: boolean;
}

// Numbered steps of the client's inspection flow. A guide, not a gate: every
// step stays tappable in any order (Nils, 2026-10-05).
export function FlowSteps({ title, subtitle, steps, collapsible }: Props) {
  const [open, setOpen] = useState(true);
  const doneCount = steps.filter(s => s.done).length;

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.head}
        disabled={!collapsible}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {collapsible && <Text style={styles.count}>{doneCount}/{steps.length} {open ? "▾" : "▸"}</Text>}
      </TouchableOpacity>
      {open && steps.map((s, i) => (
        <TouchableOpacity
          key={s.key}
          style={styles.row}
          onPress={s.onPress}
          disabled={!s.onPress || s.busy}
          activeOpacity={0.7}
        >
          <View style={[styles.num, s.done && styles.numDone]}>
            <Text style={[styles.numText, s.done && styles.numTextDone]}>{s.done ? "✓" : i + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}>{s.title}</Text>
            {s.status ? <Text style={styles.status}>{s.status}</Text> : null}
          </View>
          {s.busy
            ? <ActivityIndicator size="small" color="#2E86C1" />
            : s.onPress ? <Text style={styles.cta}>{s.cta ?? "Open"} ›</Text> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  head:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12,
                 backgroundColor: "#F0F4F8" },
  title:       { fontSize: 13, fontWeight: "800", color: "#1E3A5F", letterSpacing: 0.5, textTransform: "uppercase" },
  subtitle:    { fontSize: 12, color: "#6B7280", marginTop: 2 },
  count:       { fontSize: 13, fontWeight: "700", color: "#1E3A5F" },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11,
                 borderTopWidth: 1, borderTopColor: "#F0F4F8" },
  num:         { width: 26, height: 26, borderRadius: 13, backgroundColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  numDone:     { backgroundColor: "#1E8449" },
  numText:     { fontSize: 12, fontWeight: "800", color: "#6B7280" },
  numTextDone: { color: "#fff" },
  stepTitle:   { fontSize: 14, fontWeight: "700", color: "#1A1A2E" },
  status:      { fontSize: 12, color: "#6B7280", marginTop: 1 },
  cta:         { fontSize: 13, fontWeight: "700", color: "#2E86C1" },
});
