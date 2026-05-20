import { useCallback } from "react";

export interface GLMMeasurement {
  value_mm: number;
  battery_level: number;
  is_continuous: boolean;
  raw_bytes: string;
  timestamp: string;
}

export type BleState = "idle" | "scanning" | "connecting" | "connected" | "disconnected" | "error";

export function useBLEDevice() {
  const noop = useCallback(async () => {}, []);
  const noopCb = useCallback((_cb: (m: GLMMeasurement) => void) => {}, []);

  return {
    state: "idle" as BleState,
    lastMeasurement: null,
    deviceName: null,
    deviceId: null,
    batteryLevel: null,
    errorMessage: "Bluetooth is not available on web.",
    rawPacketCount: 0,
    isConnected: false,
    scan: noop,
    disconnect: noop,
    setOnMeasurement: noopCb,
    requestMeasurement: noop,
  };
}
