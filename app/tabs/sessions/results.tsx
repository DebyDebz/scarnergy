import { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase, SessionSummary, Zone, Measurement } from "../../../lib/supabase";

// Best → worst; same ordering the energy_label_estimate edge function uses to
// pick the building label (worst zone wins).
const LABEL_ORDER = ["A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"];

const LABEL_COLORS: Record<string, string> = {
  "A++++": "#00733D", "A+++": "#00733D", "A++": "#0B7A3E", "A+": "#1E8449",
  "A": "#27AE60", "B": "#7CB342", "C": "#C0CA33", "D": "#F1C40F",
  "E": "#E67E22", "F": "#D35400", "G": "#C0392B",
};

interface ElementLite {
  id: string; name: string; element_type: string; zone_id: string;
  rc_value: number | null; u_value: number | null; efficiency: number | null;
}

interface Coverage { filled: number; total: number; }

function worstLabel(labels: (string | null)[]): string | null {
  const known = labels.filter((l): l is string => !!l && LABEL_ORDER.includes(l));
  if (known.length === 0) return null;
  return known.reduce((worst, l) => (LABEL_ORDER.indexOf(l) > LABEL_ORDER.indexOf(worst) ? l : worst));
}

export default function SessionResultsScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [session,     setSession]     = useState<SessionSummary | null>(null);
  const [zones,       setZones]       = useState<Zone[]>([]);
  const [elements,    setElements]    = useState<ElementLite[]>([]);
  const [coverage,    setCoverage]    = useState<Coverage>({ filled: 0, total: 0 });
  const [anomalies,   setAnomalies]   = useState<Measurement[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data: sess, error: sessErr } = await supabase
        .from("session_summary").select("*").eq("id", sessionId).maybeSingle();
      if (sessErr) throw sessErr;
      if (!sess) throw new Error("Session not found");
      setSession(sess);

      const { data: zoneRows, error: zoneErr } = await supabase
        .from("zones")
        .select("*")
        .eq("building_id", sess.building_id)
        .eq("is_active", true)
        .order("floor_level", { ascending: true });
      if (zoneErr) throw zoneErr;
      const zoneList: Zone[] = zoneRows ?? [];
      setZones(zoneList);

      const zoneIds = zoneList.map(z => z.id);
      const [elemRes, anomRes] = await Promise.all([
        zoneIds.length
          ? supabase.from("building_elements")
              .select("id, name, element_type, zone_id, rc_value, u_value, efficiency")
              .in("zone_id", zoneIds).eq("is_active", true)
          : Promise.resolve({ data: [] as ElementLite[], error: null }),
        supabase.from("measurements")
          .select("id, value_mm, unit, measurement_type, measured_at, element_id, is_anomaly, session_id, device_id, org_id, inspector_id, is_deleted, ingestion_path")
          .eq("session_id", sessionId).eq("is_anomaly", true).eq("is_deleted", false)
          .order("measured_at", { ascending: false }).limit(100),
      ]);
      const elems: ElementLite[] = (elemRes.data ?? []) as ElementLite[];
      setElements(elems);
      setAnomalies((anomRes.data ?? []) as Measurement[]);

      // Data coverage: how much of the thermal envelope has real values behind
      // the label. This is what compute_zone_energy_label averages over, so it
      // is an honest proxy for how much to trust the (rule-based) label.
      const envelope  = elems.filter(e => ["gevel", "dak", "vloer"].includes(e.element_type));
      const installs  = elems.filter(e => e.element_type === "installatie");
      const elementIds = new Set(elems.map(e => e.id));
      const { data: openRows } = await supabase
        .from("openings").select("element_id, u_value_total").eq("is_active", true);
      const openings = ((openRows ?? []) as { element_id: string; u_value_total: number | null }[])
        .filter(o => elementIds.has(o.element_id));

      const filled =
        envelope.filter(e => e.rc_value != null).length +
        installs.filter(e => e.efficiency != null).length +
        openings.filter(o => o.u_value_total != null).length;
      const total = envelope.length + installs.length + openings.length;
      setCoverage({ filled, total });

      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Failed to load results");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Re-run the label computation server-side. Uses the same edge-function-first,
  // RPC-fallback pattern as session close in [id].tsx (edge functions are not
  // available in local dev).
  const recompute = useCallback(async () => {
    if (!session?.building_id) return;
    setRecomputing(true);
    try {
      const { error: fnErr } = await supabase.functions.invoke("energy_label_estimate", {
        body: { building_id: session.building_id },
      });
      if (fnErr) throw fnErr;
    } catch {
      for (const z of zones) {
        const { error: rpcErr } = await supabase.rpc("compute_zone_energy_label", { p_zone_id: z.id });
        if (rpcErr) { Alert.alert("Recompute failed", rpcErr.message); break; }
      }
    } finally {
      setRecomputing(false);
      load();
    }
  }, [session?.building_id, zones, load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1E3A5F" /></View>;
  }
  if (error || !session) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "Session not found"}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const buildingLabel = worstLabel(zones.map(z => z.energy_label));
  const elementName = (id: string | null) =>
    (id && elements.find(e => e.id === id)?.name) || "Unlinked measurement";
  const coveragePct = coverage.total > 0 ? Math.round((coverage.filled / coverage.total) * 100) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Building label hero */}
      <View style={styles.hero}>
        <Text style={styles.heroAddress}>{session.building_address}</Text>
        <Text style={styles.heroSession}>{session.session_code} · {session.inspector_name}</Text>
        <View style={[styles.heroLabel, { backgroundColor: buildingLabel ? LABEL_COLORS[buildingLabel] : "#888" }]}>
          <Text style={styles.heroLabelText}>{buildingLabel ?? "—"}</Text>
        </View>
        <Text style={styles.heroCaption}>
          {buildingLabel ? "Building energy label (worst zone)" : "No label computed yet — recompute below"}
        </Text>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: "Measurements", value: session.total_measurements ?? 0, color: "#2E86C1" },
          { label: "Anomalies",    value: session.anomaly_count ?? 0,      color: (session.anomaly_count ?? 0) > 0 ? "#C0392B" : "#1E8449" },
          { label: "Zones",        value: zones.length,                    color: "#8E44AD" },
        ].map(s => (
          <View key={s.label} style={[styles.statCard, { borderTopColor: s.color }]}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Data coverage */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Coverage</Text>
        <View style={styles.card}>
          <View style={styles.coverageHeader}>
            <Text style={styles.coverageValue}>{coveragePct}%</Text>
            <Text style={styles.coverageDetail}>
              {coverage.filled} of {coverage.total} envelope values recorded
            </Text>
          </View>
          <View style={styles.coverageTrack}>
            <View style={[styles.coverageFill, {
              width: `${coveragePct}%`,
              backgroundColor: coveragePct >= 80 ? "#1E8449" : coveragePct >= 50 ? "#E67E22" : "#C0392B",
            }]} />
          </View>
          <Text style={styles.coverageHint}>
            Rc, U and efficiency values behind the label — higher coverage means a more reliable estimate.
          </Text>
        </View>
      </View>

      {/* Per-zone labels */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Zone Labels</Text>
          <TouchableOpacity
            style={[styles.recomputeBtn, recomputing && styles.btnDisabled]}
            onPress={recompute} disabled={recomputing}
          >
            <Text style={styles.recomputeText}>{recomputing ? "Computing…" : "↻ Recompute"}</Text>
          </TouchableOpacity>
        </View>
        {zones.length === 0
          ? <Text style={styles.emptyText}>No zones defined for this building.</Text>
          : zones.map(z => (
            <View key={z.id} style={styles.zoneRow}>
              <View style={styles.zoneLeft}>
                <Text style={styles.zoneName}>{z.name}</Text>
                <Text style={styles.zoneMeta}>Floor {z.floor_level} · {z.zone_code}</Text>
              </View>
              <View style={[styles.zoneLabelChip, { backgroundColor: z.energy_label ? LABEL_COLORS[z.energy_label] : "#BBB" }]}>
                <Text style={styles.zoneLabelText}>{z.energy_label ?? "—"}</Text>
              </View>
            </View>
          ))}
      </View>

      {/* Anomaly drill-down */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Anomalies</Text>
        {anomalies.length === 0
          ? <Text style={styles.emptyText}>No anomalous measurements in this session. ✓</Text>
          : anomalies.map(a => (
            <TouchableOpacity
              key={a.id}
              style={styles.anomalyRow}
              disabled={!a.element_id}
              onPress={() => router.push({
                pathname: "/tabs/sessions/inspect",
                params: { elementId: a.element_id ?? "", sessionId: sessionId ?? "" },
              })}
              activeOpacity={0.75}
            >
              <View style={styles.anomalyDot} />
              <View style={styles.anomalyBody}>
                <Text style={styles.anomalyElement}>{elementName(a.element_id)}</Text>
                <Text style={styles.anomalyMeta}>
                  {a.value_mm.toFixed(0)} {a.unit || "mm"}
                  {a.measurement_type ? ` · ${a.measurement_type}` : ""}
                  {" · "}{new Date(a.measured_at).toLocaleString("nl-NL")}
                </Text>
              </View>
              {a.element_id ? <Text style={styles.anomalyChevron}>›</Text> : null}
            </TouchableOpacity>
          ))}
      </View>

      {/* Disclaimer — required until the §9 NTA 8800 engine replaces the heuristic */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          Indicatief — geen officieel energielabel. Gebaseerd op een vereenvoudigde
          Rc/U-heuristiek; een officiële NTA 8800-opname kan afwijken.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#F5F7FA" },
  center:         { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F5F7FA", padding: 24 },
  errorText:      { color: "#C0392B", fontSize: 14, textAlign: "center", marginBottom: 12 },
  retryBtn:       { backgroundColor: "#1E3A5F", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText:      { color: "#FFF", fontWeight: "700" },
  hero:           { alignItems: "center", paddingVertical: 24, paddingHorizontal: 16 },
  heroAddress:    { fontSize: 17, fontWeight: "700", color: "#1E3A5F", textAlign: "center" },
  heroSession:    { fontSize: 12, color: "#888", marginTop: 2, marginBottom: 16 },
  heroLabel:      { width: 96, height: 96, borderRadius: 20, alignItems: "center", justifyContent: "center",
                    elevation: 3, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8 },
  heroLabelText:  { color: "#FFF", fontSize: 36, fontWeight: "900" },
  heroCaption:    { fontSize: 12, color: "#888", marginTop: 10 },
  statsRow:       { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  statCard:       { flex: 1, backgroundColor: "#FFF", borderRadius: 12, padding: 14, borderTopWidth: 3,
                    elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  statValue:      { fontSize: 24, fontWeight: "800" },
  statLabel:      { fontSize: 11, color: "#888", marginTop: 2 },
  section:        { marginHorizontal: 16, marginBottom: 16 },
  sectionHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle:   { fontSize: 16, fontWeight: "700", color: "#1E3A5F", marginBottom: 10 },
  card:           { backgroundColor: "#FFF", borderRadius: 12, padding: 16,
                    elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  coverageHeader: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 10 },
  coverageValue:  { fontSize: 24, fontWeight: "800", color: "#1E3A5F" },
  coverageDetail: { fontSize: 12, color: "#888" },
  coverageTrack:  { height: 8, borderRadius: 4, backgroundColor: "#ECF0F1", overflow: "hidden" },
  coverageFill:   { height: 8, borderRadius: 4 },
  coverageHint:   { fontSize: 11, color: "#999", marginTop: 8, lineHeight: 15 },
  recomputeBtn:   { backgroundColor: "#EBF5FB", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                    borderWidth: 1, borderColor: "#2E86C1" },
  recomputeText:  { color: "#2E86C1", fontSize: 12, fontWeight: "700" },
  btnDisabled:    { opacity: 0.5 },
  zoneRow:        { backgroundColor: "#FFF", borderRadius: 12, padding: 14, marginBottom: 8,
                    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  zoneLeft:       { flex: 1 },
  zoneName:       { fontSize: 14, fontWeight: "700", color: "#1E3A5F" },
  zoneMeta:       { fontSize: 12, color: "#888", marginTop: 2 },
  zoneLabelChip:  { minWidth: 44, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" },
  zoneLabelText:  { color: "#FFF", fontWeight: "800", fontSize: 15 },
  anomalyRow:     { backgroundColor: "#FFF", borderRadius: 12, padding: 14, marginBottom: 8,
                    flexDirection: "row", alignItems: "center", gap: 10,
                    elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  anomalyDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C0392B" },
  anomalyBody:    { flex: 1 },
  anomalyElement: { fontSize: 14, fontWeight: "600", color: "#1A1A2E" },
  anomalyMeta:    { fontSize: 12, color: "#888", marginTop: 2 },
  anomalyChevron: { fontSize: 22, color: "#BBB", fontWeight: "300" },
  emptyText:      { color: "#AAA", fontStyle: "italic", textAlign: "center", padding: 16 },
  disclaimer:     { marginHorizontal: 16, backgroundColor: "#FEF9E7", borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: "#F7DC6F" },
  disclaimerText: { fontSize: 12, color: "#9A6A00", lineHeight: 17 },
});
