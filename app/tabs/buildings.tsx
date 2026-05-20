import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase, BuildingSummary } from "../../lib/supabase";
import { useAuthStore } from "../../store/authStore";

export default function BuildingsScreen() {
  const { profile } = useAuthStore();
  const router      = useRouter();
  const [buildings,  setBuildings]  = useState<BuildingSummary[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [starting,   setStarting]   = useState<string | null>(null);

  const load = useCallback(() => {
    if (!profile) { setLoading(false); return; }
    supabase
      .from("building_summary")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("city")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setBuildings((data ?? []) as BuildingSummary[]);
        setLoading(false);
      });
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const startInspection = useCallback(async (building: BuildingSummary) => {
    if (!profile) return;
    setStarting(building.id);
    const { data, error } = await supabase
      .from("inspection_sessions")
      .insert({
        org_id:       profile.org_id,
        building_id:  building.id,
        inspector_id: profile.id,
      })
      .select()
      .single();

    setStarting(null);
    if (error) { Alert.alert("Error", error.message); return; }
    router.push(`/tabs/sessions/${data.id}`);
  }, [profile, router]);

  if (loading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (error)   return <Text style={styles.error}>{error}</Text>;

  return (
    <View style={styles.container}>
      <FlatList
        data={buildings}
        keyExtractor={b => b.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No buildings found.</Text>}
        renderItem={({ item }) => {
          const typeColor = buildingTypeColor(item.building_type);
          const meta = [
            item.building_type.replace(/_/g, " "),
            item.construction_year,
            item.gross_floor_area_m2 ? `${item.gross_floor_area_m2} m²` : null,
          ].filter(Boolean).join(" · ");

          return (
            <View style={styles.card}>

              {/* Top: address + energy label */}
              <TouchableOpacity
                onPress={() => router.push(`/tabs/sessions?buildingId=${item.id}`)}
                activeOpacity={0.7}
                style={styles.cardTop}
              >
                <View style={styles.addressRow}>
                  <View style={[styles.dot, { backgroundColor: typeColor }]} />
                  <Text style={styles.address} numberOfLines={1}>{item.full_address}</Text>
                  {item.latest_energy_label && (
                    <View style={[styles.energyBadge, energyLabelStyle(item.latest_energy_label)]}>
                      <Text style={styles.energyBadgeText}>{item.latest_energy_label}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cityLine}>{item.postal_code} · {item.city}</Text>
                <Text style={styles.metaLine}>{meta}</Text>
              </TouchableOpacity>

              {/* Stats */}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: typeColor }]}>{item.zone_count}</Text>
                  <Text style={styles.statLbl}>zones</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: typeColor }]}>{item.element_count}</Text>
                  <Text style={styles.statLbl}>elements</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: typeColor }]}>{item.session_count}</Text>
                  <Text style={styles.statLbl}>sessions</Text>
                </View>
              </View>

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.sessionsBtn}
                  onPress={() => router.push(`/tabs/sessions?buildingId=${item.id}`)}
                >
                  <Ionicons name="albums-outline" size={13} color="#777" />
                  <Text style={styles.sessionsBtnText}>Sessions</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.startBtn, { backgroundColor: typeColor }, starting === item.id && styles.startBtnDisabled]}
                  onPress={() => startInspection(item)}
                  disabled={starting === item.id}
                >
                  {starting === item.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <Ionicons name="add" size={14} color="#fff" />
                        <Text style={styles.startBtnText}>Start Inspection</Text>
                      </>
                  }
                </TouchableOpacity>
              </View>

            </View>
          );
        }}
      />
    </View>
  );
}

function buildingTypeColor(type: string): string {
  const map: Record<string, string> = {
    residential_single: "#2E86C1",
    residential_multi:  "#1A5276",
    apartment:          "#6C3483",
    office:             "#117A65",
    retail:             "#E67E22",
    industrial:         "#546E7A",
    mixed_use:          "#00838F",
    other:              "#7F8C8D",
  };
  return map[type] ?? "#7F8C8D";
}

function energyLabelStyle(label: string) {
  const map: Record<string, { backgroundColor: string }> = {
    "A+++": { backgroundColor: "#065f46" },
    "A++":  { backgroundColor: "#047857" },
    "A+":   { backgroundColor: "#059669" },
    A:      { backgroundColor: "#16a34a" },
    B:      { backgroundColor: "#65a30d" },
    C:      { backgroundColor: "#ca8a04" },
    D:      { backgroundColor: "#d97706" },
    E:      { backgroundColor: "#ea580c" },
    F:      { backgroundColor: "#dc2626" },
    G:      { backgroundColor: "#b91c1c" },
  };
  return map[label] ?? { backgroundColor: "#9ca3af" };
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: "#F5F7FA" },
  loader:          { flex: 1 },
  list:            { padding: 16, gap: 12 },
  empty:           { textAlign: "center", color: "#AAA", fontStyle: "italic", padding: 40 },
  error:           { flex: 1, textAlign: "center", color: "#E74C3C", padding: 40, marginTop: 40 },

  card:            { backgroundColor: "#FFF", borderRadius: 14,
                     borderWidth: 1, borderColor: "#EBEBEB" },

  cardTop:         { padding: 16, paddingBottom: 12 },
  addressRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  dot:             { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  address:         { fontSize: 15, fontWeight: "700", color: "#111", flex: 1 },
  energyBadge:     { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 0 },
  energyBadgeText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  cityLine:        { fontSize: 13, color: "#555", marginLeft: 16, marginBottom: 2 },
  metaLine:        { fontSize: 12, color: "#AAA", marginLeft: 16, textTransform: "capitalize" },

  statsRow:        { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#F0F0F0",
                     borderBottomWidth: 1, borderBottomColor: "#F0F0F0", paddingVertical: 12 },
  statItem:        { flex: 1, alignItems: "center" },
  statDivider:     { width: 1, backgroundColor: "#F0F0F0" },
  statNum:         { fontSize: 22, fontWeight: "800", lineHeight: 26 },
  statLbl:         { fontSize: 10, color: "#AAA", marginTop: 2, fontWeight: "500" },

  actions:         { flexDirection: "row", gap: 8, padding: 12 },
  sessionsBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                     gap: 5, paddingVertical: 9, borderRadius: 8,
                     borderWidth: 1, borderColor: "#E5E5E5" },
  sessionsBtnText: { fontSize: 13, fontWeight: "600", color: "#777" },
  startBtn:        { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
                     gap: 5, paddingVertical: 9, borderRadius: 8, minHeight: 38 },
  startBtnDisabled:{ opacity: 0.5 },
  startBtnText:    { fontSize: 13, fontWeight: "700", color: "#fff" },
});
