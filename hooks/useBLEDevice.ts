import { useState, useEffect, useCallback, useRef } from "react";
import { BleManager, Device, Characteristic, BleError } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../store/authStore";

// BLE is unavailable in Expo Go — requires a development build
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToHex(uint8Array: Uint8Array): string {
  return Array.from(uint8Array).map(b => b.toString(16).padStart(2, "0")).join("");
}

function readUInt32LEFromUint8Array(uint8Array: Uint8Array, offset: number): number {
  return (
    uint8Array[offset] |
    (uint8Array[offset + 1] << 8) |
    (uint8Array[offset + 2] << 16) |
    (uint8Array[offset + 3] << 24)
  ) >>> 0;
}

const GLM_SERVICE_UUID     = "00001523-1212-efde-1523-785feabcd123";
const GLM_NOTIFY_CHAR_UUID = "00001524-1212-efde-1523-785feabcd123";
const GLM_WRITE_CHAR_UUID  = "00001525-1212-efde-1523-785feabcd123";
const CMD_ACTIVATE = btoa(String.fromCharCode(0x01, 0x00));
const CMD_UNIT_MM  = btoa(String.fromCharCode(0x01, 0x01));

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
  const profileRef  = useRef(profile);
  const managerRef  = useRef<BleManager | null>(null);
  const deviceRef   = useRef<Device | null>(null);
  const stateRef    = useRef<BleState>("idle"); // used to avoid stale closures in async callbacks

  const [state,            setStateRaw]        = useState<BleState>("idle");
  const [lastMeasurement,  setLastMeasurement]  = useState<GLMMeasurement | null>(null);
  const [deviceName,       setDeviceName]       = useState<string | null>(null);
  const [deviceId,         setDeviceId]         = useState<string | null>(null);
  const [batteryLevel,     setBatteryLevel]     = useState<number | null>(null);
  const [errorMessage,     setErrorMessage]     = useState<string | null>(null);
  const onMeasurementRef = useRef<((m: GLMMeasurement) => void) | null>(null);

  useEffect(() => { profileRef.current = profile; }, [profile]);

  // Wrapper that keeps the ref and React state in sync
  const setState = useCallback((s: BleState) => {
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
    if (bytes.length !== 10) return null;
    if (bytes[0] !== 0x00) return null;

    const statusFlags = bytes[1];
    if (!!(statusFlags & 0x04)) return null; // error flag

    const rawValue   = readUInt32LEFromUint8Array(bytes, 2);
    const value_mm   = rawValue / 10.0;
    const battery    = bytes[7];
    const continuous = !!(statusFlags & 0x02);

    return {
      value_mm,
      battery_level: battery,
      is_continuous: continuous,
      raw_bytes: uint8ArrayToHex(bytes),
      timestamp: new Date().toISOString(),
    };
  };

  const connect = useCallback(async (device: Device) => {
    setState("connecting");
    try {
      const connected = await device.connect({ autoConnect: true });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setDeviceName(connected.name ?? "GLM 50C");

      // Look up the device's UUID in the database (needed to insert measurements)
      const { data: deviceRow } = await supabase
        .from("ble_devices")
        .select("id")
        .eq("mac_address", connected.id)
        .single();
      setDeviceId(deviceRow?.id ?? null);

      await connected.writeCharacteristicWithResponseForService(
        GLM_SERVICE_UUID, GLM_WRITE_CHAR_UUID, CMD_ACTIVATE
      );
      await connected.writeCharacteristicWithResponseForService(
        GLM_SERVICE_UUID, GLM_WRITE_CHAR_UUID, CMD_UNIT_MM
      );

      connected.monitorCharacteristicForService(
        GLM_SERVICE_UUID, GLM_NOTIFY_CHAR_UUID,
        (_error: BleError | null, char: Characteristic | null) => {
          if (!char?.value) return;
          const m = decodePacket(char.value);
          if (!m) return;
          setLastMeasurement(m);
          setBatteryLevel(m.battery_level);
          onMeasurementRef.current?.(m);
        }
      );

      setState("connected");

      connected.onDisconnected(() => {
        setState("disconnected");
        deviceRef.current = null;
        setDeviceId(null);
      });

      if (profileRef.current) {
        await supabase.from("ble_devices")
          .update({ last_connected_at: new Date().toISOString() })
          .eq("mac_address", connected.id);
      }
    } catch (e: any) {
      setErrorMessage(e.message);
      setState("error");
      setDeviceId(null);
    }
  }, [setState]);

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

    manager.startDeviceScan([GLM_SERVICE_UUID], { allowDuplicates: false }, async (error, device) => {
      if (error) {
        setErrorMessage(error.message);
        setState("error");
        return;
      }
      if (device && (device.name?.includes("GLM") || device.name?.includes("Bosch"))) {
        manager.stopDeviceScan();
        await connect(device);
      }
    });

    // Auto-stop after 15s — use stateRef to avoid stale closure over React state
    setTimeout(() => {
      if (stateRef.current === "scanning") {
        manager.stopDeviceScan();
        setState("idle");
      }
    }, 15_000);
  }, [connect, setState]);

  const disconnect = useCallback(async () => {
    await deviceRef.current?.cancelConnection();
    deviceRef.current = null;
    setState("disconnected");
  }, [setState]);

  const setOnMeasurement = useCallback((cb: (m: GLMMeasurement) => void) => {
    onMeasurementRef.current = cb;
  }, []);

  return {
    state, lastMeasurement, deviceName, deviceId, batteryLevel, errorMessage,
    scan, disconnect, setOnMeasurement,
    isConnected: state === "connected",
  };
}
