import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";

export default function SignIn() {
  const { signIn } = useAuthStore();
  const router = useRouter();
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);

  const handleSignIn = async () => {
    if (!email || !password) { Alert.alert("Fill in both fields"); return; }
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (e: any) {
      Alert.alert("Sign in failed", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.logo}>SCARNERGY</Text>
        <Text style={styles.subtitle}>Building Inspection Platform</Text>
        <TextInput style={styles.input} placeholder="Email" value={email}
          onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <View style={styles.passwordRow}>
          <TextInput style={styles.passwordInput} placeholder="Password" value={password}
            onChangeText={setPassword} secureTextEntry={!showPassword} autoComplete="password" />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPassword(s => !s)}
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color="#888" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? "Signing in..." : "Sign In"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.forgotBtn}
          onPress={() => router.push("/auth/forgot-password")} disabled={loading}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>
        <View style={styles.signUpRow}>
          <Text style={styles.signUpPrompt}>Don't have an account?</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://scanergy.krontiva.africa/auth/sign-up")}
            disabled={loading}
          >
            <Text style={styles.signUpLink}>Sign up</Text>
          </TouchableOpacity>
        </View>
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
  passwordRow:    { flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1,
                    borderColor: "#DDD", borderRadius: 8, marginBottom: 12 },
  passwordInput:  { flex: 1, height: "100%", paddingHorizontal: 16, fontSize: 16, color: "#1A1A2E" },
  eyeBtn:         { paddingHorizontal: 12, height: "100%", justifyContent: "center" },
  button:         { height: 50, backgroundColor: "#1E3A5F", borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText:     { color: "#FFF", fontSize: 16, fontWeight: "700" },
  forgotBtn:      { alignItems: "center", marginTop: 16 },
  forgotText:     { color: "#2E86C1", fontSize: 14, fontWeight: "600" },
  signUpRow:      { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 20 },
  signUpPrompt:   { color: "#888", fontSize: 14 },
  signUpLink:     { color: "#2E86C1", fontSize: 14, fontWeight: "700", marginLeft: 6 },
});
