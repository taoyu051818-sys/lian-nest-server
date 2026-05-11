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
const QUEUE_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-queue-state.json");
const PLANNING_CONSOLE_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-planning-console.json");
const ACTIONS_DIR = path.join(__dirname, "actions");
const AUDIT_PATH = path.join(__dirname, ".audit-log.json");

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
  GET /api/workers        Active worker slots derived from provider state
  GET /api/resources      Concurrency utilization and headroom
  GET /api/queue          Queue state projection (empty if no file)
  GET /api/planning       Planning console state (empty if no file)
  GET /api/health         Server health check
  GET /api/actions        List available action modules
  POST /api/actions/preview  Preview an action (dry-run, no side effects)
  POST /api/actions/execute  Execute an action (requires confirmation for dangerous)
  GET /api/audit          View action execution audit trail (supports ?actionId=...&status=...&limit=N)

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

function readBody(req, cb) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf-8");
    if (!raw) {
      cb(null, {});
      return;
    }
    try {
      cb(null, JSON.parse(raw));
    } catch {
      cb(new Error("Invalid JSON"));
    }
  });
  req.on("error", cb);
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

// --- Action modules ---------------------------------------------------------

function listActionModuleFiles() {
  try {
    return fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  } catch {
    return [];
  }
}

function loadActionModules() {
  if (!fs.existsSync(ACTIONS_DIR)) return [];
  const modules = [];
  const files = listActionModuleFiles();
  for (const file of files) {
    try {
      const mod = require(path.join(ACTIONS_DIR, file));
      if (mod && typeof mod.id === "string" && typeof mod.label === "string") {
        modules.push({
          id: mod.id,
          label: mod.label,
          description: mod.description || "",
          dangerous: !!mod.dangerous,
        });
      }
    } catch {
      // skip broken module
    }
  }
  return modules;
}

function resolveAction(actionId) {
  if (!fs.existsSync(ACTIONS_DIR)) return null;
  const files = listActionModuleFiles();
  for (const file of files) {
    try {
      const mod = require(path.join(ACTIONS_DIR, file));
      if (mod && mod.id === actionId) return mod;
    } catch {
      // skip
    }
  }
  return null;
}

// --- Audit log --------------------------------------------------------------

function readAuditLog() {
  try {
    const raw = fs.readFileSync(AUDIT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendAuditEntry(entry) {
  const log = readAuditLog();
  log.push(entry);
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(log, null, 2), "utf-8");
}

// --- Secret stripping for action payloads -----------------------------------

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|auth)/i;

function sanitizeValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    // mask anything that looks like a key/token
    if (val.length > 20 && /^[A-Za-z0-9_\-]{20,}$/.test(val)) return "***REDACTED***";
    return val;
  }
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (typeof val === "object") return sanitizeObject(val);
  return val;
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = "***REDACTED***";
    } else {
      out[k] = sanitizeValue(v);
    }
  }
  return out;
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

  if (route === "/api/workers") {
    const state = readJsonFile(STATE_PATH);
    if (!state) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "State file not available" }));
      return;
    }
    const workers = [];
    for (const p of state.providers || []) {
      for (let i = 0; i < (p.currentConcurrency || 0); i++) {
        workers.push({
          workerId: `${p.id}-slot-${i}`,
          providerId: p.id,
          status: "running",
          startedAt: state.global?.capturedAt || null,
        });
      }
    }
    const byProvider = {};
    const byStatus = {};
    for (const w of workers) {
      byProvider[w.providerId] = (byProvider[w.providerId] || 0) + 1;
      byStatus[w.status] = (byStatus[w.status] || 0) + 1;
    }
    const payload = {
      workers,
      summary: {
        totalActive: workers.length,
        byProvider,
        byStatus,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  if (route === "/api/resources") {
    const state = readJsonFile(STATE_PATH);
    const policy = readJsonFile(POLICY_PATH);
    if (!state || !policy) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "State or policy file not available" }));
      return;
    }
    const globalMax = state.global?.globalMaxWorkers || policy.concurrency?.globalMaxWorkers || 0;
    const active = state.global?.totalActiveWorkers || 0;
    const providers = (state.providers || []).map((p) => {
      const max = p.maxConcurrency || 0;
      const cur = p.currentConcurrency || 0;
      return {
        id: p.id,
        maxConcurrency: max,
        currentConcurrency: cur,
        headroom: Math.max(0, max - cur),
        status: p.status || "unknown",
      };
    });
    const pct = globalMax > 0 ? Math.round((active / globalMax) * 100) : 0;
    const level = pct >= 90 ? "critical" : pct >= 70 ? "elevated" : "normal";
    const payload = {
      concurrency: {
        globalMaxWorkers: globalMax,
        currentActiveWorkers: active,
        headroom: Math.max(0, globalMax - active),
      },
      providers,
      utilization: { percentage: pct, level },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  if (route === "/api/queue") {
    const queue = readJsonFile(QUEUE_STATE_PATH);
    if (!queue) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        schemaVersion: 1,
        capturedAt: null,
        entries: [],
        summary: { queued: 0, launching: 0, running: 0, prCreated: 0, blocked: 0, done: 0 },
      }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(queue, null, 2));
    return;
  }

  if (route === "/api/planning") {
    const planning = readJsonFile(PLANNING_CONSOLE_PATH);
    if (!planning) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        schemaVersion: 1,
        capturedAt: null,
        candidates: [],
        summary: { ready: 0, blocked: 0, done: 0, total: 0 },
      }));
      return;
    }
    const sanitized = sanitizeObject(planning);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sanitized, null, 2));
    return;
  }

  // --- Action endpoints -------------------------------------------------------

  if (route === "/api/actions" && req.method === "GET") {
    const actions = loadActionModules();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ actions }, null, 2));
    return;
  }

  if (route === "/api/actions/preview" && req.method === "POST") {
    readBody(req, (err, body) => {
      if (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
        return;
      }
      const { actionId, payload } = body || {};
      if (!actionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing actionId" }));
        return;
      }
      const mod = resolveAction(actionId);
      if (!mod) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Action not found" }));
        return;
      }
      if (typeof mod.preview !== "function") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          actionId,
          label: mod.label,
          description: mod.description || "",
          preview: null,
          message: "This action has no preview function",
        }));
        return;
      }
      try {
        const result = mod.preview(payload || {});
        const sanitized = sanitizeObject(result);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          actionId,
          label: mod.label,
          description: mod.description || "",
          preview: sanitized,
          dryRun: true,
        }, null, 2));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Preview failed: " + e.message }));
      }
    });
    return;
  }

  if (route === "/api/actions/execute" && req.method === "POST") {
    readBody(req, (err, body) => {
      if (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
        return;
      }
      const { actionId, payload, confirm, confirmationToken } = body || {};
      if (!actionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing actionId" }));
        return;
      }
      const mod = resolveAction(actionId);
      if (!mod) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Action not found" }));
        return;
      }
      // Dangerous actions require explicit confirmation
      if (mod.dangerous && confirm !== true) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "This action is marked dangerous. Set confirm: true to proceed.",
          actionId,
          dangerous: true,
        }));
        return;
      }
      if (typeof mod.execute !== "function") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Action has no execute function" }));
        return;
      }
      const startedAt = new Date().toISOString();
      try {
        const result = mod.execute(payload || {});
        const sanitized = sanitizeObject(result);
        const entry = {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          actionId,
          startedAt,
          completedAt: new Date().toISOString(),
          status: "success",
          payload: sanitizeObject(payload || {}),
          result: sanitized,
          confirmationToken: confirmationToken ? "provided" : "absent",
        };
        appendAuditEntry(entry);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, auditId: entry.id, result: sanitized }, null, 2));
      } catch (e) {
        const entry = {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          actionId,
          startedAt,
          completedAt: new Date().toISOString(),
          status: "error",
          error: e.message,
          payload: sanitizeObject(payload || {}),
        };
        appendAuditEntry(entry);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, auditId: entry.id, error: e.message }));
      }
    });
    return;
  }

  if (route === "/api/audit" && req.method === "GET") {
    let log = readAuditLog();
    const params = url.searchParams;

    // Apply filters
    const actionIdFilter = params.get("actionId");
    const statusFilter = params.get("status");
    const limitParam = params.get("limit");

    if (actionIdFilter) {
      log = log.filter((entry) => entry.actionId === actionIdFilter);
    }

    if (statusFilter) {
      log = log.filter((entry) => entry.status === statusFilter);
    }

    // Apply limit (capped at 500 for safety)
    const MAX_LIMIT = 500;
    let limit = log.length;
    if (limitParam !== null) {
      const parsedLimit = Number(limitParam);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid limit parameter" }));
        return;
      }
      limit = Math.min(parsedLimit, MAX_LIMIT);
    }

    const filtered = log.slice(0, limit);
    const filters = {};
    if (actionIdFilter) filters.actionId = actionIdFilter;
    if (statusFilter) filters.status = statusFilter;
    if (limitParam !== null) filters.limit = limit;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      entries: filtered,
      total: filtered.length,
      unfilteredTotal: readAuditLog().length,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    }, null, 2));
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
    `  Dashboard:   http://127.0.0.1:${addr.port}/\n` +
    `  State API:   http://127.0.0.1:${addr.port}/api/state\n` +
    `  Policy API:  http://127.0.0.1:${addr.port}/api/policy\n` +
    `  Workers API: http://127.0.0.1:${addr.port}/api/workers\n` +
    `  Resources:   http://127.0.0.1:${addr.port}/api/resources\n` +
    `  Queue:       http://127.0.0.1:${addr.port}/api/queue\n` +
    `  Planning:    http://127.0.0.1:${addr.port}/api/planning\n` +
    `  Actions:     http://127.0.0.1:${addr.port}/api/actions\n` +
    `  Audit:       http://127.0.0.1:${addr.port}/api/audit\n` +
    `  Health:      http://127.0.0.1:${addr.port}/api/health\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`Error: port ${args.port} is already in use\n`);
    process.exit(1);
  }
  throw err;
});
