import { useWindowDimensions } from "react-native";
import { CANVAS_SIZE, TABLET_BREAKPOINT } from "../constants/layout";

export function useIsTablet(): boolean {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= TABLET_BREAKPOINT;
}

export function useCanvasSize(): number {
  return useIsTablet() ? CANVAS_SIZE.tablet : CANVAS_SIZE.phone;
}
