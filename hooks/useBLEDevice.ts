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
// Activates trigger-press indications on d1. Written with-response so we get a real
// GATT ACK from the device (writeWithoutResponse always returns true at the transport
// layer even when the device ignores the payload — false-positive for cmdEnabled).
const CMD_ENABLE   = btoa(String.fromCharCode(0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a));

// Rolling entry in the raw-packet debug log shown on the Device screen.
export interface PacketLogEntry {
  t:       string;       // HH:MM:SS
  hex:     string;       // full hex dump
  len:     number;       // byte count
  decoded: string | null; // "580.0mm stream" | "2430.0mm trigger" | null
}

export interface GLMMeasurement {
  value_mm:      number;
  battery_level: number;
  is_continuous: boolean;
  raw_bytes:     string;
  timestamp:     string;
}

export type BleState = "idle" | "scanning" | "connecting" | "connected" | "disconnected" | "error";

export function useBLEDevice() {
  const { profile } = useAuthStore();
  const profileRef     = useRef(profile);
  const managerRef     = useRef<BleManager | null>(null);
  const deviceRef      = useRef<Device | null>(null);
  const stateRef       = useRef<BleState>("idle");
  const writeCharRef        = useRef<{ svcUuid: string; charUuid: string } | null>(null);
  const pollRef             = useRef<ReturnType<typeof setInterval> | null>(null);
  // Armed by requestMeasurement() only when cmdEnabled=true (GATT trigger-press mode).
  // In continuous-only mode we skip arming — the Capture button is the fill path.
  const pendingMeasurementRef = useRef(false);
  // Timestamp of the last requestMeasurement() call — used to guard stale-heartbeat fills.
  const measurementRequestTimeRef = useRef<number>(0);

  const [state,                   setStateRaw]              = useState<BleState>("idle");
  const [lastMeasurement,         setLastMeasurement]        = useState<GLMMeasurement | null>(null);
  // lastTriggerMeasurement is ONLY set on trigger-press packets (is_continuous=false).
  // It is never overwritten by streaming heartbeats, so the Device screen can show a
  // stable "captured" value even though heartbeats keep updating lastMeasurement.
  const [lastTriggerMeasurement,  setLastTriggerMeasurement] = useState<GLMMeasurement | null>(null);
  const [deviceName,              setDeviceName]             = useState<string | null>(null);
  const [deviceId,                setDeviceId]               = useState<string | null>(null);
  const [batteryLevel,            setBatteryLevel]           = useState<number | null>(null);
  const [errorMessage,            setErrorMessage]           = useState<string | null>(null);
  // True only when CMD_ENABLE received a real GATT ACK from the device.
  const [cmdEnabled,              setCmdEnabled]             = useState(false);
  const [rawPacketCount,          setRawPacketCount]         = useState(0);
  // Rolling packet log (last 12 entries) shown on the Device diagnostics screen.
  const [packetLog,               setPacketLog]              = useState<PacketLogEntry[]>([]);
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
    // big-endian uint16 at [2..3] in cm → mm.
    // All 4-byte C0 packets are treated as continuous (regardless of type byte)
    // because we cannot distinguish trigger-single from heartbeat at this length.
    if (bytes.length === 4 && bytes[0] === 0xc0) {
      const raw = (bytes[2] << 8) | bytes[3];
      const value_mm = raw * 10;
      if (value_mm >= 50 && value_mm <= 50_000) {
        return { value_mm, battery_level: 0, is_continuous: true, raw_bytes: uint8ArrayToHex(bytes), timestamp: new Date().toISOString() };
      }
      return null;
    }

    // 8+ byte trigger-press indication (CMD_ENABLE path): starts with C0 55
    // Strict match first: C0 55 10 06 ... float32-LE at offset 7 (GLM 50CG confirmed format).
    if (bytes.length >= 8 && bytes[0] === 0xc0 && bytes[1] === 0x55 && bytes[2] === 0x10) {
      for (const off of [7, 6, 4]) {
        if (bytes.length < off + 4) continue;
        const dv = new DataView(bytes.buffer, bytes.byteOffset + off, 4);
        const value_mm = dv.getFloat32(0, true) * 1000;
        if (value_mm >= 1 && value_mm <= 50_000) {
          return { value_mm, battery_level: bytes[4] ?? 0, is_continuous: false, raw_bytes: uint8ArrayToHex(bytes), timestamp: new Date().toISOString() };
        }
      }
    }

    // Broad fallback: any 8+ byte C0 55 packet (catches GLM 50C firmware variants
    // that use bytes[2] != 0x10, e.g. different sub-command codes).
    // Scans every float32-LE offset from 4 to len-4 and takes the first plausible value.
    if (bytes.length >= 8 && bytes[0] === 0xc0 && bytes[1] === 0x55) {
      for (let off = 4; off <= bytes.length - 4; off++) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + off, 4);
        const value_mm = dv.getFloat32(0, true) * 1000;
        if (value_mm >= 50 && value_mm <= 50_000) {
          console.log(`[BLE] Broad C0-55 decode hit at offset ${off}, b2=0x${bytes[2].toString(16)}: ${value_mm.toFixed(1)}mm`);
          return { value_mm, battery_level: bytes[4] ?? 0, is_continuous: false, raw_bytes: uint8ArrayToHex(bytes), timestamp: new Date().toISOString() };
        }
      }
    }

    return null;
  };

  // Shared handler — called for every BLE notification on d1.
  // Updates the live display unconditionally; dispatches to the slot-fill callback only
  // when appropriate (see inline comments for the two dispatch paths).
  const handleMeasurement = useCallback((base64: string) => {
    const bytes = base64ToUint8Array(base64);
    const hex = uint8ArrayToHex(bytes);
    console.log(`[BLE PKT] ${bytes.length}B hex=${hex} b0=${bytes[0]?.toString(16)} b1=${bytes[1]?.toString(16)} b2=${bytes[2]?.toString(16)} b3=${bytes[3]?.toString(16)}`);

    const m = decodePacket(base64);

    // Always log the packet (decoded or not) for the Device diagnostics panel.
    const entry: PacketLogEntry = {
      t:       new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      hex,
      len:     bytes.length,
      decoded: m ? `${m.value_mm.toFixed(1)}mm ${m.is_continuous ? "stream" : "trigger"}` : null,
    };
    setPacketLog(prev => [entry, ...prev.slice(0, 11)]);

    if (!m) {
      console.log(`[BLE PKT] no decode`);
      return;
    }
    console.log(`[BLE PKT] decoded: ${m.value_mm.toFixed(1)}mm is_continuous=${m.is_continuous}`);
    setLastMeasurement(m);
    if (m.battery_level > 0) setBatteryLevel(m.battery_level);

    // PATH A — Trigger-press GATT indication (CMD_ENABLE active, is_continuous=false):
    // Physical trigger press = deliberate user intent → always dispatch.
    // Also captures into lastTriggerMeasurement so the Device screen shows a stable
    // value — streaming heartbeats only update lastMeasurement, never lastTriggerMeasurement.
    if (!m.is_continuous) {
      setLastTriggerMeasurement(m);
      pendingMeasurementRef.current = false;
      onMeasurementRef.current?.(m);
      return;
    }

    // PATH B — Continuous heartbeat fallback (used when CMD_ENABLE succeeded but the
    // device still only sends 4-byte packets, i.e. pendingRef was armed via requestMeasurement).
    // Guard: wait at least 1500ms after the arm so the user has time to aim the device
    // before the next heartbeat fires — prevents the pre-aiming stale value from filling.
    if (pendingMeasurementRef.current) {
      const elapsed = Date.now() - measurementRequestTimeRef.current;
      if (elapsed >= 1500) {
        pendingMeasurementRef.current = false;
        onMeasurementRef.current?.(m);
      }
      // else: too early — keep pendingRef armed; next heartbeat will re-evaluate
    }
  }, []); // decodePacket is pure; measurementRequestTimeRef is a stable ref — no deps needed

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

      // ── Subscribe to d0/d1 ONLY ──────────────────────────────────────────────
      // All measurement data (continuous heartbeat + trigger-press indications)
      // flows through the d0 service / d1 characteristic.
      // The f0 service is a proprietary Bosch service — subscribing to its
      // notification characteristics causes the GLM to immediately disconnect.
      console.log("[BLE] Services found:", services.map(s => s.uuid.slice(0, 8)));
      connected.monitorCharacteristicForService(GLM_SERVICE_UUID, GLM_CHAR_UUID, (err, ch) => {
        if (err) { console.warn("[BLE] Monitor error (d0/d1):", err.message); return; }
        if (!ch?.value) return;
        console.log("[BLE SRC] svc=d0 char=d1");
        setRawPacketCount(n => n + 1);
        handleMeasurement(ch.value);
      });

      // ── Activate trigger-press indications on d0/d1 ─────────────────────────
      // Subscribe first, then write CMD_ENABLE with a short settling delay.
      // We MUST use write-WITH-response here — writeWithoutResponse always returns true
      // at the BLE transport layer even when the device ignores the payload, giving a
      // false-positive cmdEnabled that misleads the UI. write-WITH-response waits for an
      // actual GATT ATT_WRITE_RSP from the GLM firmware before resolving.
      writeCharRef.current = { svcUuid: GLM_SERVICE_UUID, charUuid: GLM_CHAR_UUID };

      // First: inspect d1's GATT properties so we know what it actually supports.
      let d1SupportsWrite = false;
      try {
        const chars = await connected.characteristicsForService(GLM_SERVICE_UUID);
        const d1 = chars.find(c => c.uuid.toLowerCase().startsWith("02a6c0d1"));
        if (d1) {
          d1SupportsWrite = !!(d1.isWritableWithResponse || d1.isWritableWithoutResponse);
          console.log(`[BLE] d1 props — notify=${d1.isNotifiable} indicate=${d1.isIndicatable} ` +
            `writeResp=${d1.isWritableWithResponse} writeNoResp=${d1.isWritableWithoutResponse}`);
        } else {
          console.warn("[BLE] d1 characteristic not found in service listing");
        }
      } catch (e: any) {
        console.warn("[BLE] Could not inspect d1 properties:", e?.message ?? e);
        d1SupportsWrite = true; // assume writable and let the write attempt fail naturally
      }

      let cmdOk = false;
      if (!d1SupportsWrite) {
        console.warn("[BLE] d1 is not writable — CMD_ENABLE skipped; using Capture-button fallback");
      } else {
        for (let attempt = 1; attempt <= 3 && !cmdOk; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 400 * attempt));
          try {
            // Prefer write-with-response: real GATT-level ACK from device firmware.
            await connected.writeCharacteristicWithResponseForService(GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
            cmdOk = true;
            console.log(`[BLE] CMD_ENABLE attempt ${attempt}: ✓ (ACK'd by device)`);
          } catch {
            try {
              // Some GLM variants only allow write-without-response on d1.
              await connected.writeCharacteristicWithoutResponseForService(GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
              cmdOk = true;
              console.log(`[BLE] CMD_ENABLE attempt ${attempt}: sent (no-response — ACK unverifiable)`);
            } catch (e2: any) {
              console.log(`[BLE] CMD_ENABLE attempt ${attempt}: failed — ${e2?.message ?? e2}`);
            }
          }
        }
        if (!cmdOk) {
          console.warn("[BLE] CMD_ENABLE permanently failed — trigger-press GATT unavailable. " +
            "Capture button + manual entry remain active as fallback.");
        }
      }
      setCmdEnabled(cmdOk);

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

  // Arms the pending flag for the continuous-heartbeat fallback path (PATH B).
  // Only called from inspect.tsx when cmdEnabled=true — if CMD_ENABLE failed we skip
  // arming entirely and rely on the Capture button.
  const requestMeasurement = useCallback(async () => {
    if (!deviceRef.current) return;
    pendingMeasurementRef.current = true;
    measurementRequestTimeRef.current = Date.now(); // start the 1500ms aim guard
  }, []);

  return {
    state, lastMeasurement, lastTriggerMeasurement, deviceName, deviceId,
    batteryLevel, errorMessage, rawPacketCount, cmdEnabled, packetLog,
    scan, disconnect, setOnMeasurement, requestMeasurement,
    isConnected: state === "connected",
  };
}
