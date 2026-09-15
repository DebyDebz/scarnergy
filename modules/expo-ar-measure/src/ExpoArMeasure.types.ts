/** Real-world dimensions of a rectangle between two screen points raycast onto a wall plane. */
export interface ArMeasureResult {
  widthMm: number;
  heightMm: number;
  /** Distance from the camera to the midpoint of the measured rectangle. Larger = less accurate. */
  distanceMm: number;
}

export type DetectionLabel = "door" | "window" | "unknown";

/** One CoreML detection, in view points (same coordinate space as touch locationX/locationY). */
export interface DetectionBox {
  label: DetectionLabel;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ArTrackingState = "normal" | "limited" | "notAvailable";

export interface TrackingStateEvent {
  state: ArTrackingState;
  /** ARKit's limited-tracking reason, e.g. "initializing", "excessiveMotion", "insufficientFeatures". */
  reason?: string;
  /** True while the ARKit coaching overlay is showing its own guidance. */
  coaching?: boolean;
}

export interface DetectionsEvent {
  boxes: DetectionBox[];
}

export interface ArErrorEvent {
  message: string;
}

export interface ExpoArMeasureViewProps {
  style?: object;
  /** True runs the AR session; false pauses it. */
  isActive: boolean;
  /** Runs the bundled CoreML opening detector on live frames (no-op if none is bundled). */
  detectionEnabled?: boolean;
  onTrackingState?: (event: { nativeEvent: TrackingStateEvent }) => void;
  onDetections?: (event: { nativeEvent: DetectionsEvent }) => void;
  onError?: (event: { nativeEvent: ArErrorEvent }) => void;
}
