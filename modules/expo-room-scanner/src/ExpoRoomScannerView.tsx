import { requireNativeViewManager } from "expo-modules-core";
import * as React from "react";

import { ExpoRoomScannerViewProps } from "./ExpoRoomScanner.types";

const NativeView: React.ComponentType<ExpoRoomScannerViewProps> =
  requireNativeViewManager("ExpoRoomScanner");

export default function ExpoRoomScannerView(props: ExpoRoomScannerViewProps) {
  return <NativeView {...props} />;
}
