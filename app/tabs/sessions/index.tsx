import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { supabase, SessionSummary } from "../../../lib/supabase";
import { useAuthStore } from "../../../store/authStore";
import { useDataSourceStore } from "../../../store/dataSourceStore";
import {
  fetchAppsheetSessions, fetchAppsheetBuildings, materializeAppsheetBuilding, AppsheetProxyError,
} from "../../../lib/appsheetProxy";

// Building picker in the "+" modal below only ever needs these fields —
// normalized here so it can render a native buildings.* row and an
// AppsheetBuilding (Objecten row) the same way. `appsheetObjectId` is set
// only for AppSheet-sourced entries (native shadow rows carry their own
// `appsheet_object_id`, AppSheet rows use their Object ID directly), and
// drives the materialize-before-create step in createSession.
interface PickerBuilding {
  id: string;
  street: string;
  house_number: string;
  postal_code: string;
  city: string;
  appsheetObjectId: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  active:    "#2E86C1",
  completed: "#1E8449",
  paused:    "#E67E22",
  cancelled: "#888888",
};

export default function SessionsScreen() {
  const { profile }    = useAuthStore();
  const { source }     = useDataSourceStore();
  const router         = useRouter();
  const { buildingId } = useLocalSearchParams<{ buildingId?: string }>();

  const [sessions,  setSessions]  = useState<SessionSummary[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  // Tracks whether we've done at least one successful load so the profile
  // useEffect below doesn't fire a second time when the screen is already focused.
  const didInitialLoad = useRef(false);

  // New-session modal
  const [showModal,          setShowModal]          = useState(false);
  const [buildings,          setBuildings]          = useState<PickerBuilding[]>([]);
  const [buildingsLoading,   setBuildingsLoading]   = useState(false);
  const [buildingsError,     setBuildingsError]     = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [notes,              setNotes]              = useState("");
  const [creating,           setCreating]           = useState(false);

  const loadSessions = useCallback(() => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    if (source === "appsheet") {
      fetchAppsheetSessions(buildingId)
        .then((data) => { setSessions(data as unknown as SessionSummary[]); setError(null); })
        .catch((e) => setError(e instanceof AppsheetProxyError ? e.message : "Could not load AppSheet sessions."))
        .finally(() => setLoading(false));
      return;
    }
    let query = supabase
      .from("session_summary")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("started_at", { ascending: false });
    if (buildingId) query = query.eq("building_id", buildingId);
    query.then(({ data, error }) => {
      if (error) setError(error.message);
      else setError(null);
      setSessions(data ?? []);
      setLoading(false);
    });
  }, [profile, buildingId, source]);

  // Refresh whenever this screen comes into focus; set the initial-load flag.
  useFocusEffect(useCallback(() => {
    loadSessions();
    didInitialLoad.current = true;
  }, [loadSessions]));

  // Also load when profile becomes available (handles the case where the screen
  // is mounted before auth finishes — focus fires before profile exists, so we
  // need this second trigger). Skip if useFocusEffect already ran with a profile.
  useEffect(() => {
    if (profile && !didInitialLoad.current) loadSessions();
  }, [profile]);

  const openModal = useCallback(() => {
    if (!profile) return;
    setSelectedBuildingId(null);
    setNotes("");
    setBuildingsError(null);
    setBuildingsLoading(true);
    setShowModal(true);

    // Mirrors tabs/buildings.tsx's own source branch: in AppSheet mode the
    // picker lists live Objecten rows (via the same proxy Buildings/Sessions
    // already use), not the native buildings table — the two data sources
    // stay parallel rather than merged, same as everywhere else in the app.
    if (source === "appsheet") {
      fetchAppsheetBuildings()
        .then((data) => {
          setBuildings(data.map(b => ({
            id: b.id, street: b.street, house_number: b.house_number,
            postal_code: b.postal_code, city: b.city, appsheetObjectId: b.id,
          })));
        })
        .catch((e) => setBuildingsError(e instanceof AppsheetProxyError ? e.message : "Could not load AppSheet buildings."))
        .finally(() => setBuildingsLoading(false));
      return;
    }

    supabase
      .from("buildings")
      .select("id, org_id, reference_code, street, house_number, postal_code, city, building_type, construction_year, gross_floor_area_m2, appsheet_object_id")
      .eq("org_id", profile.org_id)
      .eq("is_active", true)
      .order("city", { ascending: true })
      .then(({ data, error }) => {
        if (error) setBuildingsError(error.message);
        setBuildings((data ?? []).map(b => ({
          id: b.id, street: b.street, house_number: b.house_number,
          postal_code: b.postal_code, city: b.city, appsheetObjectId: b.appsheet_object_id,
        })));
        setBuildingsLoading(false);
      });
  }, [profile, source]);

  const createSession = useCallback(async () => {
    if (!profile || !selectedBuildingId) return;
    setCreating(true);
    try {
      const picked = buildings.find(b => b.id === selectedBuildingId);

      // AppSheet buildings (and native shadow rows already linked to one)
      // aren't necessarily materialized yet — the session/zone/element flow
      // below is FK-anchored to a real buildings.id, so this reuses the same
      // materialize-or-reuse step tabs/buildings.tsx's "Start Inspection" uses.
      let buildingId = selectedBuildingId;
      if (source === "appsheet" && picked?.appsheetObjectId) {
        buildingId = await materializeAppsheetBuilding(picked.appsheetObjectId);
      }

      const { data, error } = await supabase
        .from("inspection_sessions")
        .insert({
          org_id:       profile.org_id,
          building_id:  buildingId,
          inspector_id: profile.id,
          notes:        notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      setShowModal(false);
      if (data?.id) router.push(`/tabs/sessions/flow?id=${data.id}&buildingId=${buildingId}`);
    } catch (e: any) {
      Alert.alert("Could not create session", e instanceof AppsheetProxyError ? e.message : (e.message ?? "Unknown error"));
    } finally {
      setCreating(false);
    }
  }, [profile, selectedBuildingId, notes, router, source, buildings]);

  if (error) return (
    <View style={styles.errorWrap}>
      <Text style={styles.error}>{error}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={() => { setError(null); setLoading(true); loadSessions(); }}>
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading
        ? <ActivityIndicator style={styles.loader} color="#1E3A5F" />
        : (
          <FlatList
            data={sessions}
            keyExtractor={s => s.id}
            contentContainerStyle={styles.list}
            onRefresh={loadSessions}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No sessions yet</Text>
                <Text style={styles.emptySub}>
                  {source === "appsheet" ? "No AppSheet visits found." : "Tap + to start your first inspection."}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const color = STATUS_COLOR[item.status] ?? "#888";
              const startedDate = new Date(item.started_at);
              const startedLabel = Number.isNaN(startedDate.getTime())
                ? "—"
                : startedDate.toLocaleDateString("nl-NL");
              const measurementsLabel = source === "appsheet" ? "—" : item.total_measurements;
              return (
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => {
                    if (source === "appsheet") {
                      router.push(`/tabs/sessions/appsheet-detail?objectId=${encodeURIComponent(item.id)}`);
                      return;
                    }
                    router.push(`/tabs/sessions/${item.id}`);
                  }}
                  activeOpacity={0.75}
                >
                  <View style={styles.top}>
                    <Text style={styles.code}>{item.session_code}</Text>
                    <View style={[styles.badge, { backgroundColor: color + "22" }]}>
                      <Text style={[styles.badgeText, { color }]}>{item.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.address}>{item.building_address}, {item.building_city}</Text>
                  <Text style={styles.meta}>
                    {item.inspector_name}
                    {" · "}
                    {startedLabel}
                    {" · "}
                    {measurementsLabel} measurements
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        )
      }

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* ── New Session Modal ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>New Session</Text>
              <TouchableOpacity
                onPress={createSession}
                disabled={!selectedBuildingId || creating}
                style={[styles.startBtn, (!selectedBuildingId || creating) && styles.startBtnDisabled]}
              >
                <Text style={styles.startBtnText}>{creating ? "Starting…" : "Start"}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">

              {/* Building picker */}
              <Text style={styles.sectionLabel}>SELECT BUILDING</Text>

              {buildingsLoading
                ? <ActivityIndicator color="#1E3A5F" style={{ marginVertical: 24 }} />
                : buildingsError
                  ? <Text style={styles.noBuildingsText}>{buildingsError}</Text>
                : buildings.length === 0
                  ? (
                    <Text style={styles.noBuildingsText}>
                      {source === "appsheet"
                        ? "No AppSheet buildings found."
                        : "No active buildings found.\nAdd one in the web dashboard first."}
                    </Text>
                  )
                  : buildings.map(b => {
                      const selected = selectedBuildingId === b.id;
                      return (
                        <TouchableOpacity
                          key={b.id}
                          style={[styles.buildingRow, selected && styles.buildingRowSelected]}
                          onPress={() => setSelectedBuildingId(b.id)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.buildingInfo}>
                            <Text style={[styles.buildingStreet, selected && styles.buildingStreetSel]}>
                              {b.street} {b.house_number}
                            </Text>
                            <Text style={[styles.buildingCity, selected && styles.buildingCitySel]}>
                              {b.postal_code} {b.city}
                            </Text>
                          </View>
                          {selected && <Text style={styles.checkmark}>✓</Text>}
                        </TouchableOpacity>
                      );
                    })
              }

              {source === "appsheet" && buildings.length > 0 && (
                <Text style={styles.appsheetNote}>
                  This session syncs back to AppSheet once wall measurements are completed.
                </Text>
              )}

              {/* Notes */}
              <Text style={[styles.sectionLabel, { marginTop: 28 }]}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Add notes for this inspection…"
                placeholderTextColor="#CCC"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <View style={{ height: 40 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#F5F7FA" },
  loader:      { flex: 1 },
  list:        { padding: 16, gap: 12, paddingBottom: 100 },

  errorWrap:   { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error:       { textAlign: "center", color: "#E74C3C", marginBottom: 16, lineHeight: 20 },
  retryBtn:    { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: "#1E3A5F" },
  retryBtnText:{ color: "#fff", fontWeight: "700", fontSize: 14 },

  card:        { backgroundColor: "#FFF", borderRadius: 12, padding: 16,
                 elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  top:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code:        { fontSize: 13, fontWeight: "700", color: "#1E3A5F" },
  badge:       { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText:   { fontSize: 12, fontWeight: "600" },
  address:     { fontSize: 14, color: "#444", marginTop: 6 },
  meta:        { fontSize: 12, color: "#888", marginTop: 4 },

  emptyWrap:   { padding: 60, alignItems: "center" },
  emptyTitle:  { fontSize: 16, fontWeight: "700", color: "#1E3A5F", marginBottom: 6 },
  emptySub:    { fontSize: 14, color: "#AAA", textAlign: "center" },

  fab:         { position: "absolute", bottom: 28, right: 20,
                 width: 56, height: 56, borderRadius: 28, backgroundColor: "#1E3A5F",
                 alignItems: "center", justifyContent: "center",
                 elevation: 6, shadowColor: "#000", shadowOpacity: 0.22,
                 shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabText:     { color: "#fff", fontSize: 30, lineHeight: 34, fontWeight: "300" },

  modal:       { flex: 1, backgroundColor: "#F5F7FA" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                 paddingHorizontal: 16, paddingVertical: 14,
                 backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#EEE" },
  cancelBtn:   { minWidth: 60 },
  cancelText:  { fontSize: 15, fontWeight: "600", color: "#E74C3C" },
  modalTitle:  { fontSize: 17, fontWeight: "700", color: "#1E3A5F" },
  startBtn:    { minWidth: 60, alignItems: "flex-end" },
  startBtnDisabled: { opacity: 0.35 },
  startBtnText:{ fontSize: 15, fontWeight: "700", color: "#1E3A5F" },

  modalScroll: { flex: 1, padding: 16 },
  sectionLabel:{ fontSize: 11, fontWeight: "700", color: "#888",
                 letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" },
  noBuildingsText: { color: "#AAA", fontStyle: "italic", textAlign: "center",
                     padding: 24, lineHeight: 22 },
  appsheetNote:    { color: "#999", fontSize: 12, fontStyle: "italic",
                     marginTop: 10, lineHeight: 17 },

  buildingRow:        { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 8,
                        flexDirection: "row", alignItems: "center",
                        borderWidth: 2, borderColor: "transparent",
                        elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  buildingRowSelected:{ borderColor: "#1E3A5F", backgroundColor: "#EBF2FC" },
  buildingInfo:       { flex: 1 },
  buildingStreet:     { fontSize: 14, fontWeight: "700", color: "#1A1A2E" },
  buildingStreetSel:  { color: "#1E3A5F" },
  buildingCity:       { fontSize: 12, color: "#777", marginTop: 2 },
  buildingCitySel:    { color: "#2E6DA4" },
  checkmark:          { fontSize: 18, color: "#1E3A5F", fontWeight: "700" },

  notesInput:  { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1,
                 borderColor: "#DDE", padding: 12, fontSize: 14, color: "#1A1A2E",
                 minHeight: 100 },
});
