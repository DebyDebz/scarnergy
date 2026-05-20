import { useState, useEffect, useCallback, useRef } from "react";
import { BleManager, Device } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../store/authStore";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
  return bytes;
}

function uint8ArrayToHex(uint8Array: Uint8Array): string {
  return Array.from(uint8Array).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Bosch GLM 50C BLE protocol (confirmed via reverse-engineering of GLM 50CG)
// All measurement data flows through d0/d1 — the f0 service is irrelevant.
const GLM_SERVICE_UUID  = "02a6c0d0-0451-4000-b000-fb3210111989";
const GLM_CHAR_UUID     = "02a6c0d1-0451-4000-b000-fb3210111989";
// Enables trigger-press measurement indications on d1.
// Must be written AFTER subscribing (with a short delay), using write-with-response.
const CMD_ENABLE   = btoa(String.fromCharCode(0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a));

// Write to a characteristic, trying without-response first then with-response.
// Returns true if the write succeeded.
async function writeGatt(device: Device, svcUuid: string, charUuid: string, value: string): Promise<boolean> {
  try {
    await device.writeCharacteristicWithoutResponseForService(svcUuid, charUuid, value);
    return true;
  } catch {
    try {
      await device.writeCharacteristicWithResponseForService(svcUuid, charUuid, value);
      return true;
    } catch {
      return false;
    }
  }
}

export interface GLMMeasurement {
  value_mm: number;
  battery_level: number;
  is_continuous: boolean;
  raw_bytes: string;
  timestamp: string;
}

export type BleState = "idle" | "scanning" | "connecting" | "connected" | "disconnected" | "error";

export function useBLEDevice() {
  const { profile } = useAuthStore();
  const profileRef     = useRef(profile);
  const managerRef     = useRef<BleManager | null>(null);
  const deviceRef      = useRef<Device | null>(null);
  const stateRef       = useRef<BleState>("idle");
  const writeCharRef        = useRef<{ svcUuid: string; charUuid: string } | null>(null);
  const pollRef             = useRef<ReturnType<typeof setInterval> | null>(null); // kept for stopPolling on disconnect
  // Set to true by requestMeasurement(); the next heartbeat packet fills the active slot.
  const pendingMeasurementRef = useRef(false);

  const [state,           setStateRaw]       = useState<BleState>("idle");
  const [lastMeasurement, setLastMeasurement] = useState<GLMMeasurement | null>(null);
  const [deviceName,      setDeviceName]      = useState<string | null>(null);
  const [deviceId,        setDeviceId]        = useState<string | null>(null);
  const [batteryLevel,    setBatteryLevel]    = useState<number | null>(null);
  const [errorMessage,    setErrorMessage]    = useState<string | null>(null);
  const [rawPacketCount,  setRawPacketCount]  = useState(0);
  const onMeasurementRef = useRef<((m: GLMMeasurement) => void) | null>(null);

  useEffect(() => { profileRef.current = profile; }, [profile]);

  const setState = useCallback((s: BleState) => {
    console.log("[BLE] State:", stateRef.current, "→", s);
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  useEffect(() => {
    if (isExpoGo) return;
    managerRef.current = new BleManager();
    return () => { managerRef.current?.destroy(); };
  }, []);

  const requestPermissions = async (): Promise<boolean> => {
    if (Platform.OS === "android") {
      const grants = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(grants).every(g => g === PermissionsAndroid.RESULTS.GRANTED);
    }
    return true;
  };

  const decodePacket = (base64Data: string): GLMMeasurement | null => {
    const bytes = base64ToUint8Array(base64Data);

    // 4-byte streaming packet: C0 <type> <hi> <lo>
    // big-endian uint16 at [2..3] in cm → mm
    if (bytes.length === 4 && bytes[0] === 0xc0) {
      const raw = (bytes[2] << 8) | bytes[3];
      const value_mm = raw * 10;
      if (value_mm >= 50 && value_mm <= 50_000) {
        return { value_mm, battery_level: 0, is_continuous: true, raw_bytes: uint8ArrayToHex(bytes), timestamp: new Date().toISOString() };
      }
      return null;
    }

    // 8+ byte trigger-press indication: C0 55 10 06 ... float32 at bytes 7–10
    // Format confirmed by reverse-engineering (ketan/Bosch-GLM50C-Rangefinder).
    if (bytes.length < 8 || bytes[0] !== 0xc0 || bytes[1] !== 0x55 || bytes[2] !== 0x10) return null;

    // Try offset 7 first (confirmed format), then 6 and 4 as fallbacks for
    // firmware variants that pack the float differently.
    for (const off of [7, 6, 4]) {
      if (bytes.length < off + 4) continue;
      const dv = new DataView(bytes.buffer, bytes.byteOffset + off, 4);
      const value_mm = dv.getFloat32(0, true) * 1000;
      if (value_mm >= 1 && value_mm <= 50_000) {
        return { value_mm, battery_level: bytes[4] ?? 0, is_continuous: false, raw_bytes: uint8ArrayToHex(bytes), timestamp: new Date().toISOString() };
      }
    }
    return null;
  };

  // Shared handler — called from every monitored characteristic.
  // Background poll packets update the live display only.
  // Slot-fill callbacks only fire when requestMeasurement() has armed the pending flag.
  const handleMeasurement = useCallback((base64: string) => {
    const bytes = base64ToUint8Array(base64);
    const hex = uint8ArrayToHex(bytes);
    console.log(`[BLE PKT] ${bytes.length}B hex=${hex} b0=${bytes[0]?.toString(16)} b1=${bytes[1]?.toString(16)} b2=${bytes[2]?.toString(16)} b3=${bytes[3]?.toString(16)}`);
    const m = decodePacket(base64);
    if (!m) {
      console.log(`[BLE PKT] no decode`);
      return;
    }
    console.log(`[BLE PKT] decoded: ${m.value_mm.toFixed(1)}mm`);
    setLastMeasurement(m);
    setBatteryLevel(m.battery_level);
    if (pendingMeasurementRef.current) {
      pendingMeasurementRef.current = false;
      onMeasurementRef.current?.(m);
    }
  }, []); // decodePacket is pure; no deps needed

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const connect = useCallback(async (device: Device) => {
    console.log("[BLE] Connecting to device:", device.name, "id:", device.id);
    setState("connecting");
    try {
      const connected = await device.connect({ autoConnect: false });
      console.log("[BLE] Connected. Discovering services...");
      await connected.discoverAllServicesAndCharacteristics();

      const services = await connected.services();
      console.log("[BLE] Services found:", services.map(s => s.uuid));

      deviceRef.current = connected;
      setDeviceName(connected.name ?? "GLM 50C");
      setState("connected");

      let disconnectHandled = false;
      connected.onDisconnected(() => {
        if (disconnectHandled) return;
        disconnectHandled = true;
        stopPolling();
        writeCharRef.current = null;
        console.log("[BLE] Device disconnected");
        setState("disconnected");
        deviceRef.current = null;
      });

      // ── Subscribe to all notifiable characteristics across all services ──────
      let monitoredCount = 0;
      for (const svc of services) {
        try {
          const chars = await connected.characteristicsForService(svc.uuid);
          // Log every characteristic so we can see what's writable
          console.log("[BLE] svc=" + svc.uuid.slice(0, 8) + " chars:", chars.map(c =>
            c.uuid.slice(0, 8) +
            (c.isNotifiable         ? " [N]" : "") +
            (c.isIndicatable        ? " [I]" : "") +
            (c.isWritableWithoutResponse ? " [W]" : "") +
            (c.isWritableWithResponse    ? " [Wr]" : "")
          ));
          for (const c of chars) {
            if (!c.isNotifiable && !c.isIndicatable) continue;
            const svcTag  = svc.uuid.slice(6, 8);   // e.g. "d0" or "f0"
            const charTag = c.uuid.slice(6, 8);      // e.g. "d1" or "f1"
            connected.monitorCharacteristicForService(svc.uuid, c.uuid, (err, ch) => {
              if (err) { console.warn(`[BLE] Monitor error (${svcTag}/${charTag}):`, err.message); return; }
              if (!ch?.value) return;
              console.log(`[BLE SRC] svc=${svcTag} char=${charTag}`);
              setRawPacketCount(n => n + 1);
              handleMeasurement(ch.value);
            });
            monitoredCount++;
          }
        } catch {
          // service may not be enumerable (e.g. OS-claimed HID service) — skip
        }
      }
      if (monitoredCount === 0) {
        connected.monitorCharacteristicForService(GLM_SERVICE_UUID, GLM_CHAR_UUID, (err, ch) => {
          if (err) { console.warn("[BLE] Monitor error:", err.message); return; }
          if (!ch?.value) return;
          console.log("[BLE SRC] fallback d0/d1");
          setRawPacketCount(n => n + 1);
          handleMeasurement(ch.value);
        });
      }

      // ── Activate trigger-press indications on d0/d1 ─────────────────────────
      // Per reverse-engineering of GLM 50CG: subscribe first, wait 500ms, then
      // write CMD_ENABLE with-response. Trigger presses then flow as 8-byte
      // indications on d1 (c0 55 10 06 ... float32 at bytes 7–10).
      writeCharRef.current = { svcUuid: GLM_SERVICE_UUID, charUuid: GLM_CHAR_UUID };
      await new Promise(resolve => setTimeout(resolve, 500));
      const d1Ok = await writeGatt(connected, GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
      console.log("[BLE] CMD_ENABLE → d0/d1:", d1Ok ? "✓" : "failed");

      // ── DB: upsert device record ─────────────────────────────────────────────
      const org = profileRef.current?.org_id;
      if (org) {
        const { data: upserted } = await supabase
          .from("ble_devices")
          .upsert(
            {
              org_id:            org,
              mac_address:       connected.id,
              nickname:          connected.name ?? "GLM 50C",
              device_type:       "bosch_glm50c",
              is_active:         true,
              last_connected_at: new Date().toISOString(),
            },
            { onConflict: "org_id,mac_address", ignoreDuplicates: false }
          )
          .select("id")
          .single();
        setDeviceId(upserted?.id ?? null);
      }
    } catch (e: any) {
      console.error("[BLE] Connection error:", e.message, e);
      setErrorMessage(e.message);
      setState("error");
      setDeviceId(null);
    }
  }, [setState, handleMeasurement, stopPolling]);

  const scan = useCallback(async () => {
    if (isExpoGo) {
      setErrorMessage("Bluetooth is not available in Expo Go. Use a development build.");
      setState("error");
      return;
    }

    const manager = managerRef.current;
    if (!manager) return;

    const granted = await requestPermissions();
    if (!granted) { setErrorMessage("Bluetooth permissions denied"); return; }

    setState("scanning");
    setErrorMessage(null);
    console.log("[BLE] Scan started");

    manager.startDeviceScan(null, { allowDuplicates: false }, async (error, device) => {
      if (error) {
        setErrorMessage(error.message);
        setState("error");
        return;
      }
      const name = device?.name?.toUpperCase() ?? "";
      const hasGlmService = device?.serviceUUIDs?.includes(GLM_SERVICE_UUID) ?? false;
      const nameMatch = name.includes("GLM") || name.includes("BOSCH") || name.includes("BSOCH") || name.includes("BSOH") || name.includes("KEYBOARD");
      if (device && (nameMatch || hasGlmService)) {
        if (stateRef.current !== "scanning") return;
        console.log("[BLE] Target matched:", device.name ?? "(unnamed)", "— stopping scan");
        manager.stopDeviceScan();
        await connect(device);
      }
    });

    setTimeout(() => {
      if (stateRef.current === "scanning") {
        console.log("[BLE] Scan timed out");
        manager.stopDeviceScan();
        setState("idle");
      }
    }, 15_000);
  }, [connect, setState]);

  const disconnect = useCallback(async () => {
    stopPolling();
    writeCharRef.current = null;
    await deviceRef.current?.cancelConnection();
    deviceRef.current = null;
    setRawPacketCount(0);
    setState("disconnected");
  }, [setState, stopPolling]);

  const setOnMeasurement = useCallback((cb: (m: GLMMeasurement) => void) => {
    onMeasurementRef.current = cb;
  }, []);

  // Manual one-shot measurement request (used by measurement input fields).
  // Arms the pending flag so the next trigger-press indication fills the active slot.
  const requestMeasurement = useCallback(async () => {
    if (!deviceRef.current) return;
    pendingMeasurementRef.current = true;
  }, []);

  return {
    state, lastMeasurement, deviceName, deviceId, batteryLevel, errorMessage,
    rawPacketCount,
    scan, disconnect, setOnMeasurement, requestMeasurement,
    isConnected: state === "connected",
  };
}
