#!/usr/bin/env node
"use strict";

/**
 * self-cycle-dry-run-smoke.test.js
 *
 * Fixture-based smoke that proves the
 *   status -> candidates -> safety gate -> manifest
 * flow through the self-cycle preview pipeline.
 *
 * No network required. Uses fixture inputs only.
 * Produces a plan (pipeline preview) but no mutations.
 *
 * Closes: #1251
 *
 * Run: node scripts/ai/self-cycle-dry-run-smoke.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mod = require("../../tools/provider-pool-webui/actions/self-cycle");

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
  }
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "self-cycle-smoke-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function fixturePaths(dir) {
  return {
    healthPath: path.join(dir, "health.json"),
    statePath: path.join(dir, "pool.json"),
    policyPath: path.join(dir, "policy.json"),
    queuePath: path.join(dir, "queue.json"),
  };
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function buildHealth(state) {
  return { state: state, commitSha: "abc12345def67890", capturedAt: "2026-05-12T00:00:00Z" };
}

function buildPool(providers) {
  return { providers: providers };
}

function buildPolicy(overrides) {
  var base = {
    policyVersion: 1,
    launchGateIntegration: {
      blockWhenAllExhausted: true,
      blockWhenAtCapacity: true,
    },
  };
  if (!overrides) return JSON.parse(JSON.stringify(base));
  return JSON.parse(JSON.stringify(Object.assign({}, base, overrides)));
}

function buildQueue(entries) {
  return { entries: entries };
}

// ── Smoke 1: all-green pipeline ─────────────────────────────────────────────

test("smoke: all-green -> pipeline passes, manifest produced", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 2 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      { issueNumber: 100, state: "queued", conflictGroup: "wave-a" },
      { issueNumber: 101, state: "queued", conflictGroup: "wave-b" },
    ]));

    var res = mod.preview(p);

    // manifest shape
    if (res.ok !== true) throw new Error("expected ok=true");
    if (res.status !== "preview") throw new Error("expected status=preview");
    if (res.dryRun !== true) throw new Error("expected dryRun=true");
    if (res.pipelineBlocked !== false) throw new Error("expected pipelineBlocked=false");

    // step 1: health gate passes
    if (res.steps[0].name !== "health-gate") throw new Error("step 0 name");
    if (res.steps[0].status !== "pass") throw new Error("health gate should pass");
    if (res.health.state !== "green") throw new Error("health state should be green");
    if (res.health.blocked !== false) throw new Error("health should not be blocked");

    // step 2: provider pool preflight passes
    if (res.steps[1].name !== "provider-pool-preflight") throw new Error("step 1 name");
    if (res.steps[1].status !== "pass") throw new Error("provider pool should pass");
    if (res.providerPool.available !== 1) throw new Error("1 provider available");
    if (res.providerPool.blocked !== false) throw new Error("pool should not be blocked");

    // step 3: queue status ready
    if (res.steps[2].name !== "queue-status") throw new Error("step 2 name");
    if (res.steps[2].status !== "ready") throw new Error("queue should be ready");
    if (res.queue.queued !== 2) throw new Error("2 queued issues");

    // manifest metadata
    if (typeof res.message !== "string") throw new Error("message should be string");
    if (!res.message.includes("ready")) throw new Error("message should say ready");
    if (typeof res.timestamp !== "string") throw new Error("timestamp should be string");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 2: health red -> pipeline blocked ──────────────────────────────────

test("smoke: health red -> pipeline blocked at safety gate", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("red"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 1 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      { issueNumber: 200, state: "queued" },
    ]));

    var res = mod.preview(p);

    if (res.pipelineBlocked !== true) throw new Error("expected pipelineBlocked=true");
    if (res.health.state !== "red") throw new Error("health should be red");
    if (res.health.blocked !== true) throw new Error("health should be blocked");
    if (res.steps[0].status !== "blocked") throw new Error("health step should be blocked");
    if (!res.message.includes("blocked")) throw new Error("message should say blocked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 3: provider pool exhausted -> pipeline blocked ─────────────────────

test("smoke: all providers exhausted -> pipeline blocked at safety gate", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
      { id: "prov-b", status: "disabled", currentConcurrency: 0, maxConcurrency: 1 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      { issueNumber: 300, state: "queued" },
    ]));

    var res = mod.preview(p);

    if (res.pipelineBlocked !== true) throw new Error("expected pipelineBlocked=true");
    if (res.providerPool.blocked !== true) throw new Error("pool should be blocked");
    if (res.providerPool.exhausted !== 1) throw new Error("1 exhausted");
    if (res.providerPool.disabled !== 1) throw new Error("1 disabled");
    if (res.steps[1].status !== "blocked") throw new Error("provider step should be blocked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 4: empty queue -> manifest shows empty ─────────────────────────────

test("smoke: empty queue -> manifest shows empty status", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 1 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([]));

    var res = mod.preview(p);

    if (res.pipelineBlocked !== false) throw new Error("should not be blocked");
    if (res.queue.queued !== 0) throw new Error("0 queued");
    if (res.steps[2].status !== "empty") throw new Error("queue step should be empty");
    if (!res.message.includes("no queued issues")) throw new Error("message should say no queued");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 5: all providers at capacity -> pipeline blocked ───────────────────

test("smoke: all providers at capacity -> pipeline blocked", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "available", currentConcurrency: 3, maxConcurrency: 3 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      { issueNumber: 400, state: "queued" },
    ]));

    var res = mod.preview(p);

    if (res.pipelineBlocked !== true) throw new Error("expected pipelineBlocked=true");
    if (res.providerPool.blocked !== true) throw new Error("pool should be blocked");
    if (res.providerPool.atCapacity !== 1) throw new Error("1 at capacity");
    if (res.steps[1].status !== "blocked") throw new Error("provider step should be blocked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 6: mixed providers -> pipeline passes with available provider ──────

test("smoke: mixed providers with one available -> pipeline passes", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 2 },
      { id: "prov-b", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
      { id: "prov-c", status: "disabled", currentConcurrency: 0, maxConcurrency: 1 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      { issueNumber: 500, state: "queued" },
    ]));

    var res = mod.preview(p);

    if (res.pipelineBlocked !== false) throw new Error("should not be blocked");
    if (res.providerPool.available !== 1) throw new Error("1 available");
    if (res.providerPool.exhausted !== 1) throw new Error("1 exhausted");
    if (res.providerPool.disabled !== 1) throw new Error("1 disabled");
    if (res.providerPool.total !== 3) throw new Error("3 total");
    if (res.steps[1].status !== "pass") throw new Error("provider step should pass");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 7: no mutations (no files created, no writes) ─────────────────────

test("smoke: preview creates no files or side effects", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 1 },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      { issueNumber: 600, state: "queued" },
    ]));

    mod.preview(p);

    var files = fs.readdirSync(dir);
    if (files.length !== 4) throw new Error("expected 4 fixture files, got " + files.length);
    var expected = ["health.json", "pool.json", "policy.json", "queue.json"].sort();
    if (files.sort().join(",") !== expected.join(",")) throw new Error("unexpected files: " + files.join(","));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Smoke 8: secrets stripped from output ────────────────────────────────────

test("smoke: fixture secrets never leak into manifest", function () {
  var dir = tmpDir();
  try {
    var p = fixturePaths(dir);
    writeJson(p.healthPath, buildHealth("green"));
    writeJson(p.statePath, buildPool([
      {
        id: "prov-secret",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 1,
        secret: "sk-should-not-appear",
        apiKey: "key-should-not-appear",
        token: "tok-should-not-appear",
      },
    ]));
    writeJson(p.policyPath, buildPolicy());
    writeJson(p.queuePath, buildQueue([
      {
        issueNumber: 700,
        state: "queued",
        secret: "entry-secret",
        token: "entry-token",
        apiKey: "entry-api-key",
        password: "entry-password",
      },
    ]));

    var res = mod.preview(p);
    var raw = JSON.stringify(res);

    if (raw.includes("sk-should-not-appear")) throw new Error("provider secret leaked");
    if (raw.includes("key-should-not-appear")) throw new Error("provider apiKey leaked");
    if (raw.includes("tok-should-not-appear")) throw new Error("provider token leaked");
    if (raw.includes("entry-secret")) throw new Error("entry secret leaked");
    if (raw.includes("entry-token")) throw new Error("entry token leaked");
    if (raw.includes("entry-api-key")) throw new Error("entry apiKey leaked");
    if (raw.includes("entry-password")) throw new Error("entry password leaked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

var total = passed + failed;
console.log("\n  self-cycle-dry-run-smoke.test.js");
console.log("  " + passed + "/" + total + " passed");

if (failed > 0) {
  console.log("\n  FAILURES:\n");
  for (var i = 0; i < failures.length; i++) {
    console.log("    " + failures[i].name);
    console.log("      " + failures[i].message + "\n");
  }
  process.exit(1);
} else {
  console.log("\n  All tests passed.\n");
  process.exit(0);
}
