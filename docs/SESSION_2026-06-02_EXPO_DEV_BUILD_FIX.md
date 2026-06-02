# Expo Dev Build Fix — 2026-06-02

**Problem:** Scanning the QR code from `npm start` produced no response or a
"There was a problem loading the project" error on the device every time.

---

## Root Cause #1 — Hardcoded dead tunnel URL in `@expo/ngrok`

**File:** `node_modules/@expo/ngrok/index.js`

Someone had previously patched the `connect()` function to return a hardcoded
Cloudflare quick-tunnel URL as a workaround for a broken ngrok binary:

```js
async function connect(opts) {
  // Cloudflare tunnel bypass — ngrok is broken in this environment
  return "https://head-chelsea-wing-departmental.trycloudflare.com";
}
```

That URL was a one-time Cloudflare quick-tunnel hostname that expires the moment
its `cloudflared` process stops. Every call to `expo start --tunnel` returned
this dead URL, which no longer resolved in DNS — hence the "A server with the
specified hostname could not be found" error on the device.

**Fix:** Replaced the hardcoded return with a real `cloudflared` spawn that
waits for the live tunnel URL before resolving:

```js
async function connect(opts) {
  const { spawn } = require("child_process");
  const port = opts.addr || opts.port || 8085;
  // Kill any previous cloudflared we own
  if (_cfProcess) { try { _cfProcess.kill(); } catch (_) {} }

  return new Promise((resolve, reject) => {
    const proc = spawn("/tmp/cf/usr/bin/cloudflared",
      ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
      { stdio: ["ignore", "pipe", "pipe"] });
    _cfProcess = proc;
    const onData = (data) => {
      const match = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) { processUrl = match[0]; resolve(match[0]); }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
  });
}
```

**Persistence:** `scripts/patch-ngrok.js` re-applies this fix automatically via
the `postinstall` hook in `package.json` so it survives `npm install`.

---

## Root Cause #2 — Metro cache completely disabled

**File:** `metro.config.js`

```js
config.cacheStores = [];   // ← disabled caching entirely
```

The intent was to use a user-owned cache directory to avoid permission errors
on the shared `/tmp/metro-cache` path. But setting `cacheStores = []` disables
caching altogether — every QR scan forced Metro to re-transform every module
from scratch (2–10 minutes), causing the device connection to time out before
the first byte arrived.

**Fix:** Point to a user-owned `FileStore`:

```js
const { FileStore } = require('metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(os.homedir(), '.cache', 'metro-scarnergy') }),
];
```

---

## Root Cause #3 — `import.meta` Babel plugin replaced with `{}`

**File:** `babel.config.js`

The plugin replaced `import.meta` (a Vite/ESM construct unsupported by Metro)
with an empty object `{}`. Any code that accessed `import.meta.env.MODE` then
became `({}).env.MODE`, which throws `TypeError: Cannot read properties of
undefined` at runtime — causing silent crashes in packages like zustand.

**Fix:** Replace `import.meta` with a safe shim:

```js
path.replaceWith(
  t.objectExpression([
    t.objectProperty(
      t.identifier('env'),
      t.objectExpression([
        t.objectProperty(t.identifier('MODE'), t.stringLiteral('production')),
        t.objectProperty(t.identifier('DEV'),  t.booleanLiteral(false)),
      ]),
    ),
  ]),
);
```

---

## Root Cause #4 — VPS firewall blocks direct Metro port

This server uses public IP `212.69.86.210`. The cloud provider firewall does not
expose port `8085`, so the QR code URL `http://212.69.86.210:8085` is
unreachable from a phone on any external network.

**Fix:** Use tunnel mode (`npm run start:tunnel`) so the QR code encodes a
public Cloudflare HTTPS URL instead of the blocked server IP:

```bash
npm run start:tunnel   # starts Metro + cloudflared tunnel, QR uses tunnel URL
```

The `detect-dev-ip.sh` prestart script was also updated to detect public/VPS IPs
and warn when `npm run start:tunnel` should be used instead of `npm start`.

---

## Root Cause #5 — MQTT URL not updated by IP-detection script

**File:** `scripts/detect-dev-ip.sh`

The script updated `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_AI_SERVER_URL`
when the machine IP changed, but left `EXPO_PUBLIC_MQTT_WS_URL` pointing at the
old hardcoded IP.

**Fix:** Added a third replacement block for the MQTT WebSocket URL:

```bash
elif [[ "$line" =~ ^EXPO_PUBLIC_MQTT_WS_URL=ws:// ]]; then
  echo "EXPO_PUBLIC_MQTT_WS_URL=ws://${DETECTED_IP}:9001"
```

---

## Other fixes applied in this session

| File | Change |
|---|---|
| `app.json` | Added `"jsEngine": "hermes"` so EAS builds always compile for Hermes |
| `package.json` | Moved `@expo/ngrok` to `devDependencies`; removed unused `undici` |
| `lib/supabase.ts` | Added startup guard — throws a clear error if `EXPO_PUBLIC_SUPABASE_URL` is missing instead of silently passing `undefined` to `createClient` |
| `lib/supabase.web.ts` | Same startup guard applied |

---

## Dev build workflow (VPS environment)

```bash
# Terminal 1 — keep running
npm run start:tunnel

# The QR code encodes a live Cloudflare tunnel URL.
# Scan it with the Expo dev client on your device.
# Do NOT Ctrl+C while using the app — stopping Metro kills the tunnel.

# If you need to know the current tunnel URL (e.g. to enter manually):
npm run tunnel:url
```

---

## Seed credentials

| Role | Email | Password |
|---|---|---|
| Inspector | `nils@energeticas.nl` | `Opname2025!` |
| Admin | `admin@energeticas.nl` | `Admin2025!` |
| Dev (bypass) | `dev@scarnergy.test` | `DevBypass!` |

Auth bypass for fast dev iteration: set `EXPO_PUBLIC_DEV_BYPASS_AUTH=true` in
`.env` to skip the login screen entirely (logs in as Dev User / admin).
