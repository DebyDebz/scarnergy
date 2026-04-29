"""
SCARNERGY v2.0 — Bosch GLM 50C BLE Protocol
Reverse-engineered protocol based on ketan/Bosch-GLM50C-Rangefinder.
Handles BLE characteristic decoding, command encoding, and measurement parsing.
"""

import struct
from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# ─── BLE UUIDs ────────────────────────────────────────────────────────────────

# Bosch GLM 50C custom BLE service
SERVICE_UUID        = "00001523-1212-efde-1523-785feabcd123"
# Notify characteristic — measurement data arrives here
CHAR_NOTIFY_UUID    = "00001524-1212-efde-1523-785feabcd123"
# Write characteristic — send commands here
CHAR_WRITE_UUID     = "00001525-1212-efde-1523-785feabcd123"

# ─── COMMANDS ────────────────────────────────────────────────────────────────

CMD_ACTIVATE    = bytes([0x01, 0x00])   # Wake device, start streaming
CMD_MEASURE     = bytes([0x01, 0x00])   # Trigger single measurement
CMD_CONTINUOUS  = bytes([0x02, 0x00])   # Enable continuous measurement mode
CMD_STOP        = bytes([0x00, 0x00])   # Stop continuous mode
CMD_UNIT_MM     = bytes([0x01, 0x01])   # Set unit: millimetres
CMD_UNIT_IN     = bytes([0x01, 0x02])   # Set unit: inches

# ─── PACKET STRUCTURE ─────────────────────────────────────────────────────────
# The GLM 50C sends 10-byte notification packets:
#
# Byte 0:    Packet type (0x00 = measurement, 0x01 = battery, 0x02 = error)
# Byte 1:    Status flags (bit 0: measuring, bit 1: continuous, bit 2: error)
# Bytes 2-5: Measurement value as 32-bit little-endian integer (in 0.1mm units)
# Byte 6:    Unit (0x00=mm, 0x01=in, 0x02=ft)
# Byte 7:    Battery level (0-100)
# Bytes 8-9: Checksum

PACKET_TYPE_MEASUREMENT = 0x00
PACKET_TYPE_BATTERY     = 0x01
PACKET_TYPE_ERROR       = 0x02

PACKET_LENGTH = 10


@dataclass
class GLMMeasurement:
    """A decoded measurement from the Bosch GLM 50C."""
    value_mm: float
    value_raw: int          # raw 0.1mm units
    unit_byte: int
    battery_level: int
    status_flags: int
    is_continuous: bool
    is_valid: bool
    raw_bytes: bytes

    @property
    def is_anomaly_candidate(self) -> bool:
        """Quick pre-filter: obviously bad values before ML inference."""
        return self.value_mm <= 0 or self.value_mm > 50_000

    def to_dict(self) -> dict:
        return {
            "value_mm": self.value_mm,
            "unit": "mm",
            "battery_level": self.battery_level,
            "status_flags": self.status_flags,
            "is_continuous": self.is_continuous,
            "raw_bytes": self.raw_bytes.hex(),
        }


def decode_packet(data: bytes) -> Optional[GLMMeasurement]:
    """
    Decode a 10-byte BLE notification packet from the GLM 50C.
    Returns None if the packet is not a valid measurement packet.
    """
    if len(data) != PACKET_LENGTH:
        logger.debug(f"GLM: unexpected packet length {len(data)}, expected {PACKET_LENGTH}")
        return None

    packet_type = data[0]
    if packet_type != PACKET_TYPE_MEASUREMENT:
        logger.debug(f"GLM: non-measurement packet type 0x{packet_type:02x}")
        return None

    status_flags = data[1]

    # 32-bit little-endian integer, in 0.1mm units
    raw_value = struct.unpack_from("<I", data, 2)[0]
    value_mm = raw_value / 10.0

    unit_byte    = data[6]
    battery_pct  = data[7]
    is_continuous = bool(status_flags & 0x02)
    has_error     = bool(status_flags & 0x04)

    if has_error:
        logger.warning(f"GLM: error flag set in status byte 0x{status_flags:02x}")
        return None

    return GLMMeasurement(
        value_mm=value_mm,
        value_raw=raw_value,
        unit_byte=unit_byte,
        battery_level=battery_pct,
        status_flags=status_flags,
        is_continuous=is_continuous,
        is_valid=True,
        raw_bytes=data,
    )


def encode_command(command: bytes) -> bytes:
    """Return command bytes ready to write to CHAR_WRITE_UUID."""
    return command


def validate_measurement(value_mm: float, element_type: Optional[str] = None) -> tuple[bool, str]:
    """
    Rule-based pre-validation before ML inference.
    Returns (is_valid, reason).
    """
    if value_mm <= 0:
        return False, f"Non-positive value: {value_mm}mm"
    if value_mm > 50_000:
        return False, f"Exceeds 50m: {value_mm}mm"

    bounds = {
        "wall_height":   (1_500, 5_000),
        "wall_width":    (200,   20_000),
        "roof_length":   (500,   30_000),
        "floor_length":  (500,   30_000),
        "floor_width":   (500,   15_000),
        "opening_height":(500,   3_000),
        "opening_width": (300,   3_000),
        "depth":         (50,    2_000),
    }

    if element_type and element_type in bounds:
        lo, hi = bounds[element_type]
        if not (lo <= value_mm <= hi):
            return False, f"{element_type} {value_mm}mm outside expected {lo}–{hi}mm"

    return True, "ok"
