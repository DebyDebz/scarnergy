# SCARNERGY v2.0

Building inspection and energy assessment platform — Krontiva Africa / European Market

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/your-org/scarnergy.git && cd scarnergy
cp .env.example .env   # fill in your values

# 2. Start the full local stack
cd infrastructure && docker compose up -d

# 3. Run database migrations
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -f supabase/migrations/001_extensions.sql \
  -f supabase/migrations/002_core_schema.sql \
  -f supabase/migrations/003_building_hierarchy.sql \
  -f supabase/migrations/004_sessions_measurements.sql \
  -f supabase/migrations/005_rls_policies.sql \
  -f supabase/migrations/006_auth_hooks.sql \
  -f supabase/migrations/007_views_functions.sql \
  -f supabase/migrations/008_seed_data.sql

# 4. Train AI models
cd ai_server && pip install -r requirements.txt
python models/train_models.py

# 5. Start the AI server
uvicorn main:app --host 0.0.0.0 --port 8001

# 6. Start the BLE bridge (connect your GLM 50C first)
cd ble_bridge && pip install -r requirements.txt
python bridge.py --org-id 00000000-0000-0000-0000-000000000001

# 7. Start the mobile app
cd scarnergy-app && npm install
npx expo start
```

## Services

| Service | URL | Purpose |
|---|---|---|
| Supabase Studio | http://localhost:54323 | DB admin |
| PostgREST API | http://localhost:54321 | REST API |
| AI Server | http://localhost:8001/docs | ML inference |
| Grafana | http://localhost:3001 | Real-time dashboards |
| Metabase | http://localhost:3002 | BI analytics |
| MQTT | localhost:1883 | Message broker |

## Module Status

- [x] Module 1 — Database Schema (PostgreSQL + TimescaleDB + RLS)
- [x] Module 2 — API & Auth (PostgREST + Supabase Edge Functions)
- [x] Module 3 — BLE Integration (Python Bridge + ESP32 Firmware)
- [x] Module 4 — AI/ML Server (FastAPI + IsolationForest + RandomForest)
- [x] Module 5 — Mobile App (React Native + Expo)
- [x] Module 6 — Real-Time Pipeline (MQTT + Supabase Realtime)
- [x] Module 7 — Dashboards (Grafana + Metabase)
