#!/usr/bin/env bash
# ============================================================
# Scarnergy — EAS iOS Cloud Build Trigger
#
# Triggers an EAS (Expo Application Services) iOS build entirely
# in Expo's cloud. No Xcode / Android SDK required locally — this
# only needs an Expo Access Token and network access.
#
# Usage:
#   npm run build:ios:cloud            # uses the "production" profile
#   npm run build:ios:cloud -- preview # any profile from eas.json
#   bash scripts/eas-build-ios.sh testflight
#
# Credentials (see docs/EAS_BUILD.md):
#   EXPO_TOKEN  — Expo Personal Access Token. Resolved from, in order:
#                   1. the environment
#                   2. .env.local        (preferred — git-ignored & untracked)
#                   3. .env              (note: this file IS git-tracked, avoid)
#   App ID      — read from app.json (extra.eas.projectId), already configured.
#
# The script verifies the token (GraphQL `viewer` query), confirms the
# token can see the project, then runs `eas build` non-interactively with
# --no-wait so it returns immediately with a build URL to watch on expo.dev.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PROFILE="${1:-production}"
PROJECT_ID="e41c9a9f-d0c2-4076-9392-3e36e42169c0"   # app.json → extra.eas.projectId
GRAPHQL_URL="https://api.expo.dev/graphql"

BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"; RESET="\033[0m"

log()  { echo -e "  ${CYAN}[eas-ios]${RESET} $*"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $*"; }
die()  { echo -e "  ${RED}✗${RESET} $*" >&2; exit 1; }

# ── 1. Resolve EXPO_TOKEN ────────────────────────────────────────────────────
# Prefer an already-exported token, then .env.local (git-ignored), then .env.
resolve_token() {
  if [[ -n "${EXPO_TOKEN:-}" ]]; then
    log "Using EXPO_TOKEN from environment"
    return 0
  fi
  for f in "$ROOT_DIR/.env.local" "$ROOT_DIR/.env"; do
    if [[ -f "$f" ]]; then
      local val
      val=$(grep -E '^EXPO_TOKEN=' "$f" 2>/dev/null | head -1 | sed -E 's/^EXPO_TOKEN=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true)
      if [[ -n "$val" ]]; then
        EXPO_TOKEN="$val"
        log "Using EXPO_TOKEN from ${f#$ROOT_DIR/}"
        if [[ "$f" == "$ROOT_DIR/.env" ]]; then
          warn ".env is git-tracked — move EXPO_TOKEN to .env.local to keep it out of git"
        fi
        return 0
      fi
    fi
  done
  die "EXPO_TOKEN not found. Add it to .env.local (EXPO_TOKEN=...) or export it. See docs/EAS_BUILD.md"
}

# ── 2. Verify the token via the documented GraphQL viewer query ──────────────
verify_token() {
  log "Verifying Expo Access Token…"
  local resp username
  resp=$(curl -s -X POST "$GRAPHQL_URL" \
    -H "Authorization: Bearer $EXPO_TOKEN" \
    -H "Content-Type: application/json" \
    --max-time 15 \
    -d '{"query":"query { viewer { username accounts { name } } }"}' 2>/dev/null || true)

  if [[ -z "$resp" ]]; then
    die "No response from Expo API ($GRAPHQL_URL). Check your network connection."
  fi
  if echo "$resp" | grep -q '"errors"'; then
    warn "Expo API returned an error:"
    echo "    $resp" >&2
    die "Token rejected (401 / unauthorized?). Confirm it was copied correctly and has not expired."
  fi

  username=$(echo "$resp" | sed -nE 's/.*"username"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')
  [[ -z "$username" ]] && die "Could not read viewer.username from Expo response — token may be invalid."
  ok "Authenticated as Expo user: ${BOLD}${username}${RESET}"

  # Confirm the token can see the 'krontiva-africa' owner account that owns this project.
  if echo "$resp" | grep -q '"name"[[:space:]]*:[[:space:]]*"krontiva-africa"'; then
    ok "Token has access to the 'krontiva-africa' account (project owner)"
  else
    warn "The 'krontiva-africa' account was not listed for this token."
    warn "The build may fail if this token cannot access project $PROJECT_ID."
    warn "Accounts visible to this token: $(echo "$resp" | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)"$/\1/' | paste -sd ', ' -)"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[Scarnergy] EAS iOS cloud build${RESET}"
log "Project: $PROJECT_ID"
log "Profile: $PROFILE"

resolve_token
verify_token

# ── 3. Trigger the build (cloud) ─────────────────────────────────────────────
# Use npx with a recent eas-cli — eas.json requires >= 18.4.0, which the
# stale local devDependency (^10) does not satisfy.
log "Triggering iOS build via EAS (this runs in Expo's cloud)…"
echo ""

cd "$ROOT_DIR"
EXPO_TOKEN="$EXPO_TOKEN" npx --yes eas-cli@latest build \
  --platform ios \
  --profile "$PROFILE" \
  --non-interactive \
  --no-wait

echo ""
ok "Build submitted. Watch progress at:"
log "https://expo.dev/accounts/krontiva-africa/projects/scarnergy-app/builds"
echo ""
