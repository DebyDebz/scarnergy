# Milestone 6 — Web Dashboard

Target users: supervisors and admins.
Inspectors use the mobile app; this dashboard is read-heavy with one write path (session close + inspector management).

---

## Tech stack decision

| Choice | Reason |
|---|---|
| **Next.js 14 (App Router)** | SSR auth guard, file-based routing, works with Supabase SSR client out of the box |
| **Supabase JS v2** | Same client + types already defined in `scarnergy-app/lib/supabase.ts` — copy and adapt |
| **Tailwind CSS** | Fast to build, no component library lock-in |
| **Recharts** | Lightweight charts for measurement time-series; Grafana iframe for deep analytics |

Project root: `web/` (new top-level directory alongside `scarnergy-app/`)

---

## File structure to create

```
web/
  app/
    layout.tsx                  Root layout — session provider, nav shell
    page.tsx                    Redirect → /dashboard
    auth/
      login/page.tsx            Sign-in form
    dashboard/
      page.tsx                  Home — KPI cards
    buildings/
      page.tsx                  Buildings list
      [id]/
        page.tsx                Building detail — zones + elements
    sessions/
      page.tsx                  All sessions (filterable by status / building)
      [id]/
        page.tsx                Session detail — live measurements feed
    inspectors/
      page.tsx                  Inspector list (admin only)
  components/
    nav/Sidebar.tsx             Left nav — role-aware links
    nav/TopBar.tsx              Org name, user menu, sign-out
    dashboard/KpiCard.tsx       Reusable stat tile (count + label + trend)
    dashboard/RecentSessions.tsx  Last 5 sessions table
    buildings/BuildingTable.tsx
    buildings/EnergyLabelBadge.tsx
    sessions/SessionStatusBadge.tsx
    sessions/MeasurementTable.tsx
    sessions/LiveFeed.tsx       Realtime subscription component
    sessions/AnomalyBanner.tsx
    charts/MeasurementChart.tsx Recharts line chart for value_mm over time
  lib/
    supabase.ts                 Supabase client (browser) — SSR-safe
    supabase-server.ts          Supabase client (server components / route handlers)
    types.ts                    Copy of Database types from mobile lib/supabase.ts
  middleware.ts                 Auth guard — redirect /dashboard → /auth/login if no session
```

---

## Phase 1 — Scaffold & Auth

**Deliverables:** repo runs locally, sign-in works, protected routes redirect.

| Task | File | Notes |
|---|---|---|
| `npx create-next-app@latest web --ts --tailwind --app` | `web/` | Bootstrap project |
| Install `@supabase/supabase-js @supabase/ssr` | `web/package.json` | `ssr` package handles cookie-based sessions in Next.js |
| Browser Supabase client | `web/lib/supabase.ts` | `createBrowserClient(url, anonKey)` |
| Server Supabase client | `web/lib/supabase-server.ts` | `createServerClient` reading cookies |
| Copy + adapt type definitions | `web/lib/types.ts` | From `scarnergy-app/lib/supabase.ts` — remove React Native imports |
| Auth middleware | `web/middleware.ts` | Protect all `/dashboard/**`, `/buildings/**`, `/sessions/**`, `/inspectors/**` |
| Sign-in page | `web/app/auth/login/page.tsx` | Email + password form → `supabase.auth.signInWithPassword` |
| Sign-out action | `web/components/nav/TopBar.tsx` | Server action → `supabase.auth.signOut()` + redirect |
| Root redirect | `web/app/page.tsx` | Check session → `/dashboard` or `/auth/login` |
| `.env.local` | `web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same values as mobile |

---

## Phase 2 — Navigation Shell

**Deliverables:** sidebar renders with role-aware links, top bar shows org + user.

| Task | File | Notes |
|---|---|---|
| Root layout with sidebar + top bar | `web/app/layout.tsx` | Persistent shell around all dashboard pages |
| Sidebar with role-gating | `web/components/nav/Sidebar.tsx` | Inspectors link hidden (supervisors don't create them); "Inspectors" only for `admin` role |
| Top bar | `web/components/nav/TopBar.tsx` | Fetch `user_profiles` row on load → display `full_name` + org name |
| Role helper | `web/lib/types.ts` | `type Role = 'inspector' \| 'supervisor' \| 'admin'` |

Nav links by role:

| Link | supervisor | admin |
|---|---|---|
| Dashboard | ✅ | ✅ |
| Buildings | ✅ | ✅ |
| Sessions | ✅ | ✅ |
| Inspectors | — | ✅ |

---

## Phase 3 — Dashboard Home

**Deliverables:** `/dashboard` shows org-level KPIs and recent activity.

| Task | File | Data source |
|---|---|---|
| KPI: active sessions today | `KpiCard` | `inspection_sessions` WHERE status='active' AND started_at >= today |
| KPI: total buildings | `KpiCard` | `buildings` count |
| KPI: anomalies (last 7 days) | `KpiCard` | `measurements` WHERE is_anomaly=true AND measured_at >= now-7d |
| KPI: measurements today | `KpiCard` | `measurements` count WHERE measured_at >= today |
| Recent sessions table (last 10) | `RecentSessions` | `session_summary` view ORDER BY started_at DESC LIMIT 10 |
| Row click → `/sessions/[id]` | | |

---

## Phase 4 — Buildings

**Deliverables:** Supervisors can browse buildings and see their inspection history.

| Task | File | Data source |
|---|---|---|
| Buildings list with search | `web/app/buildings/page.tsx` | `building_summary` view |
| Columns: reference code, address, type, zones, elements, sessions, last inspected, energy label | `BuildingTable` | `building_summary` |
| Energy label colour badge (A–G scale) | `EnergyLabelBadge` | `latest_energy_label` field |
| Building detail page | `web/app/buildings/[id]/page.tsx` | `building_summary` + join to `zones` |
| Zones accordion with element count | | `zones` + `building_elements` |
| Sessions for this building | | `session_summary` WHERE building_id=id |
| "View session" link → `/sessions/[id]` | | |

---

## Phase 5 — Sessions

**Deliverables:** Full session list and per-session detail with live measurements.

### Sessions list (`/sessions`)

| Task | File | Notes |
|---|---|---|
| Table with status filter tabs (all / active / completed / paused) | `web/app/sessions/page.tsx` | |
| Columns: code, building, inspector, started, measurements, anomalies, status | | `session_summary` view |
| Status badge | `SessionStatusBadge` | Color-coded: active=blue, completed=green, paused=orange |
| Row click → `/sessions/[id]` | | |

### Session detail (`/sessions/[id]`)

| Task | File | Notes |
|---|---|---|
| Session header (code, building, inspector, dates) | `web/app/sessions/[id]/page.tsx` | `session_summary` |
| Stats bar (total measurements, anomaly count) | | |
| Anomaly banner if anomaly_count > 0 | `AnomalyBanner` | |
| Measurement chart (value_mm over time) | `MeasurementChart` | Recharts — query `measurements` WHERE session_id=id ORDER BY measured_at |
| Live measurements feed (Supabase Realtime) | `LiveFeed` | Subscribe to `session-live:{id}` channel — same channel used by mobile app |
| Measurements table (paginated, most recent first) | `MeasurementTable` | `recent_measurements` view WHERE session_id=id |
| Anomaly-only filter toggle | | `is_anomaly=true` filter on query |
| Close session button (supervisor/admin only) | | POST to `/api/session-close` route handler → calls `session_close` edge function |

### Live feed implementation

```ts
// web/components/sessions/LiveFeed.tsx
supabase
  .channel(`session-live:${sessionId}`)
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "measurements",
    filter: `session_id=eq.${sessionId}`,
  }, (payload) => setMeasurements(prev => [payload.new, ...prev]))
  .subscribe()
```

---

## Phase 6 — Inspector Management (admin only)

**Deliverables:** Admins can view, invite, and deactivate inspectors.

| Task | File | Notes |
|---|---|---|
| Inspector list table | `web/app/inspectors/page.tsx` | `user_profiles` WHERE org_id=current_org AND role='inspector' |
| Columns: name, email, active, last session date | | join to `inspection_sessions` |
| Deactivate toggle | | PATCH `user_profiles` SET is_active=false |
| Invite inspector form | | `supabase.auth.admin.inviteUserByEmail` — requires service role key, call via server action |
| Guard: redirect non-admin away | `middleware.ts` or page | Check `role !== 'admin'` → 403 page |

---

## Phase 7 — Grafana embed (optional)

Grafana is already provisioned at `http://localhost:3001` with the `live_measurements` dashboard.

| Task | Notes |
|---|---|
| Embed Grafana panel via `<iframe>` in session detail | Use Grafana's panel share URL; set `kiosk=1` to strip Grafana chrome |
| Pass `var-session_id` URL param to scope the panel | Grafana variable must be defined in the dashboard JSON |
| Auth: set `GF_AUTH_ANONYMOUS_ENABLED=true` in docker-compose for embedded use | Already has provisioning config, add the env var |

---

## Phase 8 — AI / Energy label (web surface)

| Task | Notes |
|---|---|
| After session closes, fetch energy label from `/ai/energy` via Kong | Call from the close-session route handler |
| Display predicted label + confidence on session detail page | Next to session stats |
| Historical label trend chart per building | Query `measurements_hourly` continuous aggregate; chart label over time |

---

## Environment variables (`web/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from infrastructure/.env>
SUPABASE_SERVICE_ROLE_KEY=<service role key — server only, never NEXT_PUBLIC_>
```

---

## Docker / dev integration

Add to `infrastructure/docker-compose.yml` (development only):

```yaml
  web:
    build:
      context: ../web
      dockerfile: Dockerfile.dev
    container_name: scarnergy_web
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_SUPABASE_URL: http://kong:8000
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${ANON_KEY}
    volumes:
      - ../web:/app
      - /app/node_modules
    command: npm run dev
```

---

## Delivery order

| Phase | Unblocks |
|---|---|
| 1 — Scaffold & Auth | everything |
| 2 — Nav shell | all pages |
| 3 — Dashboard home | first useful supervisor screen |
| 4 — Buildings | drilling into inspections by location |
| 5 — Sessions (list + detail + live) | core monitoring workflow |
| 6 — Inspector management | admin user administration |
| 7 — Grafana embed | optional deep analytics |
| 8 — AI energy label | product differentiator surface |
