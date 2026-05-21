# Scarnergy v2.0 — Process Flows

## 1. App Startup Flow

```
npm start (in scarnergy-app/)
    │
    ├─ prestart: scripts/detect-dev-ip.sh
    │     • Detects LAN IP (en0/en1)
    │     • Verifies Supabase on :54321
    │     • Rewrites EXPO_PUBLIC_SUPABASE_URL in .env if changed
    │
    └─ expo start → Metro Bundler (port 8082)
          │
          └─ App opens on device
                │
                ▼
         app/_layout.tsx
           • DEV_BYPASS_AUTH=true?
             YES → inject DEV_PROFILE into Zustand store
                   (id: 00…000, org_id: 00…001, role: admin)
             NO  → loadProfile() → fetch user_profiles from Supabase
           • Navigate to /tabs (authenticated) or /auth/sign-in
```

---

## 2. Authentication Flow (Production)

```
User opens app → /auth/sign-in
    │
    ├─ signIn(email, password)
    │     └─ supabase.auth.signInWithPassword()
    │           │
    │           └─ GoTrue validates credentials
    │                 └─ custom_access_token_hook() fires
    │                       • Reads user_profiles to get org_id + user_role
    │                       • Injects org_id, user_role into JWT claims
    │                 └─ Returns enriched JWT
    │
    ├─ loadProfile()
    │     └─ SELECT * FROM user_profiles WHERE id = auth.uid()
    │           └─ Stores in Zustand: { profile }
    │
    └─ Navigate to /tabs
```

**Important:** `custom_access_token_hook` must be registered in the Supabase Dashboard under Authentication → Hooks for production JWTs to carry `org_id`. Without this, all RLS policies silently block everything.

---

## 3. Inspection Session Lifecycle

```
BUILDING LIST
─────────────
User opens Buildings tab
  └─ building_summary view (org filtered)
        Shows: address, zone/element counts, last energy label

  Tap "Start Inspection" on a building
  └─ INSERT inspection_sessions
        org_id, building_id, inspector_id
        session_code auto-generated: INS-YYYY-NNNN
        status = 'active'
  └─ Navigate to /tabs/sessions/[id]

SESSION DETAIL
──────────────
  Load session from session_summary view
  Load zones WHERE building_id = session.building_id
  Load building_elements WHERE zone_id = selectedZoneId

  User taps element → /tabs/sessions/inspect?elementId=&sessionId=

ELEMENT INSPECTION
──────────────────
  Load building_elements with zone join
  Pre-fill values from existing length_mm/height_mm/width_mm

  → GLM 50C trigger press fills active slot (see BLE Flow below)
  → Manual keyboard entry (metres auto-converted to mm)
  → Tap photo button → camera/library → Supabase Storage upload

  Tap "Save"
  └─ UPDATE building_elements (dimensions + is_complete if all filled)
  └─ INSERT measurements (one row per filled slot)
        org_id, session_id, device_id, inspector_id, element_id
        value_mm, measurement_type, ingestion_path='mobile'
  └─ Navigate back to session detail

SESSION CLOSE
─────────────
  Tap "✓ Complete Session"
  └─ Try: supabase.functions.invoke('session_close')
          (validates + computes zone energy labels server-side)
     Fallback: supabase.rpc('close_inspection_session')
  └─ status → 'completed', completed_at set, duration computed

  Tap "↓ Export XML"
  └─ Load all zones, elements, measurements for session
  └─ Build XML tree (ScanergyExport v1.0 format)
  └─ iOS/Android Share sheet

SESSION STATUS TRANSITIONS
───────────────────────────
  active  →  paused     (inspector pauses mid-inspection)
  paused  →  active     (inspector resumes)
  active  →  completed  (session_close RPC / edge function)
  active  →  cancelled  (admin only)
```

---

## 4. BLE Measurement Capture Flow

```
CONNECT
───────
User opens Device tab → "Scan for GLM 50C"
  └─ requestPermissions() (Android: BLUETOOTH_SCAN, BLUETOOTH_CONNECT, FINE_LOCATION)
  └─ manager.startDeviceScan()
        • Filter: name contains "GLM" / "BOSCH" OR serviceUUIDs includes d0 UUID
        • Timeout: 15 seconds
  └─ On match: manager.stopDeviceScan() → device.connect()
  └─ discoverAllServicesAndCharacteristics()
  └─ monitorCharacteristicForService(d0, d1, callback)
        ← Subscribe to d0/d1 ONLY
           DO NOT subscribe to f0 service (causes immediate disconnect)
  └─ Write CMD_ENABLE (C0 55 02 01 00 1A) to d0/d1
        • Retry up to 3× with 400ms/800ms/1200ms backoff
        • Success → cmdEnabled=true (trigger-press GATT mode)
        • Failure → cmdEnabled=false (continuous fallback mode)
  └─ Upsert ble_devices record in Supabase

MEASUREMENT DISPATCH
────────────────────
On each BLE notification from d0/d1:

  decodePacket(base64) → GLMMeasurement | null
    • 4-byte packet: C0 <type> <hi> <lo> → value_mm = uint16BE × 10
                     range check: 50mm–50,000mm
    • 8-byte packet: C0 55 10 06 <batt> <??> <flags> <float32LE>
                     float32 × 1000 → value_mm (offsets 7, 6, 4 tried in order)
                     range check: 1mm–50,000mm

  if is_continuous=false  →  dispatch regardless (user pressed trigger)
  if is_continuous=true   →  dispatch only if pendingMeasurementRef=true

SLOT FILL
─────────
  onMeasurementRef callback:
    1. Check activeSlotRef (current focused slot)
    2. If null → find first slot where value is empty/zero
    3. setValues({ [slot]: value_mm.toFixed(1) })
    4. Clear activeSlotRef

CAPTURE BUTTON (fallback for continuous mode)
─────────────────────────────────────────────
  GLM banner shows live value from lastMeasurement
  Tap "⊙ Capture NNN mm → [slot]"
    → captureNow(lastMeasurement.value_mm)
    → fills the active slot immediately (no pending flag needed)

DISCONNECT
──────────
  device.onDisconnected() → setState('disconnected')
  OR user taps "Disconnect" → device.cancelConnection()
```

---

## 5. Realtime Data Flow

```
App opens Session Detail [id]
  └─ useLiveMeasurements(sessionId)
        │
        ├─ fetchInitial: SELECT FROM measurements WHERE session_id = id
        │                               AND is_deleted = false
        │                               ORDER BY measured_at DESC LIMIT 100
        │
        └─ supabase.channel('session-live:{id}')
              .on('postgres_changes', { event: 'INSERT', table: 'measurements',
                                        filter: 'session_id=eq.{id}' })
              .subscribe()

When measurements.INSERT fires in PostgreSQL:
  └─ Supabase Realtime picks up the WAL change
  └─ Broadcasts to all subscribed channels for that session_id
  └─ App receives payload.new → prepends to measurements list
        (deduplication: skip if id already present from optimistic insert)
```

For Realtime to work with the dev bypass JWT, `supabase.realtime.setAuth(DEV_JWT)` must be called during client initialisation (done in `lib/supabase.ts` and `lib/supabase.web.ts`).

---

## 6. Offline Sync Flow

```
Inspector is offline / network flaky
  └─ Measurement writes use `useSyncQueue`
        • Enqueue operation locally (AsyncStorage)
        • Return optimistic success to UI
        • pendingCount increments

App comes back online
  └─ drain() called (automatic on reconnect OR manual "Sync Now" button)
        • Process queue FIFO
        • For each pending item: retry the Supabase INSERT/UPDATE
        • On success: remove from queue, decrement pendingCount
        • On failure: increment retry_count, exponential backoff

Dashboard shows "⟳ N pending sync" badge when pendingCount > 0
```

---

## 7. Data Export Flow

```
Session completed → "↓ Export XML"
  └─ Load all zones for the building
  └─ Load all building_elements for those zones
  └─ Load all measurements for the session (filtered by element_id)
  └─ Build ScanergyExport XML:

<?xml version="1.0" encoding="UTF-8"?>
<ScanergyExport version="1.0" generated_at="2026-05-20T...">
  <Session id="...">
    <SessionCode>INS-2026-0001</SessionCode>
    <Status>completed</Status>
    <Inspector>Jan de Vries</Inspector>
    <Building>
      <Address>Jordaanstraat 14, 1016 ZZ Amsterdam</Address>
    </Building>
    <Zones>
      <Zone id="..." code="Z01">
        <Name>Begane grond</Name>
        <FloorLevel>0</FloorLevel>
        <Elements>
          <Element id="..." type="gevel">
            <Name>Voorgevel (Noord)</Name>
            <LengthMM>4200</LengthMM>
            <HeightMM>2800</HeightMM>
            <Measurements>
              <Measurement>
                <MeasurementType>length</MeasurementType>
                <ValueMM>4200</ValueMM>
                <MeasuredAt>2026-05-20T09:14:22Z</MeasuredAt>
              </Measurement>
            </Measurements>
          </Element>
        </Elements>
      </Zone>
    </Zones>
  </Session>
</ScanergyExport>

  └─ iOS/Android Share sheet (AirDrop, email, Files, etc.)
```
