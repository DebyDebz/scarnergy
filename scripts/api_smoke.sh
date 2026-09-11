#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# API smoke test across the Kong gateway routes (GAP M8). READ-ONLY.
#
# Probes the same endpoints the web health dashboard uses (web/app/api/health/*):
#   kong     GET /                                    (gateway answers at all)
#   auth     GET /auth/v1/health
#   rest     GET /rest/v1/  (apikey)
#   storage  GET /storage/v1/health (apikey)
#   realtime GET /realtime/v1/api/tenants/realtime-dev/health (apikey)
#
# Usage: bash scripts/api_smoke.sh        (env from .env / .env.local, like
#        phase4_backend_smoke.sh; override with SUPABASE_URL / SUPABASE_ANON_KEY)
# Exit: non-zero if any probe fails. Runs against any live stack (local/staging).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

load_env() { [ -f "$1" ] && set -a && . "$1" && set +a; }
load_env .env; load_env .env.local

URL="${SUPABASE_URL:-${EXPO_PUBLIC_SUPABASE_URL:-}}"
ANON="${SUPABASE_ANON_KEY:-${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}}"
if [ -z "$URL" ] || [ -z "$ANON" ]; then
  echo "✗ Missing SUPABASE_URL / SUPABASE_ANON_KEY (or EXPO_PUBLIC_* in .env)"; exit 1
fi

FAILED=0
probe() { # name url [use_auth]
  local name="$1" url="$2" use_auth="${3:-}"
  local code
  if [ -n "$use_auth" ]; then
    # Realtime's tenant health additionally requires a Bearer token.
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
      -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$url")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H "apikey: $ANON" "$url")
  fi
  # Kong root answers 401/404 for unmatched/unauthed — that still proves the
  # gateway is up; the service probes must return 200.
  if [ "$name" = "kong" ] && [ "$code" != "000" ]; then
    echo "✓ $name  ($code)"
  elif [ "$code" = "200" ]; then
    echo "✓ $name  (200)"
  else
    echo "✗ $name  ($code)  $url"; FAILED=1
  fi
}

echo "── API smoke @ $URL ──"
probe kong     "$URL/"
probe auth     "$URL/auth/v1/health"
probe rest     "$URL/rest/v1/"
probe storage  "$URL/storage/v1/health"
probe realtime "$URL/realtime/v1/api/tenants/realtime-dev/health" auth

if [ "$FAILED" -eq 1 ]; then echo "✗ API smoke FAILED"; exit 1; fi
echo "✓ all Kong routes healthy"
