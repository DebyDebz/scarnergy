import { create } from "zustand";
import { clampTourStep, DEMO_TOURS, DemoTourKind } from "../lib/demoTour";

// Global so the walkthrough card survives navigation between the inspection,
// element, wizard and photo screens. In memory only: an app restart ends the tour.
interface DemoTourState {
  active: boolean;
  tour: DemoTourKind;
  step: number;
  minimized: boolean;
  /** House tour only: steps advance on a timer until paused or the last step is reached. */
  autoplay: boolean;
  /** When this run began; the from-scratch checks only count work done since. */
  startedAt: string | null;
  sessionId: string | null;
  buildingId: string | null;
  start: (sessionId: string, buildingId: string, autoplay?: boolean, tour?: DemoTourKind) => void;
  go: (step: number) => void;
  setMinimized: (minimized: boolean) => void;
  setAutoplay: (autoplay: boolean) => void;
  exit: () => void;
}

export const useDemoTour = create<DemoTourState>((set, get) => ({
  active: false,
  tour: "house",
  step: 0,
  minimized: false,
  autoplay: false,
  startedAt: null,
  sessionId: null,
  buildingId: null,
  start: (sessionId, buildingId, autoplay = false, tour = "house") =>
    set({
      active: true, tour, step: 0, minimized: false,
      autoplay: tour === "house" && autoplay,
      startedAt: new Date().toISOString(), sessionId, buildingId,
    }),
  go: (step) => set({ step: clampTourStep(step, DEMO_TOURS[get().tour]), minimized: false }),
  // Hiding the card hands the screen to the user, so it also pauses auto-play.
  setMinimized: (minimized) => set(minimized ? { minimized, autoplay: false } : { minimized }),
  setAutoplay: (autoplay) => set({ autoplay: get().tour === "house" && autoplay, minimized: false }),
  exit: () => set({
    active: false, tour: "house", step: 0, minimized: false, autoplay: false,
    startedAt: null, sessionId: null, buildingId: null,
  }),
}));
