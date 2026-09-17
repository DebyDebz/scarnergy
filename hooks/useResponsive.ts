import { Dimensions } from "react-native";
import { CANVAS_SIZE, TABLET_BREAKPOINT } from "../constants/layout";

// Device-class check, read once from the SCREEN rather than the app's window.
//
// useWindowDimensions() reports the window, which on iPad is smaller than the
// screen in Split View / Slide Over — dragging the divider would push the width
// under TABLET_BREAKPOINT and snap the whole app between tablet and phone
// layouts. Screen dimensions are fixed for a given device, and taking the
// shorter side keeps the answer the same in either orientation, so this is a
// stable device-class answer rather than a live layout measurement.
//
// (The app is currently locked to portrait and UIRequiresFullScreen, so Split
// View can't happen today — this keeps the check correct if either changes.)
const { width, height } = Dimensions.get("screen");
const IS_TABLET = Math.min(width, height) >= TABLET_BREAKPOINT;

export function useIsTablet(): boolean {
  return IS_TABLET;
}

export function useCanvasSize(): number {
  return IS_TABLET ? CANVAS_SIZE.tablet : CANVAS_SIZE.phone;
}
