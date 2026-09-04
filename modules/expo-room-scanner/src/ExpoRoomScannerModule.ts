import { requireNativeModule } from "expo-modules-core";

interface ExpoRoomScannerModuleType {
  isSupported(): boolean;
}

export default requireNativeModule<ExpoRoomScannerModuleType>("ExpoRoomScanner");
