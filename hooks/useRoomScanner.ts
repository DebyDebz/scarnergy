import { useCallback, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { DetectedOpening, isRoomScannerSupported } from "expo-room-scanner";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export type RoomScanState = "idle" | "scanning" | "finishing" | "done" | "error";

// Mirrors useESP32Provisioning.ts's shape (state union + ref mirror + Expo Go guard),
// but owns no native connection of its own — the native RoomCaptureView instance
// (mounted by the caller) does the actual work; this hook just tracks its state
// and normalizes the capture-finish/error events it emits.
export function useRoomScanner() {
  const stateRef = useRef<RoomScanState>("idle");
  const [state, setStateRaw] = useState<RoomScanState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<DetectedOpening[]>([]);

  const setState = useCallback((s: RoomScanState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  // Room scanning needs a custom dev-client/production build (native module) and
  // is iOS-only (RoomPlan has no Android equivalent) — hide the feature otherwise.
  const isSupported = useMemo(() => {
    if (isExpoGo || Platform.OS !== "ios") return false;
    try {
      return isRoomScannerSupported();
    } catch {
      return false;
    }
  }, []);

  const startScan = useCallback(() => {
    setErrorMessage(null);
    setResults([]);
    setState("scanning");
  }, [setState]);

  // Flips the "isScanning" prop the caller passes to <ExpoRoomScannerView> to
  // false, which tells the native RoomCaptureSession to stop. The native side
  // finalizes asynchronously and reports back via handleCaptureFinish/Error.
  const stopScan = useCallback(() => {
    setState("finishing");
  }, [setState]);

  const handleCaptureFinish = useCallback((openings: DetectedOpening[]) => {
    setResults(openings);
    setState("done");
  }, [setState]);

  const handleCaptureError = useCallback((message: string) => {
    setErrorMessage(message);
    setState("error");
  }, [setState]);

  const reset = useCallback(() => {
    setResults([]);
    setErrorMessage(null);
    setState("idle");
  }, [setState]);

  return {
    state,
    isSupported,
    errorMessage,
    results,
    startScan,
    stopScan,
    handleCaptureFinish,
    handleCaptureError,
    reset,
  };
}
