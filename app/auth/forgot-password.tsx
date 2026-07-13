import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";

// Two-step recovery, fully in-app (no deep link needed):
//   1. resetPasswordForEmail() — GoTrue emails a recovery code. The email
//      template must include {{ .Token }} for the 6-digit code (self-hosted:
//      set it in the GoTrue MAILER_TEMPLATES_RECOVERY config).
//   2. verifyOtp(type: "recovery") signs the user in, then updateUser() sets
//      the new password. The auth gate in app/_layout.tsx routes to /tabs.
type Step = "request" | "verify";

export default function ForgotPassword() {
  const router = useRouter();
  const [step,     setStep]     = useState<Step>("request");
  const [email,    setEmail]    = useState("");
  const [code,     setCode]     = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);

  const requestReset = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { Alert.alert("Enter your email address"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
      if (error) throw error;
      setStep("verify");
    } catch (e: any) {
      Alert.alert("Could not send reset email", e.message ?? "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitNewPassword = async () => {
    if (!code.trim())           { Alert.alert("Enter the code from the email"); return; }
    if (password.length < 8)    { Alert.alert("Password too short", "Use at least 8 characters."); return; }
    if (password !== confirm)   { Alert.alert("Passwords do not match"); return; }
    setLoading(true);
    try {
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type:  "recovery",
      });
      if (otpErr) throw otpErr;
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      // verifyOtp signed the user in; the root auth gate now routes to /tabs.
      Alert.alert("Password updated", "You are now signed in.");
    } catch (e: any) {
      Alert.alert("Reset failed", e.message ?? "Invalid or expired code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.logo}>SCARNERGY</Text>
        <Text style={styles.subtitle}>
          {step === "request" ? "Reset your password" : `Enter the code sent to ${email.trim()}`}
        </Text>

        {step === "request" ? (
          <>
            <TextInput style={styles.input} placeholder="Email" value={email}
              onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
              onPress={requestReset} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Sending..." : "Send Reset Code"}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput style={styles.input} placeholder="6-digit code" value={code}
              onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
            <TextInput style={styles.input} placeholder="New password" value={password}
              onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
            <TextInput style={styles.input} placeholder="Confirm new password" value={confirm}
              onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
            <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
              onPress={submitNewPassword} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Updating..." : "Set New Password"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={requestReset} disabled={loading}>
              <Text style={styles.linkText}>Resend code</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()} disabled={loading}>
          <Text style={styles.linkText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#1E3A5F", justifyContent: "center", padding: 24 },
  card:           { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 32 },
  logo:           { fontSize: 28, fontWeight: "900", color: "#1E3A5F", textAlign: "center", letterSpacing: 2 },
  subtitle:       { fontSize: 14, color: "#888", textAlign: "center", marginBottom: 32, marginTop: 4 },
  input:          { height: 48, borderWidth: 1, borderColor: "#DDD", borderRadius: 8,
                    paddingHorizontal: 16, fontSize: 16, marginBottom: 12, color: "#1A1A2E" },
  button:         { height: 50, backgroundColor: "#1E3A5F", borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText:     { color: "#FFF", fontSize: 16, fontWeight: "700" },
  linkBtn:        { alignItems: "center", marginTop: 16 },
  linkText:       { color: "#2E86C1", fontSize: 14, fontWeight: "600" },
});
