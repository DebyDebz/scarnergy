import { requireNativeViewManager } from "expo-modules-core";
import * as React from "react";

import { ArMeasureResult, ExpoArMeasureViewProps } from "./ExpoArMeasure.types";

/**
 * Imperative handle exposed by the native view. Expo Modules maps view-scoped
 * AsyncFunctions onto the native ref, so `ref.current.measureRect(...)` resolves
 * with the native result (or rejects with the native exception message).
 */
export interface ExpoArMeasureViewRef {
  /**
   * Raycasts two screen points (view coordinates, e.g. from a Pressable's
   * locationX/locationY) onto the nearest vertical surface and returns the
   * width/height of the rectangle they span, in mm.
   */
  measureRect(x1: number, y1: number, x2: number, y2: number): Promise<ArMeasureResult>;
}

const NativeView: React.ComponentType<ExpoArMeasureViewProps & { ref?: React.Ref<ExpoArMeasureViewRef> }> =
  requireNativeViewManager("ExpoArMeasure");

const ExpoArMeasureView = React.forwardRef<ExpoArMeasureViewRef, ExpoArMeasureViewProps>(
  function ExpoArMeasureView(props, ref) {
    return <NativeView {...props} ref={ref} />;
  }
);

export default ExpoArMeasureView;
