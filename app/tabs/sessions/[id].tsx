import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert, Share,
} from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { supabase, SessionSummary, Rekenzone, Zone, BuildingElement, Opening } from "../../../lib/supabase";
import { useBLE } from "../../../lib/BLEContext";
import { buildVabiXml } from "@scarnergy/opname-calc";
import { elementTypeLabel } from "../../../lib/elementTypes";
import { FloorPlanReview } from "../../../components/inspection/FloorPlanReview";
import { pushSessionResultsToAppsheet } from "../../../lib/appsheetProxy";

export default function SessionDetailScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router     = useRouter();
  const navigation = useNavigation();
  const { state: bleState, deviceName, isConnected, scan, disconnect } = useBLE();

  const [session,         setSession]         = useState<SessionSummary | null>(null);
  const [sessionLoading,  setSessionLoading]  = useState(true);
  const [sessionError,    setSessionError]    = useState<string | null>(null);
  const [zones,           setZones]           = useState<Zone[]>([]);
  const [rekenzones,      setRekenzones]      = useState<Rekenzone[]>([]);
  const [selectedZoneId,  setSelectedZoneId]  = useState<string | null>(null);
  const [elements,        setElements]        = useState<BuildingElement[]>([]);
  const [elementsLoading, setElementsLoading] = useState(false);
  const [closing,         setClosing]         = useState(false);
  const [pausing,         setPausing]         = useState(false);
  const [appsheetLinked,  setAppsheetLinked]  = useState(false);
  const [retryingSync,    setRetryingSync]    = useState(false);

// ── Data loading ───────────────────────────────────────────────────────────

  const loadSession = useCallback(() => {
    if (!sessionId) return;
    supabase
      .from("session_summary")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setSessionError(error.message);
        else setSession(data);
        setSessionLoading(false);
      });
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  useEffect(() => {
    if (!session?.building_id) return;
    Promise.all([
      supabase
        .from("zones")
        .select("*")
        .eq("building_id", session.building_id)
        .eq("is_active", true)
        .order("floor_level", { ascending: true }),
      supabase
        .from("rekenzones")
        .select("*")
        .eq("building_id", session.building_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]).then(([zonesRes, rzRes]) => {
      const rzList = (rzRes.data as Rekenzone[]) ?? [];
      const list = zonesRes.data ?? [];
      // Group chips by rekenzone (ungrouped last; floor_level order kept
      // inside a group) only when at least one zone is actually assigned —
      // the same gate the VABI exporter uses, so UI and export agree.
      const hasAssigned =
        rzList.length > 0 && list.some(z => z.rekenzone_id && rzList.some(rz => rz.id === z.rekenzone_id));
      const grouped = hasAssigned
        ? [
            ...rzList.flatMap(rz => list.filter(z => z.rekenzone_id === rz.id)),
            ...list.filter(z => !z.rekenzone_id || !rzList.some(rz => rz.id === z.rekenzone_id)),
          ]
        : list;
      setRekenzones(hasAssigned ? rzList : []);
      setZones(grouped);
      if (grouped.length > 0) setSelectedZoneId(grouped[0].id);
    });
  }, [session?.building_id]);

  // Whether this building has an AppSheet source to sync to — drives the
  // "Retry AppSheet Sync" button below (only meaningful for AppSheet-linked
  // buildings, same check syncToAppsheetIfLinked already makes on its own).
  useEffect(() => {
    if (!session?.building_id) { setAppsheetLinked(false); return; }
    let cancelled = false;
    (supabase.from("buildings") as any)
      .select("appsheet_object_id")
      .eq("id", session.building_id)
      .maybeSingle()
      .then(({ data }: any) => { if (!cancelled) setAppsheetLinked(!!data?.appsheet_object_id); });
    return () => { cancelled = true; };
  }, [session?.building_id]);

  const loadElements = useCallback(() => {
    if (!selectedZoneId) return;
    setElementsLoading(true);
    supabase
      .from("building_elements")
      .select("*")
      .eq("zone_id", selectedZoneId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => {
        setElements(data ?? []);
        setElementsLoading(false);
      });
  }, [selectedZoneId]);

  useEffect(() => { loadElements(); }, [loadElements]);

  // Reload elements (and session summary) when returning from inspect screen
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      loadElements();
      loadSession();
    });
    return unsub;
  }, [navigation, loadElements, loadSession]);

  // ── Session lifecycle actions ──────────────────────────────────────────────

  // Best-effort export of this session's finished zone/gevel/opening
  // dimensions to AppSheet, IF this building was originally sourced from
  // AppSheet (buildings.appsheet_object_id set — see the "materialize"
  // step in tabs/buildings.tsx). Supabase is always the write of record;
  // this never blocks or reverts session close on failure.
  // Returns a summary so callers that need explicit feedback (the manual
  // retry button below) can report it — the original auto-sync-on-close
  // call site ignores the return value and keeps its existing silent-on-
  // success behavior unchanged.
  const syncToAppsheetIfLinked = useCallback(async (buildingId: string) => {
    const buildingRes = await (supabase.from("buildings") as any)
      .select("appsheet_object_id")
      .eq("id", buildingId)
      .maybeSingle();
    if (!buildingRes.data?.appsheet_object_id) return { linked: false as const };

    try {
      const zonesRes = await supabase.from("zones").select("*").eq("building_id", buildingId).eq("is_active", true);
      const zoneIds = (zonesRes.data ?? []).map((z: Zone) => z.id);
      const elementsRes = zoneIds.length
        ? await supabase.from("building_elements").select("*").in("zone_id", zoneIds).eq("is_active", true)
        : { data: [] };
      const elementIds = Array.from(new Set((elementsRes.data ?? []).map((e: BuildingElement) => e.id)));
      const openingsRes = elementIds.length
        ? await supabase.from("openings").select("*").in("element_id", elementIds).eq("is_active", true)
        : { data: [] };
      const openings = openingsRes.data ?? [];

      const results = await pushSessionResultsToAppsheet({
        buildingId,
        zones: zonesRes.data ?? [],
        elements: elementsRes.data ?? [],
        openings,
      });
      const failed = results.filter(r => r.status === "failed");
      if (failed.length) {
        console.warn("[AppSheet sync] some rows failed:", failed);
      }
      return {
        linked: true as const,
        total: results.length,
        added: results.filter(r => r.status === "added").length,
        edited: results.filter(r => r.status === "edited").length,
        skipped: results.filter(r => r.status === "skipped").length,
        failed: failed.length,
      };
    } catch (e: any) {
      console.warn("[AppSheet sync] session-close export failed:", e.message);
      Alert.alert("Saved locally", "Your session is saved, but syncing results to AppSheet failed. You can retry later.");
      return { linked: true as const, error: e.message as string };
    }
  }, []);

  // Manual re-run of the same export, for a session whose auto-sync-on-close
  // already failed (or partially failed) — the failure alert above has always
  // said "you can retry later" but there was previously no control to do so.
  const retrySync = useCallback(async () => {
    if (!session?.building_id || retryingSync) return;
    setRetryingSync(true);
    const summary = await syncToAppsheetIfLinked(session.building_id);
    setRetryingSync(false);
    if (!summary || 'error' in summary) return; // failure alert already shown above
    if (!summary.linked) return; // building isn't AppSheet-linked; button shouldn't be visible anyway
    const { added, edited, skipped, failed } = summary;
    Alert.alert(
      failed > 0 ? "Sync finished with errors" : "AppSheet sync complete",
      `${added} added, ${edited} updated, ${skipped} skipped${failed > 0 ? `, ${failed} failed` : ""}.`
    );
  }, [session?.building_id, retryingSync, syncToAppsheetIfLinked]);

  const closeSession = useCallback(() => {
    if (!sessionId || !session || session.status !== "active") return;
    Alert.alert(
      "Complete Session",
      `Mark ${session.session_code} as complete?\n\nThis will validate all measurements and compute energy labels. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark Complete",
          style: "destructive",
          onPress: async () => {
            setClosing(true);
            try {
              // Try the session_close edge function first — it validates
              // measurements and computes zone energy labels server-side.
              const { error: fnErr } = await supabase.functions.invoke("session_close", {
                body: { session_id: sessionId },
              });
              if (fnErr) throw fnErr;
              if (session.building_id) await syncToAppsheetIfLinked(session.building_id);
              loadSession();
              router.push({ pathname: "/tabs/sessions/results", params: { id: sessionId } });
            } catch (fnEx: any) {
              // Edge function unavailable in local dev — fall back to the
              // close_inspection_session RPC which still computes all totals.
              console.warn("[Session] edge fn unavailable, falling back to RPC:", fnEx.message);
              const { error: rpcErr } = await supabase.rpc("close_inspection_session", {
                p_session_id: sessionId,
              });
              if (rpcErr) Alert.alert("Error", rpcErr.message);
              else {
                if (session.building_id) await syncToAppsheetIfLinked(session.building_id);
                loadSession();
                router.push({ pathname: "/tabs/sessions/results", params: { id: sessionId } });
              }
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  }, [sessionId, session, loadSession, syncToAppsheetIfLinked]);

  const pauseSession = useCallback(() => {
    if (!sessionId || !session || session.status !== "active") return;
    Alert.alert(
      "Pause Session",
      "Pause this session? You can resume it later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Pause",
          onPress: async () => {
            setPausing(true);
            const { error } = await supabase
              .from("inspection_sessions")
              .update({ status: "paused" })
              .eq("id", sessionId);
            setPausing(false);
            if (error) Alert.alert("Error", error.message);
            else loadSession();
          },
        },
      ]
    );
  }, [sessionId, session, loadSession]);

  const resumeSession = useCallback(async () => {
    if (!sessionId || !session || session.status !== "paused") return;
    setPausing(true);
    const { error } = await supabase
      .from("inspection_sessions")
      .update({ status: "active" })
      .eq("id", sessionId);
    setPausing(false);
    if (error) Alert.alert("Error", error.message);
    else loadSession();
  }, [sessionId, session, loadSession]);

  // ── VABI XML export ───────────────────────────────────────────────────────

  const exportXML = useCallback(async () => {
    if (!session || !sessionId) return;
    try {
      const [zonesRes, buildingRes, orgRes, rekenzonesRes] = await Promise.all([
        supabase.from("zones").select("*").eq("building_id", session.building_id).eq("is_active", true).order("floor_level"),
        (supabase.from("buildings") as any).select("construction_year, building_type").eq("id", session.building_id).single(),
        (supabase.from("organisations") as any).select("name").single(),
        supabase.from("rekenzones").select("*").eq("building_id", session.building_id).eq("is_active", true).order("sort_order"),
      ]);

      const allZones: Zone[] = zonesRes.data ?? [];
      const zoneIds = allZones.map(z => z.id);

      const [elemRes, openRes] = await Promise.all([
        zoneIds.length
          ? supabase.from("building_elements").select("*").in("zone_id", zoneIds).eq("is_active", true).order("sort_order")
          : Promise.resolve({ data: [] }),
        zoneIds.length
          ? supabase.from("openings").select("*").eq("is_active", true)
          : Promise.resolve({ data: [] }),
      ]);

      const allElements: BuildingElement[] = elemRes.data ?? [];
      const elementIds = new Set(allElements.map(e => e.id));
      const allOpenings: Opening[] = ((openRes.data ?? []) as Opening[]).filter(o => elementIds.has((o as any).element_id));

      const xml = buildVabiXml(
        session,
        { name: orgRes.data?.name ?? '' },
        buildingRes.data ?? {},
        allZones,
        allElements,
        allOpenings,
        rekenzonesRes.data ?? [],
      );

      const filename = `${session.session_code}_VABI.xml`;
      await Share.share({ title: filename, message: xml });
    } catch (e: any) {
      Alert.alert("Export failed", e.message ?? "Unknown error");
    }
  }, [session, sessionId]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Zone chips: label chip-groups by rekenzone (first zone of each group
  // carries the label). Empty map when no rekenzones exist → chips unchanged.
  const zoneGroupLabels = new Map<string, string>();
  if (rekenzones.length) {
    let prevRz: string | null | undefined;
    for (const z of zones) {
      const rzId = z.rekenzone_id && rekenzones.some(r => r.id === z.rekenzone_id) ? z.rekenzone_id : null;
      if (rzId !== prevRz) {
        zoneGroupLabels.set(z.id, rzId ? rekenzones.find(r => r.id === rzId)!.name : "Other");
        prevRz = rzId;
      }
    }
  }

  if (sessionLoading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (sessionError)   return <Text style={styles.error}>{sessionError}</Text>;
  if (!session)       return <Text style={styles.error}>Session not found.</Text>;

  const bleLabel = bleState === "scanning"   ? "Scanning..."
                 : bleState === "connecting" ? "Connecting..."
                 : isConnected              ? (deviceName ?? "GLM 50C")
                 : "No device";

  const completedCount = elements.filter(e => e.is_complete).length;
  const selectedZone   = zones.find(z => z.id === selectedZoneId) ?? null;
  const zoneHasPlan    = !!selectedZone &&
    ((selectedZone.floor_plan_points?.length ?? 0) >= 3 || !!selectedZone.floor_plan_image_url);

  return (
    <View style={styles.container}>

      {/* ── Session header ── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.code}>{session.session_code}</Text>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_BG[session.status] }]}>
            <Text style={[styles.statusText, { color: STATUS_FG[session.status] }]}>
              {session.status.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.address}>{session.building_address}, {session.building_city}</Text>
        {elements.length > 0 && (
          <Text style={styles.progress}>
            {completedCount} / {elements.length} elements complete
          </Text>
        )}
      </View>

      {/* ── BLE bar ── */}
      <View style={styles.bleBar}>
        <View style={[styles.bleDot, { backgroundColor: isConnected ? "#1E8449" : "#AAAAAA" }]} />
        <Text style={styles.bleLabel}>{bleLabel}</Text>
        <View style={{ flex: 1 }} />
        {isConnected
          ? <TouchableOpacity onPress={disconnect} style={styles.bleBtn}>
              <Text style={styles.bleBtnText}>Disconnect</Text>
            </TouchableOpacity>
          : <TouchableOpacity onPress={scan} style={[styles.bleBtn, styles.bleBtnPrimary]}>
              <Text style={[styles.bleBtnText, { color: "#fff" }]}>Scan</Text>
            </TouchableOpacity>
        }
      </View>

      {/* ── Zone picker ── */}
      {zones.length > 0 && (
        <View style={styles.zonePicker}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.zoneScroll}
          >
            {zones.map(z => (
              <View key={z.id} style={styles.zoneChipGroup}>
                {zoneGroupLabels.has(z.id) && (
                  <Text style={styles.zoneGroupLabel}>{zoneGroupLabels.get(z.id)!.toUpperCase()}</Text>
                )}
                <TouchableOpacity
                  style={[styles.zoneChip, selectedZoneId === z.id && styles.zoneChipActive]}
                  onPress={() => setSelectedZoneId(z.id)}
                >
                  <Text style={[styles.zoneChipText, selectedZoneId === z.id && styles.zoneChipTextActive]}>
                    {z.name}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.floorPlanBtn}
                  onPress={() => router.push({
                    pathname: "/tabs/sessions/floorplan",
                    params: {
                      zoneId: z.id,
                      sessionId: sessionId ?? "",
                      zoneName: z.name,
                      floorLevel: String(z.floor_level),
                    },
                  })}
                >
                  <Text style={styles.floorPlanBtnText}>⊞</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Element list ── */}
      {elementsLoading
        ? <ActivityIndicator style={{ marginTop: 32 }} color="#1E3A5F" />
        : (
          <FlatList
            data={elements}
            keyExtractor={e => e.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              zoneHasPlan && selectedZone && elements.length > 0 ? (
                <FloorPlanReview
                  zone={selectedZone}
                  elements={elements}
                  onMeasure={(elementId) => router.push({
                    pathname: "/tabs/sessions/inspect",
                    params: { elementId, sessionId: sessionId ?? "" },
                  })}
                />
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.empty}>
                  {zones.length === 0
                    ? "No floor plan set up yet."
                    : "No elements in this zone yet."}
                </Text>
                {session.status === 'active' && (
                  <TouchableOpacity
                    style={styles.setupBtn}
                    onPress={() => router.push(
                      zones.length === 0
                        ? `/tabs/sessions/flow?id=${sessionId}&buildingId=${session.building_id}`
                        : `/tabs/sessions/flow?id=${sessionId}&buildingId=${session.building_id}&forceStage=5`
                    )}
                  >
                    <Text style={styles.setupBtnTxt}>
                      {zones.length === 0 ? '+ Draw Floor Plan' : '+ Place Elements'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.elementCard, item.is_complete && styles.elementCardDone]}
                onPress={() => router.push({
                  pathname: "/tabs/sessions/inspect",
                  params: { elementId: item.id, sessionId: sessionId ?? "" },
                })}
                activeOpacity={0.75}
              >
                <View style={styles.elementTop}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeText}>{elementTypeLabel(item.element_type).toUpperCase()}</Text>
                  </View>
                  {item.is_complete && (
                    <Text style={styles.completeBadge}>✓ Complete</Text>
                  )}
                </View>
                <Text style={styles.elementName}>{item.name}</Text>
                <View style={styles.dimsRow}>
                  {item.length_mm !== null && <Text style={styles.dim}>L {item.length_mm.toFixed(0)} mm</Text>}
                  {item.height_mm !== null && <Text style={styles.dim}>H {item.height_mm.toFixed(0)} mm</Text>}
                  {item.width_mm  !== null && <Text style={styles.dim}>W {item.width_mm.toFixed(0)} mm</Text>}
                  {item.length_mm === null && item.height_mm === null && item.width_mm === null && (
                    <Text style={styles.dimEmpty}>Not measured yet</Text>
                  )}
                </View>
                <Text style={styles.inspectCta}>Inspect →</Text>
              </TouchableOpacity>
            )}
            ListFooterComponent={
              <View style={styles.footer}>

{session.status === "completed" && (
                  <>
                    <View style={styles.completedBanner}>
                      <Text style={styles.completedBannerText}>✓  Session Completed</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.resultsBtn}
                      onPress={() => router.push({ pathname: "/tabs/sessions/results", params: { id: sessionId ?? "" } })}
                    >
                      <Text style={styles.resultsBtnText}>⚡  Energy Results</Text>
                    </TouchableOpacity>
                    {appsheetLinked && (
                      <TouchableOpacity
                        style={[styles.resumeBtn, retryingSync && styles.btnDisabled]}
                        onPress={retrySync}
                        disabled={retryingSync}
                      >
                        <Text style={styles.resumeBtnText}>
                          {retryingSync ? "Syncing…" : "↻  Retry AppSheet Sync"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                <TouchableOpacity style={styles.exportBtn} onPress={exportXML}>
                  <Text style={styles.exportBtnText}>↓  Export XML</Text>
                </TouchableOpacity>

                {session.status === "paused" && (
                  <TouchableOpacity
                    style={[styles.resumeBtn, pausing && styles.btnDisabled]}
                    onPress={resumeSession}
                    disabled={pausing}
                  >
                    <Text style={styles.resumeBtnText}>
                      {pausing ? "Resuming…" : "▶  Resume Session"}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Gevel Foto's — always accessible */}
                <TouchableOpacity
                  style={styles.facadeBtn}
                  onPress={() => router.push({
                    pathname: '/tabs/sessions/facade-photos',
                    params: { sessionId: sessionId!, buildingId: session.building_id },
                  })}
                >
                  <Text style={styles.facadeBtnText}>📷  Gevel Foto's</Text>
                </TouchableOpacity>

                {session.status === "active" && (
                  <View style={styles.activeActions}>
                    <TouchableOpacity
                      style={[styles.pauseBtn, pausing && styles.btnDisabled]}
                      onPress={pauseSession}
                      disabled={pausing}
                    >
                      <Text style={styles.pauseBtnText}>
                        {pausing ? "Pausing…" : "⏸  Pause"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.completeBtn, closing && styles.btnDisabled]}
                      onPress={closeSession}
                      disabled={closing}
                    >
                      <Text style={styles.completeBtnText}>
                        {closing ? "Closing…" : "✓  Complete Session"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            }
          />
        )
      }
    </View>
  );
}

const STATUS_BG: Record<string, string> = {
  active:    "#2E86C122",
  paused:    "#E67E2222",
  completed: "#1E844922",
  cancelled: "#88888822",
};
const STATUS_FG: Record<string, string> = {
  active:    "#2E86C1",
  paused:    "#E67E22",
  completed: "#1E8449",
  cancelled: "#888888",
};

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: "#F5F7FA" },
  loader:              { flex: 1 },
  error:               { flex: 1, textAlign: "center", color: "#E74C3C", padding: 40, marginTop: 40 },

  header:              { backgroundColor: "#1E3A5F", padding: 16, paddingTop: 20 },
  headerTop:           { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  code:                { fontSize: 18, fontWeight: "700", color: "#fff" },
  statusBadge:         { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:          { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  address:             { fontSize: 13, color: "#A9C4E4", marginTop: 2 },
  progress:            { fontSize: 12, color: "#7FB3D3", marginTop: 6, fontStyle: "italic" },

  bleBar:              { flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
                         paddingHorizontal: 16, paddingVertical: 10,
                         borderBottomWidth: 1, borderBottomColor: "#EEE" },
  bleDot:              { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  bleLabel:            { fontSize: 14, color: "#333" },
  bleBtn:              { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
                         borderWidth: 1, borderColor: "#CCC" },
  bleBtnPrimary:       { backgroundColor: "#1E3A5F", borderColor: "#1E3A5F" },
  bleBtnText:          { fontSize: 13, fontWeight: "600", color: "#333" },

  zonePicker:          { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#EEE" },
  zoneScroll:          { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  zoneChipGroup:       { flexDirection: "row", alignItems: "center", gap: 4 },
  zoneGroupLabel:      { fontSize: 10, fontWeight: "700", color: "#9CA3AF",
                         letterSpacing: 0.5, marginLeft: 4, marginRight: 2 },
  zoneChip:            { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                         backgroundColor: "#F0F4F8", borderWidth: 1, borderColor: "#DDE" },
  zoneChipActive:      { backgroundColor: "#1E3A5F", borderColor: "#1E3A5F" },
  zoneChipText:        { fontSize: 13, fontWeight: "600", color: "#555" },
  zoneChipTextActive:  { color: "#fff" },
  floorPlanBtn:        { width: 32, height: 32, borderRadius: 8, backgroundColor: "#2E86C1",
                         alignItems: "center", justifyContent: "center" },
  floorPlanBtnText:    { fontSize: 16, color: "#fff", fontWeight: "700", lineHeight: 20 },

  list:                { padding: 16, gap: 12 },
  emptyWrap:           { padding: 40, alignItems: 'center', gap: 16 },
  empty:               { textAlign: "center", color: "#AAA", lineHeight: 22 },
  setupBtn:            { backgroundColor: '#1E3A5F', borderRadius: 10,
                         paddingHorizontal: 24, paddingVertical: 12 },
  setupBtnTxt:         { color: '#fff', fontSize: 14, fontWeight: '700' },

  elementCard:         { backgroundColor: "#fff", borderRadius: 12, padding: 16,
                         elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4,
                         borderLeftWidth: 4, borderLeftColor: "#DDE" },
  elementCardDone:     { borderLeftColor: "#1E8449" },
  elementTop:          { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  typeBadge:           { backgroundColor: "#EEF2F7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeText:            { fontSize: 10, fontWeight: "700", color: "#1E3A5F", letterSpacing: 0.5 },
  completeBadge:       { fontSize: 12, fontWeight: "700", color: "#1E8449" },
  elementName:         { fontSize: 16, fontWeight: "700", color: "#1A1A2E" },
  dimsRow:             { flexDirection: "row", gap: 12, marginTop: 6 },
  dim:                 { fontSize: 13, color: "#555", fontWeight: "600" },
  dimEmpty:            { fontSize: 13, color: "#BBB", fontStyle: "italic" },
  inspectCta:          { fontSize: 13, color: "#2E86C1", fontWeight: "700", marginTop: 10, textAlign: "right" },

  footer:              { padding: 16, paddingTop: 4, gap: 10 },

  completedBanner:     { backgroundColor: "#D5F0E3", borderRadius: 12, padding: 18, alignItems: "center" },
  completedBannerText: { color: "#1E8449", fontSize: 15, fontWeight: "700" },
  resultsBtn:          { backgroundColor: "#1E8449", borderRadius: 12, padding: 16, alignItems: "center" },
  resultsBtnText:      { color: "#fff", fontSize: 15, fontWeight: "700" },
  exportBtn:           { backgroundColor: "#2E86C1", borderRadius: 12, padding: 16, alignItems: "center" },
  exportBtnText:       { color: "#fff", fontSize: 15, fontWeight: "700" },

  facadeBtn:           { backgroundColor: '#f0f9ff', borderRadius: 12, padding: 14,
                         alignItems: 'center', borderWidth: 1.5, borderColor: '#0284c7', marginBottom: 4 },
  facadeBtnText:       { color: '#0284c7', fontSize: 14, fontWeight: '700' },
  activeActions:       { gap: 10 },
  pauseBtn:            { backgroundColor: "#fff", borderRadius: 12, padding: 16,
                         alignItems: "center", borderWidth: 1.5, borderColor: "#E67E22" },
  pauseBtnText:        { color: "#E67E22", fontSize: 15, fontWeight: "700" },
  resumeBtn:           { backgroundColor: "#2E86C1", borderRadius: 12, padding: 18, alignItems: "center" },
  resumeBtnText:       { color: "#fff", fontSize: 16, fontWeight: "700" },
  completeBtn:         { backgroundColor: "#1E3A5F", borderRadius: 12, padding: 18, alignItems: "center" },
  completeBtnText:     { color: "#fff", fontSize: 16, fontWeight: "700" },
  btnDisabled:         { opacity: 0.5 },

  measurePanel:        { backgroundColor: "#fff", borderRadius: 12, padding: 14,
                         borderLeftWidth: 3, borderLeftColor: "#2E86C1" },
  measurePanelTitle:   { fontSize: 11, fontWeight: "700", color: "#2E86C1",
                         letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  measureRow:          { flexDirection: "row", alignItems: "center", gap: 8,
                         paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F0F4F8" },
  measureValue:        { fontSize: 14, fontWeight: "700", color: "#1A1A2E", minWidth: 72 },
  measureType:         { fontSize: 12, color: "#888", flex: 1 },
  measureTime:         { fontSize: 11, color: "#AAA", fontVariant: ["tabular-nums"] },
  measureAnomaly:      { fontSize: 13, color: "#E67E22" },
});
