#!/usr/bin/env node
"use strict";

/**
 * Provider Pool WebUI — local-only server skeleton.
 *
 * Serves a read-only dashboard and sanitized state/policy endpoints.
 * Binds to 127.0.0.1 only; never exposes secrets.
 *
 * Usage:
 *   node tools/provider-pool-webui/server.js [--port <number>] [--help]
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = 4179;
const REPO_ROOT = path.resolve(__dirname, "../..");
const POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/provider-pool-policy.json");
const STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");

// --- CLI -------------------------------------------------------------------

function printHelp() {
  const msg = `
Provider Pool WebUI — local-only server skeleton

USAGE
  node tools/provider-pool-webui/server.js [OPTIONS]

OPTIONS
  --port <number>   Port to listen on (default: ${DEFAULT_PORT})
  --help            Show this help message and exit

ENDPOINTS
  GET /                   Dashboard (HTML)
  GET /api/state          Sanitized provider pool state (JSON)
  GET /api/policy         Provider pool policy (JSON, secrets stripped)
  GET /api/health         Server health check

DESCRIPTION
  Local-only HTTP server for viewing provider pool state and policy.
  Binds to 127.0.0.1 — not accessible from the network.
  Never serves secrets, API keys, or credentials.
`.trim();

  process.stdout.write(msg + "\n");
}

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--port") {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        process.stderr.write("Error: --port requires a valid port number (1-65535)\n");
        process.exit(2);
      }
      args.port = n;
    } else {
      process.stderr.write(`Error: unknown flag "${arg}"\n`);
      process.exit(2);
    }
  }
  return args;
}

// --- Data helpers ----------------------------------------------------------

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stripSecrets(policy) {
  if (!policy || typeof policy !== "object") return policy;
  const sanitized = JSON.parse(JSON.stringify(policy));
  // Remove sourcePath entries that may contain local paths
  if (Array.isArray(sanitized.providers)) {
    for (const p of sanitized.providers) {
      delete p.sourcePath;
    }
  }
  if (sanitized.secretSources) {
    delete sanitized.secretSources;
  }
  return sanitized;
}

// --- HTML dashboard --------------------------------------------------------

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Provider Pool Dashboard</title>
  <style>
    :root { --bg: #0d1117; --fg: #c9d1d9; --accent: #58a6ff; --ok: #3fb950; --warn: #d29922; --err: #f85149; --card: #161b22; --border: #30363d; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: var(--accent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
    .card h2 { font-size: 0.85rem; text-transform: uppercase; color: #8b949e; margin-bottom: 0.5rem; }
    .card .value { font-size: 1.8rem; font-weight: 700; }
    .ok { color: var(--ok); } .warn { color: var(--warn); } .err { color: var(--err); }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
    th { color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-available { background: rgba(63,185,80,0.15); color: var(--ok); }
    .badge-exhausted { background: rgba(210,153,34,0.15); color: var(--warn); }
    .badge-disabled { background: rgba(248,81,73,0.15); color: var(--err); }
    .footer { margin-top: 2rem; font-size: 0.75rem; color: #484f58; }
    #error { color: var(--err); margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>Provider Pool Dashboard</h1>
  <div id="error"></div>
  <div class="grid" id="summary"></div>
  <h2 style="font-size:1.1rem;margin-bottom:0.5rem;">Providers</h2>
  <table><thead><tr><th>ID</th><th>Status</th><th>Concurrency</th><th>Failures</th><th>Cooldown</th></tr></thead><tbody id="providers"></tbody></table>
  <div class="footer">Local-only &middot; 127.0.0.1 &middot; no secrets served &middot; <span id="ts"></span></div>
  <script>
    function badgeClass(s) { return 'badge badge-' + s; }
    async function load() {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('Failed to load state: ' + res.status);
        const data = await res.json();
        const g = data.global || {};
        document.getElementById('summary').innerHTML =
          card('Available', g.availableProviders, 'ok') +
          card('Exhausted', g.exhaustedProviders, 'warn') +
          card('Disabled', g.disabledProviders, 'err') +
          card('Active Workers', g.totalActiveWorkers, '') +
          card('Global Max', g.globalMaxWorkers, '');
        const rows = (data.providers || []).map(p =>
          '<tr><td>' + esc(p.id) + '</td>' +
          '<td><span class="' + badgeClass(p.status) + '">' + esc(p.status) + '</span></td>' +
          '<td>' + p.currentConcurrency + ' / ' + p.maxConcurrency + '</td>' +
          '<td>' + p.consecutiveFailures + '</td>' +
          '<td>' + (p.cooldownExpiresAt || '—') + '</td></tr>'
        ).join('');
        document.getElementById('providers').innerHTML = rows || '<tr><td colspan="5">No providers</td></tr>';
        document.getElementById('ts').textContent = g.capturedAt || 'unknown';
      } catch(e) { document.getElementById('error').textContent = e.message; }
    }
    function card(label, val, cls) { return '<div class="card"><h2>' + label + '</h2><div class="value ' + cls + '">' + (val ?? '—') + '</div></div>'; }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    load();
  </script>
</body>
</html>`;
}

// --- Routes ----------------------------------------------------------------

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;

  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (route === "/" || route === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml());
    return;
  }

  if (route === "/api/state") {
    const state = readJsonFile(STATE_PATH);
    if (!state) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "State file not available", path: STATE_PATH }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state, null, 2));
    return;
  }

  if (route === "/api/policy") {
    const policy = readJsonFile(POLICY_PATH);
    if (!policy) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Policy file not available", path: POLICY_PATH }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stripSecrets(policy), null, 2));
    return;
  }

  if (route === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

// --- Main ------------------------------------------------------------------

const args = parseArgs(process.argv);

const server = http.createServer(handleRequest);

server.listen(args.port, "127.0.0.1", () => {
  const addr = server.address();
  process.stdout.write(
    `Provider Pool WebUI listening on http://127.0.0.1:${addr.port}\n` +
    `  Dashboard:  http://127.0.0.1:${addr.port}/\n` +
    `  State API:  http://127.0.0.1:${addr.port}/api/state\n` +
    `  Policy API: http://127.0.0.1:${addr.port}/api/policy\n` +
    `  Health:     http://127.0.0.1:${addr.port}/api/health\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`Error: port ${args.port} is already in use\n`);
    process.exit(1);
  }
  throw err;
});
