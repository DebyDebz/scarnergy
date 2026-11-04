import * as Sentry from "@sentry/react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

// Native crash reporter. Unlike the in-app <ErrorOverlay> (which only sees
// JS-catchable failures), Sentry's native SDK captures hard crashes —
// SIGSEGV/SIGABRT, including the Hermes-GC crash from an NSException thrown by a
// native TurboModule void method — and reports them on the NEXT launch, with the
// native stack and (crucially) the NSException reason that names the module.
//
// DSN comes from EXPO_PUBLIC_SENTRY_DSN. If it's unset (e.g. local dev without a
// Sentry project, or web), init is skipped and every helper below is a no-op.

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let enabled = false;

export function initSentry() {
  // Native crash capture doesn't exist in Expo Go — needs a dev/production build.
  if (!DSN || isExpoGo) return;
  Sentry.init({
    dsn: DSN,
    // Capture native crashes (the whole reason we're here).
    enableNative: true,
    // Attach the JS stack to native crashes where possible.
    attachStacktrace: true,
    // App release/version, so crashes group per build.
    release: `${Constants.expoConfig?.version ?? "0.0.0"}`,
    // Keep perf tracing off for now — we only want crash/error reports.
    tracesSampleRate: 0,
  });
  enabled = true;
}

export function captureException(e: unknown) {
  if (enabled) Sentry.captureException(e);
}

// Wraps the root component so Sentry can hook the app lifecycle. When init was
// skipped (no DSN / Expo Go) we return the component UNCHANGED — calling
// Sentry.wrap without a prior Sentry.init logs a "wrap was called before init"
// warning and buys us nothing, so we avoid it entirely.
export function wrapWithSentry<T>(RootComponent: T): T {
  return enabled ? (Sentry.wrap(RootComponent as any) as T) : RootComponent;
}
