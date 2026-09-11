import { useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  fetchAppsheetSessionDetail, materializeAppsheetElement, materializeAppsheetSession,
  AppsheetSessionDetail, AppsheetProxyError,
} from "../../../lib/appsheetProxy";
import { elementTypeLabel } from "../../../lib/elementTypes";

// Mostly-read-only counterpart to /tabs/sessions/[id].tsx for AppSheet-sourced
// pseudo-sessions: there is no Supabase inspection_sessions row to open here,
// so this pulls the same live Objecten + Verdiepingen/Gevels/Daken/Vloeren/
// Installaties/Transparante_Delen data the web dashboard's AppSheet Sessions
// page already shows, via /api/appsheet/mobile/session-detail. No BLE bar,
// zone drawing, or complete/pause actions here — those all write to
// Supabase, which isn't the record of truth for an AppSheet visit.
//
// Two exceptions: tapping "Retake Measurement" on ANY element (gevel/dak/
// vloer/installatie) materializes a Supabase building/zone/element/session
// chain for it (see materializeAppsheetElement) and hands off to the same
// BLE /inspect screen native sessions already use — dak/vloer/installatie
// resolve their parent via a Rekenzone instead of a Verdieping directly
// (materialize-element/route.ts), matching the sync-back direction in
// session-close/route.ts. And when the building has no Verdiepingen
// recorded at all, "+ Draw Floor Plan" materializes just the
// building/session (materializeAppsheetSession) and hands off to
// /tabs/sessions/flow — same drawing flow "Start Inspection" already uses
// for a brand new native building.
export default function AppsheetSessionDetailScreen() {
  const { objectId } = useLocalSearchParams<{ objectId: string }>();
  const router = useRouter();

  const [detail,   setDetail]   = useState<AppsheetSessionDetail | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [retakingId, setRetakingId] = useState<string | null>(null);
  const [startingFloorPlan, setStartingFloorPlan] = useState(false);
  const [tracingZoneId, setTracingZoneId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!objectId) return;
    setLoading(true);
    fetchAppsheetSessionDetail(objectId)
      .then((data) => {
        setDetail(data);
        setError(null);
        setSelectedZoneId(prev => prev ?? data.zones[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof AppsheetProxyError ? e.message : "Could not load this AppSheet visit."))
      .finally(() => setLoading(false));
  }, [objectId]);

  // Refresh every time this screen comes into focus (matches buildings.tsx /
  // sessions/index.tsx) — this screen previously only fetched once on mount,
  // so newer AppSheet data (from another device, or edited directly in
  // AppSheet) wouldn't show up without leaving and re-entering the screen.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const retakeMeasurement = useCallback(async (elementId: string, elementType: "gevel" | "dak" | "vloer" | "installatie") => {
    if (!objectId) return;
    setRetakingId(elementId);
    try {
      const { elementId: materializedId, sessionId } = await materializeAppsheetElement(objectId, elementId, elementType);
      router.push({ pathname: "/tabs/sessions/inspect", params: { elementId: materializedId, sessionId } });
    } catch (e) {
      Alert.alert(
        "Could not start measurement",
        e instanceof AppsheetProxyError ? e.message : "Server error — please try again."
      );
    } finally {
      setRetakingId(null);
    }
  }, [objectId, router]);

  // No AppSheet Verdieping ID materializes into a real Supabase zone on its
  // own — materializeAppsheetElement is the only path that creates one
  // (see materialize-element/route.ts), keyed off one of the zone's own
  // elements. Reuses that instead of adding a new zone-only materialize
  // endpoint; requires the zone to have at least one element (see the
  // hasElements check below where this is called).
  const traceFloorPlan = useCallback(async (zoneIdParam: string, zoneNameParam: string) => {
    if (!objectId) return;
    const anyElement = detail?.elements.find(e => e.zone_id === zoneIdParam);
    if (!anyElement) return;
    setTracingZoneId(zoneIdParam);
    try {
      const { zoneId: materializedZoneId, buildingId, sessionId } =
        await materializeAppsheetElement(objectId, anyElement.id, anyElement.element_type as "gevel" | "dak" | "vloer" | "installatie");
      router.push({
        pathname: "/tabs/sessions/flow",
        params: { id: sessionId, buildingId, forceStage: "2", zoneId: materializedZoneId, zoneName: zoneNameParam },
      });
    } catch (e) {
      Alert.alert(
        "Could not start floor plan",
        e instanceof AppsheetProxyError ? e.message : "Server error — please try again."
      );
    } finally {
      setTracingZoneId(null);
    }
  }, [objectId, detail, router]);

  const startFloorPlan = useCallback(async () => {
    if (!objectId) return;
    setStartingFloorPlan(true);
    try {
      const { buildingId, sessionId } = await materializeAppsheetSession(objectId);
      router.push(`/tabs/sessions/flow?id=${sessionId}&buildingId=${buildingId}`);
    } catch (e) {
      Alert.alert(
        "Could not start floor plan",
        e instanceof AppsheetProxyError ? e.message : "Server error — please try again."
      );
    } finally {
      setStartingFloorPlan(false);
    }
  }, [objectId, router]);

  if (loading && !detail) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (error) return (
    <View style={styles.errorWrap}>
      <Text style={styles.error}>{error}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={load}>
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
  if (!detail) return <Text style={styles.error}>Visit not found.</Text>;

  const { session, zones, elements, rekenzones } = detail;
  const zoneElements = elements.filter(e => e.zone_id === selectedZoneId);
  const zoneName = zones.find(z => z.id === selectedZoneId)?.name;

  return (
    <View style={styles.container}>

      {/* ── Header ── */}
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
        <Text style={styles.inspector}>{session.inspector_name}</Text>
        <View style={styles.sourceTag}>
          <Text style={styles.sourceTagText}>FROM APPSHEET</Text>
        </View>
      </View>

      {/* ── Zone picker ── */}
      {zones.length > 0 && (
        <View style={styles.zonePicker}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.zoneScroll}>
            {zones.map(z => {
              const hasElements = elements.some(e => e.zone_id === z.id);
              return (
                <View key={z.id} style={styles.zoneChipRow}>
                  <TouchableOpacity
                    style={[styles.zoneChip, selectedZoneId === z.id && styles.zoneChipActive]}
                    onPress={() => setSelectedZoneId(z.id)}
                  >
                    <Text style={[styles.zoneChipText, selectedZoneId === z.id && styles.zoneChipTextActive]}>
                      {z.name}
                    </Text>
                  </TouchableOpacity>
                  {hasElements && (
                    <TouchableOpacity
                      style={styles.traceBtn}
                      onPress={() => traceFloorPlan(z.id, z.name)}
                      disabled={tracingZoneId !== null}
                      accessibilityLabel="Trace floor plan for this zone"
                    >
                      {tracingZoneId === z.id
                        ? <ActivityIndicator size="small" color="#1E3A5F" />
                        : <Text style={styles.traceBtnText}>📐</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ── Element list ── */}
      <FlatList
        data={zoneElements}
        keyExtractor={e => e.id}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={loading}
        ListHeaderComponent={
          rekenzones.length > 0 ? (
            <Text style={styles.rekenzoneNote}>{rekenzones.length} rekenzone(s) defined for this building</Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>
              {zones.length === 0 ? "No floor data recorded in AppSheet yet." : `No elements recorded for ${zoneName ?? "this floor"}.`}
            </Text>
            {zones.length === 0 && (
              <TouchableOpacity
                style={[styles.setupBtn, startingFloorPlan && styles.retakeBtnDisabled]}
                onPress={startFloorPlan}
                disabled={startingFloorPlan}
              >
                {startingFloorPlan
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.setupBtnTxt}>+ Draw Floor Plan</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.elementCard, item.is_complete && styles.elementCardDone]}>
            <View style={styles.elementTop}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeText}>{elementTypeLabel(item.element_type).toUpperCase()}</Text>
              </View>
              {item.is_complete && <Text style={styles.completeBadge}>✓ Complete</Text>}
            </View>
            <Text style={styles.elementName}>{item.name}</Text>
            <View style={styles.dimsRow}>
              {item.length_mm !== null && <Text style={styles.dim}>L {item.length_mm.toFixed(0)} mm</Text>}
              {item.height_mm !== null && <Text style={styles.dim}>H {item.height_mm.toFixed(0)} mm</Text>}
              {item.width_mm  !== null && <Text style={styles.dim}>W {item.width_mm.toFixed(0)} mm</Text>}
              {item.length_mm === null && item.height_mm === null && item.width_mm === null && (
                <Text style={styles.dimEmpty}>No dimensions recorded</Text>
              )}
            </View>
            {(["gevel", "dak", "vloer", "installatie"] as const).includes(item.element_type as any)
              ? (
                <TouchableOpacity
                  style={[styles.retakeBtn, retakingId === item.id && styles.retakeBtnDisabled]}
                  onPress={() => retakeMeasurement(item.id, item.element_type as "gevel" | "dak" | "vloer" | "installatie")}
                  disabled={retakingId !== null}
                >
                  {retakingId === item.id
                    ? <ActivityIndicator size="small" color="#2E86C1" />
                    : <Text style={styles.retakeBtnText}>↻  Retake Measurement</Text>
                  }
                </TouchableOpacity>
              )
              : <Text style={styles.viewOnlyNote}>View only — not yet syncable from mobile</Text>
            }
          </View>
        )}
        ListFooterComponent={
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← Back to Sessions</Text>
          </TouchableOpacity>
        }
      />
    </View>
  );
}

const STATUS_BG: Record<string, string> = {
  active: "#2E86C122", paused: "#E67E2222", completed: "#1E844922", cancelled: "#88888822",
};
const STATUS_FG: Record<string, string> = {
  active: "#2E86C1", paused: "#E67E22", completed: "#1E8449", cancelled: "#888888",
};

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#F5F7FA" },
  loader:      { flex: 1 },
  errorWrap:   { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error:       { textAlign: "center", color: "#E74C3C", marginBottom: 16, lineHeight: 20 },
  retryBtn:    { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: "#1E3A5F" },
  retryBtnText:{ color: "#fff", fontWeight: "700", fontSize: 14 },

  header:      { backgroundColor: "#1E3A5F", padding: 16, paddingTop: 20 },
  headerTop:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  code:        { fontSize: 18, fontWeight: "700", color: "#fff" },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  address:     { fontSize: 13, color: "#A9C4E4", marginTop: 2 },
  inspector:   { fontSize: 12, color: "#7FB3D3", marginTop: 2 },
  sourceTag:   { alignSelf: "flex-start", backgroundColor: "#FFFFFF22", borderRadius: 5,
                 paddingHorizontal: 8, paddingVertical: 3, marginTop: 8 },
  sourceTagText: { fontSize: 10, fontWeight: "700", color: "#A9C4E4", letterSpacing: 0.5 },

  zonePicker:  { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#EEE" },
  zoneScroll:  { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  zoneChipRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  zoneChip:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                 backgroundColor: "#F0F4F8", borderWidth: 1, borderColor: "#DDE" },
  zoneChipActive: { backgroundColor: "#1E3A5F", borderColor: "#1E3A5F" },
  zoneChipText: { fontSize: 13, fontWeight: "600", color: "#555" },
  zoneChipTextActive: { color: "#fff" },
  traceBtn:    { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
                 backgroundColor: "#F0F4F8", borderWidth: 1, borderColor: "#DDE" },
  traceBtnText: { fontSize: 14 },

  list:        { padding: 16, gap: 12 },
  rekenzoneNote: { fontSize: 12, color: "#999", fontStyle: "italic", marginBottom: 4 },
  emptyWrap:   { padding: 24, alignItems: "center", gap: 16 },
  empty:       { textAlign: "center", color: "#AAA", lineHeight: 22, marginTop: 24 },
  setupBtn:    { backgroundColor: "#1E3A5F", borderRadius: 10,
                 paddingHorizontal: 24, paddingVertical: 12, minHeight: 42, justifyContent: "center" },
  setupBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },

  elementCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16,
                 elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4,
                 borderLeftWidth: 4, borderLeftColor: "#DDE" },
  elementCardDone: { borderLeftColor: "#1E8449" },
  elementTop:  { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  typeBadge:   { backgroundColor: "#EEF2F7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeText:    { fontSize: 10, fontWeight: "700", color: "#1E3A5F", letterSpacing: 0.5 },
  completeBadge: { fontSize: 12, fontWeight: "700", color: "#1E8449" },
  elementName: { fontSize: 16, fontWeight: "700", color: "#1A1A2E" },
  dimsRow:     { flexDirection: "row", gap: 12, marginTop: 6 },
  dim:         { fontSize: 13, color: "#555", fontWeight: "600" },
  dimEmpty:    { fontSize: 13, color: "#BBB", fontStyle: "italic" },

  retakeBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center",
                 marginTop: 12, paddingVertical: 9, borderRadius: 8,
                 borderWidth: 1.5, borderColor: "#2E86C1" },
  retakeBtnDisabled: { opacity: 0.5 },
  retakeBtnText: { fontSize: 13, fontWeight: "700", color: "#2E86C1" },
  viewOnlyNote: { fontSize: 11, color: "#BBB", fontStyle: "italic", marginTop: 10, textAlign: "center" },

  backBtn:     { padding: 14, alignItems: "center" },
  backBtnText: { fontSize: 14, fontWeight: "600", color: "#2E86C1" },
});
