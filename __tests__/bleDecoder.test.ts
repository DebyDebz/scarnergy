/**
 * TDD tests for BLE packet decoding and measurement dispatch logic.
 *
 * These tests validate the proposed fixes for the gaps identified in the
 * BLE measurement flow audit (see BLE_FIX_PLAN.md).
 *
 * Run: npx jest __tests__/bleDecoder.test.ts
 */

import { decodePacket, shouldDispatch, selectSlot, GLMMeasurement, SlotKey } from "../hooks/bleDecoder";

// ── Helpers ────────────────────────────────────────────────────────────────

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

function makeFloat32LEBytes(valueMetre: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, valueMetre, true);
  return Array.from(new Uint8Array(buf));
}

// ── decodePacket ───────────────────────────────────────────────────────────

describe("decodePacket — 4-byte continuous heartbeat", () => {
  test("decodes c0 11 00 3a correctly → 580mm is_continuous", () => {
    // From terminal: [BLE PKT] 4B hex=c011003a decoded: 580.0mm
    const packet = toBase64([0xc0, 0x11, 0x00, 0x3a]);
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.value_mm).toBe(580);         // 0x003a = 58cm × 10 = 580mm
    expect(result!.is_continuous).toBe(true);
    expect(result!.battery_level).toBe(0);      // continuous packets carry no battery info
  });

  test("decodes 200mm correctly", () => {
    // 0x0014 = 20 in decimal, × 10 = 200mm
    const packet = toBase64([0xc0, 0x11, 0x00, 0x14]);
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.value_mm).toBe(200);
    expect(result!.is_continuous).toBe(true);
  });

  test("decodes maximum valid range (50 000mm)", () => {
    // 5000cm = 0x1388
    const packet = toBase64([0xc0, 0x11, 0x13, 0x88]);
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.value_mm).toBe(50_000);
  });

  test("rejects below-range packet (value < 50mm)", () => {
    // 0x0004 = 4cm = 40mm — below minimum
    const packet = toBase64([0xc0, 0x11, 0x00, 0x04]);
    expect(decodePacket(packet)).toBeNull();
  });

  test("rejects zero-value packet", () => {
    const packet = toBase64([0xc0, 0x11, 0x00, 0x00]);
    expect(decodePacket(packet)).toBeNull();
  });

  test("rejects wrong header byte", () => {
    const packet = toBase64([0xaa, 0x11, 0x00, 0x3a]);
    expect(decodePacket(packet)).toBeNull();
  });
});

describe("decodePacket — 8-byte trigger-press indication", () => {
  // Confirmed GLM 50CG format: C0 55 10 06 <battery> 00 00 <float32-LE at offset 7>
  // float32 in metres, little-endian
  const makeTriggerPacket = (metres: number, battery = 85): number[] => {
    const floatBytes = makeFloat32LEBytes(metres);
    return [
      0xc0, 0x55, 0x10, 0x06,   // header
      battery,                   // byte 4 = battery
      0x00, 0x00,                // bytes 5-6 padding
      ...floatBytes,             // bytes 7-10 = float32 LE metres
    ];
  };

  test("decodes 2.430m trigger-press → 2430mm, is_continuous=false", () => {
    const packet = toBase64(makeTriggerPacket(2.430));
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.value_mm).toBeCloseTo(2430, 0);
    expect(result!.is_continuous).toBe(false);
  });

  test("decodes battery level from trigger-press packet", () => {
    const packet = toBase64(makeTriggerPacket(1.500, 72));
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.battery_level).toBe(72);
  });

  test("decodes minimum valid trigger (1mm)", () => {
    const packet = toBase64(makeTriggerPacket(0.001));
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.value_mm).toBeCloseTo(1, 0);
    expect(result!.is_continuous).toBe(false);
  });

  test("rejects trigger-press with out-of-range float (> 50m)", () => {
    // 51 metres = 51 000mm, above the 50 000mm cap
    const packet = toBase64(makeTriggerPacket(51.0));
    expect(decodePacket(packet)).toBeNull();
  });

  test("rejects trigger-press with wrong magic bytes", () => {
    const wrongHeader = toBase64([0xc0, 0x55, 0x11, 0x06, 0x55, 0x00, 0x00, ...makeFloat32LEBytes(2.0)]);
    expect(decodePacket(wrongHeader)).toBeNull();
  });

  test("rejects packet too short for 8-byte indication", () => {
    const short = toBase64([0xc0, 0x55, 0x10, 0x06, 0x55, 0x00]);  // only 6 bytes
    expect(decodePacket(short)).toBeNull();
  });

  test("falls back to offset 6 when offset 7 is out of range", () => {
    // Construct packet where float at offset 7 is garbage (out of range) but
    // float at offset 6 is valid (firmware variant).
    const floatBytes = makeFloat32LEBytes(1.200);   // 1200mm — valid
    const badFloat   = [0x00, 0x00, 0x00, 0x00];   // 0m — invalid
    const bytes = [0xc0, 0x55, 0x10, 0x06, 0x55, 0x00, ...floatBytes, ...badFloat];
    const packet = toBase64(bytes);
    const result = decodePacket(packet);
    expect(result).not.toBeNull();
    expect(result!.value_mm).toBeCloseTo(1200, 0);
  });
});

describe("decodePacket — edge cases", () => {
  test("returns null for completely empty base64", () => {
    expect(decodePacket(btoa(""))).toBeNull();
  });

  test("returns null for a 3-byte packet (too short for both formats)", () => {
    const packet = toBase64([0xc0, 0x11, 0x00]);
    expect(decodePacket(packet)).toBeNull();
  });

  test("returns null for 5-byte packet (not 4 or 8+)", () => {
    // 5-byte packet: not a continuous (need exactly 4) nor trigger (need 8+)
    const packet = toBase64([0xc0, 0x55, 0x10, 0x06, 0x55]);
    expect(decodePacket(packet)).toBeNull();
  });
});

// ── shouldDispatch ─────────────────────────────────────────────────────────

describe("shouldDispatch — determines whether a packet fires the slot-fill callback", () => {
  const makeMeasurement = (is_continuous: boolean): GLMMeasurement => ({
    value_mm: 1000,
    battery_level: 80,
    is_continuous,
    raw_bytes: "c011003e",
    timestamp: new Date().toISOString(),
  });

  // ── Current broken behaviour that these tests document and the fix corrects ──

  test("[FIX] trigger-press packet always dispatches regardless of pendingArmed", () => {
    const triggerPress = makeMeasurement(false);
    // Armed = false — in the OLD code this would NOT dispatch.
    // In the FIXED code it always dispatches because the user pressed the physical button.
    expect(shouldDispatch(triggerPress, false)).toBe(true);
  });

  test("[FIX] trigger-press packet dispatches even when pendingArmed = true", () => {
    const triggerPress = makeMeasurement(false);
    expect(shouldDispatch(triggerPress, true)).toBe(true);
  });

  test("continuous heartbeat dispatches when pendingArmed = true (arm-fire fallback)", () => {
    const heartbeat = makeMeasurement(true);
    expect(shouldDispatch(heartbeat, true)).toBe(true);
  });

  test("[FIX] continuous heartbeat does NOT dispatch when pendingArmed = false", () => {
    // OLD code (bug): both packet types dispatched whenever pendingArmed=true, meaning
    // a background heartbeat could fire the slot-fill before the user triggered.
    // FIXED code: heartbeat only dispatches when explicitly armed.
    const heartbeat = makeMeasurement(true);
    expect(shouldDispatch(heartbeat, false)).toBe(false);
  });
});

// ── selectSlot ────────────────────────────────────────────────────────────

describe("selectSlot — selects which slot to fill", () => {
  const SLOTS = [
    { key: "length_mm" as SlotKey },
    { key: "height_mm" as SlotKey },
    { key: "width_mm"  as SlotKey },
  ];

  test("returns activeSlot when explicitly set", () => {
    const result = selectSlot("height_mm", SLOTS, { length_mm: "2000" });
    expect(result).toBe("height_mm");
  });

  test("returns first unfilled slot when activeSlot is null", () => {
    const result = selectSlot(null, SLOTS, { length_mm: "2000" });
    expect(result).toBe("height_mm");  // length_mm filled, height_mm is next
  });

  test("returns first slot when all slots are empty", () => {
    const result = selectSlot(null, SLOTS, {});
    expect(result).toBe("length_mm");
  });

  test("returns null when all slots are filled", () => {
    const values = { length_mm: "2000", height_mm: "1500", width_mm: "300" };
    const result = selectSlot(null, SLOTS, values);
    expect(result).toBeNull();
  });

  test("treats '0' as unfilled (zero is not a valid measurement)", () => {
    const result = selectSlot(null, SLOTS, { length_mm: "0" });
    expect(result).toBe("length_mm");  // 0 is invalid, should be refilled
  });

  test("treats negative values as unfilled", () => {
    const result = selectSlot(null, SLOTS, { length_mm: "-5" });
    expect(result).toBe("length_mm");
  });

  test("treats non-numeric strings as unfilled", () => {
    const result = selectSlot(null, SLOTS, { length_mm: "abc" });
    expect(result).toBe("length_mm");
  });

  test("[FIX] activeSlot overrides fallback even when that slot is already filled", () => {
    // User explicitly tapped a slot that already has a value — they want to re-measure.
    const result = selectSlot("length_mm", SLOTS, { length_mm: "2000" });
    expect(result).toBe("length_mm");
  });

  // ── Race condition regression test ────────────────────────────────────────

  test("[FIX] stale activeSlot=null falls back to first unfilled (no crash)", () => {
    // Simulates: toggleSlot fires, setActiveSlot(key) is async, BLE packet arrives
    // before useEffect updates activeSlotRef. activeSlotRef.current is still null.
    // Expected: falls back gracefully to first unfilled slot.
    const result = selectSlot(null, SLOTS, { length_mm: "3000" });
    expect(result).toBe("height_mm");
    expect(result).not.toBeNull();
  });
});
