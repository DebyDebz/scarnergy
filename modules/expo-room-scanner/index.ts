import ExpoRoomScannerModule from "./src/ExpoRoomScannerModule";

export { default as ExpoRoomScannerView } from "./src/ExpoRoomScannerView";
export * from "./src/ExpoRoomScanner.types";

export function isRoomScannerSupported(): boolean {
  try {
    return ExpoRoomScannerModule.isSupported();
  } catch {
    return false;
  }
}
