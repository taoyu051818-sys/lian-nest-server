#!/usr/bin/env node
"use strict";

/**
 * self-cycle.test.js
 *
 * Tests for the self-cycle WebUI action module.
 * Focus: preview pipeline, sanitization, health gate, provider pool,
 * queue status, input validation, execute blocking.
 *
 * Run: node tools/provider-pool-webui/actions/self-cycle.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
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

// Token detection regexes
const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
const ghTokenRe = /ghp.[A-Za-z\d_]+/;

// --- Fixtures ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "self-cycle-test-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function makeHealth(state) {
  return { state: state, commitSha: "abc12345def67890", capturedAt: "2026-05-11T00:00:00Z" };
}

function makePool(overrides) {
  var base = {
    providers: [
      {
        id: "provider-default",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 1,
        secret: "should-be-stripped",
        apiKey: "should-be-stripped",
        token: "should-be-stripped",
      },
    ],
  };
  if (!overrides) return base;
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function makePolicy(overrides) {
  var base = {
    policyVersion: 1,
    launchGateIntegration: {
      blockWhenAllExhausted: true,
      blockWhenAtCapacity: true,
    },
  };
  if (!overrides) return JSON.parse(JSON.stringify({ ...base, ...overrides }));
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function makeQueue(entries) {
  return { entries: entries || [] };
}

// --- Main test runner --------------------------------------------------------

function run() {
  var mod = require("./self-cycle");

  console.log("\nself-cycle.test.js\n");

  // --- Module contract ---------------------------------------------------------
  console.log("Module contract\n");

  assert(typeof mod.id === "string", "exports id");
  assert(mod.id === "self-cycle", "id is self-cycle");
  assert(typeof mod.label === "string", "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === false, "not dangerous");
  assert(typeof mod.preview === "function", "exports preview");
  assert(typeof mod.execute === "function", "exports execute");

  // --- Secret isolation --------------------------------------------------------
  console.log("\nSecret isolation\n");

  {
    var source = fs.readFileSync(path.join(__dirname, "self-cycle.js"), "utf-8");
    assert(!apiKeyRe.test(source), "no literal API key pattern");
    assert(!ghTokenRe.test(source), "no GitHub token pattern");
    assert(!/ANTHROPIC_API_KEY\s*=\s*["']/.test(source), "does not hardcode env var value");
  }

  // --- Preview: all green ------------------------------------------------------
  console.log("\nPreview: all green\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([
      { issueNumber: 100, state: "queued", conflictGroup: "wave-a" },
    ]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.ok === true, "preview ok with all green");
    assert(res.status === "preview", "status is preview");
    assert(res.dryRun === true, "dryRun is true");
    assert(res.pipelineBlocked === false, "pipeline not blocked");
    assert(res.health.state === "green", "health is green");
    assert(res.health.blocked === false, "health not blocked");
    assert(res.providerPool.available === 1, "1 provider available");
    assert(res.providerPool.blocked === false, "provider pool not blocked");
    assert(res.queue.queued === 1, "1 queued issue");
    assert(typeof res.message === "string", "message is string");
    assert(res.message.includes("ready"), "message says ready");
    assert(typeof res.timestamp === "string", "timestamp present");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: red health blocks pipeline ------------------------------------
  console.log("\nPreview: red health blocks pipeline\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("red"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.ok === true, "preview ok with red health");
    assert(res.pipelineBlocked === true, "pipeline blocked");
    assert(res.health.state === "red", "health is red");
    assert(res.health.blocked === true, "health blocked");
    assert(res.steps[0].status === "blocked", "health step blocked");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: black health blocks pipeline ----------------------------------
  console.log("\nPreview: black health blocks pipeline\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("black"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.pipelineBlocked === true, "pipeline blocked for black health");
    assert(res.health.state === "black", "health is black");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: all providers exhausted blocks pipeline -----------------------
  console.log("\nPreview: all providers exhausted blocks\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
        { id: "prov-b", status: "disabled", currentConcurrency: 0, maxConcurrency: 1 },
      ],
    }));
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.pipelineBlocked === true, "pipeline blocked when all exhausted/disabled");
    assert(res.providerPool.blocked === true, "provider pool blocked");
    assert(res.providerPool.blockReason.includes("exhausted"), "block reason mentions exhausted");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: all providers at capacity blocks pipeline ---------------------
  console.log("\nPreview: all providers at capacity blocks\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "available", currentConcurrency: 2, maxConcurrency: 2 },
      ],
    }));
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.pipelineBlocked === true, "pipeline blocked when all at capacity");
    assert(res.providerPool.blocked === true, "provider pool blocked");
    assert(res.providerPool.atCapacity === 1, "1 at capacity");
    assert(res.providerPool.blockReason.includes("concurrency"), "block reason mentions concurrency");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: sanitization strips secrets from providers --------------------
  console.log("\nPreview: sanitization strips secrets\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    var raw = JSON.stringify(res);
    assert(!raw.includes("should-be-stripped"), "no secret value in output");
    assert(!raw.includes("apiKey"), "no apiKey field in output");
    assert(!raw.includes("token"), "no token field in output");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: sanitization strips secrets from queue entries ----------------
  console.log("\nPreview: entry sanitization\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([
      {
        issueNumber: 200,
        state: "queued",
        secret: "entry-secret",
        token: "entry-token",
        apiKey: "entry-api-key",
        password: "entry-password",
      },
    ]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    var raw = JSON.stringify(res);
    assert(!raw.includes("entry-secret"), "entry secret stripped");
    assert(!raw.includes("entry-token"), "entry token stripped");
    assert(!raw.includes("entry-api-key"), "entry apiKey stripped");
    assert(!raw.includes("entry-password"), "entry password stripped");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: missing health file defaults to green -------------------------
  console.log("\nPreview: missing health defaults to green\n");

  {
    var dir = tmpDir();
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: path.join(dir, "nonexistent.json"), statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.ok === true, "preview ok with missing health");
    assert(res.health.state === "green", "defaults to green");
    assert(res.health.source === "default", "source is default");
    assert(res.health.blocked === false, "not blocked");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: missing provider pool defaults --------------------------------
  console.log("\nPreview: missing provider pool defaults\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: path.join(dir, "nonexistent.json"), policyPath: policyPath, queuePath: queuePath });
    assert(res.ok === true, "preview ok with missing state");
    assert(res.providerPool.total === 0, "0 total providers");
    assert(res.providerPool.blocked === false, "not blocked with no providers");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: missing queue defaults ----------------------------------------
  console.log("\nPreview: missing queue defaults\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: path.join(dir, "nonexistent.json") });
    assert(res.ok === true, "preview ok with missing queue");
    assert(res.queue.total === 0, "0 total entries");
    assert(res.queue.queued === 0, "0 queued");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: steps array structure -----------------------------------------
  console.log("\nPreview: steps array structure\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(Array.isArray(res.steps), "steps is array");
    assert(res.steps.length === 3, "3 steps");
    assert(res.steps[0].name === "health-gate", "first step is health-gate");
    assert(res.steps[1].name === "provider-pool-preflight", "second step is provider-pool-preflight");
    assert(res.steps[2].name === "queue-status", "third step is queue-status");
    for (var i = 0; i < res.steps.length; i++) {
      assert(typeof res.steps[i].status === "string", res.steps[i].name + " has status string");
      assert(typeof res.steps[i].detail === "string", res.steps[i].name + " has detail string");
    }

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: queue status ready when queued issues exist -------------------
  console.log("\nPreview: queue status ready\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([
      { issueNumber: 300, state: "queued" },
      { issueNumber: 301, state: "running" },
      { issueNumber: 302, state: "queued" },
    ]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.queue.total === 3, "3 total entries");
    assert(res.queue.queued === 2, "2 queued");
    assert(res.steps[2].status === "ready", "queue step is ready");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: queue status empty when no queued issues ----------------------
  console.log("\nPreview: queue status empty\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([
      { issueNumber: 400, state: "running" },
    ]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.queue.queued === 0, "0 queued");
    assert(res.steps[2].status === "empty", "queue step is empty");
    assert(res.message.includes("no queued issues"), "message mentions no queued");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: null payload uses defaults ------------------------------------
  console.log("\nPreview: null payload\n");

  {
    var res = mod.preview(null);
    assert(res.ok === true, "preview ok with null payload");
    assert(res.dryRun === true, "dryRun true with null payload");
  }

  // --- Preview: empty payload uses defaults -----------------------------------
  console.log("\nPreview: empty payload\n");

  {
    var res = mod.preview({});
    assert(res.ok === true, "preview ok with empty payload");
    assert(res.dryRun === true, "dryRun true with empty payload");
  }

  // --- Execute: always blocked ------------------------------------------------
  console.log("\nExecute: always blocked\n");

  {
    var res = mod.execute({});
    assert(res.ok === false, "execute returns not ok");
    assert(res.status === "blocked", "execute status is blocked");
    assert(typeof res.error === "string", "error is string");
    assert(res.error.includes("not supported"), "error says not supported");
  }

  {
    var res = mod.execute(null);
    assert(res.ok === false, "execute with null returns not ok");
    assert(res.status === "blocked", "execute null status is blocked");
  }

  {
    var res = mod.execute({ confirm: true });
    assert(res.ok === false, "execute with confirm still blocked");
    assert(res.status === "blocked", "execute confirm status is blocked");
  }

  // --- Preview: mixed provider statuses --------------------------------------
  console.log("\nPreview: mixed provider statuses\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 2 },
        { id: "prov-b", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
        { id: "prov-c", status: "disabled", currentConcurrency: 0, maxConcurrency: 1 },
        { id: "prov-d", status: "available", currentConcurrency: 1, maxConcurrency: 1 },
      ],
    }));
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.providerPool.available === 1, "1 available (not at capacity)");
    assert(res.providerPool.exhausted === 1, "1 exhausted");
    assert(res.providerPool.disabled === 1, "1 disabled");
    assert(res.providerPool.atCapacity === 1, "1 at capacity");
    assert(res.providerPool.total === 4, "4 total");
    assert(res.providerPool.blocked === false, "not blocked (has available)");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: output has no raw stdout/stderr -------------------------------
  console.log("\nPreview: output is sanitized JSON\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    var raw = JSON.stringify(res);
    assert(!apiKeyRe.test(raw), "no API key pattern in output");
    assert(!ghTokenRe.test(raw), "no GitHub token pattern in output");
    assert(!raw.includes("password"), "no password field in output");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: pipeline blocked message -------------------------------------
  console.log("\nPreview: pipeline blocked message\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("red"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([]));

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    assert(res.message.includes("Pipeline blocked"), "message says pipeline blocked");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: no temp files created -----------------------------------------
  console.log("\nPreview: no temp files created\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");
    var queuePath = path.join(dir, "queue.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());
    writeJson(queuePath, makeQueue([{ issueNumber: 500, state: "queued" }]));

    mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath, queuePath: queuePath });
    var files = fs.readdirSync(dir);
    assert(files.length === 4, "only original fixture files remain");
    assert(files.indexOf("health.json") >= 0, "health.json exists");
    assert(files.indexOf("state.json") >= 0, "state.json exists");
    assert(files.indexOf("policy.json") >= 0, "policy.json exists");
    assert(files.indexOf("queue.json") >= 0, "queue.json exists");

    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Entry point -------------------------------------------------------------

if (require.main === module) {
  run();
  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}

// Export action-module contract so action-modules.test.js can load this file
module.exports = {
  id: "self-cycle-test",
  label: "Self-Cycle Tests",
  description: "Test harness for self-cycle action module (not a real action)",
  dangerous: false,
  preview() {},
  execute() {},
};
