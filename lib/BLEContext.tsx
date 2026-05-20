import React, { createContext, useContext } from "react";
import { useBLEDevice, BleState, GLMMeasurement } from "../hooks/useBLEDevice";

interface BLEContextValue {
  state: BleState;
  lastMeasurement: GLMMeasurement | null;
  deviceName: string | null;
  deviceId: string | null;
  batteryLevel: number | null;
  errorMessage: string | null;
  rawPacketCount: number;
  isConnected: boolean;
  scan: () => Promise<void>;
  disconnect: () => Promise<void>;
  setOnMeasurement: (cb: (m: GLMMeasurement) => void) => void;
  requestMeasurement: () => Promise<void>;
}

const BLEContext = createContext<BLEContextValue | null>(null);

/**
 * Provides a single shared BleManager instance for the whole app.
 * Place this at the root so every screen and MeasurementInput share
 * the same connection state.
 */
export function BLEProvider({ children }: { children: React.ReactNode }) {
  const ble = useBLEDevice();
  return <BLEContext.Provider value={ble}>{children}</BLEContext.Provider>;
}

export function useBLE(): BLEContextValue {
  const ctx = useContext(BLEContext);
  if (!ctx) throw new Error("useBLE must be called inside <BLEProvider>");
  return ctx;
}
