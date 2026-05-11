#!/usr/bin/env node

/**
 * action-modules.test.js
 *
 * Tests for the WebUI action module system: module loading, preview/execute
 * endpoints, dangerous-action confirmation, audit trail, and secret sanitization.
 * No external test framework — uses a simple assert helper.
 *
 * Run: node tools/provider-pool-webui/action-modules.test.js
 */

const { spawn, execSync } = require("child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.error("  FAIL  " + name);
  }
}

// --- Helpers -----------------------------------------------------------------

const serverScript = path.resolve(__dirname, "server.js");
const actionsDir = path.resolve(__dirname, "actions");

function fetch(url, opts) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: (opts && opts.method) || "GET",
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (opts && opts.body) {
      req.write(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    }
    req.end();
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverScript, "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let started = false;
    child.stdout.on("data", (data) => {
      if (!started && data.toString().includes("listening")) {
        started = true;
        resolve(child);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!started) reject(new Error(`server exited with code ${code}`));
    });
    setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("server did not start within 5s"));
      }
    }, 5000);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.on("exit", resolve);
    child.kill();
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const net = require("node:net");
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// --- Fixture action modules --------------------------------------------------

const FIXTURES = {
  "test-safe-action.js": [
    'module.exports = {',
    '  id: "test.safe.action",',
    '  label: "Test Safe Action",',
    '  description: "A safe test action for validation",',
    '  dangerous: false,',
    '  preview(payload) {',
    '    return { message: "Would perform safe action", params: payload };',
    '  },',
    '  execute(payload) {',
    '    return { ok: true, message: "Safe action performed" };',
    '  },',
    '};',
  ].join("\n"),

  "test-dangerous-action.js": [
    'module.exports = {',
    '  id: "test.dangerous.action",',
    '  label: "Test Dangerous Action",',
    '  description: "A dangerous action requiring confirmation",',
    '  dangerous: true,',
    '  preview(payload) {',
    '    return { message: "Would perform dangerous action", params: payload };',
    '  },',
    '  execute(payload) {',
    '    return { ok: true, message: "Dangerous action performed" };',
    '  },',
    '};',
  ].join("\n"),

  "test-preview-only.js": [
    'module.exports = {',
    '  id: "test.preview.only",',
    '  label: "Test Preview Only",',
    '  description: "Action with preview function only, no execute",',
    '  dangerous: false,',
    '  preview(payload) {',
    '    return { message: "Preview only result" };',
    '  },',
    '};',
  ].join("\n"),

  "test-execute-only.js": [
    'module.exports = {',
    '  id: "test.execute.only",',
    '  label: "Test Execute Only",',
    '  description: "Action with execute function only, no preview",',
    '  dangerous: false,',
    '  execute(payload) {',
    '    return { ok: true, message: "Execute only result" };',
    '  },',
    '};',
  ].join("\n"),

  "test-secret-action.js": [
    'module.exports = {',
    '  id: "test.secret.action",',
    '  label: "Test Secret Action",',
    '  description: "Returns secrets for sanitization testing",',
    '  dangerous: false,',
    '  preview(payload) {',
    '    return { apiKey: "sk-1234567890abcdef1234567890abcdef", message: "has secret" };',
    '  },',
    '  execute(payload) {',
    '    return { apiKey: "sk-1234567890abcdef1234567890abcdef", ok: true };',
    '  },',
    '};',
  ].join("\n"),

  "test-broken.js": 'throw new Error("intentionally broken module");\n',

  "test-no-id.js": 'module.exports = { label: "No ID Action" };\n',

  "test-no-label.js": 'module.exports = { id: "test.no.label" };\n',

  "test-readme.txt": "This is a non-JS file and should be ignored.\n",
};

const VALID_MODULE_IDS = [
  "test.safe.action",
  "test.dangerous.action",
  "test.preview.only",
  "test.execute.only",
  "test.secret.action",
];

function setupFixtures() {
  fs.mkdirSync(actionsDir, { recursive: true });
  for (const [filename, content] of Object.entries(FIXTURES)) {
    fs.writeFileSync(path.join(actionsDir, filename), content, "utf-8");
  }
}

function cleanupFixtures() {
  try {
    if (fs.existsSync(actionsDir)) {
      fs.rmSync(actionsDir, { recursive: true, force: true });
    }
  } catch {
    // best effort
  }
}

// --- Audit log helper --------------------------------------------------------

const auditPath = path.resolve(__dirname, ".audit-log.json");

function readAuditLog() {
  try {
    return JSON.parse(fs.readFileSync(auditPath, "utf-8"));
  } catch {
    return [];
  }
}

function cleanupAuditLog() {
  try {
    if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
  } catch {
    // best effort
  }
}

// --- Tests -------------------------------------------------------------------

console.log("\naction-modules.test.js\n");

(async () => {
  // Clean up any leftover fixtures from a previous failed run
  cleanupFixtures();
  cleanupAuditLog();
  setupFixtures();

  const port = await findFreePort();
  let child;

  try {
    child = await startServer(port);
    assert(child.pid > 0, "server starts with action modules installed");

    // --- Module discovery ----------------------------------------------------

    console.log("\nModule discovery\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      assert(res.status === 200, "GET /api/actions returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.actions), "response has actions array");
      assert(data.actions.length === 5, "loads 5 valid modules (skips broken/invalid/non-js)");
    }

    // --- Module shape --------------------------------------------------------

    console.log("\nModule shape\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      const data = JSON.parse(res.body);
      for (const action of data.actions) {
        assert(typeof action.id === "string", `${action.id} has string id`);
        assert(typeof action.label === "string", `${action.id} has string label`);
        assert(typeof action.description === "string", `${action.id} has string description`);
        assert(typeof action.dangerous === "boolean", `${action.id} has boolean dangerous`);
      }
    }

    // --- Module id correctness -----------------------------------------------

    console.log("\nModule id correctness\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      const data = JSON.parse(res.body);
      const ids = data.actions.map((a) => a.id);
      for (const expected of VALID_MODULE_IDS) {
        assert(ids.includes(expected), `loaded modules include ${expected}`);
      }
    }

    // --- Broken/invalid modules are skipped ----------------------------------

    console.log("\nBroken/invalid modules are skipped\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      const data = JSON.parse(res.body);
      const ids = data.actions.map((a) => a.id);
      assert(!ids.includes("test.no.label"), "module without label is skipped");
      // test-no-id exports { label: "No ID Action" } — no id, so skipped
      assert(!ids.includes(undefined), "no undefined ids in list");
    }

    // --- Dangerous flag ------------------------------------------------------

    console.log("\nDangerous flag\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      const data = JSON.parse(res.body);
      const dangerous = data.actions.filter((a) => a.dangerous);
      const safe = data.actions.filter((a) => !a.dangerous);
      assert(dangerous.length === 1, "exactly 1 dangerous module");
      assert(dangerous[0].id === "test.dangerous.action", "dangerous module is test.dangerous.action");
      assert(safe.length === 4, "4 safe modules");
    }

    // --- Preview: safe action ------------------------------------------------

    console.log("\nPreview endpoint — safe action\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "test.safe.action", payload: { providerId: "p-1" } },
      });
      assert(res.status === 200, "preview safe action returns 200");
      const data = JSON.parse(res.body);
      assert(data.actionId === "test.safe.action", "response has actionId");
      assert(data.label === "Test Safe Action", "response has label");
      assert(data.description.length > 0, "response has description");
      assert(data.dryRun === true, "response has dryRun: true");
      assert(data.preview !== null, "response has preview data");
      assert(data.preview.message === "Would perform safe action", "preview has expected message");
      assert(data.preview.params.providerId === "p-1", "preview echoes payload params");
    }

    // --- Preview: dangerous action -------------------------------------------

    console.log("\nPreview endpoint — dangerous action\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "test.dangerous.action", payload: {} },
      });
      assert(res.status === 200, "preview dangerous action returns 200");
      const data = JSON.parse(res.body);
      assert(data.dryRun === true, "dangerous preview has dryRun: true");
      assert(data.preview !== null, "dangerous preview has data");
    }

    // --- Preview: no preview function ----------------------------------------

    console.log("\nPreview endpoint — no preview function\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "test.execute.only", payload: {} },
      });
      assert(res.status === 200, "preview on execute-only module returns 200");
      const data = JSON.parse(res.body);
      assert(data.preview === null, "preview is null when module has no preview function");
      assert(data.message.includes("no preview"), "message explains no preview function");
    }

    // --- Preview: missing actionId -------------------------------------------

    console.log("\nPreview endpoint — error handling\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { payload: {} },
      });
      assert(res.status === 400, "preview missing actionId returns 400");
    }

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "nonexistent.action", payload: {} },
      });
      assert(res.status === 404, "preview unknown actionId returns 404");
    }

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: "not-json",
      });
      assert(res.status === 400, "preview invalid JSON returns 400");
    }

    // --- Execute: safe action ------------------------------------------------

    console.log("\nExecute endpoint — safe action\n");

    {
      cleanupAuditLog();
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.safe.action", payload: { providerId: "p-1" } },
      });
      assert(res.status === 200, "execute safe action returns 200");
      const data = JSON.parse(res.body);
      assert(data.ok === true, "execute returns ok: true");
      assert(typeof data.auditId === "string", "execute returns auditId");
      assert(data.result !== null, "execute returns result");
      assert(data.result.message === "Safe action performed", "execute result has expected message");
    }

    // --- Execute: dangerous without confirm ----------------------------------

    console.log("\nExecute endpoint — dangerous action confirmation\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.dangerous.action", payload: {} },
      });
      assert(res.status === 409, "dangerous execute without confirm returns 409");
      const data = JSON.parse(res.body);
      assert(data.dangerous === true, "response indicates dangerous: true");
      assert(data.actionId === "test.dangerous.action", "response includes actionId");
    }

    // --- Execute: dangerous with confirm -------------------------------------

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.dangerous.action", payload: {}, confirm: true },
      });
      assert(res.status === 200, "dangerous execute with confirm returns 200");
      const data = JSON.parse(res.body);
      assert(data.ok === true, "confirmed dangerous execute returns ok: true");
    }

    // --- Execute: no execute function ----------------------------------------

    console.log("\nExecute endpoint — no execute function\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.preview.only", payload: {} },
      });
      assert(res.status === 400, "execute on preview-only module returns 400");
      const data = JSON.parse(res.body);
      assert(data.error.includes("no execute"), "error explains no execute function");
    }

    // --- Execute: missing actionId -------------------------------------------

    console.log("\nExecute endpoint — error handling\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { payload: {} },
      });
      assert(res.status === 400, "execute missing actionId returns 400");
    }

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "nonexistent.action", payload: {} },
      });
      assert(res.status === 404, "execute unknown actionId returns 404");
    }

    // --- Sanitization: preview -----------------------------------------------

    console.log("\nSanitization\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "test.secret.action", payload: {} },
      });
      assert(res.status === 200, "secret action preview returns 200");
      const data = JSON.parse(res.body);
      assert(data.preview.apiKey === "***REDACTED***", "apiKey is redacted in preview");
      assert(data.preview.message === "has secret", "non-secret fields preserved in preview");
    }

    // --- Sanitization: execute -----------------------------------------------

    {
      cleanupAuditLog();
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.secret.action", payload: {}, confirm: true },
      });
      assert(res.status === 200, "secret action execute returns 200");
      const data = JSON.parse(res.body);
      assert(data.result.apiKey === "***REDACTED***", "apiKey is redacted in execute result");
    }

    // --- Sanitization: audit log entries -------------------------------------

    console.log("\nAudit trail\n");

    {
      cleanupAuditLog();
      // Run a safe action to generate an audit entry
      await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.safe.action", payload: { providerId: "p-1" }, confirm: true },
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/audit`);
      assert(res.status === 200, "GET /api/audit returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.entries), "audit has entries array");
      assert(data.entries.length >= 1, "audit has at least 1 entry after execute");

      const entry = data.entries[data.entries.length - 1];
      assert(typeof entry.id === "string", "audit entry has id");
      assert(entry.actionId === "test.safe.action", "audit entry has correct actionId");
      assert(entry.status === "success", "audit entry has status success");
      assert(typeof entry.startedAt === "string", "audit entry has startedAt");
      assert(typeof entry.completedAt === "string", "audit entry has completedAt");
    }

    // --- Audit: no secrets in audit payload ----------------------------------

    console.log("\nAudit secret redaction\n");

    {
      cleanupAuditLog();
      await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.secret.action", payload: {}, confirm: true },
      });

      const log = readAuditLog();
      assert(log.length >= 1, "audit log has entry for secret action");
      const raw = JSON.stringify(log);
      assert(!raw.includes("sk-1234567890abcdef"), "audit log has no raw secret value");
      assert(raw.includes("REDACTED"), "audit log has redacted marker");
    }

    // --- Audit: preview does NOT create audit entries ------------------------

    console.log("\nAudit: preview does not write entries\n");

    {
      cleanupAuditLog();
      await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "test.safe.action", payload: {} },
      });
      const log = readAuditLog();
      assert(log.length === 0, "no audit entry after preview");
    }

    // --- Preview result has no raw secrets -----------------------------------

    console.log("\nNo raw secrets in any response\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/preview`, {
        method: "POST",
        body: { actionId: "test.secret.action", payload: {} },
      });
      const raw = res.body;
      assert(!raw.includes("sk-1234567890abcdef"), "no raw API key in preview response body");
    }

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: "POST",
        body: { actionId: "test.secret.action", payload: {}, confirm: true },
      });
      const raw = res.body;
      assert(!raw.includes("sk-1234567890abcdef"), "no raw API key in execute response body");
    }

    // --- GET /api/actions correct method only --------------------------------

    console.log("\nMethod enforcement\n");

    {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      assert(res.status === 200, "GET /api/actions works");
    }

  } finally {
    await stopServer(child);
    cleanupFixtures();
    cleanupAuditLog();
  }

  // --- Summary ---------------------------------------------------------------

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
})();
