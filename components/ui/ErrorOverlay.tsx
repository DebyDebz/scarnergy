import { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from "react-native";
import { AppError, subscribe, clearErrors } from "../../lib/errorLog";

// Floating, dismissible panel that shows the most recent JS-catchable errors on
// top of the whole app. Rendered once at the root (see app/_layout.tsx).
// Invisible until at least one error is captured.
export function ErrorOverlay() {
  const [errors, setErrors]   = useState<AppError[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => subscribe(setErrors), []);

  if (errors.length === 0) return null;

  const latest = errors[0];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.header}
          activeOpacity={0.8}
          onPress={() => setExpanded(e => !e)}
        >
          <Text style={styles.badge}>{errors.length}</Text>
          <Text style={styles.title} numberOfLines={expanded ? undefined : 1}>
            {latest.kind === "unhandledRejection" ? "Unhandled rejection: " : ""}
            {latest.message}
          </Text>
          <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>
        </TouchableOpacity>

        {expanded && (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 8 }}>
            {errors.map(e => (
              <View key={e.id} style={styles.item}>
                <Text style={styles.meta}>{e.when} · {e.kind}</Text>
                <Text style={styles.msg}>{e.message}</Text>
                {e.stack ? <Text style={styles.stack}>{e.stack}</Text> : null}
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.actions}>
          <TouchableOpacity onPress={() => clearErrors()} style={styles.actionBtn}>
            <Text style={styles.actionText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    padding: 8,
    // Keep above tab bars / safe area on both platforms.
    paddingBottom: Platform.OS === "ios" ? 34 : 12,
    zIndex: 9999,
  },
  card: {
    backgroundColor: "#2a0d0d",
    borderColor: "#e5484d",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  badge: {
    backgroundColor: "#e5484d",
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
    minWidth: 22,
    textAlign: "center",
    borderRadius: 11,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  title: { flex: 1, color: "#ffd7d7", fontSize: 13, fontWeight: "700" },
  chevron: { color: "#ffd7d7", fontSize: 14, fontWeight: "700" },
  body: { maxHeight: 260, paddingHorizontal: 12 },
  item: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#5a2323",
    paddingVertical: 8,
  },
  meta: { color: "#c98a8a", fontSize: 11, marginBottom: 2 },
  msg: { color: "#ffecec", fontSize: 13, fontWeight: "600" },
  stack: {
    color: "#d9a3a3",
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
  },
  actionBtn: {
    backgroundColor: "#e5484d",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
