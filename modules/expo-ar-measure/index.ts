import ExpoArMeasureModule from "./src/ExpoArMeasureModule";

export { default as ExpoArMeasureView } from "./src/ExpoArMeasureView";
export type { ExpoArMeasureViewRef } from "./src/ExpoArMeasureView";
export * from "./src/ExpoArMeasure.types";

/** True when the device can run ARKit world tracking (any iPhone 6s+/iPad from 2017, iOS 15.1+). */
export function isArMeasureSupported(): boolean {
  try {
    return ExpoArMeasureModule.isSupported();
  } catch {
    return false;
  }
}

/** True when an `OpeningDetector.mlmodelc` CoreML model is bundled, enabling auto-detection. */
export function isOpeningDetectorAvailable(): boolean {
  try {
    return ExpoArMeasureModule.isDetectorAvailable();
  } catch {
    return false;
  }
}
