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
import {
  USE_CLASSES, UseClass, BUILDING_TYPES_BY_CLASS, POSITIONS, Position, ORIENTATIONS,
  orientationDeg, parseVisitDateTime, formatVisitDate, formatVisitTime, standardParts,
} from "../lib/visitPlan";

const PRIMARY = "#1E3A5F";
const ACCENT = "#2E86C1";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after the building and its planned visit (inspection session) are saved. */
  onCreated: (buildingId: string, startInspection: boolean, sessionId: string | null) => void;
}

// "Before the visit": enter a new object. Postcode + house number are checked
// against the official address register (PDOK), which fills in street and city
// — the same flow as the client's current tool. Manual entry stays possible for
// new-builds or when the lookup service is unreachable. Saving also plans the
// visit (an inspection session with planned_at) and, if asked, creates the
// standard parts (exterior walls, floor, roof) so on site only measuring is left.
export function AddBuildingModal({ visible, onClose, onCreated }: Props) {
  const profile = useAuthStore(s => s.profile);
  const [postcode, setPostcode] = useState("");
  const [number, setNumber] = useState("");
  const [addition, setAddition] = useState("");
  const [useClass, setUseClass] = useState<UseClass>("woning");
  const [buildingType, setBuildingType] = useState("residential_single");
  const [position, setPosition] = useState<Position | null>(null);
  const [orientation, setOrientation] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [visitDate, setVisitDate] = useState(() => formatVisitDate(new Date()));
  const [visitTime, setVisitTime] = useState(() => formatVisitTime(new Date()));
  const [createStandard, setCreateStandard] = useState(true);
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
    setPostcode(""); setNumber(""); setAddition(""); setUseClass("woning"); setBuildingType("residential_single");
    setPosition(null); setOrientation(null); setContactName(""); setContactPhone("");
    const now = new Date(); setVisitDate(formatVisitDate(now)); setVisitTime(formatVisitTime(now));
    setCreateStandard(true);
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
  const visitAt = parseVisitDateTime(visitDate, visitTime);
  const addressOk = manual
    ? !!pc && /^\d{1,5}$/.test(number.trim()) && street.trim() !== "" && city.trim() !== ""
    : !!found;
  const canSave = !!profile && !saving && addressOk && !!visitAt;

  const pickUseClass = (c: UseClass) => {
    setUseClass(c);
    setBuildingType(BUILDING_TYPES_BY_CLASS[c][0].value);
    if (c === "utiliteit") setPosition(null);
  };

  const setVisitNow = (dayOffset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    if (dayOffset !== 0) d.setHours(9, 0, 0, 0);
    setVisitDate(formatVisitDate(d));
    setVisitTime(formatVisitTime(d));
  };

  // Floor + standard parts in one go; failures here never undo the building.
  const createStandardParts = async (buildingId: string) => {
    if (!profile) return;
    const { data: zone, error: zErr } = await supabase.from("zones")
      .insert({ org_id: profile.org_id, building_id: buildingId, zone_code: "Z01", name: "Begane grond", floor_level: 0 })
      .select("id").single();
    if (zErr || !zone) throw zErr ?? new Error("No zone returned");
    const parts = standardParts(position, orientationDeg(orientation));
    const { error } = await supabase.from("building_elements").insert(parts.map((p, i) => ({
      org_id: profile.org_id,
      zone_id: (zone as { id: string }).id,
      element_type: p.element_type,
      name: p.name,
      orientation_deg: p.orientation_deg,
      sort_order: i,
    })));
    if (error) throw error;
  };

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
        metadata: {
          source: manual ? "mobile_manual" : "mobile_pdok",
          use_class: useClass,
          ...(position ? { position } : {}),
          ...(orientation ? { orientation } : {}),
          ...(contactName.trim() || contactPhone.trim()
            ? { contact: { name: contactName.trim() || null, phone: contactPhone.trim() || null } }
            : {}),
        },
      }).select("id").single();
      if (error || !data) throw error ?? new Error("No building returned");
      const id = (data as { id: string }).id;

      // The planned visit. RLS only lets an inspector create their own
      // sessions, so the inspector is whoever enters the object.
      const warnings: string[] = [];
      let sessionId: string | null = null;
      const { data: ses, error: sErr } = await supabase.from("inspection_sessions").insert({
        org_id: profile.org_id,
        building_id: id,
        inspector_id: profile.id,
        planned_at: visitAt!.toISOString(),
      }).select("id").single();
      if (sErr || !ses) warnings.push(`The visit couldn't be planned (${sErr?.message ?? "unknown error"}). Start an inspection from the building instead.`);
      else sessionId = (ses as { id: string }).id;

      if (createStandard) {
        try { await createStandardParts(id); }
        catch (e: any) { warnings.push(`Standard parts weren't created (${e?.message ?? "unknown error"}).`); }
      }

      setSaving(false);
      const title = `${addr.street} ${addr.house_number}${addr.house_number_addition ?? ""}, ${addr.city}`;
      const body = [`Visit planned ${visitDate} ${visitTime}.`, ...warnings].join("\n\n");
      Alert.alert("Building added", `${title}\n\n${body}`, [
        { text: "Later", style: "cancel", onPress: () => { reset(); onCreated(id, false, sessionId); } },
        { text: "Start inspection", onPress: () => { reset(); onCreated(id, true, sessionId); } },
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
            <View style={styles.segment}>
              {USE_CLASSES.map(c => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.segmentBtn, useClass === c.value && styles.segmentBtnActive]}
                  onPress={() => pickUseClass(c.value)}
                >
                  <Text style={[styles.segmentText, useClass === c.value && styles.segmentTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.selectWrap}>
              <FieldSelect label="Building type" value={buildingType} options={BUILDING_TYPES_BY_CLASS[useClass]} onSelect={setBuildingType} />
            </View>
            {useClass === "woning" && (
              <View style={styles.selectWrap}>
                <FieldSelect
                  label="Type and position (optional)" value={position} options={POSITIONS}
                  onSelect={v => setPosition(v as Position)} placeholder="Not set"
                />
              </View>
            )}
            <View style={styles.selectWrap}>
              <FieldSelect
                label="Front facade faces (optional)" value={orientation}
                options={ORIENTATIONS.map(o => ({ value: o.value, label: o.label }))}
                onSelect={setOrientation} placeholder="Not set"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Construction year (optional)</Text>
              <TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="1965" placeholderTextColor="#9ca3af" keyboardType="number-pad" maxLength={4} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline
                placeholder="Access, anything for the office" placeholderTextColor="#9ca3af"
              />
            </View>

            <Text style={[styles.section, { marginTop: 18 }]}>CONTACT PERSON (OPTIONAL)</Text>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1.3 }]}>
                <Text style={styles.label}>Name</Text>
                <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Name" placeholderTextColor="#9ca3af" />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Phone</Text>
                <TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} placeholder="06…" placeholderTextColor="#9ca3af" keyboardType="phone-pad" />
              </View>
            </View>

            <Text style={[styles.section, { marginTop: 18 }]}>VISIT</Text>
            <Text style={styles.label}>Inspector: {profile?.full_name ?? "you"}</Text>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1.3 }]}>
                <Text style={styles.label}>Date</Text>
                <TextInput style={styles.input} value={visitDate} onChangeText={setVisitDate} placeholder="31-10-2026" placeholderTextColor="#9ca3af" keyboardType="numbers-and-punctuation" maxLength={10} />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Time</Text>
                <TextInput style={styles.input} value={visitTime} onChangeText={setVisitTime} placeholder="09:00" placeholderTextColor="#9ca3af" keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
            </View>
            <View style={styles.choices}>
              <TouchableOpacity style={styles.choice} onPress={() => setVisitNow(0)}><Text style={styles.choiceText}>Now</Text></TouchableOpacity>
              <TouchableOpacity style={styles.choice} onPress={() => setVisitNow(1)}><Text style={styles.choiceText}>Tomorrow 09:00</Text></TouchableOpacity>
            </View>
            {!visitAt && <Text style={styles.msg}>Enter the date as DD-MM-YYYY and the time as HH:MM.</Text>}

            <Text style={[styles.section, { marginTop: 18 }]}>STANDARD PARTS</Text>
            <Text style={styles.label}>Create the standard parts now? (exterior walls, ground floor, roof — ready to measure on site)</Text>
            <View style={styles.segment}>
              {[true, false].map(v => (
                <TouchableOpacity
                  key={String(v)}
                  style={[styles.segmentBtn, createStandard === v && styles.segmentBtnActive]}
                  onPress={() => setCreateStandard(v)}
                >
                  <Text style={[styles.segmentText, createStandard === v && styles.segmentTextActive]}>{v ? "Yes" : "No"}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {createStandard && (
              <Text style={styles.hint}>
                {standardParts(position, orientationDeg(orientation)).map(p => p.name).join(", ")}
              </Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.saveBtn, !canSave && styles.disabled]} onPress={save} disabled={!canSave}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add building</Text>}
            </TouchableOpacity>
            {!canSave && !saving && (
              <Text style={styles.footerHint}>
                {!addressOk
                  ? (manual ? "Fill in postcode, number, street and city." : "Look up the address first.")
                  : "Enter the visit date and time."}
              </Text>
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
  segment: { flexDirection: "row", gap: 8 },
  segmentBtn: { flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: "#fff" },
  segmentBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  segmentText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  segmentTextActive: { color: "#fff" },
  hint: { fontSize: 12, color: "#6b7280" },
  footer: { padding: 16, gap: 6, backgroundColor: "#fff", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  saveBtn: { backgroundColor: "#1E8449", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  footerHint: { fontSize: 12, color: "#6b7280", textAlign: "center" },
  disabled: { opacity: 0.5 },
});
