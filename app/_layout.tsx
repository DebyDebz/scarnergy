import { useEffect, useState, Component, ReactNode } from "react";
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
import { installErrorHandlers, reportError } from "../lib/errorLog";
import { ErrorOverlay } from "../components/ui/ErrorOverlay";

// Install the global JS error/rejection handlers as early as possible — at module
// load, before any component mounts — so startup failures are captured too.
installErrorHandlers();

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  componentDidCatch(e: Error) { reportError(e, "error"); }
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

const DEV_BYPASS_AUTH = process.env.EXPO_PUBLIC_DEV_BYPASS_AUTH === 'true';

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (DEV_BYPASS_AUTH) {
      useAuthStore.setState({ profile: DEV_PROFILE, loading: false });
      return;
    }
    loadProfile();
    // Watchdog: never let the splash spinner hang indefinitely. If auth hasn't
    // resolved in 8s (slow/unreachable backend), fall through so the router can
    // show the sign-in screen instead of spinning forever.
    const t = setTimeout(() => {
      if (useAuthStore.getState().loading) useAuthStore.setState({ loading: false });
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (loading) return;
    if (DEV_BYPASS_AUTH) {
      if (segments[0] !== "tabs") router.replace("/tabs");
      return;
    }
    // Redirect rules. Note the second case must cover a session-holder sitting on
    // the splash/index route (segments === []), not just one inside `auth` — a
    // returning user cold-starts at index, and without this they'd stay stuck on
    // the spinner with no rule ever sending them to /tabs.
    const inAuth = segments[0] === "auth";
    const inTabs = segments[0] === "tabs";
    if (!session && !inAuth)     router.replace("/auth/sign-in");
    else if (session && !inTabs) router.replace("/tabs");
  }, [mounted, session, loading, segments]);

  return (
    <ErrorBoundary>
      <BLEProvider>
        <Slot />
      </BLEProvider>
      <ErrorOverlay />
    </ErrorBoundary>
  );
}
