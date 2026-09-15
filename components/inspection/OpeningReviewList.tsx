import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { FieldSelect } from "../ui/FieldSelect";
import { OpeningType, OpeningToSave } from "../../lib/saveOpenings";

// A captured opening is editable/removable before it's written — both RoomPlan and a
// hand-tapped AR rectangle can misclassify or pick up a false positive, and this is the
// inspector's only chance to correct that before it becomes a permanent building_elements row.
export type ReviewItem = OpeningToSave & { id: string; keep: boolean };

interface Props {
  items: ReviewItem[];
  saving: boolean;
  onSetType: (id: string, type: OpeningType) => void;
  onToggleKeep: (id: string) => void;
  onSave: () => void;
  /** Optional per-item hint, e.g. the AR measurement distance. */
  renderMeta?: (item: ReviewItem) => string | null;
}

export function OpeningReviewList({ items, saving, onSetType, onToggleKeep, onSave, renderMeta }: Props) {
  const keptCount = items.filter(i => i.keep).length;
  return (
    <View style={styles.reviewWrap}>
      <Text style={styles.reviewTitle}>
        {items.length} opening{items.length === 1 ? "" : "s"} captured
      </Text>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.reviewList}
        renderItem={({ item }) => {
          const meta = renderMeta?.(item);
          return (
            <View style={[styles.reviewCard, !item.keep && styles.reviewCardOff]}>
              <View style={styles.reviewCardTop}>
                <View style={{ flex: 1 }}>
                  <FieldSelect
                    label="Type"
                    value={item.type}
                    options={["window", "door"]}
                    onSelect={v => onSetType(item.id, v as OpeningType)}
                  />
                </View>
                <TouchableOpacity onPress={() => onToggleKeep(item.id)} style={styles.keepBtn}>
                  <Text style={styles.keepBtnText}>{item.keep ? "Remove" : "Restore"}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.dims}>
                {item.widthMm} mm × {item.heightMm} mm{meta ? `  ·  ${meta}` : ""}
              </Text>
            </View>
          );
        }}
      />
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={onSave}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.saveBtnText}>Save {keptCount} to Zone</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  reviewWrap: { flex: 1, backgroundColor: "#F5F7FA", paddingTop: 16 },
  reviewTitle: { fontSize: 18, fontWeight: "700", color: "#1E3A5F", textAlign: "center", marginBottom: 12 },
  reviewList: { paddingHorizontal: 16, paddingBottom: 100 },
  reviewCard: {
    backgroundColor: "#fff", borderRadius: 12, marginBottom: 12, overflow: "hidden",
    elevation: 1, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  reviewCardOff: { opacity: 0.45 },
  reviewCardTop: { flexDirection: "row", alignItems: "center" },
  keepBtn: { paddingHorizontal: 16 },
  keepBtnText: { color: "#C0392B", fontWeight: "600", fontSize: 13 },
  dims: { fontSize: 13, color: "#6b7280", paddingHorizontal: 16, paddingBottom: 12 },
  saveBtn: {
    position: "absolute", left: 16, right: 16, bottom: 24,
    backgroundColor: "#1E8449", borderRadius: 12, paddingVertical: 16, alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
