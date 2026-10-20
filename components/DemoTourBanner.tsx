import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useDemoTour } from "../store/demoTourStore";
import { DEMO_TOUR_STEPS } from "../lib/demoTour";

const NAVY = "#1E3A5F";
const ACCENT = "#2E86C1";

// Floating guide card for the demo-house walkthrough. Mounted once in the root
// layout; renders nothing unless a tour was started from a demo inspection.
export function DemoTourBanner() {
  const { active, step, minimized, sessionId, buildingId, go, setMinimized, exit } = useDemoTour();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  if (!active || !sessionId) return null;

  const s = DEMO_TOUR_STEPS[step];
  const total = DEMO_TOUR_STEPS.length;
  const last = step === total - 1;
  // Sit above the tab bar (~50 pt) plus the home indicator.
  const bottom = insets.bottom + 58;

  const takeMeThere = async () => {
    const t = s.target;
    setBusy(true);
    try {
      if (t.kind === "session") {
        router.navigate({
          pathname: "/tabs/sessions/[id]",
          params: { id: sessionId, ...(t.zone ? { zone: t.zone } : {}) },
        });
      } else if (t.kind === "facade") {
        router.push({ pathname: "/tabs/sessions/facade-photos", params: { sessionId, buildingId: buildingId ?? "" } });
      } else {
        const { data, error } = await supabase
          .from("building_elements")
          .select("id, zones!inner(building_id)")
          .eq("name", t.name)
          .eq("zones.building_id", buildingId ?? "")
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (error || !data) {
          Alert.alert("Not found", `"${t.name}" isn't in this house any more.`);
          return;
        }
        const dest = { pathname: "/tabs/sessions/inspect" as const, params: { elementId: (data as { id: string }).id, sessionId } };
        // Swap element screens instead of stacking one per step.
        if (pathname.includes("/inspect")) router.replace(dest);
        else router.push(dest);
      }
    } finally {
      setBusy(false);
    }
  };

  if (minimized) {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
        <TouchableOpacity style={styles.pill} onPress={() => setMinimized(false)} accessibilityLabel="Show walkthrough">
          <Text style={styles.pillText}>Walkthrough · {step + 1}/{total} ▴</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <View style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.eyebrow}>DEMO WALKTHROUGH · STEP {step + 1} OF {total}</Text>
          <TouchableOpacity onPress={() => setMinimized(true)} hitSlop={10} accessibilityLabel="Minimise walkthrough">
            <Text style={styles.icon}>▾</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={exit} hitSlop={10} accessibilityLabel="End walkthrough">
            <Text style={styles.icon}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.body}>{s.body}</Text>
        <View style={styles.see}>
          <Text style={styles.seeLabel}>YOU SHOULD SEE</Text>
          <Text style={styles.seeText}>{s.see}</Text>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, step === 0 && styles.btnDisabled]}
            onPress={() => go(step - 1)}
            disabled={step === 0}
          >
            <Text style={styles.btnGhostText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={takeMeThere} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Take me there</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => (last ? exit() : go(step + 1))}
          >
            <Text style={styles.btnGhostText}>{last ? "Finish" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 10, right: 10, alignItems: "center", zIndex: 1000, elevation: 20 },
  card: {
    width: "100%", maxWidth: 560, backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: "#D6E2EF",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  eyebrow: { flex: 1, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, color: "#6b7280" },
  icon: { fontSize: 16, color: "#6b7280", fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "700", color: NAVY },
  body: { fontSize: 13, lineHeight: 18, color: "#374151" },
  see: { backgroundColor: "#EEF4FA", borderRadius: 8, padding: 8, gap: 2 },
  seeLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8, color: NAVY },
  seeText: { fontSize: 12, lineHeight: 17, color: "#1f2937" },
  buttons: { flexDirection: "row", gap: 8, marginTop: 4 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: ACCENT, flex: 1.4 },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnGhost: { borderWidth: 1, borderColor: "#cbd5e1" },
  btnGhostText: { color: NAVY, fontWeight: "600", fontSize: 14 },
  btnDisabled: { opacity: 0.35 },
  pill: {
    backgroundColor: NAVY, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  pillText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
