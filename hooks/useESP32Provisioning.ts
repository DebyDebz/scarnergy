import { useCallback, useRef, useState } from "react";
import { BleManager, Device, State as BleAdapterState } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Must match esp32_firmware/src/main.cpp's PROVISION_*_UUID / PROVISIONING_ADV_NAME
// exactly — these are this app's own UUIDs (not the GLM 50C's Bosch-protocol ones
// useBLEDevice.ts uses), generated for this feature.
const PROVISION_SERVICE_UUID     = "6f0eaf00-2e33-4c60-9b1a-8f0a2f2b6a01";
const PROVISION_CONFIG_CHAR_UUID = "6f0eaf00-2e33-4c60-9b1a-8f0a2f2b6a02";
const PROVISION_STATUS_CHAR_UUID = "6f0eaf00-2e33-4c60-9b1a-8f0a2f2b6a03";
const PROVISIONING_ADV_NAME      = "SCARNERGY-ESP32-SETUP";

export type ProvisioningState = "idle" | "scanning" | "connecting" | "connected" | "writing" | "done" | "error";

export interface ProvisionConfig {
  ssid: string;
  password: string;
  mqttHost: string;
  mqttPort: number;
  orgId: string;
  deviceId: string;
}

// Flat (non-discriminated-union) shape deliberately — `message` is just
// unused/empty on success. Callers check `.ok` and read `.message` only to
// display it; a two-branch union here bought nothing but narrowing friction.
export interface ProvisionResult {
  ok: boolean;
  message: string;
}

// Deliberately separate from useBLEDevice.ts (GLM measurement hook) — that
// hook is hardcoded end-to-end for the Bosch GLM 50C's protocol (fixed
// UUIDs, packet decoder, measurement dispatch) and isn't a fit for a
// one-shot "write config, wait for ack" flow against a different
// peripheral. Shares only the same permission-request/adapter-ready
// pattern. Owns its own BleManager instance, created/destroyed with this
// hook's lifecycle (the provisioning screen), rather than reusing the
// app-wide BLEContext instance — the two never need to run concurrently.
export function useESP32Provisioning() {
  const managerRef = useRef<BleManager | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const stateRef = useRef<ProvisioningState>("idle");

  const [state, setStateRaw] = useState<ProvisioningState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  // The BLE peripheral's own id (MAC on Android, a per-app UUID on iOS) —
  // exposed so the caller can register it in `ble_devices.mac_address`.
  const [deviceMac, setDeviceMac] = useState<string | null>(null);

  const setState = useCallback((s: ProvisioningState) => {
    stateRef.current = s;
    setStateRaw(s);
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

  const waitForPoweredOn = (manager: BleManager, timeoutMs = 5_000): Promise<BleAdapterState> =>
    new Promise(resolve => {
      let settled = false;
      const finish = (s: BleAdapterState) => {
        if (settled) return;
        settled = true;
        sub.remove();
        clearTimeout(timer);
        resolve(s);
      };
      const sub = manager.onStateChange(s => {
        if (s !== BleAdapterState.Unknown && s !== BleAdapterState.Resetting) finish(s);
      }, true);
      const timer = setTimeout(() => finish(BleAdapterState.Unknown), timeoutMs);
    });

  const ensureManager = (): BleManager | null => {
    if (isExpoGo) {
      setErrorMessage("Bluetooth is not available in Expo Go. Use a development build.");
      setState("error");
      return null;
    }
    if (!managerRef.current) {
      try {
        managerRef.current = new BleManager();
      } catch (e: any) {
        setErrorMessage(`Bluetooth init failed: ${e?.message ?? e}`);
        setState("error");
        return null;
      }
    }
    return managerRef.current;
  };

  // Scans for an unprovisioned ESP32 (advertising PROVISIONING_ADV_NAME),
  // connects, writes the JSON config to the config characteristic, and
  // waits for the status characteristic's ack/error notification.
  const provision = useCallback(async (config: ProvisionConfig): Promise<ProvisionResult> => {
    const manager = ensureManager();
    if (!manager) return { ok: false, message: errorMessage ?? "Bluetooth unavailable" };

    const granted = await requestPermissions();
    if (!granted) {
      setErrorMessage("Bluetooth permissions denied");
      setState("error");
      return { ok: false, message: "Bluetooth permissions denied" };
    }

    const adapterState = await waitForPoweredOn(manager);
    if (adapterState !== BleAdapterState.PoweredOn) {
      const msg = adapterState === BleAdapterState.PoweredOff
        ? "Bluetooth is turned off — enable it and try again."
        : `Bluetooth is not ready (state: ${adapterState}).`;
      setErrorMessage(msg);
      setState("error");
      return { ok: false, message: msg };
    }

    setState("scanning");
    setErrorMessage(null);

    const device = await new Promise<Device | null>(resolve => {
      manager.startDeviceScan(null, { allowDuplicates: false }, (error, found) => {
        if (error) {
          manager.stopDeviceScan();
          resolve(null);
          return;
        }
        const name = found?.name?.toUpperCase() ?? "";
        if (found && name.includes(PROVISIONING_ADV_NAME)) {
          manager.stopDeviceScan();
          resolve(found);
        }
      });
      setTimeout(() => {
        manager.stopDeviceScan();
        resolve(null);
      }, 15_000);
    });

    if (!device) {
      const msg = "No unprovisioned ESP32 found — make sure it's powered on and hasn't already been configured.";
      setErrorMessage(msg);
      setState("error");
      return { ok: false, message: msg };
    }

    setState("connecting");
    try {
      const connected = await device.connect({ autoConnect: false });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setDeviceName(connected.name ?? "ESP32");
      setDeviceMac(connected.id);
      setState("connected");

      const ackPromise = new Promise<ProvisionResult>((resolve) => {
        connected.monitorCharacteristicForService(PROVISION_SERVICE_UUID, PROVISION_STATUS_CHAR_UUID, (err, ch) => {
          if (err || !ch?.value) return;
          try {
            const json = decodeURIComponent(escape(atob(ch.value)));
            const parsed = JSON.parse(json);
            if (parsed.status === "ok") resolve({ ok: true, message: "" });
            else resolve({ ok: false, message: parsed.message ?? "Device rejected the config" });
          } catch {
            resolve({ ok: false, message: "Could not parse the device's response" });
          }
        });
      });

      setState("writing");
      const payload = JSON.stringify({
        ssid: config.ssid, password: config.password,
        mqtt_host: config.mqttHost, mqtt_port: config.mqttPort,
        org_id: config.orgId, device_id: config.deviceId,
      });
      const base64Payload = btoa(unescape(encodeURIComponent(payload)));
      await connected.writeCharacteristicWithResponseForService(PROVISION_SERVICE_UUID, PROVISION_CONFIG_CHAR_UUID, base64Payload);

      const result = await Promise.race([
        ackPromise,
        new Promise<ProvisionResult>(resolve =>
          setTimeout(() => resolve({ ok: false, message: "Timed out waiting for the device to confirm" }), 10_000)
        ),
      ]);

      if (result.ok) {
        setState("done");
      } else {
        setState("error");
        setErrorMessage(result.message);
      }
      return result;
    } catch (e: any) {
      const msg = e?.message ?? "Could not provision this device";
      setErrorMessage(msg);
      setState("error");
      return { ok: false, message: msg };
    }
  }, [errorMessage, setState]);

  const reset = useCallback(() => {
    deviceRef.current?.cancelConnection().catch(() => {});
    deviceRef.current = null;
    setErrorMessage(null);
    setState("idle");
  }, [setState]);

  return { state, errorMessage, deviceName, deviceMac, provision, reset };
}
