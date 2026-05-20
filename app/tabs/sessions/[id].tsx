import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert, Share,
} from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { supabase, SessionSummary, Zone, BuildingElement } from "../../../lib/supabase";
import { useBLE } from "../../../lib/BLEContext";
import { useLiveMeasurements } from "../../../hooks/useLiveMeasurements";

export default function SessionDetailScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router     = useRouter();
  const navigation = useNavigation();
  const { state: bleState, deviceName, isConnected, scan, disconnect } = useBLE();

  const [session,         setSession]         = useState<SessionSummary | null>(null);
  const [sessionLoading,  setSessionLoading]  = useState(true);
  const [zones,           setZones]           = useState<Zone[]>([]);
  const [selectedZoneId,  setSelectedZoneId]  = useState<string | null>(null);
  const [elements,        setElements]        = useState<BuildingElement[]>([]);
  const [elementsLoading, setElementsLoading] = useState(false);
  const [closing,         setClosing]         = useState(false);
  const [pausing,         setPausing]         = useState(false);

  const { measurements } = useLiveMeasurements(sessionId ?? null);

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadSession = useCallback(() => {
    if (!sessionId) return;
    supabase
      .from("session_summary")
      .select("*")
      .eq("id", sessionId)
      .single()
      .then(({ data }) => { setSession(data); setSessionLoading(false); });
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  useEffect(() => {
    if (!session?.building_id) return;
    supabase
      .from("zones")
      .select("*")
      .eq("building_id", session.building_id)
      .order("floor_level", { ascending: true })
      .then(({ data }) => {
        const list = data ?? [];
        setZones(list);
        if (list.length > 0) setSelectedZoneId(list[0].id);
      });
  }, [session?.building_id]);

  const loadElements = useCallback(() => {
    if (!selectedZoneId) return;
    setElementsLoading(true);
    supabase
      .from("building_elements")
      .select("*")
      .eq("zone_id", selectedZoneId)
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
              loadSession();
            } catch (fnEx: any) {
              // Edge function unavailable in local dev — fall back to the
              // close_inspection_session RPC which still computes all totals.
              console.warn("[Session] edge fn unavailable, falling back to RPC:", fnEx.message);
              const { error: rpcErr } = await supabase.rpc("close_inspection_session", {
                p_session_id: sessionId,
              });
              if (rpcErr) Alert.alert("Error", rpcErr.message);
              else loadSession();
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  }, [sessionId, session, loadSession]);

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
              .update({ status: "paused", paused_at: new Date().toISOString() })
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
      .update({ status: "active", paused_at: null })
      .eq("id", sessionId);
    setPausing(false);
    if (error) Alert.alert("Error", error.message);
    else loadSession();
  }, [sessionId, session, loadSession]);

  // ── XML export ────────────────────────────────────────────────────────────

  const exportXML = useCallback(async () => {
    if (!session || !sessionId) return;
    try {
      const { data: allZones } = await supabase
        .from("zones")
        .select("*")
        .eq("building_id", session.building_id)
        .order("floor_level", { ascending: true });

      const zoneIds = (allZones ?? []).map((z: Zone) => z.id);

      const { data: allElements } = zoneIds.length
        ? await supabase
            .from("building_elements")
            .select("*")
            .in("zone_id", zoneIds)
            .order("name", { ascending: true })
        : { data: [] };

      const elementIds = (allElements ?? []).map((e: BuildingElement) => e.id);

      const { data: allMeasurements } = elementIds.length
        ? await supabase
            .from("measurements")
            .select("*")
            .eq("session_id", sessionId)
            .in("element_id", elementIds)
            .eq("is_deleted", false)
            .order("measured_at", { ascending: true })
        : { data: [] };

      const msrByElement: Record<string, any[]> = {};
      for (const m of allMeasurements ?? []) {
        (msrByElement[m.element_id] ??= []).push(m);
      }
      const elemByZone: Record<string, BuildingElement[]> = {};
      for (const e of allElements ?? []) {
        (elemByZone[(e as BuildingElement).zone_id] ??= []).push(e as BuildingElement);
      }

      const esc = (v: unknown) => String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      const zonesXml = (allZones ?? []).map((z: Zone) => {
        const elems = elemByZone[z.id] ?? [];
        const elemsXml = elems.map((e: BuildingElement) => {
          const msrs    = msrByElement[e.id] ?? [];
          const msrsXml = msrs.map((m: any) =>
            `\n          <Measurement>` +
            `\n            <MeasurementType>${esc(m.measurement_type)}</MeasurementType>` +
            `\n            <ValueMM>${esc(m.value_mm)}</ValueMM>` +
            `\n            <MeasuredAt>${esc(m.measured_at)}</MeasuredAt>` +
            `\n          </Measurement>`
          ).join("");
          return (
            `\n        <Element id="${esc(e.id)}" type="${esc(e.element_type)}">` +
            `\n          <Name>${esc(e.name)}</Name>` +
            (e.length_mm != null ? `\n          <LengthMM>${e.length_mm}</LengthMM>` : "") +
            (e.height_mm != null ? `\n          <HeightMM>${e.height_mm}</HeightMM>` : "") +
            (e.width_mm  != null ? `\n          <WidthMM>${e.width_mm}</WidthMM>`   : "") +
            `\n          <IsComplete>${e.is_complete}</IsComplete>` +
            (msrsXml
              ? `\n          <Measurements>${msrsXml}\n          </Measurements>`
              : "\n          <Measurements/>") +
            `\n        </Element>`
          );
        }).join("");
        return (
          `\n      <Zone id="${esc(z.id)}" code="${esc(z.zone_code)}">` +
          `\n        <Name>${esc(z.name)}</Name>` +
          `\n        <FloorLevel>${z.floor_level}</FloorLevel>` +
          (z.gross_area_m2 != null ? `\n        <GrossAreaM2>${z.gross_area_m2}</GrossAreaM2>` : "") +
          (z.energy_label  ? `\n        <EnergyLabel>${esc(z.energy_label)}</EnergyLabel>` : "") +
          (elemsXml ? `\n        <Elements>${elemsXml}\n        </Elements>` : "\n        <Elements/>") +
          `\n      </Zone>`
        );
      }).join("");

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<ScanergyExport version="1.0" generated_at="${new Date().toISOString()}">\n` +
        `  <Session id="${esc(session.id)}">\n` +
        `    <SessionCode>${esc(session.session_code)}</SessionCode>\n` +
        `    <Status>${esc(session.status)}</Status>\n` +
        `    <StartedAt>${esc(session.started_at)}</StartedAt>\n` +
        (session.completed_at ? `    <CompletedAt>${esc(session.completed_at)}</CompletedAt>\n` : "") +
        `    <Inspector>${esc(session.inspector_name)}</Inspector>\n` +
        `    <Building>\n` +
        `      <Address>${esc(session.building_address)}, ${esc(session.building_city)}</Address>\n` +
        `    </Building>\n` +
        `    <Zones>${zonesXml}\n    </Zones>\n` +
        `  </Session>\n` +
        `</ScanergyExport>`;

      await Share.share({ title: `${session.session_code}.xml`, message: xml });
    } catch (e: any) {
      Alert.alert("Export failed", e.message ?? "Unknown error");
    }
  }, [session, sessionId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (sessionLoading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (!session)       return <Text style={styles.error}>Session not found.</Text>;

  const bleLabel = bleState === "scanning"   ? "Scanning..."
                 : bleState === "connecting" ? "Connecting..."
                 : isConnected              ? (deviceName ?? "GLM 50C")
                 : "No device";

  const completedCount = elements.filter(e => e.is_complete).length;

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
            ListEmptyComponent={
              <Text style={styles.empty}>
                {zones.length === 0
                  ? "No zones found for this building.\nAdd zones in the web dashboard."
                  : "No elements in this zone.\nAdd building elements in the web dashboard."}
              </Text>
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
                    <Text style={styles.typeText}>{item.element_type.toUpperCase()}</Text>
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

                {/* ── Live measurements feed ── */}
                {measurements.length > 0 && (
                  <View style={styles.measurePanel}>
                    <Text style={styles.measurePanelTitle}>
                      Measurements · {measurements.length}
                    </Text>
                    {measurements.slice(0, 15).map(m => (
                      <View key={m.id} style={styles.measureRow}>
                        <Text style={styles.measureValue}>
                          {Number(m.value_mm).toFixed(0)} mm
                        </Text>
                        {m.measurement_type ? (
                          <Text style={styles.measureType}>{m.measurement_type}</Text>
                        ) : null}
                        <Text style={styles.measureTime}>
                          {new Date(m.measured_at).toLocaleTimeString("nl-NL", {
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                          })}
                        </Text>
                        {m.is_anomaly && <Text style={styles.measureAnomaly}>⚠</Text>}
                      </View>
                    ))}
                  </View>
                )}

                {session.status === "completed" && (
                  <>
                    <View style={styles.completedBanner}>
                      <Text style={styles.completedBannerText}>✓  Session Completed</Text>
                    </View>
                    <TouchableOpacity style={styles.exportBtn} onPress={exportXML}>
                      <Text style={styles.exportBtnText}>↓  Export XML</Text>
                    </TouchableOpacity>
                  </>
                )}

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
  zoneChip:            { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                         backgroundColor: "#F0F4F8", borderWidth: 1, borderColor: "#DDE" },
  zoneChipActive:      { backgroundColor: "#1E3A5F", borderColor: "#1E3A5F" },
  zoneChipText:        { fontSize: 13, fontWeight: "600", color: "#555" },
  zoneChipTextActive:  { color: "#fff" },
  floorPlanBtn:        { width: 32, height: 32, borderRadius: 8, backgroundColor: "#2E86C1",
                         alignItems: "center", justifyContent: "center" },
  floorPlanBtnText:    { fontSize: 16, color: "#fff", fontWeight: "700", lineHeight: 20 },

  list:                { padding: 16, gap: 12 },
  empty:               { textAlign: "center", color: "#AAA", padding: 40, lineHeight: 22 },

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
  exportBtn:           { backgroundColor: "#2E86C1", borderRadius: 12, padding: 16, alignItems: "center" },
  exportBtnText:       { color: "#fff", fontSize: 15, fontWeight: "700" },

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
