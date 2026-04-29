"""
SCARNERGY v2.0 — MQTT → Supabase Bridge
Subscribes to all measurement topics and writes to TimescaleDB.
Handles measurements from ESP32 and Python bridge that wrote to MQTT
but not directly to Supabase (e.g. when Supabase was unreachable).

Run: python mqtt_bridge.py
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from asyncio_mqtt import Client as MQTTClient
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("scarnergy.mqtt_bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")

TOPIC_FILTER = "scarnergy/+/devices/+/measurements"


async def main():
    supabase = create_client(
        os.getenv("SUPABASE_URL", "http://localhost:54321"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
    )
    mqtt_host = os.getenv("MQTT_HOST", "localhost")
    mqtt_port = int(os.getenv("MQTT_PORT", 1883))

    logger.info(f"Connecting to MQTT broker at {mqtt_host}:{mqtt_port}")

    async with MQTTClient(mqtt_host, mqtt_port, client_id="scarnergy-db-bridge") as client:
        logger.info("MQTT connected ✓")
        await client.subscribe(TOPIC_FILTER, qos=1)
        logger.info(f"Subscribed to: {TOPIC_FILTER}")

        async with client.messages() as messages:
            async for message in messages:
                try:
                    payload = json.loads(message.payload)
                    await handle_measurement(supabase, payload, str(message.topic))
                except Exception as e:
                    logger.error(f"Error processing message: {e}")


async def handle_measurement(supabase, payload: dict, topic: str):
    # Deduplicate: skip if ID already in DB
    if existing_id := payload.get("id"):
        result = supabase.table("measurements").select("id").eq("id", existing_id).execute()
        if result.data:
            logger.debug(f"Skipping duplicate measurement {existing_id}")
            return

    row = {
        "id":             payload.get("id"),
        "measured_at":    payload.get("measured_at", datetime.now(timezone.utc).isoformat()),
        "org_id":         payload["org_id"],
        "session_id":     payload.get("session_id"),
        "device_id":      payload.get("device_id"),
        "inspector_id":   payload.get("inspector_id"),
        "value_mm":       payload["value_mm"],
        "unit":           payload.get("unit", "mm"),
        "ingestion_path": payload.get("ingestion_path", "mqtt_bridge"),
        "is_anomaly":     payload.get("is_anomaly", False),
        "client_timestamp": payload.get("measured_at"),
    }

    # Filter out None values
    row = {k: v for k, v in row.items() if v is not None}

    # Require minimum fields
    if not row.get("org_id") or not row.get("value_mm"):
        logger.warning(f"Skipping incomplete measurement from {topic}")
        return

    try:
        supabase.table("measurements").insert(row).execute()
        logger.info(f"Stored: {row['value_mm']}mm from {topic}")
    except Exception as e:
        logger.error(f"DB write error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
