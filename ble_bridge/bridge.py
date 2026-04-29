"""
SCARNERGY v2.0 — Python BLE Bridge
Connects to up to 5 Bosch GLM 50C devices simultaneously.
Broadcasts measurements through 3 output channels:
  1. WebSocket server (port 8765)
  2. MQTT publisher
  3. Direct Supabase write

Usage:
    python bridge.py --org-id <uuid> --device-id <uuid>

Requirements:
    pip install bleak asyncio-mqtt websockets supabase python-dotenv
"""

import asyncio
import json
import logging
import signal
import uuid
from datetime import datetime, timezone
from typing import Optional
import argparse
import os

from bleak import BleakClient, BleakScanner, BleakError
from bleak.backends.device import BLEDevice
import websockets
from asyncio_mqtt import Client as MQTTClient
from supabase import create_client, Client as SupabaseClient
from dotenv import load_dotenv

from glm_protocol import (
    SERVICE_UUID, CHAR_NOTIFY_UUID, CHAR_WRITE_UUID,
    CMD_ACTIVATE, CMD_UNIT_MM,
    decode_packet, validate_measurement, GLMMeasurement,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("scarnergy.bridge")

MAX_DEVICES      = 5
WS_PORT          = 8765
RECONNECT_BASE   = 1.0    # seconds
RECONNECT_MAX    = 30.0   # seconds
MQTT_TOPIC_BASE  = "scarnergy"


class ScarnergyBridge:
    def __init__(
        self,
        org_id: str,
        supabase_url: str,
        supabase_key: str,
        mqtt_host: str = "localhost",
        mqtt_port: int = 1883,
        session_id: Optional[str] = None,
        inspector_id: Optional[str] = None,
    ):
        self.org_id       = org_id
        self.session_id   = session_id
        self.inspector_id = inspector_id
        self.mqtt_host    = mqtt_host
        self.mqtt_port    = mqtt_port

        self.supabase: SupabaseClient = create_client(supabase_url, supabase_key)
        self.ws_clients: set = set()
        self.connected_devices: dict[str, BleakClient] = {}  # mac -> client
        self.device_info: dict[str, dict] = {}               # mac -> {device_id, nickname}
        self.measurement_queue: asyncio.Queue = asyncio.Queue()
        self._running = True

    # ─── DEVICE DISCOVERY ───────────────────────────────────────────────────

    async def scan_for_glm_devices(self, timeout: float = 10.0) -> list[BLEDevice]:
        """Scan for nearby Bosch GLM 50C devices."""
        logger.info(f"Scanning for GLM devices ({timeout}s)...")
        devices = await BleakScanner.discover(timeout=timeout)
        glm_devices = [
            d for d in devices
            if d.name and ("GLM" in d.name or "Bosch" in d.name)
        ]
        logger.info(f"Found {len(glm_devices)} GLM device(s): {[d.address for d in glm_devices]}")
        return glm_devices

    # ─── DEVICE CONNECTION ───────────────────────────────────────────────────

    async def connect_device(self, mac_address: str, device_id: str, nickname: str = "GLM"):
        """Connect to a GLM device with exponential backoff reconnection."""
        delay = RECONNECT_BASE
        attempt = 0

        while self._running:
            attempt += 1
            try:
                logger.info(f"[{nickname}] Connecting to {mac_address} (attempt {attempt})...")
                async with BleakClient(mac_address, timeout=20.0) as client:
                    logger.info(f"[{nickname}] Connected ✓ (RSSI: {client.rssi})")
                    self.connected_devices[mac_address] = client
                    self.device_info[mac_address] = {"device_id": device_id, "nickname": nickname}
                    delay = RECONNECT_BASE  # reset on successful connection

                    # Activate device and set unit to mm
                    await client.write_gatt_char(CHAR_WRITE_UUID, CMD_ACTIVATE)
                    await asyncio.sleep(0.2)
                    await client.write_gatt_char(CHAR_WRITE_UUID, CMD_UNIT_MM)

                    # Subscribe to notifications
                    await client.start_notify(
                        CHAR_NOTIFY_UUID,
                        lambda _, data: asyncio.create_task(
                            self._on_notification(mac_address, data)
                        )
                    )

                    # Update device last_connected_at in DB
                    self.supabase.table("ble_devices").update({
                        "last_connected_at": datetime.now(timezone.utc).isoformat()
                    }).eq("id", device_id).execute()

                    # Keep alive until disconnect
                    while self._running and client.is_connected:
                        await asyncio.sleep(1.0)

                    logger.warning(f"[{nickname}] Disconnected")

            except BleakError as e:
                logger.error(f"[{nickname}] BLE error: {e}")
            except Exception as e:
                logger.error(f"[{nickname}] Unexpected error: {e}")
            finally:
                self.connected_devices.pop(mac_address, None)

            if not self._running:
                break

            logger.info(f"[{nickname}] Reconnecting in {delay:.1f}s...")
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)

    # ─── MEASUREMENT HANDLING ────────────────────────────────────────────────

    async def _on_notification(self, mac_address: str, data: bytes):
        """Called on every BLE notification from any connected device."""
        measurement = decode_packet(data)
        if measurement is None:
            return

        info = self.device_info.get(mac_address, {})
        is_valid, reason = validate_measurement(measurement.value_mm)

        payload = {
            "id": str(uuid.uuid4()),
            "measured_at": datetime.now(timezone.utc).isoformat(),
            "org_id": self.org_id,
            "session_id": self.session_id,
            "device_id": info.get("device_id"),
            "inspector_id": self.inspector_id,
            "value_mm": measurement.value_mm,
            "unit": "mm",
            "ingestion_path": "python_bridge",
            "is_anomaly": not is_valid,
            "battery_level": measurement.battery_level,
            "raw_ble_bytes": measurement.raw_bytes.hex(),
            "mac_address": mac_address,
            "device_nickname": info.get("nickname", "GLM"),
        }

        if not is_valid:
            logger.warning(f"[{info.get('nickname')}] Anomaly: {reason} ({measurement.value_mm}mm)")
            payload["validation_message"] = reason

        logger.info(f"[{info.get('nickname', mac_address)}] {measurement.value_mm:.1f}mm {'⚠' if not is_valid else '✓'}")

        await self.measurement_queue.put(payload)

    async def _broadcast_worker(self):
        """Drain the queue and fan out to all 3 channels simultaneously."""
        async with MQTTClient(self.mqtt_host, self.mqtt_port) as mqtt:
            logger.info(f"MQTT connected to {self.mqtt_host}:{self.mqtt_port}")
            while self._running:
                try:
                    payload = await asyncio.wait_for(self.measurement_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                await asyncio.gather(
                    self._publish_websocket(payload),
                    self._publish_mqtt(mqtt, payload),
                    self._write_supabase(payload),
                    return_exceptions=True,
                )

    async def _publish_websocket(self, payload: dict):
        """Broadcast to all connected WebSocket clients."""
        if not self.ws_clients:
            return
        message = json.dumps(payload)
        dead = set()
        for ws in self.ws_clients:
            try:
                await ws.send(message)
            except Exception:
                dead.add(ws)
        self.ws_clients -= dead

    async def _publish_mqtt(self, mqtt: MQTTClient, payload: dict):
        """Publish to MQTT topic: scarnergy/{org_id}/devices/{device_id}/measurements"""
        device_id = payload.get("device_id", "unknown")
        topic = f"{MQTT_TOPIC_BASE}/{self.org_id}/devices/{device_id}/measurements"
        await mqtt.publish(topic, json.dumps(payload), qos=1)

    async def _write_supabase(self, payload: dict):
        """Write directly to the measurements hypertable."""
        if not self.session_id or not self.inspector_id:
            return
        try:
            row = {
                "id": payload["id"],
                "measured_at": payload["measured_at"],
                "org_id": payload["org_id"],
                "session_id": payload["session_id"],
                "device_id": payload["device_id"],
                "inspector_id": payload["inspector_id"],
                "value_mm": payload["value_mm"],
                "unit": "mm",
                "ingestion_path": "python_bridge",
                "is_anomaly": payload["is_anomaly"],
                "raw_ble_bytes": payload["raw_ble_bytes"],
                "client_timestamp": payload["measured_at"],
            }
            self.supabase.table("measurements").insert(row).execute()
        except Exception as e:
            logger.error(f"Supabase write error: {e}")

    # ─── WEBSOCKET SERVER ────────────────────────────────────────────────────

    async def _ws_handler(self, websocket, path):
        self.ws_clients.add(websocket)
        logger.info(f"WS client connected ({len(self.ws_clients)} total)")
        try:
            await websocket.wait_closed()
        finally:
            self.ws_clients.discard(websocket)
            logger.info(f"WS client disconnected ({len(self.ws_clients)} remaining)")

    # ─── MAIN RUN ────────────────────────────────────────────────────────────

    async def run(self, devices: list[dict]):
        """
        devices: list of {"mac_address": str, "device_id": str, "nickname": str}
        """
        if len(devices) > MAX_DEVICES:
            raise ValueError(f"Maximum {MAX_DEVICES} devices supported")

        logger.info(f"Starting Scarnergy BLE Bridge — {len(devices)} device(s)")

        # WebSocket server
        ws_server = await websockets.serve(self._ws_handler, "0.0.0.0", WS_PORT)
        logger.info(f"WebSocket server listening on ws://0.0.0.0:{WS_PORT}")

        tasks = [
            asyncio.create_task(self._broadcast_worker()),
            *[
                asyncio.create_task(
                    self.connect_device(d["mac_address"], d["device_id"], d.get("nickname", "GLM"))
                )
                for d in devices
            ]
        ]

        def _stop(sig, _):
            logger.info(f"Signal {sig.name} received — shutting down...")
            self._running = False
            for t in tasks:
                t.cancel()

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda s=sig: _stop(s, None))

        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            ws_server.close()
            await ws_server.wait_closed()
            logger.info("Bridge shut down cleanly.")


# ─── ENTRY POINT ──────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Scarnergy BLE Bridge")
    parser.add_argument("--org-id",       required=True,  help="Organisation UUID")
    parser.add_argument("--session-id",   default=None,   help="Active inspection session UUID")
    parser.add_argument("--inspector-id", default=None,   help="Inspector user UUID")
    parser.add_argument("--mqtt-host",    default="localhost")
    parser.add_argument("--mqtt-port",    default=1883, type=int)
    parser.add_argument("--scan",         action="store_true", help="Scan for devices and exit")
    args = parser.parse_args()

    supabase_url = os.getenv("SUPABASE_URL", "http://localhost:54321")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    bridge = ScarnergyBridge(
        org_id=args.org_id,
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        mqtt_host=args.mqtt_host,
        mqtt_port=args.mqtt_port,
        session_id=args.session_id,
        inspector_id=args.inspector_id,
    )

    if args.scan:
        devices = await bridge.scan_for_glm_devices()
        for d in devices:
            print(f"  {d.address}  {d.name}")
        return

    # Load devices from Supabase
    result = bridge.supabase.table("ble_devices") \
        .select("id,mac_address,nickname") \
        .eq("org_id", args.org_id) \
        .eq("is_active", True) \
        .execute()

    devices = [
        {"mac_address": d["mac_address"], "device_id": d["id"], "nickname": d["nickname"] or "GLM"}
        for d in (result.data or [])
    ]

    if not devices:
        logger.error("No active devices found for this org. Register devices first.")
        return

    await bridge.run(devices)


if __name__ == "__main__":
    asyncio.run(main())
