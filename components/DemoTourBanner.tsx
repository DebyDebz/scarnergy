import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, Animated, Easing, ActivityIndicator } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useDemoTour } from "../store/demoTourStore";
import { DEMO_TOURS, DemoTourTarget, autoplayDwellMs } from "../lib/demoTour";
import { isStepDone } from "../lib/demoTourChecks";

const NAVY = "#1E3A5F";
const ACCENT = "#2E86C1";

// Floating guide for the demo-house walkthrough, mounted once in the root layout.
//
// Each step first shows its instructions. "Try it" shrinks the card to a slim
// bar so the screen underneath is usable; tapping the bar brings the
// instructions back. Next / Back move to the step's screen automatically.
// Auto-play shows a compact card with a progress bar and moves on by itself,
// so a viewer can watch the whole flow without touching anything.
// The from-scratch guide (bare Demostraat 2) has no timer: the user does each
// task for real and the guide moves on when it sees the result in the database.
export function DemoTourBanner() {
  const { active, tour, step, minimized, autoplay, startedAt, sessionId, buildingId, go, setMinimized, setAutoplay, exit } = useDemoTour();
  const steps = DEMO_TOURS[tour];
  const progress = useRef(new Animated.Value(0)).current;
  const [stepDone, setStepDone] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  // Latest pathname for the navigation effect without re-running it on every route change.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const lastNavigated = useRef<number | null>(null);

  const navigateTo = async (t: DemoTourTarget) => {
    if (!sessionId) return;
    if (t.kind === "session") {
      router.navigate({
        pathname: "/tabs/sessions/[id]",
        params: { id: sessionId, ...(t.zone ? { zone: t.zone } : {}) },
      });
      return;
    }
    if (t.kind === "flow") {
      router.navigate({ pathname: "/tabs/sessions/flow", params: { id: sessionId, buildingId: buildingId ?? "" } });
      return;
    }
    if (t.kind === "facade") {
      router.push({ pathname: "/tabs/sessions/facade-photos", params: { sessionId, buildingId: buildingId ?? "" } });
      return;
    }
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
    if (pathRef.current.includes("/inspect")) router.replace(dest);
    else router.push(dest);
  };

  // Move to each step's screen when the step changes. The house tour starts on
  // the inspection itself, so its first step doesn't navigate.
  useEffect(() => {
    if (!active || !sessionId) {
      lastNavigated.current = null;
      return;
    }
    if (lastNavigated.current === step) return;
    const isStart = lastNavigated.current === null && step === 0 && tour === "house";
    lastNavigated.current = step;
    if (!isStart) void navigateTo(steps[step].target);
    // navigateTo reads refs/props at call time; re-running on its identity would re-navigate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step, sessionId]);

  // Auto-play: fill the progress bar over the step's dwell time, then advance.
  // Stops on the last step rather than ending, so the final card stays up.
  useEffect(() => {
    if (!active || !autoplay || minimized) return;
    const dwell = autoplayDwellMs(step);
    progress.setValue(0);
    const anim = Animated.timing(progress, { toValue: 1, duration: dwell, easing: Easing.linear, useNativeDriver: false });
    anim.start();
    const t = setTimeout(() => {
      if (step >= steps.length - 1) setAutoplay(false);
      else go(step + 1);
    }, dwell);
    return () => { clearTimeout(t); anim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoplay, minimized, step]);

  // From scratch: check every 3 s whether the user has done this step; when
  // they have, show "Done" briefly and move on (which opens the next screen).
  useEffect(() => {
    setStepDone(false);
    const check = steps[step]?.doneWhen;
    if (!active || tour !== "scratch" || !check || !buildingId || !startedAt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const done = await isStepDone(check, buildingId, startedAt).catch(() => false);
      if (cancelled) return;
      if (done) {
        setStepDone(true);
        timer = setTimeout(() => { if (!cancelled) go(step + 1); }, 1500);
        return;
      }
      timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tour, step, buildingId, startedAt]);

  if (!active || !sessionId) return null;

  const s = steps[step];
  const total = steps.length;
  const watching = tour === "scratch" && !!s.doneWhen;
  const last = step === total - 1;
  const next = () => (last ? exit() : go(step + 1));
  // Sit above the tab bar (~50 pt) plus the home indicator.
  const bottom = insets.bottom + 58;

  if (autoplay && !minimized) {
    const width = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>AUTO-PLAY · STEP {step + 1} OF {total}</Text>
            <TouchableOpacity onPress={() => setAutoplay(false)} hitSlop={10} accessibilityLabel="Pause auto-play">
              <Text style={styles.link}>Pause ❚❚</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={exit} hitSlop={10} accessibilityLabel="End walkthrough">
              <Text style={styles.link}>End ✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>{s.title}</Text>
          <Text style={styles.seeText}>{s.see}</Text>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, { width }]} />
          </View>
        </View>
      </View>
    );
  }

  // From scratch, minimised: a small bubble in the corner so the wizard's own
  // buttons stay reachable. Tap it for the instructions.
  if (minimized && tour === "scratch") {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, styles.wrapRight, { bottom }]}>
        <TouchableOpacity style={styles.bubble} onPress={() => setMinimized(false)} accessibilityLabel="Show instructions">
          {stepDone
            ? <Text style={styles.bubbleText}>✓ Done</Text>
            : <Text style={styles.bubbleText}>{step + 1}/{total} · ?</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  if (minimized) {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
        <View style={styles.bar}>
          <TouchableOpacity
            style={styles.barInfo}
            onPress={() => setMinimized(false)}
            accessibilityLabel="Show instructions"
          >
            <Text style={styles.barEyebrow}>STEP {step + 1} OF {total} · TAP FOR INSTRUCTIONS ▴</Text>
            <Text style={styles.barTitle} numberOfLines={1}>{s.title}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.barNext} onPress={next}>
            <Text style={styles.barNextText}>{last ? "Finish" : "Next ›"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <View style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.eyebrow}>STEP {step + 1} OF {total}</Text>
          {!last && tour === "house" && (
            <TouchableOpacity onPress={() => setAutoplay(true)} hitSlop={10} accessibilityLabel="Resume auto-play">
              <Text style={styles.link}>Play ▶</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setMinimized(true)} hitSlop={10} accessibilityLabel="Hide instructions">
            <Text style={styles.link}>Hide ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={exit} hitSlop={10} accessibilityLabel="End walkthrough">
            <Text style={styles.link}>End ✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.label}>WHAT TO DO</Text>
        <Text style={styles.body}>{s.body}</Text>
        <View style={styles.see}>
          <Text style={styles.seeLabel}>YOU SHOULD SEE</Text>
          <Text style={styles.seeText}>{s.see}</Text>
        </View>
        {watching && (
          <View style={styles.status}>
            {stepDone
              ? <Text style={styles.statusDone}>✓ Done, moving on…</Text>
              : <>
                  <ActivityIndicator size="small" color={ACCENT} />
                  <Text style={styles.statusText}>Waiting for you to do this. The guide moves on by itself.</Text>
                </>}
          </View>
        )}

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, step === 0 && styles.btnDisabled]}
            onPress={() => go(step - 1)}
            disabled={step === 0}
          >
            <Text style={styles.btnGhostText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setMinimized(true)}>
            <Text style={styles.btnPrimaryText}>Try it</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={next}>
            <Text style={styles.btnGhostText}>{last ? "Finish" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 10, right: 10, alignItems: "center", zIndex: 1000, elevation: 20 },
  wrapRight: { left: undefined, right: 12, alignItems: "flex-end" },
  bubble: {
    backgroundColor: NAVY, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  bubbleText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  statusText: { flex: 1, fontSize: 12, color: "#4b5563" },
  statusDone: { fontSize: 13, fontWeight: "700", color: "#1E8449" },
  card: {
    width: "100%", maxWidth: 560, backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: "#D6E2EF",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  eyebrow: { flex: 1, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, color: "#6b7280" },
  link: { fontSize: 13, color: ACCENT, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "700", color: NAVY },
  label: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8, color: "#6b7280", marginTop: 2 },
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
  bar: {
    width: "100%", maxWidth: 560, flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 8, paddingLeft: 14, paddingRight: 8,
    shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  barInfo: { flex: 1, minWidth: 0 },
  barEyebrow: { fontSize: 9, fontWeight: "700", letterSpacing: 0.6, color: "#A9C4E4" },
  barTitle: { fontSize: 14, fontWeight: "700", color: "#fff", marginTop: 1 },
  barNext: { backgroundColor: ACCENT, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  barNextText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  track: { height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", overflow: "hidden", marginTop: 4 },
  fill: { height: 4, backgroundColor: ACCENT },
});
