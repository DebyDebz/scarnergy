import { useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../store/authStore";
import { FieldSelect } from "./ui/FieldSelect";
import { lookupAddress, normalizePostcode, LookedUpAddress } from "../lib/addressLookup";

const PRIMARY = "#1E3A5F";
const ACCENT = "#2E86C1";

// building_type enum values with the labels an inspector recognises.
const BUILDING_TYPES = [
  { value: "residential_single", label: "House (single-family)" },
  { value: "residential_multi",  label: "Multi-family building" },
  { value: "apartment",          label: "Apartment" },
  { value: "office",             label: "Office" },
  { value: "retail",             label: "Shop / retail" },
  { value: "industrial",         label: "Industrial" },
  { value: "mixed_use",          label: "Mixed use" },
  { value: "other",              label: "Other" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the new building's id after it's saved. */
  onCreated: (buildingId: string, startInspection: boolean) => void;
}

// Add a building on site: postcode + house number are checked against the
// official address register (PDOK), which fills in street and city — the same
// flow as the client's current tool. Manual entry stays possible for new-builds
// or when the lookup service is unreachable.
export function AddBuildingModal({ visible, onClose, onCreated }: Props) {
  const profile = useAuthStore(s => s.profile);
  const [postcode, setPostcode] = useState("");
  const [number, setNumber] = useState("");
  const [addition, setAddition] = useState("");
  const [buildingType, setBuildingType] = useState("residential_single");
  const [year, setYear] = useState("");
  const [notes, setNotes] = useState("");
  const [found, setFound] = useState<LookedUpAddress | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [looking, setLooking] = useState(false);
  const [manual, setManual] = useState(false);
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setPostcode(""); setNumber(""); setAddition(""); setBuildingType("residential_single");
    setYear(""); setNotes(""); setFound(null); setLookupMsg(null); setChoices([]);
    setManual(false); setStreet(""); setCity("");
  };
  const close = () => { reset(); onClose(); };

  // Any edit to the address invalidates the previous lookup.
  const editAddress = (fn: () => void) => { fn(); setFound(null); setLookupMsg(null); setChoices([]); };

  const lookUp = async (withAddition = addition) => {
    if (!normalizePostcode(postcode)) { setLookupMsg("Enter a Dutch postcode, for example 2251 AA."); return; }
    if (!/^\d{1,5}$/.test(number.trim())) { setLookupMsg("Enter the house number as digits only."); return; }
    setLooking(true); setLookupMsg(null); setChoices([]);
    try {
      const r = await lookupAddress(postcode, number, withAddition);
      if (r.status === "found") setFound(r.address);
      else if (r.status === "choose") { setChoices(r.additions); setLookupMsg("This number has several units. Pick one:"); }
      else setLookupMsg("No address found. Check the postcode and house number.");
    } catch {
      setLookupMsg("The address service can't be reached. Check your connection, or enter the address by hand.");
    } finally {
      setLooking(false);
    }
  };

  const pc = normalizePostcode(postcode);
  const canSave = !!profile && !saving && (
    manual
      ? !!pc && /^\d{1,5}$/.test(number.trim()) && street.trim() !== "" && city.trim() !== ""
      : !!found
  );

  const save = async () => {
    if (!profile || !canSave) return;
    const addr = manual
      ? { street: street.trim(), house_number: number.trim(), house_number_addition: addition.trim() || null,
          postal_code: pc!.display, city: city.trim() }
      : { street: found!.street, house_number: found!.house_number, house_number_addition: found!.house_number_addition,
          postal_code: found!.postal_code, city: found!.city, municipality: found!.municipality, province: found!.province,
          latitude: found!.latitude, longitude: found!.longitude, bag_id: found!.bag_id };

    setSaving(true);
    try {
      // Same address already in this organisation? Offer that one instead of a duplicate.
      let dupQ = supabase.from("buildings").select("id")
        .eq("org_id", profile.org_id).eq("is_active", true)
        .in("postal_code", [pc?.display ?? addr.postal_code, pc?.query ?? addr.postal_code])
        .eq("house_number", addr.house_number);
      dupQ = addr.house_number_addition ? dupQ.eq("house_number_addition", addr.house_number_addition) : dupQ.is("house_number_addition", null);
      const { data: dup } = await dupQ.limit(1);
      if (dup && dup.length > 0) {
        setSaving(false);
        Alert.alert("Already in your list", "This address already exists. Use the existing building instead.", [
          { text: "OK", onPress: close },
        ]);
        return;
      }

      const year4 = parseInt(year, 10);
      const { data, error } = await supabase.from("buildings").insert({
        org_id: profile.org_id,
        created_by: profile.id,
        ...addr,
        building_type: buildingType,
        construction_year: Number.isFinite(year4) && year4 > 1000 && year4 < 2100 ? year4 : null,
        notes: notes.trim() || null,
        metadata: { source: manual ? "mobile_manual" : "mobile_pdok" },
      }).select("id").single();
      if (error || !data) throw error ?? new Error("No building returned");

      const id = (data as { id: string }).id;
      setSaving(false);
      Alert.alert("Building added", `${addr.street} ${addr.house_number}${addr.house_number_addition ?? ""}, ${addr.city}`, [
        { text: "Later", style: "cancel", onPress: () => { reset(); onCreated(id, false); } },
        { text: "Start inspection", onPress: () => { reset(); onCreated(id, true); } },
      ]);
    } catch (e: any) {
      setSaving(false);
      Alert.alert("Couldn't add building", e?.message ?? "Unknown error");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.header}>
            <TouchableOpacity onPress={close} hitSlop={10}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
            <Text style={styles.headerTitle}>Add building</Text>
            <View style={{ width: 52 }} />
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>ADDRESS</Text>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1.3 }]}>
                <Text style={styles.label}>Postcode</Text>
                <TextInput
                  style={styles.input} value={postcode} placeholder="2251 AA" placeholderTextColor="#9ca3af"
                  autoCapitalize="characters" autoCorrect={false} maxLength={7}
                  onChangeText={v => editAddress(() => setPostcode(v))}
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Number</Text>
                <TextInput
                  style={styles.input} value={number} placeholder="12" placeholderTextColor="#9ca3af"
                  keyboardType="number-pad" maxLength={5}
                  onChangeText={v => editAddress(() => setNumber(v))}
                />
              </View>
              <View style={[styles.field, { flex: 0.9 }]}>
                <Text style={styles.label}>Addition</Text>
                <TextInput
                  style={styles.input} value={addition} placeholder="A" placeholderTextColor="#9ca3af"
                  autoCapitalize="characters" autoCorrect={false} maxLength={6}
                  onChangeText={v => editAddress(() => setAddition(v))}
                />
              </View>
            </View>

            {!manual && (
              <TouchableOpacity style={[styles.lookupBtn, looking && styles.disabled]} onPress={() => lookUp()} disabled={looking}>
                {looking ? <ActivityIndicator color="#fff" /> : <Text style={styles.lookupBtnText}>Look up address</Text>}
              </TouchableOpacity>
            )}

            {found && !manual && (
              <View style={styles.found}>
                <Text style={styles.foundCheck}>✓ Address found</Text>
                <Text style={styles.foundAddr}>
                  {found.street} {found.house_number}{found.house_number_addition ?? ""}
                </Text>
                <Text style={styles.foundSub}>{found.postal_code} {found.city}{found.province ? ` · ${found.province}` : ""}</Text>
              </View>
            )}

            {lookupMsg && !found && <Text style={styles.msg}>{lookupMsg}</Text>}
            {choices.length > 0 && (
              <View style={styles.choices}>
                {choices.map(c => (
                  <TouchableOpacity key={c} style={styles.choice} onPress={() => { setAddition(c); void lookUp(c); }}>
                    <Text style={styles.choiceText}>{number}{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity onPress={() => { setManual(m => !m); setFound(null); setLookupMsg(null); setChoices([]); }}>
              <Text style={styles.link}>{manual ? "Look the address up instead" : "Enter the address by hand (new-build, or no connection)"}</Text>
            </TouchableOpacity>

            {manual && (
              <View style={{ gap: 10 }}>
                <View style={styles.field}>
                  <Text style={styles.label}>Street</Text>
                  <TextInput style={styles.input} value={street} onChangeText={setStreet} placeholder="Street name" placeholderTextColor="#9ca3af" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>City</Text>
                  <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor="#9ca3af" />
                </View>
              </View>
            )}

            <Text style={[styles.section, { marginTop: 18 }]}>BUILDING</Text>
            <View style={styles.selectWrap}>
              <FieldSelect label="Building type" value={buildingType} options={BUILDING_TYPES} onSelect={setBuildingType} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Construction year (optional)</Text>
              <TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="1965" placeholderTextColor="#9ca3af" keyboardType="number-pad" maxLength={4} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline
                placeholder="Contact, access, anything for the office" placeholderTextColor="#9ca3af"
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.saveBtn, !canSave && styles.disabled]} onPress={save} disabled={!canSave}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add building</Text>}
            </TouchableOpacity>
            {!canSave && !saving && (
              <Text style={styles.footerHint}>{manual ? "Fill in postcode, number, street and city." : "Look up the address first."}</Text>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F7FA" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: PRIMARY },
  cancel: { fontSize: 15, color: ACCENT, width: 52 },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  section: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, color: "#6b7280" },
  row: { flexDirection: "row", gap: 8 },
  field: { gap: 4 },
  label: { fontSize: 12, fontWeight: "600", color: "#374151" },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: "#111827",
  },
  notes: { minHeight: 70, textAlignVertical: "top" },
  lookupBtn: { backgroundColor: ACCENT, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  lookupBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  found: { backgroundColor: "#EAFAF1", borderRadius: 10, padding: 12, gap: 2, borderWidth: 1, borderColor: "#A9DFBF" },
  foundCheck: { fontSize: 12, fontWeight: "700", color: "#1E8449" },
  foundAddr: { fontSize: 16, fontWeight: "700", color: PRIMARY },
  foundSub: { fontSize: 13, color: "#4b5563" },
  msg: { fontSize: 13, color: "#B03A2E" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: ACCENT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#fff" },
  choiceText: { color: PRIMARY, fontWeight: "700" },
  link: { fontSize: 13, color: ACCENT, fontWeight: "600", paddingVertical: 4 },
  selectWrap: { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#d1d5db" },
  footer: { padding: 16, gap: 6, backgroundColor: "#fff", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  saveBtn: { backgroundColor: "#1E8449", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  footerHint: { fontSize: 12, color: "#6b7280", textAlign: "center" },
  disabled: { opacity: 0.5 },
});
