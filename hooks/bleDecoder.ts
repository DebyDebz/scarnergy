/**
 * Pure BLE packet decoder and slot-selection logic.
 * Extracted from useBLEDevice so these functions can be unit-tested
 * without React, hooks, or native modules.
 */

export interface GLMMeasurement {
  value_mm: number;
  battery_level: number;
  is_continuous: boolean;
  raw_bytes: string;
  timestamp: string;
}

export type SlotKey = "length_mm" | "height_mm" | "width_mm";

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decodes a base64 BLE packet from the Bosch GLM 50C.
 *
 * Two packet types:
 *   4-byte continuous  : C0 <type> <hi> <lo>  — big-endian uint16 in cm → mm
 *   8+ byte trigger    : C0 55 10 06 ...       — little-endian float32 at offset 7 in m → mm
 *
 * Returns null if the packet is unrecognised or the decoded value is out of range.
 */
export function decodePacket(base64Data: string): GLMMeasurement | null {
  const bytes = base64ToUint8Array(base64Data);
  const hex   = uint8ArrayToHex(bytes);
  const ts    = new Date().toISOString();

  // ── 4-byte continuous heartbeat ─────────────────────────────────────────
  if (bytes.length === 4 && bytes[0] === 0xc0) {
    const raw      = (bytes[2] << 8) | bytes[3];
    const value_mm = raw * 10;
    if (value_mm >= 50 && value_mm <= 50_000) {
      return { value_mm, battery_level: 0, is_continuous: true, raw_bytes: hex, timestamp: ts };
    }
    return null;
  }

  // ── 8+ byte trigger-press indication ────────────────────────────────────
  if (bytes.length < 8 || bytes[0] !== 0xc0 || bytes[1] !== 0x55 || bytes[2] !== 0x10) {
    return null;
  }
  // Try offsets 7, 6, 4 to cover firmware variants
  for (const off of [7, 6, 4]) {
    if (bytes.length < off + 4) continue;
    const dv       = new DataView(bytes.buffer, bytes.byteOffset + off, 4);
    const value_mm = dv.getFloat32(0, true) * 1000;
    if (value_mm >= 1 && value_mm <= 50_000) {
      return {
        value_mm,
        battery_level: bytes[4] ?? 0,
        is_continuous: false,
        raw_bytes: hex,
        timestamp: ts,
      };
    }
  }
  return null;
}

/**
 * Decides whether to dispatch a decoded measurement to the slot-fill callback.
 *
 * Rules (post-fix):
 *   - Trigger-press packets (is_continuous === false) always dispatch — the
 *     physical trigger button is an explicit user intent.
 *   - Continuous heartbeat packets dispatch ONLY when pendingArmed === true
 *     (fallback for devices where CMD_ENABLE fails).
 */
export function shouldDispatch(m: GLMMeasurement, pendingArmed: boolean): boolean {
  if (!m.is_continuous) return true;  // trigger-press: always dispatch
  return pendingArmed;                // heartbeat: dispatch only if armed
}

/**
 * Selects which slot to fill given the currently active slot and the set of
 * slot values already recorded.
 *
 * Priority:
 *   1. activeSlot — explicitly selected by the user
 *   2. First slot whose current value is empty / zero / NaN
 *   3. null — all slots filled, nothing to target
 */
export function selectSlot(
  activeSlot: SlotKey | null,
  slots: { key: SlotKey }[],
  currentValues: Partial<Record<SlotKey, string>>
): SlotKey | null {
  if (activeSlot) return activeSlot;
  const unfilled = slots.find(s => {
    const v = parseFloat(currentValues[s.key] ?? "");
    return isNaN(v) || v <= 0;
  });
  return unfilled?.key ?? null;
}
