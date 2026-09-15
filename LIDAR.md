# LiDAR Room Scanning — Status

Last updated: 2026-09-15

## What this is

A LiDAR-assisted door/window measurement feature for the mobile app, built on Apple's
**RoomPlan** framework. During a building inspection, a user can scan a zone with a
LiDAR-equipped iPhone/iPad Pro instead of measuring doors and windows by hand — the scan
detects openings and their dimensions, which are then reviewed and saved as
`building_elements` / `openings` / `measurements` rows.

This is a **first-party native bridge straight onto Apple's system `RoomPlan` framework**
— no third-party AR/point-cloud SDK is used (no `react-native-arkit`, no ARCore, no
`react-native-vision-camera`).

## Where the code lives

**Native module — `modules/expo-room-scanner/`** (local Expo module, `file:` dependency)
- `ios/ExpoRoomScannerModule.swift` — `isSupported()` → `RoomCaptureSession.isSupported`
  (false on iOS <16 or no LiDAR sensor)
- `ios/ExpoRoomScannerView.swift` (182 lines) — the real implementation: drives
  `RoomCaptureSession` start/stop off an `isScanning` prop, builds a `CapturedRoom` via
  `RoomBuilder(options: [.beautifyObjects])` on finish, extracts doors/windows into
  `{type, widthMm, heightMm}`, maps known RoomPlan `NSError`s (world-tracking loss,
  scene-too-large) to friendly messages.
- `ios/ExpoRoomScanner.podspec` — iOS 15.1 min target, Swift 5.9, depends only on
  `ExpoModulesCore` (RoomPlan is a system framework, no external pod needed).
- `android/.../ExpoRoomScannerModule.kt` — stub, `isSupported()` hardcoded `false`
  ("RoomPlan is Apple-only, no Android equivalent").
- `android/.../ExpoRoomScannerView.kt` — empty stub view (exists only so the module loads).
- `index.ts`, `src/ExpoRoomScanner.types.ts`, `src/ExpoRoomScannerModule.ts`,
  `src/ExpoRoomScannerView.tsx` — JS/TS bridge and type definitions.

**App integration**
- `hooks/useRoomScanner.ts` — state machine hook (`idle | scanning | finishing | done | error`).
  Gates the feature off in Expo Go (`Constants.executionEnvironment === StoreClient`) and
  on non-iOS platforms; also checks native `isSupported()`.
- `app/tabs/sessions/roomscan.tsx` (258 lines) — the scan screen: unsupported-device
  message, live `<ExpoRoomScannerView>` while scanning, then a review list of detected
  openings (editable type, keep/remove toggle), then `save()`.
- `app/tabs/sessions/[id].tsx` — zone detail screen has a "📡" scan button per zone,
  gated by `useRoomScanner().isSupported`; if unsupported, alerts that the device needs
  an iPhone/iPad Pro with LiDAR; otherwise routes to `/tabs/sessions/roomscan` with
  `zoneId`/`sessionId`.

**Config**
- `package.json` — `"expo-room-scanner": "file:modules/expo-room-scanner"`.
- `ios/Podfile` — standard `use_expo_modules!` autolinking, no manual pod entry needed.
- `ios/scarnergyapp/Info.plist` — reuses the existing `NSCameraUsageDescription`
  ("Allow Scarnergy to use the camera to photograph floor plans.") to cover RoomPlan's
  camera/ARSession usage. There is **no separate LiDAR/AR-specific permission string**,
  and no `NSMotionUsageDescription` or ARKit entitlement configured in `app.json`.

## How a scan works end to end

1. User taps 📡 on a zone in `app/tabs/sessions/[id].tsx` (button only enabled if
   `useRoomScanner().isSupported`).
2. Navigates to `app/tabs/sessions/roomscan.tsx` with `zoneId`/`sessionId`.
3. `<ExpoRoomScannerView isScanning={...}>` mounts a native `RoomCaptureView`; toggling
   `isScanning` calls `RoomCaptureSession.run()` / `.stop()` on the Swift side.
4. On session end, `RoomBuilder(options: [.beautifyObjects]).capturedRoom(from: data)`
   produces a `CapturedRoom`; doors/windows are mapped to `{type, widthMm, heightMm}` and
   emitted through the `onCaptureFinish` event.
5. JS receives the detected openings, the user reviews/edits type and keep-or-discard per
   item, then **Save**:
   - inserts one `building_elements` row per kept opening
     (`element_type: "transparant_deel"`, name `"<Window|Door> (LiDAR)"`, `is_complete: true`)
   - inserts one linked `openings` row (by `element_id`)
   - inserts two `measurements` rows (width, height), tagged `ingestion_path: "mobile"`
6. **Nothing else is persisted.** No mesh, point cloud, or USDZ file is exported or
   uploaded anywhere — only these derived numeric rows land in Postgres via Supabase.
   There is no Storage bucket and no API endpoint involved in this feature.

## Current status

### Working end to end
- Capability detection correctly disables the feature in Expo Go, on Android, and on
  unsupported iOS devices/versions.
- Full capture → review → edit → save flow, on a real LiDAR device with a dev-client or
  production/EAS build.
- Error handling for common RoomPlan failures (world-tracking loss, room too large) with
  a retry path and user-facing messages.
- A real double-`stop()` bug (stale `isCurrentlyScanning` flag) was found on-device and
  fixed.

### Partial / rolled back
- An `ARCoachingOverlayView` was added to guide users during scanning, then **reverted**
  after it caused scans to fail again almost immediately on a real device retry —
  `RoomCaptureSession` expects to exclusively own its `ARSession`, and attaching the
  overlay broke that. There is currently **no in-scan coaching UI**, only after-the-fact
  error messages. See comments in `ExpoRoomScannerView.swift` (~lines 33–41, 117) — the
  author notes RoomPlan behavior can't be verified against the real SDK outside a live
  device, so this needs on-device re-verification before retrying.

### Not implemented
- No point cloud / mesh / USDZ export — only door/window bounding dimensions are pulled
  out of `CapturedRoom`; the rest of RoomPlan's geometry (walls, floor, full mesh) is
  discarded.
- No connection to the separate `floorplan.tsx` screen — that's a distinct manual/photo
  upload feature (`expo-image-picker`), unrelated to this RoomPlan path.
- No Android/ARCore equivalent — explicitly out of scope (Kotlin stub comment).
- Not tracked in `GAP.md` — this feature has no entry in the project's usual
  definition-of-done checklist.

## Platform support

- **iOS only.** Requires iOS 16+ (RoomPlan minimum) and LiDAR hardware (iPhone/iPad Pro).
- Requires a custom dev-client or EAS/production build — **does not work in Expo Go**.
- **Android:** fully stubbed, feature hidden behind the same support check.
- Will report unsupported in the iOS Simulator (no LiDAR sensor).

## Timeline

| Date | Commit | Change |
|---|---|---|
| 2026-09-04 | `d40584f` | Initial LiDAR room scanning via `expo-room-scanner` module |
| 2026-09-07 | `9619d61` | Non-blocking notice when LiDAR unsupported |
| 2026-09-08 | `2a7a533` | Fix black-screen scan (sync `RoomCaptureView` frame on layout) |
| 2026-09-10 | `f8bbff1` | Add ARKit coaching overlay + friendlier error messages |
| 2026-09-11 | `6b83b64` | Revert coaching overlay (live regression), fix stale scanning-flag bug |

## Suggested next steps

1. Re-attempt in-scan guidance (coaching overlay or custom equivalent) with on-device
   verification before merging, given the prior regression.
2. Decide whether to retain and upload the fuller `CapturedRoom` geometry (walls, floor,
   mesh/USDZ) for record-keeping, or confirm door/window dimensions are the only data
   the calc pipeline needs.
3. Add an entry to `GAP.md` so this feature is tracked against the same
   definition-of-done bar as the rest of the mobile app.
