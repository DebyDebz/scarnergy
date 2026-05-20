import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { supabase, SessionSummary, Building } from "../../../lib/supabase";
import { useAuthStore } from "../../../store/authStore";

const STATUS_COLOR: Record<string, string> = {
  active:    "#2E86C1",
  completed: "#1E8449",
  paused:    "#E67E22",
  cancelled: "#888888",
};

export default function SessionsScreen() {
  const { profile }    = useAuthStore();
  const router         = useRouter();
  const { buildingId } = useLocalSearchParams<{ buildingId?: string }>();

  const [sessions,  setSessions]  = useState<SessionSummary[]>([]);
  const [loading,   setLoading]   = useState(true);

  // New-session modal
  const [showModal,          setShowModal]          = useState(false);
  const [buildings,          setBuildings]          = useState<Building[]>([]);
  const [buildingsLoading,   setBuildingsLoading]   = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [notes,              setNotes]              = useState("");
  const [creating,           setCreating]           = useState(false);

  const loadSessions = useCallback(() => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("session_summary")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("started_at", { ascending: false });
    if (buildingId) query = query.eq("building_id", buildingId);
    query.then(({ data, error }) => {
      if (error) console.warn("[Sessions]", error.message);
      setSessions(data ?? []);
      setLoading(false);
    });
  }, [profile, buildingId]);

  // Refresh whenever this screen comes into focus
  useFocusEffect(useCallback(() => { loadSessions(); }, [loadSessions]));

  // Also load when profile becomes available (handles timing race on first mount)
  useEffect(() => { if (profile) loadSessions(); }, [profile]);

  const openModal = useCallback(() => {
    if (!profile) return;
    setSelectedBuildingId(null);
    setNotes("");
    setBuildingsLoading(true);
    setShowModal(true);
    supabase
      .from("buildings")
      .select("id, org_id, reference_code, street, house_number, postal_code, city, building_type, construction_year, gross_floor_area_m2")
      .eq("org_id", profile.org_id)
      .eq("is_active", true)
      .order("city", { ascending: true })
      .then(({ data }) => {
        setBuildings((data as Building[]) ?? []);
        setBuildingsLoading(false);
      });
  }, [profile]);

  const createSession = useCallback(async () => {
    if (!profile || !selectedBuildingId) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("inspection_sessions")
        .insert({
          org_id:       profile.org_id,
          building_id:  selectedBuildingId,
          inspector_id: profile.id,
          notes:        notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      setShowModal(false);
      if (data?.id) router.push(`/tabs/sessions/${data.id}`);
    } catch (e: any) {
      Alert.alert("Could not create session", e.message ?? "Unknown error");
    } finally {
      setCreating(false);
    }
  }, [profile, selectedBuildingId, notes, router]);

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
                <Text style={styles.emptySub}>Tap + to start your first inspection.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const color = STATUS_COLOR[item.status] ?? "#888";
              return (
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => router.push(`/tabs/sessions/${item.id}`)}
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
                    {new Date(item.started_at).toLocaleDateString("nl-NL")}
                    {" · "}
                    {item.total_measurements} measurements
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
                : buildings.length === 0
                  ? (
                    <Text style={styles.noBuildingsText}>
                      No active buildings found.{"\n"}Add one in the web dashboard first.
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
