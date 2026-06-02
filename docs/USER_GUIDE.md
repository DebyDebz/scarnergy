# Scarnergy v2.0 — User Guide

## What is Scarnergy?

Scarnergy is a mobile app for Dutch building energy inspectors. You use it together with a Bosch GLM 50C Bluetooth laser distance meter to capture building measurements required for an NTA 8800 energy certificate.

---

## Getting Started

### Prerequisites
- iPhone or Android phone on the **same Wi-Fi network** as the Scarnergy server
- Bosch GLM 50C laser distance meter (charged)
- The Scarnergy app installed (development build via Expo Go dev client)

### First Launch
1. Open the Scarnergy app on your phone
2. You will land on the **Dashboard** screen
3. In development mode the app logs you in automatically as "Dev User"

---

## App Navigation

The bottom tab bar has four tabs:

| Tab | Icon | Purpose |
|---|---|---|
| **Home** | ⊞ | Dashboard: session stats, quick actions, recent sessions |
| **Buildings** | 🏠 | List of all buildings for your organisation |
| **Sessions** | 📋 | All inspection sessions you have started |
| **Device** | 🔷 | Bluetooth GLM 50C scanner and connection status |

---

## Step-by-Step: Running an Inspection

### Step 1 — Connect the GLM 50C

1. Power on the Bosch GLM 50C (press the green button)
2. In the app, tap the **Device** tab
3. Tap **"🔍 Scan for GLM 50C"**
4. The app scans for 15 seconds — keep the meter within 5 metres of your phone
5. When found, it connects automatically and shows:
   - **"Connected"** status (green)
   - **"Trigger-press GATT mode: Active ✓"** — means button presses auto-fill measurement fields
   - If it shows **"Fallback (continuous)"** — button presses still work but you must use the Capture button (see Step 4)

> **Tip:** If scanning times out, press the blue Bluetooth button on the GLM briefly to wake it, then scan again.

### Step 2 — Select a Building

1. Tap the **Buildings** tab
2. Tap **"Start Inspection"** on the building you are visiting
   - OR tap **Sessions → +** and choose a building from the modal list
3. A new session is created with a code like `INS-2026-0001`
4. You are taken to the **Session Detail** screen

### Step 3 — Navigate to an Element

The Session Detail screen shows:
- **Zone tabs** at the top (e.g., "Begane grond", "Eerste verdieping") — swipe to switch
- **Element cards** per zone (walls, roof, floor, installations)
- A live **measurements feed** at the bottom (updates in real-time)

Tap a floor tab to switch zones. Tap an element card to open it for inspection.

> Elements with a green left border (✓ Complete) have all required measurements.

### Step 4 — Take Measurements

The **Inspect** screen shows measurement slots for the element type:

| Element type | Slots |
|---|---|
| Gevel (wall/facade) | Length · Height · Thickness |
| Dak (roof) | Length · Width |
| Vloer (floor) | Length · Width |
| Transparant deel (window/door) | Width · Height |
| Installatie | Length |

**Method A: GLM trigger press (recommended, GATT mode active)**
1. Tap the **📏 icon** next to a slot (or tap anywhere on the row) to make it active (highlighted blue)
2. Point the GLM and press the **green trigger button**
3. The measured value fills in automatically in mm

**Method B: Capture button (continuous mode fallback)**
1. The blue banner at the top shows the live GLM reading
2. Tap the row to select a slot
3. When the distance shown is correct, tap **"⊙ Capture NNN mm → [slot name]"**

**Method C: Keyboard entry**
1. Tap a slot — the keyboard opens
2. Type the value; the app accepts mm directly (`4200`) or metres (`4.200` auto-converts to `4200 mm`)
3. Press Return to confirm and advance to the next slot

**Auto-advance:** After confirming a slot, the cursor jumps to the next unfilled slot automatically.

### Step 5 — Save and Mark Complete

1. Once all slots have valid values, tap **"Save"** at the bottom
2. The element card in the session list gains a green border with **"✓ Complete"**
3. The measurements are saved to the database and appear in the live feed

> The **Save** button also triggers AI anomaly detection on the server side.

### Step 6 — Complete the Session

When all elements are measured:
1. From the Session Detail screen, scroll to the bottom
2. Tap **"✓ Complete Session"**
3. Confirm in the alert dialog
4. The system validates all measurements, computes zone energy labels, and marks the session complete

### Step 7 — Export the Report

1. In the completed session, tap **"↓ Export XML"**
2. The app generates a `ScanergyExport` XML file containing all zones, elements, and measurements
3. Use the iOS/Android Share sheet to send via AirDrop, email, or save to Files

---

## Tips and Troubleshooting

### "Network request failed" errors
The app cannot reach the Supabase backend. Check:
1. Your phone is on the **same Wi-Fi network** as the server
2. Run `npm start` again from `scarnergy-app/` — the IP auto-detector will update the backend URL
3. Confirm the Docker stack is running: `cd infrastructure && docker compose ps`

### GLM scan times out
- Wake the GLM by pressing the blue Bluetooth button briefly
- Keep the phone within 5 metres during scan
- Check Bluetooth is enabled on the phone

### GLM connects but measurements don't fill
- Check **Device tab** → "Trigger-press GATT mode" status
- If "Active ✓": press the trigger while a slot is highlighted
- If "Fallback (continuous)": use the **Capture button** in the blue banner
- CMD_ENABLE may fail if the GLM firmware is older — fallback mode is fully functional

### Sessions show nothing / buildings list empty
The database schema may not be initialised. On the server:
```bash
cd /path/to/ScanergyV2
./start-web.sh
```
This runs all migrations and seeds the test data.

### Measurements not showing in live feed
Realtime requires the correct JWT for WebSocket authentication. The dev JWT is injected automatically. If building from scratch, ensure `EXPO_PUBLIC_DEV_JWT` is set in `scarnergy-app/.env`.

---

## Dashboard Quick Actions

| Card | Action |
|---|---|
| **New Inspection** | Goes to Buildings tab to pick a building |
| **Connect GLM** | Goes to Device tab; shows current BLE status |
| **My Sessions** | Goes to Sessions list |
| **Sync Now / All Synced** | Drains offline queue; badge shows pending count |

The **Recent Sessions** section at the bottom shows the last 5 sessions with status badges (active/paused/completed).

---

## Session Status Reference

| Status | Meaning | Can Transition To |
|---|---|---|
| **active** | Inspection in progress | paused, completed, cancelled |
| **paused** | Temporarily stopped | active (resume) |
| **completed** | All measurements validated, energy labels computed | — (immutable) |
| **cancelled** | Abandoned session | — (admin only) |

---

## Measurement Slot Reference

Slots map to `building_elements` columns:

| Slot key | Column | Displayed as |
|---|---|---|
| `length_mm` | `length_mm` | Length |
| `height_mm` | `height_mm` | Height |
| `width_mm` | `width_mm` | Width / Thickness |

All values stored in millimetres. Metre input (e.g. `2.430`) is auto-converted to `2430 mm` when the value contains a decimal point and is less than 100.
