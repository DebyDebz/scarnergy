import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../store/authStore";
import { useSyncQueue } from "../../hooks/useSyncQueue";
import { useBLE } from "../../lib/BLEContext";

export default function Dashboard() {
  const { profile }    = useAuthStore();
  const { pendingCount, drain } = useSyncQueue();
  const { isConnected, state: bleState, deviceName, batteryLevel } = useBLE();
  const router         = useRouter();
  const [stats, setStats] = useState({ activeSessions: 0, buildings: 0, measurements: 0 });
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [sessRes, buildRes, measRes, recentRes] = await Promise.all([
      supabase.from("inspection_sessions").select("id", { count: "exact" }).eq("status", "active"),
      supabase.from("buildings").select("id", { count: "exact" }),
      supabase.from("measurements").select("id", { count: "exact" }),
      supabase.from("session_summary").select("*").order("started_at", { ascending: false }).limit(5),
    ]);
    setStats({
      activeSessions: sessRes.count ?? 0,
      buildings:      buildRes.count ?? 0,
      measurements:   measRes.count ?? 0,
    });
    setRecentSessions(recentRes.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Good day, {profile?.full_name?.split(" ")[0]} 👋</Text>
        {pendingCount > 0 && (
          <TouchableOpacity style={styles.syncBadge} onPress={drain}>
            <Text style={styles.syncText}>⟳ {pendingCount} pending sync</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        {[
          { label: "Active Sessions", value: stats.activeSessions, color: "#2E86C1" },
          { label: "Buildings",       value: stats.buildings,      color: "#1E8449" },
          { label: "Measurements",    value: stats.measurements,   color: "#8E44AD" },
        ].map(s => (
          <View key={s.label} style={[styles.statCard, { borderTopColor: s.color }]}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Quick actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {/* New Inspection */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: "#EBF5FB", borderTopColor: "#2E86C1" }]}
            onPress={() => router.push("/tabs/buildings")}
            activeOpacity={0.75}
          >
            <View style={styles.actionCardTop}>
              <Ionicons name="clipboard-outline" size={26} color="#2E86C1" />
              {stats.activeSessions > 0 && (
                <View style={[styles.actionBadge, { backgroundColor: "#2E86C1" }]}>
                  <Text style={styles.actionBadgeText}>{stats.activeSessions}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.actionCardTitle, { color: "#1A5276" }]}>New Inspection</Text>
            <Text style={styles.actionCardSub}>
              {stats.activeSessions > 0
                ? `${stats.activeSessions} active session${stats.activeSessions > 1 ? "s" : ""}`
                : "Select a building to begin"}
            </Text>
          </TouchableOpacity>

          {/* Connect GLM */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: isConnected ? "#EAFAF1" : "#FDFEFE", borderTopColor: isConnected ? "#27AE60" : "#CCC" }]}
            onPress={() => router.push("/tabs/device")}
            activeOpacity={0.75}
          >
            <View style={styles.actionCardTop}>
              <Ionicons name="bluetooth-outline" size={26} color={isConnected ? "#27AE60" : "#1E3A5F"} />
              <View style={[styles.statusDot, {
                backgroundColor: isConnected ? "#27AE60" : bleState === "scanning" ? "#F39C12" : "#CCC",
              }]} />
            </View>
            <Text style={[styles.actionCardTitle, { color: isConnected ? "#1E8449" : "#1E3A5F" }]}>
              {isConnected ? "GLM Connected" : "Connect GLM"}
            </Text>
            <Text style={styles.actionCardSub}>
              {isConnected
                ? `${deviceName ?? "GLM 50C"}${batteryLevel != null ? ` · ${batteryLevel}%` : ""}`
                : bleState === "scanning"
                ? "Scanning for device…"
                : "Tap to pair device"}
            </Text>
          </TouchableOpacity>

          {/* Sessions */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: "#F5EEF8", borderTopColor: "#6C3483" }]}
            onPress={() => router.push("/tabs/sessions")}
            activeOpacity={0.75}
          >
            <View style={styles.actionCardTop}>
              <Ionicons name="albums-outline" size={26} color="#6C3483" />
            </View>
            <Text style={[styles.actionCardTitle, { color: "#6C3483" }]}>My Sessions</Text>
            <Text style={styles.actionCardSub}>
              {stats.measurements > 0 ? `${stats.measurements} measurements` : "View all sessions"}
            </Text>
          </TouchableOpacity>

          {/* Sync */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: pendingCount > 0 ? "#FEF9E7" : "#F2F3F4", borderTopColor: pendingCount > 0 ? "#E67E22" : "#888" }]}
            onPress={drain}
            activeOpacity={0.75}
          >
            <View style={styles.actionCardTop}>
              <Ionicons
                name={pendingCount > 0 ? "cloud-upload-outline" : "cloud-done-outline"}
                size={26}
                color={pendingCount > 0 ? "#E67E22" : "#555"}
              />
              {pendingCount > 0 && (
                <View style={[styles.actionBadge, { backgroundColor: "#E67E22" }]}>
                  <Text style={styles.actionBadgeText}>{pendingCount}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.actionCardTitle, { color: pendingCount > 0 ? "#9A6A00" : "#555" }]}>
              {pendingCount > 0 ? "Sync Now" : "All Synced"}
            </Text>
            <Text style={styles.actionCardSub}>
              {pendingCount > 0 ? `${pendingCount} item${pendingCount > 1 ? "s" : ""} pending` : "Data is up to date"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Recent sessions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Sessions</Text>
        {recentSessions.length === 0
          ? <Text style={styles.emptyText}>No sessions yet. Start an inspection!</Text>
          : recentSessions.map(s => (
            <TouchableOpacity key={s.id} style={styles.sessionCard}
              onPress={() => router.push(`/tabs/sessions/${s.id}`)}>
              <View style={styles.sessionLeft}>
                <Text style={styles.sessionCode}>{s.session_code}</Text>
                <Text style={styles.sessionAddress}>{s.building_address}</Text>
                <Text style={styles.sessionDate}>{new Date(s.started_at).toLocaleDateString("nl-NL")}</Text>
              </View>
              <View style={[styles.statusBadge,
                { backgroundColor: s.status === "completed" ? "#E8F8F5" : s.status === "active" ? "#EBF5FB" : "#FDFEFE" }]}>
                <Text style={[styles.statusText,
                  { color: s.status === "completed" ? "#1E8449" : s.status === "active" ? "#2E86C1" : "#888" }]}>
                  {s.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#F5F7FA" },
  header:         { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  greeting:       { fontSize: 20, fontWeight: "700", color: "#1E3A5F" },
  syncBadge:      { backgroundColor: "#FEF9E7", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "#F39C12" },
  syncText:       { fontSize: 12, color: "#D68910", fontWeight: "600" },
  statsRow:       { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  statCard:       { flex: 1, backgroundColor: "#FFF", borderRadius: 12, padding: 16, borderTopWidth: 3, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  statValue:      { fontSize: 28, fontWeight: "800" },
  statLabel:      { fontSize: 11, color: "#888", marginTop: 2 },
  section:        { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle:   { fontSize: 16, fontWeight: "700", color: "#1E3A5F", marginBottom: 12 },
  actionGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  actionCard:       { width: "47%", borderRadius: 16, padding: 16, borderTopWidth: 3, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6 },
  actionCardTop:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  actionBadge:      { borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  actionBadgeText:  { fontSize: 11, fontWeight: "700", color: "#FFF" },
  statusDot:        { width: 10, height: 10, borderRadius: 5 },
  actionCardTitle:  { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  actionCardSub:    { fontSize: 11, color: "#777", lineHeight: 15 },
  emptyText:      { color: "#AAA", fontStyle: "italic", textAlign: "center", padding: 20 },
  sessionCard:    { backgroundColor: "#FFF", borderRadius: 12, padding: 16, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  sessionLeft:    { flex: 1 },
  sessionCode:    { fontSize: 14, fontWeight: "700", color: "#1E3A5F" },
  sessionAddress: { fontSize: 13, color: "#444", marginTop: 2 },
  sessionDate:    { fontSize: 12, color: "#888", marginTop: 2 },
  statusBadge:    { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText:     { fontSize: 12, fontWeight: "600" },
});
