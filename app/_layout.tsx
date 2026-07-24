import { useEffect, useState, Component, ReactNode } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { Platform, Text, View, LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

LogBox.ignoreLogs([
  '"shadow*" style props are deprecated',
  "props.pointerEvents is deprecated",
  // Benign auth noise: supabase-js console.error's an expired refresh token on
  // cold start, then clears the session itself — the user just signs in again.
  // Same patterns as IGNORED_ERROR_PATTERNS in lib/errorLog.ts.
  /invalid refresh token/i,
  /refresh token not found/i,
  /auth session missing/i,
  /auto refresh tick failed/i,
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
import { supabaseConfigError } from "../lib/supabase";
import { BLEProvider } from "../lib/BLEContext";
import { installErrorHandlers, reportError } from "../lib/errorLog";
import { ErrorOverlay } from "../components/ui/ErrorOverlay";
import { initSentry, captureException, wrapWithSentry } from "../lib/sentry";

// Initialize the native crash reporter first (it installs its own global
// handlers), then chain our in-app JS handlers on top. Both run at module load,
// before any component mounts, so startup failures are captured too.
initSentry();
installErrorHandlers();

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  componentDidCatch(e: Error) { reportError(e, "error"); captureException(e); }
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

function RootLayout() {
  const { session, loading, loadProfile } = useAuthStore();
  const router   = useRouter();
  const segments = useSegments();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (supabaseConfigError) return; // config screen is shown; don't hit the backend
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
    if (supabaseConfigError) return;
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

  if (supabaseConfigError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" }}>
        <Text style={{ color: "#b91c1c", fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Configuration error</Text>
        <Text style={{ color: "#333", fontSize: 13, textAlign: "center" }}>{supabaseConfigError}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <BLEProvider>
          <Slot />
        </BLEProvider>
        <ErrorOverlay />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

// Wrap the root with Sentry so it can hook the app's lifecycle and touch events
// onto crash reports. No-op if Sentry init was skipped (no DSN / Expo Go).
export default wrapWithSentry(RootLayout);
