import { create } from "zustand";
import { clampTourStep } from "../lib/demoTour";

// Global so the walkthrough card survives navigation between the inspection,
// element and photo screens. In memory only: an app restart ends the tour.
interface DemoTourState {
  active: boolean;
  step: number;
  minimized: boolean;
  /** Steps advance on their own until paused or the last step is reached. */
  autoplay: boolean;
  sessionId: string | null;
  buildingId: string | null;
  start: (sessionId: string, buildingId: string, autoplay?: boolean) => void;
  go: (step: number) => void;
  setMinimized: (minimized: boolean) => void;
  setAutoplay: (autoplay: boolean) => void;
  exit: () => void;
}

export const useDemoTour = create<DemoTourState>((set) => ({
  active: false,
  step: 0,
  minimized: false,
  autoplay: false,
  sessionId: null,
  buildingId: null,
  start: (sessionId, buildingId, autoplay = false) =>
    set({ active: true, step: 0, minimized: false, autoplay, sessionId, buildingId }),
  go: (step) => set({ step: clampTourStep(step), minimized: false }),
  // Hiding the card hands the screen to the user, so it also pauses auto-play.
  setMinimized: (minimized) => set(minimized ? { minimized, autoplay: false } : { minimized }),
  setAutoplay: (autoplay) => set({ autoplay, minimized: false }),
  exit: () => set({ active: false, step: 0, minimized: false, autoplay: false, sessionId: null, buildingId: null }),
}));
