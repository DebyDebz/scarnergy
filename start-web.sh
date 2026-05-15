#!/bin/bash
# ScanergyV2 — Web App Launcher
#
# Usage:
#   ./start-web.sh           normal start (keeps existing data)
#   ./start-web.sh --reset   wipe all volumes and start fresh

ROOT="$(cd "$(dirname "$0")" && pwd)"
INFRA="$ROOT/infrastructure"
APP="$ROOT/scarnergy-app"
WEB_PORT="${WEB_PORT:-8082}"

# ─── colours ──────────────────────────────────────────────────────────────────
BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"

step()  { echo ""; echo -e "${BOLD}${GREEN}[STEP $1]${RESET} $2"; }
info()  { echo -e "  ${YELLOW}→${RESET} $*"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $*"; }
die()   { echo -e "  ${RED}✗ $*${RESET}" >&2; exit 1; }

confirm() {
  echo ""
  read -rp "  Press Enter to continue or Ctrl+C to abort... "
}

# ─── wait for container health ────────────────────────────────────────────────
wait_healthy() {
  local name="$1" tries=30
  echo -n "  waiting for $name"
  while [ $tries -gt 0 ]; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$name" 2>/dev/null || echo "missing")
    [ "$status" = "healthy" ] && { echo -e " ${GREEN}✓${RESET}"; return 0; }
    echo -n "."
    sleep 2; tries=$((tries-1))
  done
  echo ""
  die "$name did not become healthy. Check: docker logs $name"
}

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗"
echo -e "║     SCARNERGY v2.0  —  Web Launcher      ║"
echo -e "╚══════════════════════════════════════════╝${RESET}"


# ─── STEP 0 : prerequisites ───────────────────────────────────────────────────
step 0 "Checking prerequisites"

# Load nvm if available
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js v20+ required (found: $(node --version 2>/dev/null || echo 'none'))\n\n  Fix:\n    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash\n    source ~/.bashrc\n    nvm install 22 && nvm use 22"
fi
ok "Node.js $(node --version)"

command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker info >/dev/null 2>&1      || die "Docker daemon is not running."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"


# ─── STEP 1 : optional reset ─────────────────────────────────────────────────
if [ "${1:-}" = "--reset" ]; then
  step 1 "Resetting all volumes (all data will be deleted)"
  info "This will run: docker compose down -v"
  confirm
  cd "$INFRA" && docker compose down -v
  ok "Volumes removed"
else
  step 1 "Reset check"
  info "Running in normal mode (existing data preserved)."
  info "To wipe all data and start fresh, run:  ./start-web.sh --reset"
fi


# ─── STEP 2 : start Docker backend ───────────────────────────────────────────
step 2 "Starting backend Docker services"
info "Services: db  auth  rest  meta  studio  kong"
info "Command:  docker compose up -d db auth rest meta studio kong"
confirm

cd "$INFRA"
docker compose up -d db auth rest meta studio kong

echo ""
wait_healthy scarnergy_db
ok "Database is healthy"


# ─── STEP 3 : bootstrap database (idempotent) ────────────────────────────────
step 3 "Bootstrapping database roles (safe to re-run)"
info "Creates Supabase system roles if they don't already exist."
info "Command:  docker exec scarnergy_db psql -U postgres -c \"...\""
confirm

docker exec scarnergy_db psql -U postgres -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'postgres';
    GRANT anon TO authenticator;
    GRANT authenticated TO authenticator;
    GRANT service_role TO authenticator;
    GRANT authenticator TO postgres;
  END IF;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT LOGIN PASSWORD 'postgres' CREATEROLE;
    CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
    GRANT ALL ON SCHEMA public TO supabase_auth_admin;
    GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
  END IF;
END
\$\$;
" 2>&1 | grep -v "^$" || true

info "Restarting auth + rest to pick up new roles..."
docker compose restart auth rest
ok "Auth and REST restarted"


# ─── STEP 4 : run migrations ──────────────────────────────────────────────────
step 4 "Running database migrations"
info "Applies all SQL files from supabase/migrations/ in order."
info "Command:  docker exec -i scarnergy_db psql ... < supabase/migrations/NNN_*.sql"
confirm

cd "$ROOT"
for f in "$ROOT"/supabase/migrations/0*.sql; do
  name=$(basename "$f")
  info "applying $name"
  docker exec -i scarnergy_db psql -U postgres -d postgres < "$f"__ 2>&1 \
    | grep -v "^$" | grep -v "^NOTICE" | grep -v "already exists" || true
done

info "Reloading PostgREST schema cache..."
cd "$INFRA" && docker compose restart rest
ok "Migrations done"


# ─── STEP 5 : install dependencies ───────────────────────────────────────────
step 5 "Installing web app dependencies"
info "Command:  cd scarnergy-app && npm install"
confirm

cd "$APP"
npm install --silent
ok "Dependencies installed"


# ─── STEP 6 : start web app ───────────────────────────────────────────────────
step 6 "Starting the web app"
info "Command:  npx expo start --web --port $WEB_PORT"
echo ""
echo -e "  ${BOLD}URLs:${RESET}"
echo -e "  ${GREEN}Web App         →  http://localhost:${WEB_PORT}${RESET}"
echo    "  Supabase Studio →  http://localhost:54323"
echo    "  API Gateway     →  http://localhost:54321"
echo ""
echo    "  Press Ctrl+C to stop the web server."
echo    "  To stop the backend:  cd infrastructure && docker compose down"
echo ""
confirm

npx expo start --web --port "$WEB_PORT"
