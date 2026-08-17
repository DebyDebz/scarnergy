#!/usr/bin/env node
// Patches @expo/ngrok/index.js after every npm install.
// The original file had a hardcoded dead cloudflare URL in connect().
// This replaces it with a real cloudflared spawn so the tunnel is always live.
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "../node_modules/@expo/ngrok/index.js");
if (!fs.existsSync(target)) {
  console.log("[patch-ngrok] @expo/ngrok not found — skipping");
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");

// Already patched
if (src.includes("cloudflared quick tunnel")) {
  console.log("[patch-ngrok] already patched — skipping");
  process.exit(0);
}

const DEAD_CONNECT = /let processUrl = null;\s*let ngrokClient = null;\s*async function connect\(opts\) \{[\s\S]*?return connectRetry\(opts\);\s*\}/;

// Absolute path baked in at patch time (this script's own __dirname) — the
// generated code below runs from inside node_modules/@expo/ngrok, whose own
// __dirname would point to the wrong place, so this can't be resolved at
// runtime relative to the target file.
const EMPTY_CLOUDFLARED_CONFIG = path.join(__dirname, "cloudflared-empty-config.yml");

const LIVE_CONNECT = `let processUrl = null;
let ngrokClient = null;
let _cfProcess = null;

async function connect(opts) {
  // Use cloudflared quick tunnel — real tunnel, not a hardcoded dead URL.
  const { spawn } = require("child_process");
  const BINARY = "/tmp/cf/usr/bin/cloudflared";
  const port = opts.addr || opts.port || 8085;

  if (_cfProcess) {
    try { _cfProcess.kill(); } catch (_) {}
    _cfProcess = null;
  }

  return new Promise((resolve, reject) => {
    // --config points at a blank file so this anonymous quick tunnel never
    // inherits ~/.cloudflared/config.yml (a different, already-in-use named
    // tunnel with a catch-all "service: http_status:404" ingress rule) —
    // without this override every dev-tunnel request silently 404s before
    // ever reaching Metro, regardless of what --url says.
    const args = ["tunnel", "--config", ${JSON.stringify(EMPTY_CLOUDFLARED_CONFIG)}, "--url", \`http://localhost:\${port}\`, "--no-autoupdate"];
    const proc = spawn(BINARY, args, { stdio: ["ignore", "pipe", "pipe"] });
    _cfProcess = proc;

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error("cloudflared tunnel timed out after 20s"));
    }, 20000);

    const onData = (data) => {
      const text = data.toString();
      const match = text.match(/https:\\/\\/[a-z0-9-]+\\.trycloudflare\\.com/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        processUrl = match[0];
        // Force Expo to emit HTTPS manifest+bundle URLs for the tunnel host.
        // Without this Expo defaults the bundleUrl to http://<host>, which iOS
        // ATS blocks (public domain, cleartext) -> the dev client can fetch the
        // manifest (https wrapper) but never downloads the JS bundle, so the app
        // "does not load". Setting the proxy URL makes UrlCreator upgrade to https.
        process.env.EXPO_PACKAGER_PROXY_URL = match[0];
        resolve(match[0]);
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => { if (!resolved) { clearTimeout(timeout); reject(err); } });
    proc.on("exit", (code) => {
      if (!resolved) { clearTimeout(timeout); reject(new Error(\`cloudflared exited with code \${code}\`)); }
    });
  });
}`;

const patched = src.replace(DEAD_CONNECT, LIVE_CONNECT);

if (patched === src) {
  console.log("[patch-ngrok] pattern not matched — file may have changed, skipping");
  process.exit(0);
}

fs.writeFileSync(target, patched, "utf8");
console.log("[patch-ngrok] @expo/ngrok patched successfully");
