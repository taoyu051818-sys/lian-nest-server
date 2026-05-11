#!/usr/bin/env node
"use strict";

/**
 * action-modules.test.js
 *
 * Tests the real WebUI action module inventory. This intentionally does not
 * create or remove files in actions/ because those files are production
 * operation modules.
 *
 * Run: node tools/provider-pool-webui/action-modules.test.js
 */

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed += 1;
    console.log("  PASS  " + name);
  } else {
    failed += 1;
    console.error("  FAIL  " + name);
  }
}

function requestJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = opts.body === undefined
      ? null
      : typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: opts.method || "GET",
        headers: body
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode, raw, data });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "server.js"), "--port", String(port)], {
      cwd: path.resolve(__dirname, "../.."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PROVIDER_POOL_WEBUI_AUDIT_PATH: path.join(__dirname, ".action-modules-test-audit.json") },
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("server did not start within 5s: " + output));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("listening")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("server exited before ready: " + code + " " + output));
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.once("exit", resolve);
    child.kill();
  });
}

function loadModules() {
  const actionsDir = path.join(__dirname, "actions");
  const files = fs.readdirSync(actionsDir)
    .filter((name) => name.endsWith(".js"))
    .sort();
  return files.map((file) => {
    const fullPath = path.join(actionsDir, file);
    delete require.cache[require.resolve(fullPath)];
    return { file, fullPath, mod: require(fullPath) };
  });
}

console.log("\naction-modules.test.js\n");

const expectedIds = [
  "compile-tasks",
  "create-issues",
  "issue-state",
  "launch-batch",
  "merge-prs",
  "plan.next.batch",
  "provider-rotation",
  "worker.control",
];

const dangerousIds = [
  "create-issues",
  "issue-state",
  "launch-batch",
  "merge-prs",
  "provider-rotation",
  "worker.control",
];

(async () => {
  const actionsDir = path.join(__dirname, "actions");

  console.log("Inventory\n");
  assert(fs.existsSync(actionsDir), "actions directory exists");
  const loaded = loadModules();
  const ids = loaded.map((entry) => entry.mod.id).sort();
  assert(loaded.length >= expectedIds.length, "loads at least the expected action modules");
  for (const id of expectedIds) {
    assert(ids.includes(id), "loads " + id);
  }
  assert(new Set(ids).size === ids.length, "action ids are unique");

  console.log("\nModule contract\n");
  for (const { file, mod } of loaded) {
    assert(typeof mod.id === "string" && mod.id.length > 0, file + " exports id");
    assert(typeof mod.label === "string" && mod.label.length > 0, mod.id + " exports label");
    assert(typeof mod.description === "string", mod.id + " exports description");
    assert(typeof mod.dangerous === "boolean", mod.id + " exports dangerous boolean");
    assert(typeof mod.preview === "function", mod.id + " exports preview");
    assert(typeof mod.execute === "function", mod.id + " exports execute");
  }

  console.log("\nDanger classification\n");
  for (const { mod } of loaded) {
    if (dangerousIds.includes(mod.id)) {
      assert(mod.dangerous === true, mod.id + " is marked dangerous");
    }
  }
  assert(loaded.find((entry) => entry.mod.id === "compile-tasks").mod.dangerous === false, "compile-tasks is safe");
  assert(loaded.find((entry) => entry.mod.id === "plan.next.batch").mod.dangerous === false, "plan.next.batch is safe");

  console.log("\nSource hygiene\n");
  for (const { file, fullPath } of loaded) {
    const source = fs.readFileSync(fullPath, "utf-8");
    assert(!/sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]+/.test(source), file + " contains no literal token patterns");
    assert(!/settings\.json/.test(source) || /never reads|not read|without reading actual values/i.test(source), file + " does not directly expose settings secrets");
  }

  console.log("\nServer discovery\n");
  const port = await freePort();
  let child = null;
  try {
    child = await startServer(port);
    assert(Boolean(child.pid), "server starts");
    const res = await requestJson(`http://127.0.0.1:${port}/api/actions`);
    assert(res.status === 200, "GET /api/actions returns 200");
    assert(Array.isArray(res.data.actions), "GET /api/actions returns actions array");
    const serverIds = res.data.actions.map((action) => action.id).sort();
    for (const id of expectedIds) {
      assert(serverIds.includes(id), "server exposes " + id);
    }
    assert(!res.raw.includes("sk-ant-") && !res.raw.includes("ghp_"), "GET /api/actions response contains no token pattern");

    const missingPreview = await requestJson(`http://127.0.0.1:${port}/api/actions/preview`, {
      method: "POST",
      body: {},
    });
    assert(missingPreview.status === 400, "preview without actionId returns 400");

    const unknownPreview = await requestJson(`http://127.0.0.1:${port}/api/actions/preview`, {
      method: "POST",
      body: { actionId: "missing-action" },
    });
    assert(unknownPreview.status === 404, "preview unknown action returns 404");

    const dangerousExecute = await requestJson(`http://127.0.0.1:${port}/api/actions/execute`, {
      method: "POST",
      body: { actionId: "merge-prs", payload: { prNumbers: [1], repo: "owner/repo" } },
    });
    assert(dangerousExecute.status === 409, "dangerous execute requires confirm");
    assert(dangerousExecute.data.dangerous === true, "dangerous execute response is marked dangerous");
  } finally {
    await stopServer(child);
    const auditPath = path.join(__dirname, ".action-modules-test-audit.json");
    if (fs.existsSync(auditPath)) fs.rmSync(auditPath, { force: true });
  }

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
