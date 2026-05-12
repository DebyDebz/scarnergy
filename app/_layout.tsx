import { useEffect, Component, ReactNode } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { Platform, Text, View, LogBox } from "react-native";

LogBox.ignoreLogs([
  '"shadow*" style props are deprecated',
  "props.pointerEvents is deprecated",
]);

// LogBox only covers native; filter the same noisy warnings from the web console.
if (Platform.OS === "web") {
  const _warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (msg.includes("shadow") || msg.includes("pointerEvents")) return;
    _warn(...args);
  };
}
import { useAuthStore } from "../store/authStore";
import { BLEProvider } from "../lib/BLEContext";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" }}>
          <Text style={{ color: "red", fontSize: 16, fontWeight: "700", marginBottom: 8 }}>App crashed</Text>
          <Text style={{ color: "#333", fontSize: 13 }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// TODO: set to false before releasing to App Store
const DEV_BYPASS_AUTH = true;

const DEV_PROFILE = {
  id:        "00000000-0000-0000-0000-000000000000",
  org_id:    "00000000-0000-0000-0000-000000000001",
  role:      "admin",
  full_name: "Dev User",
  is_active: true,
};

export default function RootLayout() {
  const { session, loading, loadProfile } = useAuthStore();
  const router   = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (DEV_BYPASS_AUTH) {
      useAuthStore.setState({ profile: DEV_PROFILE, loading: false });
      return;
    }
    loadProfile();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (DEV_BYPASS_AUTH) {
      if (segments[0] !== "tabs") router.replace("/tabs");
      return;
    }
    const inAuth = segments[0] === "auth";
    if (!session && !inAuth)  router.replace("/auth/sign-in");
    if (session  &&  inAuth)  router.replace("/tabs");
  }, [session, loading, segments]);

  return (
    <ErrorBoundary>
      <BLEProvider>
        <Slot />
      </BLEProvider>
    </ErrorBoundary>
  );
}
