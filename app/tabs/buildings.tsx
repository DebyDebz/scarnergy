import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { supabase, Building } from "../../lib/supabase";
import { useAuthStore } from "../../store/authStore";

export default function BuildingsScreen() {
  const { profile }  = useAuthStore();
  const router       = useRouter();
  const [buildings,  setBuildings]  = useState<Building[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    if (!profile) { setLoading(false); return; }
    supabase
      .from("buildings")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("city")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setBuildings(data ?? []);
        setLoading(false);
      });
  }, [profile]);

  if (loading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;
  if (error)   return <Text style={styles.error}>{error}</Text>;

  return (
    <View style={styles.container}>
      <FlatList
        data={buildings}
        keyExtractor={b => b.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No buildings found.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/tabs/sessions?buildingId=${item.id}`)}
          >
            <Text style={styles.ref}>{item.reference_code}</Text>
            <Text style={styles.address}>
              {item.street} {item.house_number}, {item.city}
            </Text>
            <Text style={styles.meta}>
              {item.building_type} · {item.construction_year} · {item.gross_floor_area_m2} m²
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F7FA" },
  loader:    { flex: 1 },
  list:      { padding: 16, gap: 12 },
  card:      { backgroundColor: "#FFF", borderRadius: 12, padding: 16,
               elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  ref:       { fontSize: 12, fontWeight: "700", color: "#2E86C1",
               textTransform: "uppercase", letterSpacing: 1 },
  address:   { fontSize: 15, fontWeight: "600", color: "#1E3A5F", marginTop: 4 },
  meta:      { fontSize: 12, color: "#888", marginTop: 4 },
  empty:     { textAlign: "center", color: "#AAA", fontStyle: "italic", padding: 40 },
  error:     { flex: 1, textAlign: "center", color: "#E74C3C", padding: 40, marginTop: 40 },
});
