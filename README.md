# SCARNERGY v2.0

Building inspection and energy assessment platform — Krontiva Africa / European Market

---

## Running the Web App (Quick Start)

> This is the recommended path for local development. Mobile (iOS/Android) is covered separately below.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Node.js](https://nodejs.org/) v20 or later (use [nvm](https://github.com/nvm-sh/nvm) — see note below)

**Node version note:** Expo SDK 54 requires Node ≥ 20. If you're on an older version:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22 && nvm alias default 22
```

---

### Step 1 — Clone and configure

```bash
git clone https://github.com/your-org/scarnergy.git && cd scarnergy
cp .env.example .env   # fill in your values (defaults work for local dev)
```

---

### Step 2 — Start the backend (Docker)

Run from inside the `infrastructure/` directory:

```bash
cd infrastructure
docker compose up -d db auth rest meta studio kong
```

Wait for the database to be healthy:

```bash
docker compose ps   # scarnergy_db should show (healthy)
```

> To also start dashboards: append `grafana metabase` to the command above.
> To start everything (including MQTT for BLE): `docker compose up -d`

---

### Step 3 — Bootstrap the database *(first time only)*

```bash
docker exec scarnergy_db psql -U postgres -c "
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'postgres';
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT authenticator TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE ROLE supabase_auth_admin NOINHERIT LOGIN PASSWORD 'postgres' CREATEROLE;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT ALL ON SCHEMA public TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
"
```

Then restart auth and REST to pick up the new roles:

```bash
docker compose restart auth rest
```

> Re-running this on an already-configured database produces harmless "already exists" errors.

---

### Step 4 — Run database migrations *(first time only)*

Run from the **project root** (not `infrastructure/`):

```bash
for f in 001 002 003 004 005 006 007 008; do
  docker exec -i scarnergy_db psql -U postgres -d postgres \
    < supabase/migrations/${f}_*.sql
done
```

Then reload the PostgREST schema cache:

```bash
cd infrastructure && docker compose restart rest
```

---

### Step 5 — Start the web app

```bash
cd scarnergy-app
npm install
npx expo start --web --port 8082
```

> Port 8081 may be occupied on shared machines — use any free port with `--port XXXX`.

Open **http://localhost:8082** in your browser.

---

### Services

| Service           | URL                                                     | Purpose              |
|-------------------|---------------------------------------------------------|----------------------|
| **Web App**       | http://localhost:8082                                   | Main application     |
| Supabase Studio   | http://localhost:54323                                  | DB admin UI          |
| API Gateway       | http://localhost:54321                                  | PostgREST + Auth     |
| pg-meta           | http://localhost:8081                                   | Supabase Studio backend |
| AI Server         | http://localhost:8001/docs                              | ML inference         |
| Grafana           | http://localhost:3001                                   | Real-time dashboards |
| Metabase          | http://localhost:3002                                   | BI analytics         |
| MQTT              | localhost:1883                                          | Message broker       |
| DB (direct)       | postgresql://postgres:postgres@localhost:54322/postgres | psql / migrations    |

---

### Stopping everything

```bash
cd infrastructure && docker compose down
```

Kill the web dev server with `Ctrl+C` in its terminal.

Full reset (deletes all data volumes):

```bash
cd infrastructure && docker compose down -v
```

---

## Full Stack (including AI server and BLE bridge)

### Train AI models

```bash
cd ai_server
pip install -r requirements.txt
python models/train_models.py
```

> If you see `InconsistentVersionWarning` about scikit-learn versions, run
> `pip install --upgrade scikit-learn` and retrain.

### Start the AI server

```bash
cd ai_server
uvicorn main:app --host 0.0.0.0 --port 8001
```

### Start the BLE bridge (Bosch GLM 50C)

Connect your device via Bluetooth first, then:

```bash
cd ble_bridge
pip install -r requirements.txt
python bridge.py --org-id 00000000-0000-0000-0000-000000000001
```

---

## Mobile App (iOS / Android)

> Bluetooth (BLE) only works in a native build — not in the browser or Expo Go.

```bash
cd scarnergy-app
npm install
npx expo start          # then press 'a' for Android or 'i' for iOS
```

For a device build:

```bash
npm run android         # or: npm run ios
```

---

## Known Limitations (dev environment)

- `timescale/timescaledb:2.13.0-pg15` does not include PostGIS, pgvector, or pg_net. Migrations handle this gracefully — those extensions are skipped with a warning. Location is stored as `latitude`/`longitude` NUMERIC columns.
- The database bootstrap (Step 3) only needs to run once per fresh database.
- Bluetooth (BLE) is disabled on web — the GLM Device tab will show "not available" in the browser. Use a native build for BLE functionality.
- `expo-secure-store` falls back to `localStorage` on web (implemented in `lib/supabase.ts`).

---

## Module Status

- [x] Module 1 — Database Schema (PostgreSQL + TimescaleDB + RLS)
- [x] Module 2 — API & Auth (PostgREST + Supabase Edge Functions)
- [x] Module 3 — BLE Integration (Python Bridge + ESP32 Firmware)
- [x] Module 4 — AI/ML Server (FastAPI + IsolationForest + RandomForest)
- [x] Module 5 — Web + Mobile App (React Native + Expo)
- [x] Module 6 — Real-Time Pipeline (MQTT + Supabase Realtime)
- [x] Module 7 — Dashboards (Grafana + Metabase)
