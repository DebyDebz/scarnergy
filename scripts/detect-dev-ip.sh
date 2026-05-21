#!/usr/bin/env bash
# ============================================================
# Scarnergy — Dev IP Auto-Detector
#
# Runs automatically before `npm start` via the prestart hook.
# Detects the current LAN IP of the machine running the Docker
# stack and updates EXPO_PUBLIC_SUPABASE_URL and
# EXPO_PUBLIC_AI_SERVER_URL in scarnergy-app/.env so native
# iOS/Android devices on the same Wi-Fi always reach the backend.
#
# Safe to run multiple times. Only rewrites the file when the
# IP actually changes. Does NOT touch any other .env lines.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; CYAN="\033[36m"; RESET="\033[0m"

log()  { echo -e "  ${CYAN}[ip-detect]${RESET} $*"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $*"; }

# ── 1. Detect candidate LAN IP ──────────────────────────────────────────────
detect_ip() {
  local ip=""

  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: try common interface names in preference order
    for iface in en0 en1 en2 en3 utun0; do
      ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
      [[ -n "$ip" && "$ip" != "127."* ]] && echo "$ip" && return
    done
  else
    # Linux
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    [[ -n "$ip" && "$ip" != "127."* ]] && echo "$ip" && return
  fi

  echo ""
}

# ── 2. Verify the candidate IP hosts the Supabase stack ─────────────────────
verify_supabase() {
  local ip="$1"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 3 "http://${ip}:54321/rest/v1/" 2>/dev/null || echo "000")
  # PostgREST returns 200 with the OpenAPI spec when healthy
  [[ "$http_code" == "200" ]] && return 0 || return 1
}

# ── 3. Read current value from .env ─────────────────────────────────────────
current_supabase_ip() {
  grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null \
    | sed -E 's|.*http://([^:]+):.*|\1|' || echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[Scarnergy] Detecting backend IP…${RESET}"

if [[ ! -f "$ENV_FILE" ]]; then
  warn ".env not found at $ENV_FILE — skipping IP detection"
  exit 0
fi

DETECTED_IP=$(detect_ip)

if [[ -z "$DETECTED_IP" ]]; then
  warn "Could not detect a LAN IP. Backend URLs unchanged."
  log  "If running in a browser only, localhost:54321 still works."
  exit 0
fi

log "Candidate IP: $DETECTED_IP"

# Verify Supabase is reachable on that IP
if ! verify_supabase "$DETECTED_IP"; then
  warn "Port 54321 not reachable on $DETECTED_IP — is the Docker stack running?"
  warn "Backend URLs unchanged. Run: cd infrastructure && docker compose up -d"
  exit 0
fi

CURRENT_IP=$(current_supabase_ip)

if [[ "$CURRENT_IP" == "$DETECTED_IP" ]]; then
  ok "IP unchanged ($DETECTED_IP) — .env is up to date"
  exit 0
fi

# ── Update .env in-place (macOS-compatible sed) ──────────────────────────────
# Only rewrites lines that match our two EXPO_PUBLIC URL patterns.
# All other lines (keys, JWT, ANON_KEY) are left untouched.

TMP=$(mktemp)
while IFS= read -r line; do
  if [[ "$line" =~ ^EXPO_PUBLIC_SUPABASE_URL=http:// ]]; then
    echo "EXPO_PUBLIC_SUPABASE_URL=http://${DETECTED_IP}:54321"
  elif [[ "$line" =~ ^EXPO_PUBLIC_AI_SERVER_URL=http:// ]]; then
    echo "EXPO_PUBLIC_AI_SERVER_URL=http://${DETECTED_IP}:8001"
  else
    echo "$line"
  fi
done < "$ENV_FILE" > "$TMP"

mv "$TMP" "$ENV_FILE"

if [[ -n "$CURRENT_IP" ]]; then
  ok "Updated IP: ${YELLOW}${CURRENT_IP}${RESET} → ${GREEN}${DETECTED_IP}${RESET}"
else
  ok "Set backend IP to ${GREEN}${DETECTED_IP}${RESET}"
fi
log "EXPO_PUBLIC_SUPABASE_URL  = http://${DETECTED_IP}:54321"
log "EXPO_PUBLIC_AI_SERVER_URL = http://${DETECTED_IP}:8001"
log "Metro will rebuild the bundle with the new URLs."
echo ""
