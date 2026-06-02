import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase, BuildingElement } from "../../../lib/supabase";

const { width: SCREEN_W } = Dimensions.get("window");
const PLAN_SIZE = Math.min(SCREEN_W - 32, 340);
const WALL_THICK = 56;

// ── Orientation helpers ───────────────────────────────────────────────────────

type WallSide = "north" | "east" | "south" | "west" | "dak" | "vloer" | "installatie" | "other";

function inferWall(el: BuildingElement): WallSide {
  if (el.element_type === "dak")        return "dak";
  if (el.element_type === "vloer")      return "vloer";
  if (el.element_type === "installatie") return "installatie";

  if (el.element_type === "gevel" || el.element_type === "transparant_deel") {
    if (el.orientation_deg !== null && el.orientation_deg !== undefined) {
      const deg = ((el.orientation_deg % 360) + 360) % 360;
      if (deg >= 315 || deg < 45)  return "north";
      if (deg >= 45  && deg < 135) return "east";
      if (deg >= 135 && deg < 225) return "south";
      if (deg >= 225 && deg < 315) return "west";
    }
    const n = el.name.toLowerCase();
    if (n.includes("noord") || n.includes("voor"))   return "north";
    if (n.includes("oost")  || n.includes("rechts"))  return "east";
    if (n.includes("zuid")  || n.includes("achter"))  return "south";
    if (n.includes("west")  || n.includes("links"))   return "west";
  }
  return "other";
}

function completionColor(elements: BuildingElement[]): string {
  if (elements.length === 0) return "#DDE";
  const pct = elements.filter(e => e.is_complete).length / elements.length;
  if (pct === 1) return "#1E8449";
  if (pct > 0)   return "#E67E22";
  return "#2E86C1";
}

// ── Wall band component ───────────────────────────────────────────────────────

function WallBand({
  label, elements, active, onPress, horizontal,
  style,
}: {
  label: string;
  elements: BuildingElement[];
  active: boolean;
  onPress: () => void;
  horizontal?: boolean;
  style?: object;
}) {
  const filled   = elements.filter(e => e.is_complete).length;
  const total    = elements.length;
  const dot      = completionColor(elements);

  return (
    <TouchableOpacity
      style={[
        horizontal ? styles.wallH : styles.wallV,
        active && styles.wallActive,
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {horizontal ? (
        <View style={styles.wallHInner}>
          <View style={[styles.wallDot, { backgroundColor: dot }]} />
          <Text style={styles.wallLabel}>{label}</Text>
          {total > 0 && (
            <Text style={styles.wallCount}>{filled}/{total}</Text>
          )}
        </View>
      ) : (
        <>
          <View style={[styles.wallDot, { backgroundColor: dot }]} />
          <Text style={styles.wallLabelV}>{label}</Text>
          {total > 0 && <Text style={styles.wallCountV}>{filled}/{total}</Text>}
        </>
      )}
    </TouchableOpacity>
  );
}

// ── Element list item ─────────────────────────────────────────────────────────

function ElementItem({
  item, onNavigate,
}: {
  item: BuildingElement;
  onNavigate: (el: BuildingElement) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.elementCard, item.is_complete && styles.elementCardDone]}
      onPress={() => onNavigate(item)}
      activeOpacity={0.75}
    >
      <View style={styles.elementCardRow}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{item.element_type.toUpperCase()}</Text>
        </View>
        {item.is_complete && (
          <Text style={styles.completeBadge}>✓</Text>
        )}
        <Text style={styles.elementName} numberOfLines={1}>{item.name}</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.dimRow}>
          {item.length_mm != null && <Text style={styles.dimVal}>L {item.length_mm.toFixed(0)}</Text>}
          {item.height_mm != null && <Text style={styles.dimVal}>H {item.height_mm.toFixed(0)}</Text>}
          {item.width_mm  != null && <Text style={styles.dimVal}>W {item.width_mm.toFixed(0)}</Text>}
        </View>
        <Text style={styles.inspectArrow}>→</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const SIDE_LABELS: Record<WallSide, string> = {
  north: "Noordgevel", east: "Oostgevel", south: "Zuidgevel", west: "Westgevel",
  dak: "Dak", vloer: "Vloer", installatie: "Installaties", other: "Overig",
};

export default function FloorPlanScreen() {
  const { zoneId, sessionId, zoneName, floorLevel } =
    useLocalSearchParams<{ zoneId: string; sessionId: string; zoneName: string; floorLevel: string }>();
  const router = useRouter();

  const [elements,       setElements]       = useState<BuildingElement[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [activeSide,     setActiveSide]     = useState<WallSide | null>(null);
  const [sideElements,   setSideElements]   = useState<BuildingElement[]>([]);

  useEffect(() => {
    if (!zoneId) return;
    supabase
      .from("building_elements")
      .select("*")
      .eq("zone_id", zoneId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => {
        setElements(data ?? []);
        setLoading(false);
      });
  }, [zoneId]);

  const tapSide = useCallback((side: WallSide, group: BuildingElement[]) => {
    if (activeSide === side) {
      setActiveSide(null);
      setSideElements([]);
      return;
    }
    setActiveSide(side);
    setSideElements(group);
  }, [activeSide]);

  const navigateToElement = useCallback((el: BuildingElement) => {
    router.push({
      pathname: "/tabs/sessions/inspect",
      params: { elementId: el.id, sessionId: sessionId ?? "" },
    });
  }, [router, sessionId]);

  if (loading) return <ActivityIndicator style={styles.loader} color="#1E3A5F" />;

  const groups: Record<WallSide, BuildingElement[]> = {
    north: [], east: [], south: [], west: [],
    dak: [], vloer: [], installatie: [], other: [],
  };
  for (const el of elements) groups[inferWall(el)].push(el);

  const totalComplete = elements.filter(e => e.is_complete).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.zoneName}>{zoneName || "Zone"}</Text>
          <Text style={styles.floorLabel}>
            {floorLevel != null ? `Floor ${floorLevel}` : ""}
            {" · "}
            {totalComplete}/{elements.length} complete
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Dak card (above floor plan) ──────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.typeCard,
            activeSide === "dak" && styles.typeCardActive,
            groups.dak.length > 0 && groups.dak.every(e => e.is_complete) && styles.typeCardDone,
          ]}
          onPress={() => tapSide("dak", groups.dak)}
          activeOpacity={0.75}
        >
          <View style={[styles.typeCardDot, { backgroundColor: completionColor(groups.dak) }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.typeCardLabel}>Dak (Roof)</Text>
            <Text style={styles.typeCardSub}>
              {groups.dak.length === 0 ? "No elements" :
                `${groups.dak.filter(e => e.is_complete).length}/${groups.dak.length} complete`}
            </Text>
          </View>
          <Text style={styles.typeCardArrow}>{activeSide === "dak" ? "▼" : "▶"}</Text>
        </TouchableOpacity>

        {/* ── Floor plan rectangle ─────────────────────────────────── */}
        <View style={[styles.floorPlan, { width: PLAN_SIZE, height: PLAN_SIZE }]}>

          {/* North wall (top) */}
          <WallBand
            label="Noord"
            elements={groups.north}
            active={activeSide === "north"}
            onPress={() => tapSide("north", groups.north)}
            horizontal
            style={{ height: WALL_THICK }}
          />

          {/* Middle row */}
          <View style={styles.planMiddle}>

            {/* West wall */}
            <WallBand
              label="West"
              elements={groups.west}
              active={activeSide === "west"}
              onPress={() => tapSide("west", groups.west)}
              style={{ width: WALL_THICK }}
            />

            {/* Room interior */}
            <View style={styles.roomInterior}>
              <Text style={styles.roomZoneName} numberOfLines={2}>
                {zoneName}
              </Text>
              {groups.installatie.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.installBtn,
                    activeSide === "installatie" && styles.installBtnActive,
                  ]}
                  onPress={() => tapSide("installatie", groups.installatie)}
                >
                  <Text style={styles.installBtnText}>
                    ⚙ {groups.installatie.length} installatie{groups.installatie.length !== 1 ? "s" : ""}
                  </Text>
                </TouchableOpacity>
              )}
              {groups.other.length > 0 && (
                <TouchableOpacity
                  style={[styles.otherBtn, activeSide === "other" && styles.installBtnActive]}
                  onPress={() => tapSide("other", groups.other)}
                >
                  <Text style={styles.otherBtnText}>
                    ● {groups.other.length} overig
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* East wall — border on left, not right */}
            <WallBand
              label="Oost"
              elements={groups.east}
              active={activeSide === "east"}
              onPress={() => tapSide("east", groups.east)}
              style={{ width: WALL_THICK, borderRightWidth: 0, borderLeftWidth: 1, borderLeftColor: "#1E3A5F" }}
            />
          </View>

          {/* South wall (bottom) */}
          <WallBand
            label="Zuid"
            elements={groups.south}
            active={activeSide === "south"}
            onPress={() => tapSide("south", groups.south)}
            horizontal
            style={{ height: WALL_THICK }}
          />
        </View>

        {/* ── Vloer card (below floor plan) ───────────────────────── */}
        <TouchableOpacity
          style={[
            styles.typeCard,
            activeSide === "vloer" && styles.typeCardActive,
            groups.vloer.length > 0 && groups.vloer.every(e => e.is_complete) && styles.typeCardDone,
          ]}
          onPress={() => tapSide("vloer", groups.vloer)}
          activeOpacity={0.75}
        >
          <View style={[styles.typeCardDot, { backgroundColor: completionColor(groups.vloer) }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.typeCardLabel}>Vloer (Floor)</Text>
            <Text style={styles.typeCardSub}>
              {groups.vloer.length === 0 ? "No elements" :
                `${groups.vloer.filter(e => e.is_complete).length}/${groups.vloer.length} complete`}
            </Text>
          </View>
          <Text style={styles.typeCardArrow}>{activeSide === "vloer" ? "▼" : "▶"}</Text>
        </TouchableOpacity>

        {/* ── Element list for active side ─────────────────────────── */}
        {activeSide && (
          <View style={styles.sidePanel}>
            <View style={styles.sidePanelHeader}>
              <Text style={styles.sidePanelTitle}>
                {SIDE_LABELS[activeSide]}
              </Text>
              <Text style={styles.sidePanelCount}>{sideElements.length} element{sideElements.length !== 1 ? "s" : ""}</Text>
            </View>

            {sideElements.length === 0 ? (
              <Text style={styles.sidePanelEmpty}>
                No elements on this side.{"\n"}Add them via the web dashboard.
              </Text>
            ) : (
              sideElements.map(el => (
                <ElementItem
                  key={el.id}
                  item={el}
                  onNavigate={navigateToElement}
                />
              ))
            )}
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#F5F7FA" },
  loader:       { flex: 1 },

  header:       { backgroundColor: "#1E3A5F", flexDirection: "row",
                  alignItems: "center", padding: 16, paddingTop: 20, gap: 12 },
  backBtn:      { padding: 4 },
  backArrow:    { fontSize: 22, color: "#fff", fontWeight: "700" },
  headerText:   { flex: 1 },
  zoneName:     { fontSize: 17, fontWeight: "700", color: "#fff" },
  floorLabel:   { fontSize: 12, color: "#A9C4E4", marginTop: 2 },

  scroll:       { flex: 1 },
  content:      { padding: 16, alignItems: "center", gap: 12 },

  // ── Type cards (Dak / Vloer) ──
  typeCard:     { flexDirection: "row", alignItems: "center", gap: 12,
                  backgroundColor: "#fff", borderRadius: 12, padding: 14,
                  borderWidth: 2, borderColor: "transparent",
                  width: "100%",
                  elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  typeCardActive:{ borderColor: "#2E86C1" },
  typeCardDone: { borderColor: "#D5F0E3" },
  typeCardDot:  { width: 10, height: 10, borderRadius: 5 },
  typeCardLabel:{ fontSize: 15, fontWeight: "700", color: "#1A1A2E" },
  typeCardSub:  { fontSize: 12, color: "#888", marginTop: 2 },
  typeCardArrow:{ fontSize: 16, color: "#888", fontWeight: "700" },

  // ── Floor plan box ──
  floorPlan:    { borderWidth: 2, borderColor: "#1E3A5F", backgroundColor: "#fff",
                  borderRadius: 4 },

  wallH:        { backgroundColor: "#EEF2F7", justifyContent: "center",
                  borderBottomWidth: 1, borderBottomColor: "#1E3A5F",
                  paddingHorizontal: 12 },
  wallHInner:   { flexDirection: "row", alignItems: "center", gap: 6 },
  wallActive:   { backgroundColor: "#2E86C122" },

  wallV:        { backgroundColor: "#EEF2F7", alignItems: "center", justifyContent: "center",
                  borderRightWidth: 1, borderRightColor: "#1E3A5F" },

  wallDot:      { width: 6, height: 6, borderRadius: 3 },
  wallLabel:    { fontSize: 11, fontWeight: "700", color: "#1E3A5F", letterSpacing: 0.5 },
  wallCount:    { fontSize: 11, color: "#2E86C1", fontWeight: "600", marginLeft: "auto" },
  wallLabelV:   { fontSize: 10, fontWeight: "700", color: "#1E3A5F", letterSpacing: 0.5,
                  writingDirection: "ltr", textAlign: "center", marginTop: 2 },
  wallCountV:   { fontSize: 10, color: "#2E86C1", fontWeight: "600", textAlign: "center" },

  planMiddle:   { flex: 1, flexDirection: "row" },
  roomInterior: { flex: 1, alignItems: "center", justifyContent: "center",
                  padding: 10, gap: 8 },
  roomZoneName: { fontSize: 13, fontWeight: "700", color: "#1E3A5F", textAlign: "center" },

  installBtn:   { backgroundColor: "#F0F4F8", borderRadius: 8,
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderWidth: 1, borderColor: "#DDE" },
  installBtnActive: { borderColor: "#2E86C1", backgroundColor: "#EBF5FB" },
  installBtnText:   { fontSize: 11, color: "#1E3A5F", fontWeight: "600" },

  otherBtn:     { backgroundColor: "#FFF8F0", borderRadius: 8,
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderWidth: 1, borderColor: "#FDDCB5" },
  otherBtnText: { fontSize: 11, color: "#E67E22", fontWeight: "600" },

  // East wall shares wallV but needs no right border
  // We apply { borderRightWidth: 0, borderLeftWidth: 1, borderLeftColor: "#1E3A5F" } inline

  // ── Side element panel ──
  sidePanel:    { width: "100%", backgroundColor: "#fff", borderRadius: 12,
                  borderWidth: 2, borderColor: "#2E86C1",
                  overflow: "hidden" },
  sidePanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                     paddingHorizontal: 14, paddingVertical: 10,
                     backgroundColor: "#EBF5FB", borderBottomWidth: 1, borderBottomColor: "#AED6F1" },
  sidePanelTitle:  { fontSize: 13, fontWeight: "700", color: "#2E86C1" },
  sidePanelCount:  { fontSize: 12, color: "#7FB3D3" },
  sidePanelEmpty:  { padding: 20, color: "#AAA", textAlign: "center", lineHeight: 20 },

  // ── Element cards inside panel ──
  elementCard:    { flexDirection: "row", padding: 12,
                    borderBottomWidth: 1, borderBottomColor: "#F0F4F8" },
  elementCardDone:{ backgroundColor: "#F9FFF9" },
  elementCardRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  typeBadge:      { backgroundColor: "#EEF2F7", borderRadius: 4,
                    paddingHorizontal: 6, paddingVertical: 2 },
  typeText:       { fontSize: 9, fontWeight: "700", color: "#1E3A5F", letterSpacing: 0.4 },
  completeBadge:  { fontSize: 12, color: "#1E8449", fontWeight: "700" },
  elementName:    { fontSize: 13, fontWeight: "600", color: "#1A1A2E", maxWidth: 120 },
  dimRow:         { flexDirection: "row", gap: 6 },
  dimVal:         { fontSize: 11, color: "#888" },
  inspectArrow:   { fontSize: 14, color: "#2E86C1", fontWeight: "700", marginLeft: 4 },
});
