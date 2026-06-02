import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useAuthStore } from "../../store/authStore";

export default function SignIn() {
  const { signIn } = useAuthStore();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);

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
        <TextInput style={styles.input} placeholder="Password" value={password}
          onChangeText={setPassword} secureTextEntry autoComplete="password" />
        <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? "Signing in..." : "Sign In"}</Text>
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
});
