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
# On a VPS/server the first IP is a public IP, not a LAN IP.
# A public IP is usable if the cloud firewall opens the Metro port — but if
# not (common on DigitalOcean / AWS / Hetzner), `npm run start:tunnel` is
# the correct command instead of plain `npm start`.
is_private_ip() {
  local ip="$1"
  [[ "$ip" =~ ^10\. ]] && return 0
  [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. ]] && return 0
  [[ "$ip" =~ ^192\.168\. ]] && return 0
  return 1
}

detect_ip() {
  local ip=""

  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: try common interface names in preference order
    for iface in en0 en1 en2 en3 utun0; do
      ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
      [[ -n "$ip" && "$ip" != "127."* ]] && echo "$ip" && return
    done
  else
    # Linux — prefer a private/LAN IP over a public one so that
    # local Wi-Fi scanning works without needing a tunnel.
    for ip in $(hostname -I 2>/dev/null); do
      [[ -z "$ip" || "$ip" == "127."* ]] && continue
      if is_private_ip "$ip"; then
        echo "$ip" && return
      fi
    done
    # No private IP found — fall back to the first non-loopback address.
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

# Warn when running on a VPS — direct Metro connections need the cloud firewall
# to allow the port. If they don't load, use `npm run start:tunnel` instead.
if ! is_private_ip "$DETECTED_IP"; then
  warn "Public/VPS IP detected ($DETECTED_IP). Metro port may be blocked by your cloud firewall."
  warn "If the QR code does not load on your device, run: npm run start:tunnel"
fi

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
  elif [[ "$line" =~ ^EXPO_PUBLIC_MQTT_WS_URL=ws:// ]]; then
    echo "EXPO_PUBLIC_MQTT_WS_URL=ws://${DETECTED_IP}:9001"
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
log "EXPO_PUBLIC_MQTT_WS_URL   = ws://${DETECTED_IP}:9001"
log "Metro will rebuild the bundle with the new URLs."
echo ""
