import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase, SessionSummary } from "../../../lib/supabase";
import { useAuthStore } from "../../../store/authStore";

const STATUS_COLOR: Record<string, string> = {
  active:    "#2E86C1",
  completed: "#1E8449",
  paused:    "#E67E22",
};

export default function SessionsScreen() {
  const { profile }  = useAuthStore();
  const router       = useRouter();
  const { buildingId } = useLocalSearchParams<{ buildingId?: string }>();
  const [sessions,   setSessions]  = useState<SessionSummary[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [error,      setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!profile) { setLoading(false); return; }
    let query = supabase
      .from("session_summary")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("started_at", { ascending: false });
    if (buildingId) query = query.eq("building_id", buildingId);
    query.then(({ data, error }) => {
      if (error) setError(error.message);
      else setSessions(data ?? []);
      setLoading(false);
    });
  }, [profile, buildingId]);

  if (loading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (error)   return <Text style={styles.error}>{error}</Text>;

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No sessions found.</Text>}
        renderItem={({ item }) => {
          const color = STATUS_COLOR[item.status] ?? "#888";
          return (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/tabs/sessions/${item.id}`)}>
              <View style={styles.top}>
                <Text style={styles.code}>{item.session_code}</Text>
                <View style={[styles.badge, { backgroundColor: color + "22" }]}>
                  <Text style={[styles.badgeText, { color }]}>{item.status}</Text>
                </View>
              </View>
              <Text style={styles.address}>{item.building_address}, {item.building_city}</Text>
              <Text style={styles.meta}>
                {item.inspector_name} · {new Date(item.started_at).toLocaleDateString("nl-NL")} · {item.total_measurements} measurements
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: "#F5F7FA" },
  loader:     { flex: 1 },
  list:       { padding: 16, gap: 12 },
  card:       { backgroundColor: "#FFF", borderRadius: 12, padding: 16,
                elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  top:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code:       { fontSize: 13, fontWeight: "700", color: "#1E3A5F" },
  badge:      { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText:  { fontSize: 12, fontWeight: "600" },
  address:    { fontSize: 14, color: "#444", marginTop: 6 },
  meta:       { fontSize: 12, color: "#888", marginTop: 4 },
  empty:      { textAlign: "center", color: "#AAA", fontStyle: "italic", padding: 40 },
  error:      { flex: 1, textAlign: "center", color: "#E74C3C", padding: 40, marginTop: 40 },
});
