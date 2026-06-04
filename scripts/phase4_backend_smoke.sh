#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 4 — Layer B backend/DB smoke test for the unified floor-plan flow.
#
# Proves the data layer the flow writes to actually accepts every write, without
# a UI. READ-ONLY by default. Mutating writes require the explicit --write flag
# and operate ONLY on a clearly-named throwaway building (reference_code
# PHASE4-SMOKE), cleaning up afterwards.
#
# Usage:
#   bash scripts/phase4_backend_smoke.sh                         # read-only checks
#   bash scripts/phase4_backend_smoke.sh --write                 # + write path (needs a dev JWT)
#   bash scripts/phase4_backend_smoke.sh --login EMAIL PASS --write   # mint a JWT, then write
#
# Env: reads EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY / _DEV_JWT / _AI_SERVER_URL
#      from .env then .env.local (.env.local wins). --login overrides the JWT.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

WRITE=0; LOGIN_EMAIL=""; LOGIN_PASS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --write) WRITE=1; shift ;;
    --login) LOGIN_EMAIL="${2:-}"; LOGIN_PASS="${3:-}"; shift 3 ;;
    *) shift ;;
  esac
done

# ── Load env (.env then .env.local override) ────────────────────────────────
load_env() { [ -f "$1" ] && set -a && . "$1" && set +a; }
load_env .env; load_env .env.local

URL="${EXPO_PUBLIC_SUPABASE_URL:-}"
ANON="${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}"
AI="${EXPO_PUBLIC_AI_SERVER_URL:-}"
[ -z "$URL" ] || [ -z "$ANON" ] && { echo "✗ Missing SUPABASE_URL / ANON_KEY"; exit 1; }

# --login EMAIL PASS → mint an authenticated access_token via password grant.
if [ -n "$LOGIN_EMAIL" ]; then
  echo "→ logging in as $LOGIN_EMAIL …"
  LRESP=$(curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
    -H "Content-Type: application/json" -d "{\"email\":\"$LOGIN_EMAIL\",\"password\":\"$LOGIN_PASS\"}")
  LTOK=$(printf '%s' "$LRESP" | grep -o '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -z "$LTOK" ] && { echo "✗ login failed: $(printf '%s' "$LRESP" | head -c 200)"; exit 1; }
  EXPO_PUBLIC_DEV_JWT="$LTOK"; echo "✓ authenticated"
fi

JWT="${EXPO_PUBLIC_DEV_JWT:-$ANON}"          # fall back to anon if no dev JWT
[ "${EXPO_PUBLIC_DEV_JWT:-}" = "" ] && echo "⚠ EXPO_PUBLIC_DEV_JWT unset — using anon role (authenticated-only writes will be denied)."

REST="$URL/rest/v1"; STORAGE="$URL/storage/v1"
H_KEY=(-H "apikey: $ANON"); H_AUTH=(-H "Authorization: Bearer $JWT")
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok  - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL- $1   ($2)"; }
# code <method> <url> [curl-args...]  -> prints HTTP status
code() { local m="$1" u="$2"; shift 2; curl -s -o /tmp/p4body -w "%{http_code}" -X "$m" "$u" "${H_KEY[@]}" "${H_AUTH[@]}" "$@"; }

echo "── READ-ONLY CHECKS ─────────────────────────────────────────"

# R1 — REST reachable + zones schema has the three floor-plan columns
c=$(code GET "$REST/zones?select=id,floor_plan_points,floor_plan_scale_m,floor_plan_image_url&limit=1")
[ "$c" = "200" ] && ok "REST reachable; zones exposes floor_plan_points/scale/image_url" \
                 || bad "GET zones" "HTTP $c: $(head -c160 /tmp/p4body)"

# R2 — building_elements exposes grid_* columns (Stage 5 target)
c=$(code GET "$REST/building_elements?select=id,grid_x,grid_y,grid_w,grid_h,grid_rotation,element_type&limit=1")
[ "$c" = "200" ] && ok "building_elements exposes grid_* + element_type" \
                 || bad "GET building_elements" "HTTP $c: $(head -c160 /tmp/p4body)"

# R3 — measurements table reachable (Stage 6 target)
c=$(code GET "$REST/measurements?select=id,value_mm,element_id,measured_at&limit=1")
[ "$c" = "200" ] && ok "measurements reachable" \
                 || bad "GET measurements" "HTTP $c: $(head -c160 /tmp/p4body)"

# R4 — AI auto-detect endpoint (non-mutating; processes an image, no DB write)
IMG=$(ls img/*.jpeg img/*.jpg 2>/dev/null | head -1)
if [ -n "$AI" ] && [ -n "$IMG" ]; then
  c=$(curl -s -o /tmp/p4det -w "%{http_code}" -X POST "$AI/floorplan/detect?mode=full" -F "file=@$IMG")
  if [ "$c" = "200" ]; then
    rooms=$(grep -o '"rooms"' /tmp/p4det | wc -l)
    ok "AI /floorplan/detect responded 200 (sample: $(basename "$IMG"))"
  else bad "POST /floorplan/detect" "HTTP $c: $(head -c160 /tmp/p4det)"; fi
else echo "  skip- AI detect (no AI_SERVER_URL or no img/*.jpeg sample)"; fi

if [ "$WRITE" = "0" ]; then
  echo "──────────────────────────────────────────────────────────────"
  echo "  $PASS passed, $FAIL failed  (read-only). Re-run with --write to test the write path."
  exit $([ "$FAIL" = 0 ] && echo 0 || echo 1)
fi

echo "── WRITE CHECKS (throwaway PHASE4-SMOKE building) ───────────"
# Resolve the authenticated user's identity. user_profile_id() == auth.uid() ==
# user_profiles.id, and the profiles SELECT policy exposes the whole org, so a
# blind limit=1 could pick another member. Take the id straight from the JWT
# `sub` (the real auth.uid()), then fetch THAT profile's org_id.
JPAY=$(printf '%s' "$JWT" | cut -d. -f2); P=$(( ${#JPAY} % 4 )); [ "$P" -ne 0 ] && JPAY="$JPAY$(printf '=%.0s' $(seq $((4-P))))"
INSP=$(printf '%s' "$JPAY" | tr '_-' '/+' | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$INSP" ] && { bad "resolve identity" "no sub in JWT (anon role?)"; echo "Aborting writes."; exit 1; }
code GET "$REST/user_profiles?select=org_id&id=eq.$INSP" >/dev/null
ORG=$(grep -o '"org_id":"[^"]*"' /tmp/p4body | head -1 | cut -d'"' -f4)
[ -z "$ORG" ] && { bad "resolve profile" "no own profile for sub=$INSP: $(head -c160 /tmp/p4body)"; echo "Aborting writes."; exit 1; }

post() { code POST "$1" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$2"; }
patch(){ code PATCH "$1" -H "Content-Type: application/json" -d "$2"; }
idof() { grep -o '"id":"[^"]*"' /tmp/p4body | head -1 | cut -d'"' -f4; }

# W1 — create test building
c=$(post "$REST/buildings" "{\"org_id\":\"$ORG\",\"reference_code\":\"PHASE4-SMOKE\",\"street\":\"Test\",\"house_number\":\"1\",\"postal_code\":\"0000\",\"city\":\"Test\",\"building_type\":\"residential_single\",\"construction_year\":2000}")
BID=$(idof); { [ "$c" = "201" ] && [ -n "$BID" ]; } && ok "created test building" || { bad "create building" "HTTP $c: $(head -c160 /tmp/p4body)"; BID=""; }

if [ -n "$BID" ]; then
  # W2 — create zone
  c=$(post "$REST/zones" "{\"org_id\":\"$ORG\",\"building_id\":\"$BID\",\"zone_code\":\"Z01\",\"name\":\"Smoke Zone\",\"floor_level\":0}")
  ZID=$(idof); { [ "$c" = "201" ] && [ -n "$ZID" ]; } && ok "created test zone" || bad "create zone" "HTTP $c: $(head -c160 /tmp/p4body)"

  if [ -n "${ZID:-}" ]; then
    # W3 — Stage 2 polygon write
    c=$(patch "$REST/zones?id=eq.$ZID" '{"floor_plan_points":[{"x":0.1,"y":0.1},{"x":0.9,"y":0.1},{"x":0.9,"y":0.9},{"x":0.1,"y":0.9}]}')
    [ "$c" = "204" ] && ok "Stage 2: floor_plan_points write" || bad "patch points" "HTTP $c: $(head -c160 /tmp/p4body)"

    # W4 — Stage 4 scale write
    c=$(patch "$REST/zones?id=eq.$ZID" '{"floor_plan_scale_m":10.5}')
    [ "$c" = "204" ] && ok "Stage 4: floor_plan_scale_m write" || bad "patch scale" "HTTP $c: $(head -c160 /tmp/p4body)"

    # W5 — storage upload + public read. The bucket name is the FIRST path
    # segment (matches supabase.storage.from('floor-plans').upload(path)).
    OBJ="floor-plans/$BID/$ZID/floor_plan.jpg"
    if [ -n "${IMG:-}" ]; then
      c=$(curl -s -o /tmp/p4body -w "%{http_code}" -X POST "$STORAGE/object/$OBJ" "${H_KEY[@]}" "${H_AUTH[@]}" -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary "@$IMG")
      { [ "$c" = "200" ] || [ "$c" = "201" ]; } && ok "storage upload to floor-plans" || bad "storage upload" "HTTP $c: $(head -c160 /tmp/p4body)"
      PUB="$STORAGE/object/public/$OBJ"
      c=$(curl -s -o /dev/null -w "%{http_code}" "$PUB")
      [ "$c" = "200" ] && ok "storage public read" || bad "storage public read" "HTTP $c"
      patch "$REST/zones?id=eq.$ZID" "{\"floor_plan_image_url\":\"$PUB\"}" >/dev/null && ok "Stage 2: floor_plan_image_url write"
    fi

    # W6 — Stage 5 element insert (grid coords + enum)
    c=$(post "$REST/building_elements" "{\"org_id\":\"$ORG\",\"zone_id\":\"$ZID\",\"element_type\":\"gevel\",\"name\":\"Wall-01\",\"grid_x\":0.1,\"grid_y\":0.1,\"grid_w\":0.8,\"grid_h\":0.02,\"grid_rotation\":0,\"sort_order\":0}")
    EID=$(idof); { [ "$c" = "201" ] && [ -n "$EID" ]; } && ok "Stage 5: building_elements insert" || bad "insert element" "HTTP $c: $(head -c160 /tmp/p4body)"

    # W7 — Stage 6: a measurement belongs to an inspector's session, so create a
    # session first, then insert the measurement linked to it (satisfies the
    # "inspector inserts own" RLS on both tables).
    if [ -n "${EID:-}" ]; then
      c=$(post "$REST/inspection_sessions" "{\"org_id\":\"$ORG\",\"building_id\":\"$BID\",\"inspector_id\":\"$INSP\",\"session_code\":\"PHASE4-SMOKE\",\"status\":\"active\"}")
      SID=$(idof); { [ "$c" = "201" ] && [ -n "$SID" ]; } && ok "created test session" || bad "create session" "HTTP $c: $(head -c160 /tmp/p4body)"
      if [ -n "${SID:-}" ]; then
        c=$(post "$REST/measurements" "{\"org_id\":\"$ORG\",\"session_id\":\"$SID\",\"inspector_id\":\"$INSP\",\"element_id\":\"$EID\",\"value_mm\":2430,\"unit\":\"mm\",\"measurement_type\":\"length\",\"is_anomaly\":false,\"is_deleted\":false,\"ingestion_path\":\"smoke\"}")
        [ "$c" = "201" ] && ok "Stage 6: measurements insert" || bad "insert measurement" "HTTP $c: $(head -c160 /tmp/p4body)"
      fi
    fi

    # ── Cleanup: hard-delete what we created (best-effort) ──────────────────
    echo "── CLEANUP ──────────────────────────────────────────────────"
    [ -n "${EID:-}" ] && code DELETE "$REST/measurements?element_id=eq.$EID" >/dev/null
    [ -n "${SID:-}" ] && code DELETE "$REST/inspection_sessions?id=eq.$SID" >/dev/null
    [ -n "${EID:-}" ] && code DELETE "$REST/building_elements?id=eq.$EID" >/dev/null
    [ -n "${IMG:-}" ] && code DELETE "$STORAGE/object/$OBJ" >/dev/null
    code DELETE "$REST/zones?id=eq.$ZID" >/dev/null
  fi
  code DELETE "$REST/buildings?id=eq.$BID" >/dev/null
  # Verify the test building is gone (soft check)
  code GET "$REST/buildings?select=id&reference_code=eq.PHASE4-SMOKE" >/dev/null
  [ "$(cat /tmp/p4body)" = "[]" ] && ok "cleanup: test building removed" || bad "cleanup" "leftover rows: $(head -c120 /tmp/p4body)"
fi

echo "──────────────────────────────────────────────────────────────"
echo "  $PASS passed, $FAIL failed"
exit $([ "$FAIL" = 0 ] && echo 0 || echo 1)
