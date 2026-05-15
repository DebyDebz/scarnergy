#!/usr/bin/env bash
# Scarnergy BLE Bridge — cross-platform launcher (macOS + Linux)
#
# Runs on the machine with Bluetooth hardware (MacBook, field laptop, Pi).
# Pushes measurements to Supabase on the server over HTTPS — no BlueZ on server.
#
# Usage:
#   ./start-bridge.sh              BLE mode — needs Bluetooth hardware (MacBook/Pi)
#   ./start-bridge.sh --relay      Relay mode — no Bluetooth needed, runs on server
#   ./start-bridge.sh --monitor    BLE connect only, no DB writes
#   ./start-bridge.sh --scan       scan for nearby BLE devices and exit
#
# Relay mode: starts a WebSocket server on port 8765 that polls Supabase for
# new measurements and broadcasts them to the web dashboard. Run this on the
# server; the browser auto-connects to ws://<server-ip>:8765.
#
# Prerequisites (auto-installed if missing):
#   BLE mode:   pip3 install -r ble_bridge/requirements.txt
#   Relay mode: pip3 install websockets python-dotenv

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="$ROOT/ble_bridge"

# ── python check ──────────────────────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 not found."
  echo "  macOS: brew install python"
  echo "  Linux: sudo apt install python3 python3-pip"
  exit 1
fi

# ── dependency check ──────────────────────────────────────────────────────────
# In --relay mode bleak is not needed (no Bluetooth hardware required)
RELAY_MODE=false
for arg in "$@"; do [[ "$arg" == "--relay" ]] && RELAY_MODE=true; done

if $RELAY_MODE; then
  python3 -c "import websockets, dotenv" 2>/dev/null || \
    pip3 install websockets python-dotenv --quiet
else
  python3 -c "import bleak" 2>/dev/null || \
    pip3 install -r "$BRIDGE/requirements.txt" --quiet
fi

# ── hand off to the Python launcher ───────────────────────────────────────────
cd "$BRIDGE"
exec python3 launcher.py "$@"
