# SCARNERGY v2.0 — Module 1: Database Setup

Everything you need to get the database running locally and on Supabase.

---

## Prerequisites

Make sure you have these installed before starting:

```bash
# Check versions
node --version      # Need 20+
python3 --version   # Need 3.11+
docker --version    # Need 24+
```

Install the Supabase CLI:

```bash
npm install -g supabase
supabase --version   # Should show 1.x or 2.x
```

---

## Option A — Local Development (Docker, recommended to start)

### 1. Start the local stack

```bash
cd scarnergy/infrastructure
docker compose up -d

# Watch it come up (takes ~60 seconds first time)
docker compose logs -f db
```

Once the db service says `database system is ready to accept connections`, you're good.

### 2. Access the local services

| Service | URL | Credentials |
|---|---|---|
| Supabase Studio | http://localhost:54323 | — |
| PostgREST API | http://localhost:54321 | anon key in .env.example |
| Database (direct) | localhost:54322 | postgres / postgres |
| Grafana | http://localhost:3001 | admin / scarnergy |
| Metabase | http://localhost:3002 | set on first launch |
| MQTT broker | localhost:1883 | anonymous |
| Email (Inbucket) | http://localhost:54324 | — |

### 3. Run migrations manually (if not auto-loaded)

```bash
# Connect to the local database
psql postgresql://postgres:postgres@localhost:54322/postgres

# Run migrations in order
\i supabase/migrations/001_extensions.sql
\i supabase/migrations/002_core_schema.sql
\i supabase/migrations/003_building_hierarchy.sql
\i supabase/migrations/004_sessions_measurements.sql
\i supabase/migrations/005_rls_policies.sql
\i supabase/migrations/006_auth_hooks.sql
\i supabase/migrations/007_views_functions.sql
\i supabase/migrations/008_seed_data.sql
```

### 4. Verify everything is working

```bash
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -f supabase/migrations/rls_tests.sql
```

You should see 10 tests — all should show PASS or expected results.

---

## Option B — Supabase Cloud

### 1. Create a new project

1. Go to https://supabase.com/dashboard
2. Click **New project**
3. Name it `scarnergy-dev`
4. Set a strong database password and save it
5. Choose region closest to you (for EU: Frankfurt or Amsterdam)
6. Wait for project to provision (~2 minutes)

### 2. Get your credentials

From your Supabase project dashboard → **Settings → API**:

- Copy **Project URL** → `SUPABASE_URL` in your `.env`
- Copy **anon public** key → `SUPABASE_ANON_KEY`
- Copy **service_role secret** key → `SUPABASE_SERVICE_ROLE_KEY`

```bash
cp .env.example .env
# Fill in the three values above
```

### 3. Link and push migrations

```bash
# Link your local project to the cloud project
supabase link --project-ref your-project-ref

# Push all migrations
supabase db push

# Or run them individually in the SQL editor on the dashboard
```

### 4. Enable TimescaleDB

In Supabase Dashboard → **Database → Extensions**:
- Search for `timescaledb` → Enable it

> Note: TimescaleDB is available on Supabase Pro and above.
> For development, use the Docker stack (Option A) which includes it free.

### 5. Register the Auth JWT Hook

In Supabase Dashboard → **Authentication → Hooks**:
- Hook: **Custom Access Token**
- Function: `public.custom_access_token_hook`

This is what makes RLS tenant isolation work.

### 6. Run migrations

```bash
supabase db push
```

Or paste each migration file into the Supabase SQL Editor and run them in order.

---

## Create Your First Test User

```bash
# Using Supabase CLI
supabase auth admin create-user \
  --email admin@yourcompany.nl \
  --password YourPassword123! \
  --user-metadata '{
    "org_id": "00000000-0000-0000-0000-000000000001",
    "full_name": "Your Name",
    "role": "admin"
  }'
```

Or use the **Supabase Dashboard → Authentication → Users → Add user**.

The `handle_new_user` trigger automatically creates a `user_profiles` row.

---

## Validate the Schema

After running all migrations, open the SQL Editor and run:

```sql
-- Check all tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Should show: audit_log, ble_devices, building_elements, buildings,
-- inspection_sessions, measurements, openings, organisations,
-- sync_queue, user_profiles, zones

-- Check TimescaleDB hypertable
SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;
-- Should show: measurements

-- Check continuous aggregate
SELECT view_name FROM timescaledb_information.continuous_aggregates;
-- Should show: measurements_hourly

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' ORDER BY tablename;
-- All tables should show rowsecurity = true
```

---

## What's Next

Once your database is running and the tests pass, you're ready for **Module 2: Backend API & Auth**.

In Module 2 we'll:
- Validate every PostgREST endpoint
- Build the Edge Functions (energy_label_estimate, measurement_validate, session_close)
- Set up Supabase Storage buckets for photos
- Write the full API test suite

Just say **"Let's build Module 2"** when you're ready.
