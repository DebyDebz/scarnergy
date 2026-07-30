import { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../store/authStore";

const ROLE_LABELS: Record<string, string> = {
  inspector:    "Inspector",
  supervisor:   "Supervisor",
  admin:        "Administrator",
  service_role: "Service",
};

export default function Profile() {
  const { profile, user, signOut } = useAuthStore();
  const [orgName,     setOrgName]     = useState<string | null>(null);
  const [name,        setName]        = useState(profile?.full_name ?? "");
  const [savingName,  setSavingName]  = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [savingPw,    setSavingPw]    = useState(false);

  useEffect(() => { setName(profile?.full_name ?? ""); }, [profile?.full_name]);

  useEffect(() => {
    if (!profile?.org_id) return;
    supabase.from("organisations").select("name").eq("id", profile.org_id).single()
      .then(({ data }) => setOrgName(data?.name ?? null));
  }, [profile?.org_id]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!profile || !trimmed || trimmed === profile.full_name) return;
    setSavingName(true);
    const { error } = await supabase
      .from("user_profiles")
      .update({ full_name: trimmed })
      .eq("id", profile.id);
    setSavingName(false);
    if (error) { Alert.alert("Could not save name", error.message); return; }
    // Update the store in place so the dashboard greeting picks up the new
    // name. (Not loadProfile(): in dev-bypass mode there is no real session
    // and a re-fetch would clear the DEV_PROFILE.)
    useAuthStore.setState({ profile: { ...profile, full_name: trimmed } });
  };

  const changePassword = async () => {
    if (newPassword.length < 8)  { Alert.alert("Password too short", "Use at least 8 characters."); return; }
    if (newPassword !== confirm) { Alert.alert("Passwords do not match"); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPw(false);
    if (error) { Alert.alert("Could not change password", error.message); return; }
    setNewPassword(""); setConfirm("");
    Alert.alert("Password changed");
  };

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => { signOut(); } },
    ]);
  };

  const initials = (profile?.full_name ?? "?")
    .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const role = profile?.role ?? "inspector";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Identity header */}
      <View style={styles.identity}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
        <Text style={styles.name}>{profile?.full_name ?? "—"}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{ROLE_LABELS[role] ?? role}</Text>
        </View>
        {orgName ? <Text style={styles.org}>{orgName}</Text> : null}
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Email</Text>
          <Text style={styles.fieldValue}>{user?.email ?? "—"}</Text>

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Full name</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.saveBtn, (savingName || !name.trim() || name.trim() === profile?.full_name) && styles.btnDisabled]}
              onPress={saveName}
              disabled={savingName || !name.trim() || name.trim() === profile?.full_name}
            >
              <Text style={styles.saveBtnText}>{savingName ? "…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Security */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>New password</Text>
          <TextInput style={[styles.input, { marginBottom: 10 }]} value={newPassword}
            onChangeText={setNewPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" />
          <Text style={styles.fieldLabel}>Confirm new password</Text>
          <TextInput style={styles.input} value={confirm}
            onChangeText={setConfirm} secureTextEntry autoComplete="new-password" placeholder="Repeat password" />
          <TouchableOpacity
            style={[styles.primaryBtn, (savingPw || !newPassword) && styles.btnDisabled]}
            onPress={changePassword}
            disabled={savingPw || !newPassword}
          >
            <Text style={styles.primaryBtnText}>{savingPw ? "Changing..." : "Change Password"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* App info + sign out */}
      <View style={styles.section}>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.fieldLabel}>App version</Text>
            <Text style={styles.fieldValue}>{Constants.expoConfig?.version ?? "—"}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color="#C0392B" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#F5F7FA" },
  identity:     { alignItems: "center", paddingVertical: 28 },
  avatar:       { width: 72, height: 72, borderRadius: 36, backgroundColor: "#1E3A5F",
                  alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText:   { color: "#FFF", fontSize: 26, fontWeight: "800" },
  name:         { fontSize: 20, fontWeight: "700", color: "#1E3A5F" },
  roleBadge:    { backgroundColor: "#EBF5FB", borderRadius: 10, paddingHorizontal: 12,
                  paddingVertical: 4, marginTop: 6 },
  roleText:     { color: "#2E86C1", fontSize: 12, fontWeight: "700" },
  org:          { color: "#888", fontSize: 13, marginTop: 6 },
  section:      { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1E3A5F", marginBottom: 10 },
  card:         { backgroundColor: "#FFF", borderRadius: 12, padding: 16,
                  elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3 },
  fieldLabel:   { fontSize: 12, color: "#888", marginBottom: 4, fontWeight: "600" },
  fieldValue:   { fontSize: 15, color: "#1A1A2E" },
  inlineRow:    { flexDirection: "row", gap: 8, alignItems: "center" },
  input:        { flexGrow: 1, flexShrink: 1, height: 44, borderWidth: 1, borderColor: "#DDD",
                  borderRadius: 8, paddingHorizontal: 12, fontSize: 15, color: "#1A1A2E" },
  saveBtn:      { height: 44, paddingHorizontal: 16, backgroundColor: "#1E3A5F", borderRadius: 8,
                  alignItems: "center", justifyContent: "center" },
  saveBtnText:  { color: "#FFF", fontWeight: "700", fontSize: 14 },
  primaryBtn:   { height: 46, backgroundColor: "#1E3A5F", borderRadius: 8, alignItems: "center",
                  justifyContent: "center", marginTop: 14 },
  primaryBtnText:{ color: "#FFF", fontWeight: "700", fontSize: 15 },
  btnDisabled:  { opacity: 0.5 },
  aboutRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  signOutBtn:   { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
                  backgroundColor: "#FDEDEC", borderRadius: 12, paddingVertical: 14, marginTop: 12,
                  borderWidth: 1, borderColor: "#F5B7B1" },
  signOutText:  { color: "#C0392B", fontWeight: "700", fontSize: 15 },
});
