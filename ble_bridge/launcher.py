#!/usr/bin/env python3
"""
Scarnergy BLE Bridge — interactive launcher.

Works on macOS (CoreBluetooth, no BlueZ) and Linux.
Discovers GLM devices, lets you pick a session, then starts the bridge.
All org/device/session data fetched from Supabase over HTTPS — no local DB needed.

Modes:
    python3 launcher.py              # BLE mode  — needs Bluetooth hardware
    python3 launcher.py --relay      # Relay mode — no Bluetooth needed (server-side)
    python3 launcher.py --monitor    # BLE connect, no DB writes
    python3 launcher.py --scan       # scan for BLE devices and exit

Relay mode:
    Subscribes to Supabase Realtime for new measurements and broadcasts them
    over a local WebSocket (ws://0.0.0.0:8765).  The web dashboard's
    BridgeConnector can then connect and receive measurements in real-time
    without a Bluetooth radio on this machine.
"""

import asyncio
import json
import os
import sys
import uuid
from urllib.request import urlopen, Request
from urllib.error import URLError
from urllib.parse import urlparse

# ─── colour helpers ──────────────────────────────────────────────────────────
BOLD  = "\033[1m"
GREEN = "\033[32m"
YELLOW= "\033[33m"
RED   = "\033[31m"
CYAN  = "\033[36m"
DIM   = "\033[2m"
RESET = "\033[0m"

def step(n, msg): print(f"\n{BOLD}{GREEN}[STEP {n}]{RESET} {msg}")
def info(msg):    print(f"  {YELLOW}→{RESET} {msg}")
def ok(msg):      print(f"  {GREEN}✓{RESET} {msg}")
def die(msg):     sys.exit(f"\n  {RED}✗ {msg}{RESET}\n")
def warn(msg):    print(f"  {YELLOW}⚠{RESET} {msg}")

def prompt(msg: str) -> str:
    print(f"  {CYAN}?{RESET} {msg} ", end="", flush=True)
    return input().strip()

def pick(items: list, label_fn, question: str, allow_skip=False):
    if allow_skip:
        print(f"  {DIM}[0]{RESET}  Monitor mode — no DB writes")
    for i, item in enumerate(items, 1):
        print(f"  {DIM}[{i}]{RESET}  {label_fn(item)}")
    raw = prompt(f"{question} [{'0-' if allow_skip else '1-'}{len(items)}]:")
    idx = int(raw) if raw.isdigit() else (1 if len(items) == 1 else -1)
    if allow_skip and idx == 0:
        return None
    if 1 <= idx <= len(items):
        return items[idx - 1]
    if len(items) == 1:
        return items[0]
    die("Invalid selection.")

# ─── Supabase REST helpers ────────────────────────────────────────────────────
def _headers(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}

def api_get(base: str, key: str, table: str, params: str = "") -> list:
    url = f"{base}/rest/v1/{table}{'?' + params if params else ''}"
    req = Request(url, headers=_headers(key))
    try:
        return json.loads(urlopen(req, timeout=10).read().decode())
    except URLError as e:
        die(f"Cannot reach Supabase at {base} — {e}\nCheck ble_bridge/.env.")
    return []

def api_post(base: str, key: str, table: str, body: dict) -> list:
    req = Request(
        f"{base}/rest/v1/{table}",
        data=json.dumps(body).encode(),
        headers={**_headers(key), "Content-Type": "application/json", "Prefer": "return=representation"},
        method="POST",
    )
    try:
        return json.loads(urlopen(req, timeout=10).read().decode())
    except URLError as e:
        die(f"API POST error — {e}")
    return []

# ─── Relay mode — no Bluetooth needed ────────────────────────────────────────
async def run_relay(supabase_url: str, service_key: str, org_id: str, ws_port: int = 8765):
    """
    Poll Supabase REST for new measurements in this org every 2 s,
    then broadcast each one over a local WebSocket server.
    The web BridgeConnector connects to ws://<this-host>:8765.
    No Bluetooth hardware or supabase-realtime library needed.
    """
    import websockets
    from datetime import datetime, timezone, timedelta

    ws_clients: set = set()

    async def ws_handler(websocket, _path=None):
        ws_clients.add(websocket)
        info(f"Browser connected ({len(ws_clients)} client(s))")
        try:
            await websocket.wait_closed()
        finally:
            ws_clients.discard(websocket)
            info(f"Browser disconnected ({len(ws_clients)} client(s))")

    async def broadcast(payload: dict):
        if not ws_clients:
            return
        msg  = json.dumps(payload)
        dead = set()
        for ws in ws_clients:
            try:
                await ws.send(msg)
            except Exception:
                dead.add(ws)
        ws_clients.difference_update(dead)

    server = await websockets.serve(ws_handler, "0.0.0.0", ws_port)
    ok(f"WebSocket relay listening on ws://0.0.0.0:{ws_port}")
    info("Browser → open the session page and click 'Connect GLM bridge'")
    info(f"URL to use: {BOLD}ws://{urlparse(supabase_url).hostname}:{ws_port}{RESET}")
    info("Polling Supabase for new measurements every 2 s…")
    info("Press Ctrl+C to stop.\n")

    # Start polling 5 seconds in the past to catch any very recent inserts
    last_seen = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()

    try:
        while True:
            try:
                rows = api_get(
                    supabase_url, service_key, "measurements",
                    f"org_id=eq.{org_id}&measured_at=gt.{last_seen}"
                    f"&order=measured_at.asc&limit=50&select=*",
                )
                for row in rows:
                    await broadcast(row)
                    val  = row.get("value_mm", "?")
                    flag = " ⚠" if row.get("is_anomaly") else " ✓"
                    print(f"  relay  {val}mm{flag}  → {len(ws_clients)} browser(s)")
                if rows:
                    last_seen = rows[-1]["measured_at"]
            except Exception as e:
                warn(f"Poll error: {e}")
            await asyncio.sleep(2.0)
    finally:
        server.close()
        await server.wait_closed()

# ─── BLE scan ────────────────────────────────────────────────────────────────
async def ble_scan(timeout: float = 10.0):
    from bleak import BleakScanner
    info(f"Scanning for Bluetooth devices ({timeout:.0f}s) …")
    info("Hold the BT button on the GLM 50C until the BT icon blinks.")
    devices = await BleakScanner.discover(timeout=timeout)
    return sorted(devices, key=lambda d: d.name or "")

# ─── main ─────────────────────────────────────────────────────────────────────
async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

    SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321").rstrip("/")
    SERVICE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    RELAY        = "--relay"   in sys.argv
    MONITOR      = "--monitor" in sys.argv
    SCAN_ONLY    = "--scan"    in sys.argv

    if not SERVICE_KEY:
        die("SUPABASE_SERVICE_ROLE_KEY is not set in ble_bridge/.env")

    print(f"\n{BOLD}╔══════════════════════════════════════════╗")
    print( "║   SCARNERGY v2.0  —  BLE Bridge Setup   ║")
    print(f"╚══════════════════════════════════════════╝{RESET}")
    print(f"  Platform : {CYAN}{sys.platform}{RESET}")
    print(f"  Server   : {CYAN}{SUPABASE_URL}{RESET}")
    print(f"  Mode     : {CYAN}{'relay (no BLE)' if RELAY else 'BLE'}{RESET}")

    # SSH warning for BLE mode only
    in_ssh = bool(os.getenv("SSH_CLIENT") or os.getenv("SSH_TTY") or os.getenv("SSH_CONNECTION"))
    if in_ssh and not RELAY and not SCAN_ONLY:
        print(f"""
  {YELLOW}{BOLD}⚠  SSH session detected — no Bluetooth hardware available.{RESET}

  Run in relay mode instead (WebSocket server, no BLE needed):

      {BOLD}python3 launcher.py --relay{RESET}

  Or run the bridge on your local Mac and connect the browser to:
      ws://<mac-ip>:8765
""")
        ans = prompt("Continue in BLE mode anyway? [y/N]:")
        if ans.lower() != "y":
            sys.exit(0)

    # ── Organisation ────────────────────────────────────────────────────
    step(1, "Connecting to Supabase")
    orgs = api_get(SUPABASE_URL, SERVICE_KEY, "organisations", "select=id,name")
    if not orgs:
        die("No organisations found. Run the seed migration first.")
    if len(orgs) == 1:
        org = orgs[0]; ok(f"Organisation: {org['name']}")
    else:
        org = pick(orgs, lambda o: o["name"], "Select organisation")
    org_id = org["id"]

    # ── Relay mode — skip BLE entirely ──────────────────────────────────
    if RELAY:
        step(2, "Starting WebSocket relay (Supabase Realtime → browser)")
        await run_relay(SUPABASE_URL, SERVICE_KEY, org_id)
        return

    # ── Scan-only mode ───────────────────────────────────────────────────
    if SCAN_ONLY:
        step(2, "BLE scan")
        devices = await ble_scan()
        if not devices:
            die("No devices found.")
        print(f"\n  Found {len(devices)} device(s):")
        for d in devices:
            print(f"    {d.address}  {d.name or '(unnamed)'}")
        return

    # ── BLE mode ─────────────────────────────────────────────────────────
    step(2, "Scanning for Bosch GLM 50C")
    print()
    try:
        found = await ble_scan()
    except Exception as e:
        print(f"\n  {RED}BLE scan failed:{RESET} {e}")
        print(f"""
  This machine has no Bluetooth hardware (or BlueZ is not installed).

  To use the bridge on this server, run in relay mode:

      {BOLD}python3 launcher.py --relay{RESET}

  Relay mode starts a WebSocket server on port 8765 that the web
  dashboard can connect to. Measurements arrive via Supabase Realtime.
""")
        sys.exit(1)

    if not found:
        warn("No Bluetooth devices found nearby.")
        if prompt("Retry scan? [Y/n]:").lower() != "n":
            found = await ble_scan()
    if not found:
        die("No Bluetooth devices found. Check the GLM is on and discoverable.")

    print(f"\n  Found {GREEN}{len(found)}{RESET} device(s) nearby:")

    # ── Device select / register ─────────────────────────────────────────
    step(3, "Selecting device")
    db_devs  = api_get(SUPABASE_URL, SERVICE_KEY, "ble_devices",
                       f"org_id=eq.{org_id}&is_active=eq.true&select=id,mac_address,nickname")
    mac_map  = {d["mac_address"].upper(): d for d in db_devs}

    chosen_ble = pick(
        found,
        lambda d: f"{d.address}  {CYAN}{d.name or '(unnamed)'}{RESET}",
        "Select your GLM 50C",
    )
    mac = chosen_ble.address.upper()

    if mac in mac_map:
        db_dev    = mac_map[mac]
        nickname  = db_dev.get("nickname") or "GLM"
        device_id = db_dev["id"]
        ok(f"Device registered: {nickname} ({mac})")
    else:
        warn(f"Device {mac} is not registered for this org yet.")
        nickname = prompt("Nickname for this device [GLM]:") or "GLM"
        result   = api_post(SUPABASE_URL, SERVICE_KEY, "ble_devices", {
            "org_id": org_id, "mac_address": mac, "nickname": nickname, "is_active": True,
        })
        device_id = result[0]["id"] if result else str(uuid.uuid4())
        ok(f"Registered: {nickname} → {device_id}")

    # ── Inspector ────────────────────────────────────────────────────────
    step(4, "Selecting inspector")
    profiles = api_get(SUPABASE_URL, SERVICE_KEY, "user_profiles",
                       f"org_id=eq.{org_id}&is_active=eq.true&select=id,full_name,role")
    if not profiles:
        die("No user profiles found. Create users in the web dashboard first.")
    inspector = pick(
        profiles,
        lambda p: f"{p['full_name']}  {DIM}({p['role']}){RESET}",
        "Select inspector for this session",
    )
    ok(f"Inspector: {inspector['full_name']} ({inspector['role']})")
    inspector_id = inspector["id"]

    # ── Session ──────────────────────────────────────────────────────────
    session_id    = None
    session_label = "(none — monitor mode, no DB writes)"

    if not MONITOR:
        step(5, "Selecting inspection session")
        sessions = api_get(SUPABASE_URL, SERVICE_KEY, "session_summary",
                           f"org_id=eq.{org_id}&status=eq.active"
                           f"&select=id,session_code,building_address,building_city"
                           f"&order=started_at.desc")
        if not sessions:
            warn("No active sessions found. Create one in the web dashboard first.")
            info("Falling back to monitor mode.")
        else:
            session = pick(
                sessions,
                lambda s: f"{s['session_code']}  {CYAN}{s['building_address']}, {s['building_city']}{RESET}",
                "Select session (0 = monitor mode only)",
                allow_skip=True,
            )
            if session:
                session_id    = session["id"]
                session_label = f"{session['session_code']} — {session['building_address']}"
                ok(f"Session: {session_label}")
            else:
                info("Monitor mode — no DB writes.")

    # ── MQTT / launch ────────────────────────────────────────────────────
    mqtt_host = os.getenv("MQTT_HOST", urlparse(SUPABASE_URL).hostname or "localhost")
    mqtt_port = int(os.getenv("MQTT_PORT", "1883"))

    print(f"\n  {BOLD}Device   :{RESET}  {nickname} ({mac})")
    print(f"  {BOLD}Inspector:{RESET}  {inspector['full_name']}")
    print(f"  {BOLD}Session  :{RESET}  {session_label}")
    print(f"  {BOLD}WebSocket:{RESET}  ws://0.0.0.0:8765")
    print(f"  {BOLD}MQTT     :{RESET}  {mqtt_host}:{mqtt_port}")
    print(f"  {BOLD}Supabase :{RESET}  {SUPABASE_URL}")
    print(f"\n  Press {BOLD}Ctrl+C{RESET} to stop.\n")

    from bridge import ScarnergyBridge
    bridge = ScarnergyBridge(
        org_id       = org_id,
        supabase_url = SUPABASE_URL,
        supabase_key = SERVICE_KEY,
        mqtt_host    = mqtt_host,
        mqtt_port    = mqtt_port,
        session_id   = session_id,
        inspector_id = inspector_id,
    )
    await bridge.run([{"mac_address": mac, "device_id": device_id, "nickname": nickname}])


if __name__ == "__main__":
    asyncio.run(main())
