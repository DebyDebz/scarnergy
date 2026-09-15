import { useMemo } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { isArMeasureSupported, isOpeningDetectorAvailable } from "expo-ar-measure";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Capability gate for camera-only AR measurement. Like useRoomScanner this needs a
// dev-client/EAS build (native module), but unlike RoomPlan it runs on any ARKit-capable
// iPhone/iPad (A9+, iOS 15.1+) — no LiDAR sensor required. Android reports false until
// the ARCore implementation lands.
export function useArMeasure() {
  const isSupported = useMemo(() => {
    if (isExpoGo || Platform.OS !== "ios") return false;
    return isArMeasureSupported();
  }, []);

  // Auto-detection needs a CoreML model bundled in the iOS target; without it the
  // screen falls back to manual corner tapping, which is always available.
  const isDetectorAvailable = useMemo(() => isSupported && isOpeningDetectorAvailable(), [isSupported]);

  return { isSupported, isDetectorAvailable };
}
