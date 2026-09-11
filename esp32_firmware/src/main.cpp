/*
 * SCARNERGY v2.0 — ESP32 BLE Bridge Firmware
 * Bosch GLM 50C BLE → WiFi → MQTT gateway, with BLE provisioning (M7)
 *
 * Hardware: ESP32-WROOM-32
 * Framework: PlatformIO + NimBLE (50% less RAM than Bluedroid)
 * Build: pio run --target upload
 *
 * NOTE: the provisioning section below (loadConfig/saveConfigAndReboot/
 * ProvisionConfigCallback/startProvisioningServer, plus the setup()/loop()/
 * setupWiFi()/reconnectMQTT() changes that read from it) was written and
 * reviewed but NOT compiled — this dev environment has no PlatformIO CLI.
 * `pio run` (and a real BLE round-trip against a physical unit) is the
 * actual verification gate before flashing a fleet.
 */

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>

// ─── Configuration ────────────────────────────────────────────────────────────
// Compiled-in fallbacks only — a unit that has never been provisioned over
// BLE (see the Provisioning section below) uses these; once provisioned,
// runtime config loaded from NVS (Preferences) always takes precedence,
// even across reflashes with different defaults here.

#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"
#define MQTT_HOST       "192.168.1.100"   // Local broker IP
#define MQTT_PORT       1883
#define ORG_ID          "00000000-0000-0000-0000-000000000001"
#define DEVICE_ID       "d0000000-0000-0000-0000-000000000001"

// GLM 50C BLE UUIDs
#define GLM_SERVICE_UUID      "00001523-1212-efde-1523-785feabcd123"
#define GLM_NOTIFY_CHAR_UUID  "00001524-1212-efde-1523-785feabcd123"
#define GLM_WRITE_CHAR_UUID   "00001525-1212-efde-1523-785feabcd123"

// MQTT topic: scarnergy/{org_id}/devices/{device_id}/measurements
#define MQTT_TOPIC_TEMPLATE  "scarnergy/%s/devices/%s/measurements"
#define MQTT_CLIENT_ID       "scarnergy-esp32"
#define MQTT_QOS             1

// Watchdog timeout (seconds)
#define WDT_TIMEOUT          30

// ─── Provisioning (BLE GATT server, NVS-backed) ──────────────────────────────
// Standard ESP32 BLE-provisioning pattern: an unprovisioned unit advertises
// as a distinct BLE peripheral (PROVISIONING_ADV_NAME) exposing one config
// characteristic (write JSON: ssid/password/mqtt_host/mqtt_port/org_id/
// device_id) and one status characteristic (notify ok/error back to the
// phone app). A valid write persists to NVS and reboots into normal
// operation. CONFIG_BT_NIMBLE_MAX_CONNECTIONS=1 (platformio.ini) means the
// provisioning-server role and the GLM-client role never run
// concurrently — decided by the `provisioned` flag at boot, not a runtime
// switch — so that build flag (and its RAM budget) is untouched.
//
// Own UUIDs (distinct from the GLM 50C's, which belong to Bosch's protocol,
// not this app) — generated for this feature, not reused from anywhere.
#define PROVISION_SERVICE_UUID      "6f0eaf00-2e33-4c60-9b1a-8f0a2f2b6a01"
#define PROVISION_CONFIG_CHAR_UUID  "6f0eaf00-2e33-4c60-9b1a-8f0a2f2b6a02"
#define PROVISION_STATUS_CHAR_UUID  "6f0eaf00-2e33-4c60-9b1a-8f0a2f2b6a03"
#define PROVISIONING_ADV_NAME       "Scarnergy-ESP32-Setup"

// After this many consecutive setupWiFi() failures, assume the stored
// credentials are wrong (not just a transient outage) and drop back into
// provisioning mode — recovers a misconfigured unit over BLE instead of
// requiring a USB reflash in the field.
#define WIFI_FAIL_THRESHOLD  5

Preferences prefs;
String   cfgWifiSsid, cfgWifiPassword, cfgMqttHost, cfgOrgId, cfgDeviceId;
uint16_t cfgMqttPort  = MQTT_PORT;
bool     provisioned  = false;

NimBLEServer*         provisionServer = nullptr;
NimBLECharacteristic*  provisionStatusChar = nullptr;

void notifyProvisionStatus(const char* json) {
  if (!provisionStatusChar) return;
  provisionStatusChar->setValue(json);
  provisionStatusChar->notify();
}

// Loads runtime config from NVS, falling back to the compiled #defines for
// any key that's never been set — so a freshly-flashed-but-not-yet-
// provisioned unit still has a value for every field (used only while
// `provisioned` is false and setup() is deciding which mode to enter; once
// provisioned, every field below is expected to have been written by
// saveConfigAndReboot()).
void loadConfig() {
  prefs.begin("scarnergy", true);
  provisioned    = prefs.getBool("provisioned", false);
  cfgWifiSsid    = prefs.getString("wifi_ssid", WIFI_SSID);
  cfgWifiPassword = prefs.getString("wifi_pw", WIFI_PASSWORD);
  cfgMqttHost    = prefs.getString("mqtt_host", MQTT_HOST);
  cfgMqttPort    = (uint16_t)prefs.getUInt("mqtt_port", MQTT_PORT);
  cfgOrgId       = prefs.getString("org_id", ORG_ID);
  cfgDeviceId    = prefs.getString("device_id", DEVICE_ID);
  prefs.end();
}

void saveConfigAndReboot(const String& ssid, const String& password, const String& mqttHost,
                          uint16_t mqttPort, const String& orgId, const String& deviceId) {
  prefs.begin("scarnergy", false);
  prefs.putBool("provisioned", true);
  prefs.putString("wifi_ssid", ssid);
  prefs.putString("wifi_pw", password);
  prefs.putString("mqtt_host", mqttHost);
  prefs.putUInt("mqtt_port", mqttPort);
  prefs.putString("org_id", orgId);
  prefs.putString("device_id", deviceId);
  prefs.putUInt("wifi_fail_count", 0);
  prefs.end();
  Serial.println("[PROVISION] Config saved — rebooting into normal operation");
  delay(300);
  ESP.restart();
}

// Called from setupWiFi() on failure. Only clears `provisioned` (dropping
// back into BLE setup mode on the next boot) once WIFI_FAIL_THRESHOLD
// consecutive failures have accumulated — a single flaky reconnect
// shouldn't throw away good credentials.
void recordWifiFailureAndMaybeReprovision() {
  prefs.begin("scarnergy", false);
  uint32_t fails = prefs.getUInt("wifi_fail_count", 0) + 1;
  if (fails >= WIFI_FAIL_THRESHOLD) {
    Serial.println("[WiFi] Too many consecutive failures — clearing provisioning, will re-enter setup mode");
    prefs.putBool("provisioned", false);
    prefs.putUInt("wifi_fail_count", 0);
  } else {
    prefs.putUInt("wifi_fail_count", fails);
    Serial.printf("[WiFi] Failure %u/%u\n", fails, (unsigned)WIFI_FAIL_THRESHOLD);
  }
  prefs.end();
}

class ProvisionConfigCallback : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar) override {
    std::string raw = pChar->getValue();
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, raw);
    if (err) {
      Serial.printf("[PROVISION] Invalid JSON: %s\n", err.c_str());
      notifyProvisionStatus("{\"status\":\"error\",\"message\":\"invalid JSON\"}");
      return;
    }

    const char* ssid     = doc["ssid"];
    const char* password = doc["password"];
    const char* mqttHost = doc["mqtt_host"];
    const char* orgId    = doc["org_id"];
    const char* deviceId = doc["device_id"];
    int mqttPort = doc["mqtt_port"] | MQTT_PORT;

    if (!ssid || !password || !mqttHost || !orgId || !deviceId) {
      Serial.println("[PROVISION] Missing required field in config write");
      notifyProvisionStatus("{\"status\":\"error\",\"message\":\"missing required field\"}");
      return;
    }

    Serial.printf("[PROVISION] Received config for SSID '%s', org %s\n", ssid, orgId);
    notifyProvisionStatus("{\"status\":\"ok\"}");
    // Give the notification a moment to actually go out over BLE before
    // this device disappears mid-restart.
    delay(200);
    saveConfigAndReboot(ssid, password, mqttHost, (uint16_t)mqttPort, orgId, deviceId);
  }
};

void startProvisioningServer() {
  NimBLEDevice::init(PROVISIONING_ADV_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

  provisionServer = NimBLEDevice::createServer();
  NimBLEService* svc = provisionServer->createService(PROVISION_SERVICE_UUID);

  NimBLECharacteristic* configChar =
    svc->createCharacteristic(PROVISION_CONFIG_CHAR_UUID, NIMBLE_PROPERTY::WRITE);
  configChar->setCallbacks(new ProvisionConfigCallback());

  provisionStatusChar =
    svc->createCharacteristic(PROVISION_STATUS_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(PROVISION_SERVICE_UUID);
  adv->start();

  Serial.println("[PROVISION] Advertising as \"" PROVISIONING_ADV_NAME "\" — waiting for config over BLE...");
}

// ─── Globals ──────────────────────────────────────────────────────────────────

WiFiClient       wifiClient;
PubSubClient     mqttClient(wifiClient);
NimBLEClient*    bleClient   = nullptr;
NimBLEScan*      bleScan     = nullptr;
bool             bleConnected = false;
bool             scanning     = false;
char             mqttTopic[128];
uint32_t         measurementCount = 0;
uint32_t         lastBatteryReport = 0;

// ─── BLE Notification Callback ───────────────────────────────────────────────

class MeasurementCallback : public NimBLEClientCallbacks {
  void onDisconnect(NimBLEClient* client) override {
    Serial.println("[BLE] Disconnected from GLM");
    bleConnected = false;
  }
};

void onNotification(NimBLERemoteCharacteristic* pChar, uint8_t* data, size_t length, bool isNotify) {
  if (length != 10) {
    Serial.printf("[BLE] Unexpected packet length: %d\n", length);
    return;
  }

  uint8_t packetType = data[0];
  if (packetType != 0x00) return;  // Only process measurement packets

  uint8_t statusFlags = data[1];
  bool hasError = statusFlags & 0x04;
  if (hasError) {
    Serial.println("[BLE] Error flag in measurement packet");
    return;
  }

  // 32-bit little-endian value in 0.1mm units
  uint32_t rawValue;
  memcpy(&rawValue, data + 2, 4);
  float valueMm = rawValue / 10.0f;

  uint8_t batteryLevel = data[7];
  bool isContinuous = statusFlags & 0x02;

  Serial.printf("[GLM] %.1f mm | battery: %d%% | continuous: %s\n",
    valueMm, batteryLevel, isContinuous ? "yes" : "no");

  // Build JSON payload
  StaticJsonDocument<256> doc;
  doc["value_mm"]       = valueMm;
  doc["unit"]           = "mm";
  doc["org_id"]         = cfgOrgId;
  doc["device_id"]      = cfgDeviceId;
  doc["ingestion_path"] = "esp32";
  doc["battery_level"]  = batteryLevel;
  doc["is_continuous"]  = isContinuous;
  doc["sequence"]       = ++measurementCount;

  // ISO timestamp (millis since boot — real time requires NTP)
  doc["millis"] = millis();

  char rawHex[21];
  snprintf(rawHex, sizeof(rawHex),
    "%02x%02x%02x%02x%02x%02x%02x%02x%02x%02x",
    data[0], data[1], data[2], data[3], data[4],
    data[5], data[6], data[7], data[8], data[9]);
  doc["raw_ble_bytes"] = rawHex;

  char payload[256];
  serializeJson(doc, payload);

  if (mqttClient.connected()) {
    bool published = mqttClient.publish(mqttTopic, payload, MQTT_QOS);
    if (!published) {
      Serial.println("[MQTT] Publish failed — buffer full?");
    }
  } else {
    Serial.println("[MQTT] Not connected — measurement dropped");
  }
}

// ─── BLE Connection ──────────────────────────────────────────────────────────

bool connectToGLM(NimBLEAdvertisedDevice* device) {
  Serial.printf("[BLE] Connecting to %s...\n", device->getAddress().toString().c_str());

  bleClient = NimBLEDevice::createClient();
  bleClient->setClientCallbacks(new MeasurementCallback());
  bleClient->setConnectionParams(12, 12, 0, 200);  // min, max, latency, timeout

  if (!bleClient->connect(device)) {
    Serial.println("[BLE] Connection failed");
    NimBLEDevice::deleteClient(bleClient);
    return false;
  }

  Serial.println("[BLE] Connected ✓");

  NimBLERemoteService* service = bleClient->getService(GLM_SERVICE_UUID);
  if (!service) {
    Serial.println("[BLE] GLM service not found");
    bleClient->disconnect();
    return false;
  }

  NimBLERemoteCharacteristic* notifyChar = service->getCharacteristic(GLM_NOTIFY_CHAR_UUID);
  NimBLERemoteCharacteristic* writeChar  = service->getCharacteristic(GLM_WRITE_CHAR_UUID);

  if (!notifyChar || !writeChar) {
    Serial.println("[BLE] Required characteristics not found");
    bleClient->disconnect();
    return false;
  }

  // Subscribe to notifications
  notifyChar->subscribe(true, onNotification);

  // Activate device and set unit to mm
  uint8_t cmdActivate[] = {0x01, 0x00};
  uint8_t cmdUnitMm[]   = {0x01, 0x01};
  writeChar->writeValue(cmdActivate, 2);
  delay(200);
  writeChar->writeValue(cmdUnitMm, 2);

  bleConnected = true;
  Serial.println("[BLE] GLM activated, notifications enabled");
  return true;
}

// ─── BLE Scan Callback ───────────────────────────────────────────────────────

class ScanCallback : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* device) override {
    const char* name = device->getName().c_str();
    if (strstr(name, "GLM") || strstr(name, "Bosch")) {
      Serial.printf("[SCAN] Found GLM device: %s (%s)\n", name, device->getAddress().toString().c_str());
      NimBLEDevice::getScan()->stop();
      connectToGLM(device);
    }
  }
};

// ─── WiFi + MQTT Setup ───────────────────────────────────────────────────────

void setupWiFi() {
  Serial.printf("[WiFi] Connecting to %s", cfgWifiSsid.c_str());
  WiFi.begin(cfgWifiSsid.c_str(), cfgWifiPassword.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection failed — restarting...");
    recordWifiFailureAndMaybeReprovision();
    ESP.restart();
  }
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.printf("[MQTT] Connecting to %s:%d...\n", cfgMqttHost.c_str(), cfgMqttPort);
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println("[MQTT] Connected ✓");
      // Subscribe to OTA topic
      char otaTopic[64];
      snprintf(otaTopic, sizeof(otaTopic), "scarnergy/%s/esp32/ota", cfgOrgId.c_str());
      mqttClient.subscribe(otaTopic);
    } else {
      Serial.printf("[MQTT] Failed (rc=%d) — retry in 5s\n", mqttClient.state());
      delay(5000);
    }
  }
}

// ─── Setup & Loop ────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Scarnergy ESP32 BLE Bridge v2.0 ===");

  // Watchdog
  esp_task_wdt_init(WDT_TIMEOUT, true);
  esp_task_wdt_add(NULL);

  loadConfig();

  if (!provisioned) {
    Serial.println("[SETUP] Not provisioned — entering BLE provisioning mode");
    startProvisioningServer();
    return;  // loop() stays idle; NimBLE's own event handling runs the GATT server
  }

  // Build MQTT topic
  snprintf(mqttTopic, sizeof(mqttTopic), MQTT_TOPIC_TEMPLATE, cfgOrgId.c_str(), cfgDeviceId.c_str());
  Serial.printf("[MQTT] Topic: %s\n", mqttTopic);

  // WiFi
  setupWiFi();

  // MQTT
  mqttClient.setServer(cfgMqttHost.c_str(), cfgMqttPort);
  mqttClient.setBufferSize(512);
  reconnectMQTT();

  // BLE (GLM client role only — the provisioning GATT server from above is
  // never started on this path, keeping exactly one BLE role active per
  // CONFIG_BT_NIMBLE_MAX_CONNECTIONS=1)
  NimBLEDevice::init("Scarnergy-ESP32");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);  // Max TX power for range

  bleScan = NimBLEDevice::getScan();
  bleScan->setAdvertisedDeviceCallbacks(new ScanCallback());
  bleScan->setActiveScan(true);
  bleScan->setInterval(100);
  bleScan->setWindow(99);

  Serial.println("[SCAN] Starting GLM scan...");
  bleScan->start(10, false);  // 10s scan, non-blocking
}

void loop() {
  esp_task_wdt_reset();

  if (!provisioned) {
    // Provisioning GATT server runs entirely on NimBLE's own event/callback
    // path — nothing to poll here.
    delay(100);
    return;
  }

  // Keep MQTT alive
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // Reconnect BLE if disconnected
  if (!bleConnected && !scanning) {
    Serial.println("[BLE] Not connected — scanning...");
    scanning = true;
    bleScan->start(10, [](NimBLEScanResults results) {
      scanning = false;
    });
  }

  delay(10);
}
