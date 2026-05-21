# BLE Measurement Flow — Gap Analysis & Fix Plan

**Problem:** Measurements decoded correctly in the terminal (580.0mm) are not reflected
in the Expo app UI on the inspect screen. Users can confirm the GLM is connected and
streaming, but tapping "▶ GLM" either doesn't fill the slot or fills it with the wrong value.

---

## Evidence from Terminal

```
[BLE SRC] svc=d0 char=d1
[BLE PKT] 4B hex=c011003a  b0=c0 b1=11  b2=0  b3=3a
[BLE PKT] decoded: 580.0mm        ← decoding works
[BLE SRC] svc=d0 char=d1
[BLE PKT] 4B hex=c011003a  ...    ← ONLY 4-byte packets, no 8-byte trigger-press
[BLE PKT] decoded: 580.0mm
```

Key observations:
- Only **4-byte continuous heartbeat packets** are visible — no 8-byte trigger-press indications
- This means `CMD_ENABLE` either (a) hasn't been sent yet in this session or (b) silently failed
- Without 8-byte packets, the physical trigger press on the GLM device **never fires the GATT slot-fill path**

---

## Architecture Overview (current)

```
GLM 50C hardware
  ├── Path A  4-byte heartbeat  (every ~200ms, continuous streaming)
  │           C0 <type> <hi> <lo>  → value in cm × 10 = mm
  │           is_continuous = true
  │
  ├── Path B  8-byte trigger-press indication  (requires CMD_ENABLE)
  │           C0 55 10 06 ... float32-LE at offset 7 in metres
  │           is_continuous = false
  │
  └── Path C  BLE HID Keyboard  (GLM paired as keyboard in iOS Settings)
              trigger press "types" distance in metres → focused TextInput
              "\n" arrives → handleSubmitEditing → m→mm conversion

App (useBLEDevice.ts)
  monitorCharacteristicForService → handleMeasurement(base64)
    → decodePacket()              → GLMMeasurement | null
    → setLastMeasurement(m)       → device.tsx shows value  ✓
    → if (pendingMeasurementRef)  → onMeasurementRef.current(m) → inspect.tsx fills slot
```

---

## Gap Inventory

### GAP-1 — CRITICAL: Both continuous AND trigger-press fire the same pendingRef gate

**Location:** `hooks/useBLEDevice.ts:148`

```ts
// Current code
if (pendingMeasurementRef.current) {
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
}
```

`handleMeasurement` fires for **every decoded packet** — both 4-byte heartbeats and 8-byte
trigger-press indications. No distinction is made. When the user taps "▶ GLM":

1. `pendingMeasurementRef.current = true`
2. Within ~200ms the **next heartbeat** (which may be streaming 580mm before the user
   has even aimed the device) fires and fills the slot
3. The user's intended trigger press arrives later — but `pendingRef` is already `false`
   and is silently ignored

**Result:** Slot fills with the current heartbeat value, not the deliberately triggered measurement.

**Fix:** Use `is_continuous` to distinguish intent:
- `is_continuous === false` (trigger-press) → always dispatch, no pending flag needed
- `is_continuous === true` (heartbeat) → dispatch only when pendingRef is armed (fallback only)

**Validated by tests:** `shouldDispatch` in `__tests__/bleDecoder.test.ts` — 4 tests

---

### GAP-2 — HIGH: `activeSlotRef` is stale when the BLE callback fires

**Location:** `app/tabs/sessions/inspect.tsx:79-80`

```ts
const activeSlotRef = useRef<SlotKey | null>(null);
useEffect(() => { activeSlotRef.current = activeSlot; }, [activeSlot]);
//               ↑ runs AFTER next render, not synchronously
```

`toggleSlot` calls `setActiveSlot(key)` (async React update) then `requestMeasurement()`
(sync). If a heartbeat packet arrives within the same render cycle, `activeSlotRef.current`
still holds the **previous value** (null or previous slot) because the useEffect hasn't
run yet.

**Result:** Wrong slot gets filled, or fallback to first-unfilled fires instead of the
user-selected slot.

**Fix:** Update the ref synchronously in `toggleSlot` and everywhere `setActiveSlot` is called:

```ts
// Replace standalone setActiveSlot calls with this helper:
const setActiveSlotSync = (slot: SlotKey | null) => {
  activeSlotRef.current = slot;   // sync — BLE callbacks read this immediately
  setActiveSlot(slot);            // async React update for render
};
```

**Validated by tests:** `selectSlot` race condition test in `__tests__/bleDecoder.test.ts`

---

### GAP-3 — CRITICAL: CMD_ENABLE result unknown / likely failing

**Location:** `hooks/useBLEDevice.ts:233`

```ts
const d1Ok = await writeGatt(connected, GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
console.log("[BLE] CMD_ENABLE → d0/d1:", d1Ok ? "✓" : "failed");
```

The terminal output provided **does not show this log line** — only `[BLE PKT]` and
`[BLE SRC]` logs. This strongly suggests either:
- CMD_ENABLE was attempted and failed (both `writeWithoutResponse` and `writeWithResponse` threw)
- The connection log scrolled out of view before the session was captured

Without CMD_ENABLE succeeding, the GLM never sends 8-byte trigger-press indications.
Path B is completely dead.

**Fix:** Add retry logic with exponential backoff and surface CMD_ENABLE status to the UI:

```ts
// In connect(), after the 500ms wait:
let cmdEnabled = false;
for (let attempt = 0; attempt < 3 && !cmdEnabled; attempt++) {
  await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  cmdEnabled = await writeGatt(connected, GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
  console.log(`[BLE] CMD_ENABLE attempt ${attempt + 1}:`, cmdEnabled ? "✓" : "failed");
}
setCmdEnabled(cmdEnabled);  // expose to UI
```

Add `cmdEnabled: boolean` to BLE context so `inspect.tsx` and `device.tsx` can tell the
user whether trigger-press mode is active.

---

### GAP-4 — CRITICAL: `supabase.web.ts` missing Realtime authentication

**Location:** `lib/supabase.web.ts`

`supabase.ts` (native) correctly calls:
```ts
if (DEV_JWT) {
  supabase.realtime.setAuth(DEV_JWT);
}
```

`supabase.web.ts` **does not**. On web (`expo start --web`), the Supabase Realtime
WebSocket connects as anonymous. RLS blocks `postgres_changes` events for the
`measurements` table. The `useLiveMeasurements` channel subscribes successfully
(no error) but receives **zero events** — all inserts are silent.

**Result:** After saving a measurement on web, the session detail live feed never updates.

**Status: FIXED** — `supabase.realtime.setAuth(DEV_JWT)` added to `lib/supabase.web.ts`.

---

### GAP-5 — HIGH: No live GLM reading on the inspect screen

**Location:** `app/tabs/sessions/inspect.tsx`

The inspect screen shows no live GLM reading. Users cannot see what the device is
currently measuring while they aim it. They must either:
- Look at the physical device LCD
- Switch to the Device tab

This makes it impossible to confirm correct aim before capturing.

**Fix:** Add a live reading banner using `lastMeasurement` from BLEContext:

```tsx
const { deviceId, isConnected, setOnMeasurement, requestMeasurement, lastMeasurement } = useBLE();

{/* Below the GLM status banner */}
{isConnected && lastMeasurement && (
  <View style={styles.liveReading}>
    <Text style={styles.liveValue}>{lastMeasurement.value_mm.toFixed(0)} mm</Text>
    {activeSlot && (
      <TouchableOpacity onPress={() => captureNow(lastMeasurement.value_mm)}>
        <Text>⊙ Capture</Text>
      </TouchableOpacity>
    )}
  </View>
)}
```

The "Capture" button calls a new `captureNow(value_mm)` function that directly fills
the active slot — no `pendingRef` arm needed. This provides a reliable path in
continuous mode that works regardless of CMD_ENABLE state.

---

### GAP-6 — MEDIUM: Single `onMeasurementRef` — screens compete for the callback

**Location:** `hooks/useBLEDevice.ts:74`, `lib/BLEContext.tsx`

`onMeasurementRef` is a single slot. Multiple screens calling `setOnMeasurement`
overwrite each other. `inspect.tsx` cleanup sets it to `() => {}` (noop), so after
navigation any incoming packets go nowhere. This is by design for `inspect.tsx` but
creates a pitfall for future screens using `MeasurementInput`.

**Fix (future):** Replace single-callback with an EventEmitter pattern:

```ts
// useBLEDevice.ts
const listeners = useRef<Set<(m: GLMMeasurement) => void>>(new Set());

const addMeasurementListener = useCallback((cb: (m: GLMMeasurement) => void) => {
  listeners.current.add(cb);
  return () => listeners.current.delete(cb);  // returns cleanup function
}, []);

// In handleMeasurement:
listeners.current.forEach(cb => cb(m));
```

This allows multiple screens/components to subscribe simultaneously without conflict.
Not required for immediate fix but eliminates the fragility entirely.

---

### GAP-7 — MEDIUM: `handleSubmitEditing` auto-advance uses stale `values` state

**Location:** `app/tabs/sessions/inspect.tsx:248`

```ts
const next = slots.slice(idx + 1).find(s => {
  const v = parseFloat(values[s.key] ?? "");   // ← stale React state
  return isNaN(v) || v <= 0;
});
```

Should use `valuesRef.current` (the sync ref) instead of `values` (async state):

```ts
const v = parseFloat(valuesRef.current[s.key] ?? "");
```

Minor — only affects auto-advance when GLM keyboard mode types very quickly.

---

### GAP-8 — LOW: Measurements insert doesn't explicitly set `is_deleted = false`

**Location:** `app/tabs/sessions/inspect.tsx:310`

`useLiveMeasurements` filters `.eq("is_deleted", false)` on initial load, but the
insert payload in `inspect.tsx` does not include `is_deleted`. It relies on the DB
column default being `false`. If the default ever changes or a trigger overrides it,
newly inserted measurements become invisible.

**Fix:** Add `is_deleted: false` explicitly to the insert rows object.

---

## Summary Table

| Gap | Severity | File | Status |
|-----|----------|------|--------|
| GAP-1: Both packet types fire same pendingRef gate | CRITICAL | `hooks/useBLEDevice.ts:148` | Fix described below |
| GAP-2: `activeSlotRef` stale at callback time | HIGH | `inspect.tsx:79` | Fix described below |
| GAP-3: CMD_ENABLE failing, no 8-byte indications | CRITICAL | `hooks/useBLEDevice.ts:227` | Fix described below |
| GAP-4: Realtime missing setAuth on web | CRITICAL | `lib/supabase.web.ts` | **FIXED** |
| GAP-5: No live GLM reading on inspect screen | HIGH | `inspect.tsx` | Fix described below |
| GAP-6: Single callback slot, screens compete | MEDIUM | `hooks/useBLEDevice.ts:74` | Future refactor |
| GAP-7: Auto-advance uses stale `values` state | MEDIUM | `inspect.tsx:248` | Fix described below |
| GAP-8: `is_deleted` not explicit in insert | LOW | `inspect.tsx:313` | Fix described below |

---

## Fix Sequence (prioritised)

### Fix A — Modify `handleMeasurement` to distinguish packet types (GAP-1)

**File:** `hooks/useBLEDevice.ts:148`

Replace:
```ts
if (pendingMeasurementRef.current) {
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
}
```

With:
```ts
if (!m.is_continuous) {
  // Trigger-press: physical button = deliberate intent → always dispatch
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
} else if (pendingMeasurementRef.current) {
  // Continuous heartbeat with pending arm: fallback for devices where CMD_ENABLE fails
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
}
```

This is a 6-line change, no API changes, no hook signature changes.

---

### Fix B — Sync `activeSlotRef` immediately in `toggleSlot` (GAP-2)

**File:** `app/tabs/sessions/inspect.tsx:225`

Add a synchronous ref update helper and use it everywhere `setActiveSlot` is called:

```ts
// Add this after the activeSlotRef declaration (line 79):
const setActiveSlotSync = useCallback((slot: SlotKey | null) => {
  activeSlotRef.current = slot;   // immediate — BLE callbacks read this in the same tick
  setActiveSlot(slot);
}, []);
```

Replace all 5 occurrences of `setActiveSlot(...)` (lines 217, 227, 243, 253, 419) with
`setActiveSlotSync(...)`. Remove the existing `useEffect` that synced the ref (line 80),
since the ref is now always up-to-date.

---

### Fix C — CMD_ENABLE retry + cmdEnabled state (GAP-3)

**File:** `hooks/useBLEDevice.ts:227`

```ts
// Replace the single write with:
let cmdEnabled = false;
for (let attempt = 1; attempt <= 3 && !cmdEnabled; attempt++) {
  await new Promise(r => setTimeout(r, 400 * attempt));
  cmdEnabled = await writeGatt(connected, GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
  console.log(`[BLE] CMD_ENABLE attempt ${attempt}: ${cmdEnabled ? "✓" : "failed"}`);
}
if (!cmdEnabled) {
  console.warn("[BLE] CMD_ENABLE permanently failed — trigger-press GATT mode unavailable. " +
    "Continuous arm-fire fallback active.");
}
setCmdEnabled(cmdEnabled);
```

Add `cmdEnabled` state and expose it via `useBLEDevice` return / BLEContext:
```ts
const [cmdEnabled, setCmdEnabled] = useState(false);
// ... in return:
return { ..., cmdEnabled };
```

Update `BLEContext.tsx` interface to include `cmdEnabled: boolean`.

---

### Fix D — Add live GLM reading + Capture button to inspect.tsx (GAP-5)

**File:** `app/tabs/sessions/inspect.tsx`

1. Destructure `lastMeasurement` from `useBLE()`:
   ```ts
   const { deviceId, isConnected, setOnMeasurement, requestMeasurement, lastMeasurement } = useBLE();
   ```

2. Add `captureNow` function (no pending flag needed):
   ```ts
   const captureNow = useCallback((value_mm: number) => {
     const slot = activeSlotRef.current ?? slotsRef.current.find(s => {
       const v = parseFloat(valuesRef.current[s.key] ?? "");
       return isNaN(v) || v <= 0;
     })?.key ?? null;
     if (!slot) return;
     setActiveSlotSync(String(value_mm) === "" ? null : slot as SlotKey);
     setValues(prev => ({ ...prev, [slot]: value_mm.toFixed(1) }));
     setActiveSlotSync(null);
   }, [setActiveSlotSync]);
   ```

3. Replace the GLM banner (lines 380-386) with an expanded version:
   ```tsx
   <View style={[styles.glmBanner, isConnected && styles.glmBannerConnected]}>
     <View style={styles.glmBannerRow}>
       <Text style={styles.glmBannerText}>
         {isConnected
           ? "📏 GLM connected — tap a field then press trigger"
           : "📏 No GLM — enter manually or connect from Session screen"}
       </Text>
       {isConnected && lastMeasurement && (
         <Text style={styles.glmLiveValue}>
           {lastMeasurement.value_mm.toFixed(0)} mm
         </Text>
       )}
     </View>
     {isConnected && lastMeasurement && activeSlot && (
       <TouchableOpacity style={styles.captureBtn} onPress={() => captureNow(lastMeasurement.value_mm)}>
         <Text style={styles.captureBtnText}>
           ⊙ Capture {lastMeasurement.value_mm.toFixed(0)} mm → {activeSlot.replace("_mm", "")}
         </Text>
       </TouchableOpacity>
     )}
   </View>
   ```

---

### Fix E — Use `valuesRef` in auto-advance (GAP-7)

**File:** `app/tabs/sessions/inspect.tsx:248`

```ts
// Change:
const v = parseFloat(values[s.key] ?? "");
// To:
const v = parseFloat(valuesRef.current[s.key] ?? "");
```

---

### Fix F — Explicit `is_deleted: false` in insert rows (GAP-8)

**File:** `app/tabs/sessions/inspect.tsx:313`

Add `is_deleted: false` to the rows map:
```ts
const rows = slots.filter(...).map(s => ({
  ...
  is_deleted:       false,    // ← add this line
  is_anomaly:       false,
  ...
}));
```

---

## Implementation Order

```
Day 1 (unblock field use)
  Fix A  — handleMeasurement dispatch logic        ~15 min
  Fix B  — activeSlotRef sync                      ~10 min
  Fix D  — live GLM reading + Capture button       ~30 min

Day 2 (reliability)
  Fix C  — CMD_ENABLE retry                        ~20 min
  Fix E  — valuesRef in auto-advance               ~5 min
  Fix F  — is_deleted explicit                     ~5 min

Future
  GAP-6  — EventEmitter pattern for callbacks      refactor sprint
```

---

## TDD Validation

Tests are in `__tests__/bleDecoder.test.ts`. They cover:

- `decodePacket`: 16 tests for 4-byte continuous, 8-byte trigger-press, and edge cases
- `shouldDispatch`: 4 tests validating the new dispatch rules (GAP-1 fix)
- `selectSlot`: 9 tests including the GAP-2 race condition regression

Run with:
```bash
cd scarnergy-app
npx jest __tests__/bleDecoder.test.ts
# Expected: 29 passed, 0 failed
```

All 29 tests pass against the extracted pure functions (`hooks/bleDecoder.ts`), 
confirming the proposed logic is correct before any hook changes are made.

---

## Notes on GLM Keyboard Mode (Path C)

Path C (GLM paired as BLE keyboard in iOS Settings) **works independently of these fixes**.
When paired as a keyboard:
- Trigger press types the distance in metres (e.g. `2.430`) into whichever TextInput
  has first-responder status
- `handleSubmitEditing` converts metres→mm and advances to the next slot
- `toggleSlot` / BLE permissions / CMD_ENABLE are irrelevant

If users have already paired the GLM as a keyboard, they should:
1. Tap a measurement slot (focus the TextInput)
2. Press the GLM trigger
3. The value types in as metres, auto-converts on Enter

If users want GATT mode (no iOS pairing needed):
- Fixes A, B, C, D together provide a reliable experience
- The Capture button (Fix D) provides a fallback in continuous mode even when
  CMD_ENABLE fails
