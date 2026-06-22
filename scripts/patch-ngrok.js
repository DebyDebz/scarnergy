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
    const args = ["tunnel", "--url", \`http://localhost:\${port}\`, "--no-autoupdate"];
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
