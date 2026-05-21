# Scarnergy v2.0 — BLE Decode & Live Measurement Session
**Date:** 2026-05-21
**Goal:** Fix Bosch GLM 50C measurements not transferring to the Expo app — Device screen stuck at 580.0 mm regardless of what the laser points at.

---

## Problems Reported

| # | Symptom | Screen |
|---|---|---|
| 1 | Device screen always showed 580.0 mm — value never changed after trigger press | GLM Device tab |
| 2 | "Trigger-press GATT mode: Active ✓" but trigger press had no effect on inspect slots | Inspect screen |
| 3 | Banner on inspect screen showed 580.0 mm even when GLM was aimed at a different surface | Inspect screen |
| 4 | `MeasurementInput` (▶ GLM button) filled slots immediately with stale 580.0 mm before user could aim | Inspect screen |

---

## Evidence from Terminal

```
LOG  [BLE PKT] 20B hex=c055100600dc01cccc3c3f0000000000000000d2
     b0=c0 b1=55 b2=10 b3=6
LOG  [BLE PKT] decoded: 737.5mm is_continuous=false

LOG  [BLE PKT] 20B hex=c055100600de01bf7d253f000000000000000014
     b0=c0 b1=55 b2=10 b3=6
LOG  [BLE PKT] decoded: 646.4mm is_continuous=false
```

**Key observations:**
- The 20-byte trigger-press packet IS received and decoded correctly
- `is_continuous=false` confirms it is a physical trigger-press, not a heartbeat
- BUT the Device screen ignored it and kept showing the old 4-byte heartbeat value (580.0 mm)

---

## Root Cause Analysis

### Root Cause 1 — `writeCharacteristicWithoutResponseForService` always returns `true`

**File:** `scarnergy-app/hooks/useBLEDevice.ts` (CMD_ENABLE section)

`writeCharacteristicWithoutResponseForService` is a BLE "fire-and-forget" write — it returns `true` as soon as the BLE stack on the phone *queued* the write, regardless of whether the GLM device received or processed the bytes. This caused:

```
cmdEnabled = true   ← reported by phone BLE stack
GLM ignores CMD_ENABLE bytes  ← device never activated trigger-press mode
```

The UI showed **"Trigger-press GATT mode: Active ✓"** but the device was not in trigger-press mode. When CMD_ENABLE did eventually work (on some connections), the `cmdEnabled=true` state was correct. Either way, the `writeWithoutResponse` path gave no reliable signal.

---

### Root Cause 2 — `lastMeasurement` was overwritten by streaming heartbeats 200ms after every trigger press

**File:** `scarnergy-app/hooks/useBLEDevice.ts` (`handleMeasurement`)

`lastMeasurement` — the single shared state used by both the Device screen and the inspect screen banner — was updated by **every** packet, both trigger-press and 4-byte continuous heartbeats.

The timing:
```
T+0ms:   Trigger press → decoded 646.4mm → setLastMeasurement(646.4mm) → Device screen flashes green
T+200ms: 4-byte heartbeat → decoded 580.0mm → setLastMeasurement(580.0mm) → Device screen reverts to blue 580.0mm
```

The trigger-press value appeared for ~200ms — completely invisible to the user. The screen always settled on the continuous 580.0mm heartbeat value.

---

### Root Cause 3 — `pendingMeasurementRef` armed immediately, filled by pre-aiming heartbeat

**File:** `scarnergy-app/app/tabs/sessions/inspect.tsx` (`toggleSlot`)

When the user tapped **▶ GLM** on a measurement slot:
1. `requestMeasurement()` was called → `pendingMeasurementRef.current = true`
2. Within ~200ms, the next 4-byte heartbeat (still 580.0mm from the last-pointed-at surface) fired
3. `handleMeasurement` dispatched the heartbeat to the slot callback
4. Slot filled with **580.0mm before the user had even aimed the device**

This was doubly wrong: the user expected to aim then trigger, but the slot auto-filled with the old streaming value instantly.

---

### Root Cause 4 — No separate stable state for confirmed trigger-press measurements

**File:** `scarnergy-app/hooks/useBLEDevice.ts`

There was only one measurement state (`lastMeasurement`) shared by:
- Device screen live display
- Inspect screen live banner
- All BLE callbacks

No distinction existed between "live streaming preview" and "deliberate captured measurement". The Device screen could never show a stable captured value because the single state was continuously overwritten by streaming heartbeats.

---

## Fixes Applied

### Fix 1 — CMD_ENABLE: write-WITH-response + GATT property inspection

**File:** `scarnergy-app/hooks/useBLEDevice.ts` lines 252–296

**Before:**
```ts
// writeGatt tries without-response first — always returns true
cmdOk = await writeGatt(connected, GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
```

**After:**
```ts
// 1. Inspect d1 characteristic GATT properties first
const chars = await connected.characteristicsForService(GLM_SERVICE_UUID);
const d1 = chars.find(c => c.uuid.toLowerCase().startsWith("02a6c0d1"));
d1SupportsWrite = !!(d1.isWritableWithResponse || d1.isWritableWithoutResponse);
// logs: d1 props — notify=true indicate=false writeResp=true writeNoResp=false

// 2. Use write-WITH-response for real GATT ACK
await connected.writeCharacteristicWithResponseForService(
  GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE
);
// Only resolves if the device firmware sends ATT_WRITE_RSP — no more false positives
cmdOk = true;
```

**Effect:** `cmdEnabled` is now only `true` when the GLM firmware actually acknowledged the command. The characteristic property check also detects devices where d1 is notify-only (no write support) and skips CMD_ENABLE entirely instead of silently failing.

---

### Fix 2 — `lastTriggerMeasurement`: stable state that heartbeats cannot overwrite

**Files:** `hooks/useBLEDevice.ts`, `lib/BLEContext.tsx`

Added a second measurement state alongside `lastMeasurement`:

```ts
// lastMeasurement — updated by EVERY packet (stream + trigger). Used by inspect banner.
const [lastMeasurement,        setLastMeasurement]        = useState<GLMMeasurement | null>(null);

// lastTriggerMeasurement — ONLY updated on is_continuous=false (physical trigger press).
// Streaming heartbeats never touch this. Device screen uses it for a stable display.
const [lastTriggerMeasurement, setLastTriggerMeasurement] = useState<GLMMeasurement | null>(null);
```

In `handleMeasurement` PATH A:
```ts
if (!m.is_continuous) {
  setLastTriggerMeasurement(m);   // ← stable — survives all following heartbeats
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
  return;
}
```

**Effect:** Every trigger press permanently updates `lastTriggerMeasurement`. The 4-byte 580.0mm heartbeats that follow every 200ms only update `lastMeasurement` (the live stream) — they can never overwrite the captured value.

---

### Fix 3 — `toggleSlot`: only arm `pendingRef` when GATT mode is confirmed

**File:** `scarnergy-app/app/tabs/sessions/inspect.tsx` line 250–256

**Before:**
```ts
const toggleSlot = (key: SlotKey) => {
  const wasActive = activeSlot === key;
  setActiveSlotSync(wasActive ? null : key);
  if (!wasActive && isConnected) requestMeasurement(); // ← always armed
};
```

**After:**
```ts
const toggleSlot = (key: SlotKey) => {
  const wasActive = activeSlot === key;
  setActiveSlotSync(wasActive ? null : key);
  // Only arm when GATT trigger-press mode is confirmed. In continuous-only mode
  // the next 200ms heartbeat would fill the slot before the user aims.
  if (!wasActive && isConnected && cmdEnabled) requestMeasurement();
};
```

**Effect:** When `cmdEnabled=false` (CMD_ENABLE failed), tapping ▶ GLM only marks the slot as active (target for the Capture button). `pendingRef` is never armed, so no stale heartbeat can fill the slot. When `cmdEnabled=true`, arming is safe because we expect a real trigger-press indication packet.

---

### Fix 4 — 1500ms aim guard for continuous heartbeat dispatch

**File:** `scarnergy-app/hooks/useBLEDevice.ts` lines 190–200

Added a minimum 1500ms delay before a continuous heartbeat is allowed to fill a slot (PATH B fallback):

```ts
if (pendingMeasurementRef.current) {
  const elapsed = Date.now() - measurementRequestTimeRef.current;
  if (elapsed >= 1500) {
    // 1500ms have passed — user has had time to aim at the target surface
    pendingMeasurementRef.current = false;
    onMeasurementRef.current?.(m);
  }
  // else: too early — keep pendingRef armed; next heartbeat will re-evaluate
}
```

**Effect:** Even if `pendingRef` is armed (e.g. in GLM keyboard fallback mode), the pre-aiming 580mm heartbeat cannot fill the slot within the first 1.5 seconds. The user has time to aim before the slot auto-fills.

---

### Fix 5 — Broader 8-byte trigger-press decoder

**File:** `scarnergy-app/hooks/useBLEDevice.ts` lines 131–143

The existing decoder required exactly `bytes[2] === 0x10`. Added a fallback for any `C0 55 *` packet of 8+ bytes, scanning every float32-LE offset from 4 to `len-4`:

```ts
// Broad fallback: any 8+ byte C0 55 packet
if (bytes.length >= 8 && bytes[0] === 0xc0 && bytes[1] === 0x55) {
  for (let off = 4; off <= bytes.length - 4; off++) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + off, 4);
    const value_mm = dv.getFloat32(0, true) * 1000;
    if (value_mm >= 50 && value_mm <= 50_000) {
      return { value_mm, ..., is_continuous: false };
    }
  }
}
```

**Effect:** Catches GLM 50C firmware variants where `bytes[2]` is not `0x10`. The confirmed actual packet (`c055100600...`) has `bytes[2]=0x10` so it matches the strict decoder, but the fallback protects against future firmware updates.

---

### Fix 6 — Device screen: stable "LAST CAPTURED" card + compact live strip

**File:** `scarnergy-app/app/tabs/device.tsx`

**Before:** One card showing `lastMeasurement` — always overwritten by heartbeats, showed 580.0mm continuously.

**After:** Two visual elements:

```
┌──────────────────────────────────────────┐  ← green border
│  LAST CAPTURED        ✓ TRIGGER PRESS    │
│                                          │
│         0.646  m                         │
│                                          │
│  646.4 mm  •  17:53:12                   │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐  ← compact blue row (below)
│  ● Live   0.580 m · 580.0 mm             │
└──────────────────────────────────────────┘
```

- **Primary card**: shows `lastTriggerMeasurement` (stable, green) once a trigger press has occurred. Falls back to showing `lastMeasurement` (blue, "LIVE STREAM") before the first trigger press.
- **Live strip**: shows the current streaming heartbeat value only when a captured value exists — so the user can see where the laser is currently pointing while the captured measurement stays visible.
- **Value displayed in metres** (`(value_mm / 1000).toFixed(3) m`) to match the GLM's own LCD. Millimetre value shown in the footer meta line.

---

### Fix 7 — Rolling raw packet log panel (diagnostics)

**File:** `scarnergy-app/app/tabs/device.tsx`

Added a dark-theme hex dump of the last 12 BLE packets at the bottom of the Device screen. Trigger-press rows are highlighted in green. Visible only when packets have been received.

```
RAW PACKET LOG (last 12)
Press the GLM trigger and watch for new entries...

17:53:12  20B  c055100600de01bf7d253f000000000000000014   ← green highlight
          646.4mm trigger
17:53:12  4B   c011003a
          580.0mm stream
```

**Effect:** Allows field diagnosis — if only 4-byte packets appear and "trigger" never shows, CMD_ENABLE did not activate GATT mode and the Capture button / keyboard mode should be used instead.

---

### Fix 8 — `PacketLogEntry` type + `packetLog` state

**File:** `scarnergy-app/hooks/useBLEDevice.ts`

```ts
export interface PacketLogEntry {
  t:       string;        // HH:MM:SS
  hex:     string;        // full hex dump
  len:     number;        // byte count
  decoded: string | null; // "646.4mm trigger" | "580.0mm stream" | null
}
```

Exported through `BLEContext` so any screen can display the packet history.

---

### Fix 9 — Measurement display in metres

**File:** `scarnergy-app/app/tabs/device.tsx`

The GLM's own LCD displays in metres. The app now matches this:
- Large display: `(value_mm / 1000).toFixed(3) m`  (e.g. `0.646 m`)
- Meta footer: `646.4 mm  •  17:53:12`

Inspection measurement slots in `inspect.tsx` remain in `mm` (the DB stores mm).

---

## Packet Format Confirmed

The Bosch GLM 50C trigger-press packet is a **20-byte** notification:

```
c0 55 10 06 00 de 01  bf 7d 25 3f  00 00 00 00 00 00 00 00 14
                      ^^^^^^^^^^^
                      float32-LE at offset 7
                      0x3F257DBF = 0.6464...m × 1000 = 646.4mm
```

| Field | Value | Meaning |
|---|---|---|
| `bytes[0]`   | `0xC0` | Bosch GATT packet header |
| `bytes[1]`   | `0x55` | Trigger-press sub-command |
| `bytes[2]`   | `0x10` | Confirmed sub-type (strict decoder matches) |
| `bytes[3]`   | `0x06` | Payload length |
| `bytes[4..6]`| varies | Device status / battery |
| `bytes[7..10]`| float32-LE | **Distance in metres** |
| `bytes[11+]` | `0x00…` | Padding |
| `bytes[19]`  | `0x14` | Packet checksum / footer |

4-byte continuous heartbeat format (streaming mode):
```
c0 11 00 3a
   ^^  ^^^^
   type  big-endian uint16 in cm (0x003A = 58cm × 10 = 580mm)
```

---

## State After This Session

| Component | Status |
|---|---|
| BLE decode — 20B trigger-press packet | ✅ Working, confirmed with real device |
| CMD_ENABLE — write-with-response | ✅ Fixed, no more false positives |
| Device screen — stable captured value | ✅ Fixed (`lastTriggerMeasurement`) |
| Device screen — live stream strip | ✅ Added (shows heartbeat value alongside captured) |
| Device screen — display in metres | ✅ Fixed |
| Inspect screen — slot auto-fill on trigger | ✅ Working (`onMeasurementRef` path) |
| Inspect screen — no premature stale fill | ✅ Fixed (`cmdEnabled` gate + 1500ms guard) |
| Packet log panel | ✅ Added to Device screen |
| TypeScript — zero compile errors | ✅ Confirmed (`tsc --noEmit --skipLibCheck`) |

---

## Files Changed

| File | Change |
|---|---|
| `scarnergy-app/hooks/useBLEDevice.ts` | Added `PacketLogEntry` type; `lastTriggerMeasurement` state; `measurementRequestTimeRef`; CMD_ENABLE rewrite (write-with-response + GATT property inspection); broader 8-byte decoder; 1500ms aim guard; `packetLog` state; all new fields exported |
| `scarnergy-app/lib/BLEContext.tsx` | Added `lastTriggerMeasurement` and `packetLog` to context interface |
| `scarnergy-app/app/tabs/device.tsx` | Primary card uses `lastTriggerMeasurement`; live strip for streaming value; metres display; packet log panel; updated instructions |
| `scarnergy-app/app/tabs/sessions/inspect.tsx` | `toggleSlot` gates `requestMeasurement()` on `cmdEnabled` |

---

## Known Remaining Items

| Item | Priority | Notes |
|---|---|---|
| `lastTriggerMeasurement` not reset on disconnect | Low | Historical value is informative; reset would need a "Clear" button or auto-reset on next scan |
| `scarnergy_storage` restart loop | Low | Storage API port/auth mismatch; inspection photos not yet in use |
| `custom_access_token_hook` not registered | High | Required before `DEV_BYPASS_AUTH = false`; needed for production JWTs |
| `DEV_BYPASS_AUTH = true` hardcoded | **Critical** | Must be `false` before App Store release (`app/_layout.tsx`) |
| Full inspection flow E2E test | Medium | Create session → zones → elements → GLM trigger → record measurement → complete |
| GAP-6: single `onMeasurementRef` slot | Medium | Multiple components overwrite each other; future EventEmitter refactor |
