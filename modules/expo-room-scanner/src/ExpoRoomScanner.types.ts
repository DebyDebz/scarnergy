export type DetectedOpeningType = "door" | "window" | "wall";

/** A surface RoomPlan detected. For walls widthMm is the wall's length along the room. */
export interface DetectedOpening {
  type: DetectedOpeningType;
  widthMm: number;
  heightMm: number;
}

export interface CaptureFinishEvent {
  openings: DetectedOpening[];
}

export interface CaptureErrorEvent {
  message: string;
}

export interface ExpoRoomScannerViewProps {
  style?: object;
  /** Toggling true starts a RoomPlan capture session; toggling back to false stops it and finalizes the result. */
  isScanning: boolean;
  onCaptureFinish?: (event: { nativeEvent: CaptureFinishEvent }) => void;
  onCaptureError?: (event: { nativeEvent: CaptureErrorEvent }) => void;
}
