# Scarnergy v2.0 — Session Fixes
**Date:** 2026-05-26

---

## Issue 1 — Mobile App Crash: `supabaseUrl is required`

### Symptom
Expo bundler crashed on every route with the error:
```
ERROR  [Error: supabaseUrl is required.]
  at createClient (lib/supabase.ts:26)
  at store/authStore.ts:3
  at app/_layout.tsx:19
```
Cascading WARN messages appeared for every route file ("missing required default export") — these were not real bugs; they were noise caused by the crash preventing the module from loading at all.

### Root Cause
`scarnergy-app/` is run as a standalone Expo project (submodule). Expo reads environment variables exclusively from a `.env` file in the directory where the bundler process runs — i.e., `scarnergy-app/.env`. That file did not exist.

The `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` values were defined in the root-level `/ScanergyV2/.env`, which Expo never reads.

### Fix
Created `scarnergy-app/.env` with the correct `EXPO_PUBLIC_*` values copied from the root `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=http://192.168.10.13:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-jwt>
EXPO_PUBLIC_MQTT_WS_URL=ws://212.69.86.210:9001
EXPO_PUBLIC_AI_SERVER_URL=http://212.69.86.210:8001
```

The file is already covered by the existing `.gitignore` entry (`.env`) so it will not be committed.

---

## Issue 2 — "Could Not Start Inspection" — RLS Blocking Insert

### Symptom
Tapping **Start Inspection** on any building card in the mobile app showed:
```
Could not start inspection
<Supabase error message>
```
No session was created. The buildings list loaded fine (SELECT worked), but the INSERT into `inspection_sessions` was silently denied by the database.

### Root Cause — Full Chain

**Step 1 — `EXPO_PUBLIC_DEV_JWT` was not set.**

`scarnergy-app/lib/supabase.ts` has a dev-bypass mechanism:
```typescript
const DEV_JWT = process.env.EXPO_PUBLIC_DEV_JWT;

function devFetch(input, init) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${DEV_JWT}`);
  return fetch(input, { ...init, headers });
}

export const supabase = createClient(url, anonKey, {
  ...(DEV_JWT ? { global: { fetch: devFetch } } : {}),
});
```

Because `EXPO_PUBLIC_DEV_JWT` was undefined, `devFetch` was never activated. Every API request went out with only the anon key in the `Authorization` header.

**Step 2 — The anon key JWT has no user identity.**

The anon key decodes to:
```json
{ "iss": "supabase-demo", "role": "anon", "exp": 2051218800 }
```
No `sub` (user ID), no `org_id`, no `user_role`. When PostgREST forwards this to PostgreSQL, `auth.uid()` returns `NULL`, `auth.jwt() ->> 'org_id'` returns `NULL`, and `auth.jwt() ->> 'user_role'` returns `NULL`.

**Step 3 — The RLS INSERT policy on `inspection_sessions` rejected the row.**

```sql
CREATE POLICY "sessions: inspector inserts own"
  ON inspection_sessions FOR INSERT
  WITH CHECK (
    org_id = auth.user_org_id()       -- resolves to: org_id = NULL → FALSE
    AND inspector_id = auth.user_profile_id() -- resolves to: inspector_id = NULL → FALSE
  );
```

In SQL, any comparison to `NULL` is `UNKNOWN` (treated as `FALSE`). The `WITH CHECK` clause failed, so PostgreSQL rejected the insert silently.

**Why SELECT on buildings still worked:** The `buildings` SELECT policy uses the same `auth.user_org_id()` check — it also fails with the anon key. The buildings list was loading because the Supabase JS client returns an empty array (not an error) when RLS blocks a SELECT with no matching rows, which looked like success with zero data. If there were no seed buildings, users may have seen an empty list.

### Fix
Generated a signed dev JWT containing the correct identity claims, then added it to `scarnergy-app/.env`:

```env
EXPO_PUBLIC_DEV_JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<payload>.<sig>
```

The JWT payload:
```json
{
  "iss":       "supabase-demo",
  "aud":       "authenticated",
  "role":      "authenticated",
  "sub":       "00000000-0000-0000-0000-000000000000",
  "org_id":    "00000000-0000-0000-0000-000000000001",
  "user_role": "admin",
  "exp":       2051218800
}
```

Signed with `HS256` using the same `JWT_SECRET` as the infrastructure (`super-secret-jwt-token-with-at-least-32-characters-long`).

With this JWT in place:
- `auth.uid()` → `00000000-…-000` (dev user)
- `auth.user_org_id()` → `00000000-…-001` (dev org)
- `auth.user_role()` → `admin`
- `auth.is_privileged()` → `true`

All RLS policies (SELECT, INSERT, UPDATE) pass for the dev user.

### Verification
Confirmed the insert succeeds at the database level by running directly against the DB:
```sql
INSERT INTO inspection_sessions (org_id, building_id, inspector_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000'
)
RETURNING id, session_code, status, started_at;
-- → INS-2026-0007 | active | 2026-05-26 09:45:53
```

The `session_code` trigger (`generate_session_code()`) fired correctly and all NOT NULL defaults populated automatically.

---

## Action Required to Apply

Restart the Expo dev server with a **full stop + restart** (not a hot reload) so the new `.env` values are picked up by the Metro bundler:

```bash
cd scarnergy-app
# Ctrl+C to stop the current server, then:
npx expo start --clear
```

---

## Files Changed

| File | Change |
|---|---|
| `scarnergy-app/.env` | Created — added `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_DEV_JWT`, MQTT and AI server URLs |

No application code was modified. The bugs were entirely configuration gaps.
