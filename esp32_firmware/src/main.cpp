/*
 * SCARNERGY v2.0 — ESP32 BLE Bridge Firmware
 * Bosch GLM 50C BLE → WiFi → MQTT gateway
 *
 * Hardware: ESP32-WROOM-32
 * Framework: PlatformIO + NimBLE (50% less RAM than Bluedroid)
 * Build: pio run --target upload
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
// Edit these or provision via BLE config characteristic

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
  doc["org_id"]         = ORG_ID;
  doc["device_id"]      = DEVICE_ID;
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
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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
    ESP.restart();
  }
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.printf("[MQTT] Connecting to %s:%d...\n", MQTT_HOST, MQTT_PORT);
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println("[MQTT] Connected ✓");
      // Subscribe to OTA topic
      char otaTopic[64];
      snprintf(otaTopic, sizeof(otaTopic), "scarnergy/%s/esp32/ota", ORG_ID);
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

  // Build MQTT topic
  snprintf(mqttTopic, sizeof(mqttTopic), MQTT_TOPIC_TEMPLATE, ORG_ID, DEVICE_ID);
  Serial.printf("[MQTT] Topic: %s\n", mqttTopic);

  // WiFi
  setupWiFi();

  // MQTT
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(512);
  reconnectMQTT();

  // BLE
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
