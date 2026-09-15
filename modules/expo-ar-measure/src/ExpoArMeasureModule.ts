import { requireNativeModule } from "expo-modules-core";

interface ExpoArMeasureModuleType {
  isSupported(): boolean;
  isDetectorAvailable(): boolean;
}

export default requireNativeModule<ExpoArMeasureModuleType>("ExpoArMeasure");
