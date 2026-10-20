import { create } from "zustand";
import { clampTourStep } from "../lib/demoTour";

// Global so the walkthrough card survives navigation between the inspection,
// element and photo screens. In memory only: an app restart ends the tour.
interface DemoTourState {
  active: boolean;
  step: number;
  minimized: boolean;
  sessionId: string | null;
  buildingId: string | null;
  start: (sessionId: string, buildingId: string) => void;
  go: (step: number) => void;
  setMinimized: (minimized: boolean) => void;
  exit: () => void;
}

export const useDemoTour = create<DemoTourState>((set) => ({
  active: false,
  step: 0,
  minimized: false,
  sessionId: null,
  buildingId: null,
  start: (sessionId, buildingId) => set({ active: true, step: 0, minimized: false, sessionId, buildingId }),
  go: (step) => set({ step: clampTourStep(step), minimized: false }),
  setMinimized: (minimized) => set({ minimized }),
  exit: () => set({ active: false, step: 0, minimized: false, sessionId: null, buildingId: null }),
}));
