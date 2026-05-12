#!/usr/bin/env node
"use strict";

/**
 * autonomy-readiness.test.js
 *
 * Tests for the autonomy-readiness WebUI action module.
 * Focus: preview readiness gates, sanitization, health gate,
 * verdict logic, input validation, execute blocking.
 *
 * Run: node tools/provider-pool-webui/actions/autonomy-readiness.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-readiness-test-"));
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
  if (!overrides) return JSON.parse(JSON.stringify(base));
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

// --- Main test runner --------------------------------------------------------

function run() {
  var mod = require("./autonomy-readiness");

  console.log("\nautonomy-readiness.test.js\n");

  // --- Module contract ---------------------------------------------------------
  console.log("Module contract\n");

  assert(typeof mod.id === "string", "exports id");
  assert(mod.id === "autonomy-readiness", "id is autonomy-readiness");
  assert(typeof mod.label === "string", "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === false, "not dangerous");
  assert(typeof mod.preview === "function", "exports preview");
  assert(typeof mod.execute === "function", "exports execute");

  // --- Secret isolation --------------------------------------------------------
  console.log("\nSecret isolation\n");

  {
    var source = fs.readFileSync(path.join(__dirname, "autonomy-readiness.js"), "utf-8");
    assert(!apiKeyRe.test(source), "no literal API key pattern");
    assert(!ghTokenRe.test(source), "no GitHub token pattern");
    assert(!/ANTHROPIC_API_KEY\s*=\s*["']/.test(source), "does not hardcode env var value");
    assert(!source.includes("process.env"), "no process.env access");
  }

  // --- Preview: all green, ready verdict --------------------------------------
  console.log("\nPreview: all green, ready verdict\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.ok === true, "preview ok");
    assert(res.status === "preview", "status is preview");
    assert(res.dryRun === true, "dryRun is true");
    assert(typeof res.verdict === "string", "verdict is string");
    assert(res.verdict === "ready", "verdict is ready with green health and available pool");
    assert(typeof res.passedBlocking === "number", "passedBlocking is number");
    assert(typeof res.totalBlocking === "number", "totalBlocking is number");
    assert(res.totalBlocking === 7, "7 blocking gates");
    assert(res.passedBlocking === 7, "all 7 blocking gates pass");
    assert(Array.isArray(res.gates), "gates is array");
    assert(res.gates.length === 7, "7 gates in array");
    assert(Array.isArray(res.blockers), "blockers is array");
    assert(res.blockers.length === 0, "no blockers when ready");
    assert(typeof res.message === "string", "message is string");
    assert(res.message.includes("READY"), "message says READY");
    assert(typeof res.timestamp === "string", "timestamp present");
    assert(typeof res.runtime === "object", "runtime object present");
    assert(res.runtime.health.state === "green", "runtime health is green");
    assert(res.runtime.health.blocked === false, "runtime health not blocked");
    assert(res.runtime.providerPool.available === 1, "1 provider available");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: red health produces partial verdict ---------------------------
  console.log("\nPreview: red health, partial verdict\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("red"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.ok === true, "preview ok with red health");
    assert(res.verdict === "partial", "verdict is partial with red health");
    assert(res.runtime.health.state === "red", "runtime health is red");
    assert(res.runtime.health.blocked === true, "runtime health blocked");
    assert(res.blockers.length > 0, "has blockers");
    assert(res.message.includes("PARTIAL"), "message says PARTIAL");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: black health produces partial verdict -------------------------
  console.log("\nPreview: black health, partial verdict\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("black"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.verdict === "partial", "verdict partial for black health");
    assert(res.runtime.health.state === "black", "health is black");
    assert(res.runtime.health.blocked === true, "health blocked");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: all providers exhausted blocks runtime -----------------------
  console.log("\nPreview: all providers exhausted\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
        { id: "prov-b", status: "disabled", currentConcurrency: 0, maxConcurrency: 1 },
      ],
    }));
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.runtime.providerPool.blocked === true, "pool blocked when all exhausted");
    assert(res.runtime.providerPool.blockReason.includes("exhausted"), "reason mentions exhausted");
    assert(res.verdict === "partial", "verdict partial when pool blocked");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: all providers at capacity blocks runtime ---------------------
  console.log("\nPreview: all providers at capacity\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "available", currentConcurrency: 2, maxConcurrency: 2 },
      ],
    }));
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.runtime.providerPool.blocked === true, "pool blocked at capacity");
    assert(res.runtime.providerPool.blockReason.includes("concurrency"), "reason mentions concurrency");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: missing health file defaults to unknown ----------------------
  console.log("\nPreview: missing health defaults to unknown\n");

  {
    var dir = tmpDir();
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: path.join(dir, "nonexistent.json"), statePath: statePath, policyPath: policyPath });
    assert(res.ok === true, "preview ok with missing health");
    assert(res.runtime.health.state === "unknown", "health defaults to unknown");
    assert(res.runtime.health.blocked === true, "unknown health is blocked");
    assert(res.verdict !== "ready", "not ready with unknown health");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: missing provider pool defaults --------------------------------
  console.log("\nPreview: missing provider pool defaults\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: path.join(dir, "nonexistent.json"), policyPath: policyPath });
    assert(res.ok === true, "preview ok with missing state");
    assert(res.runtime.providerPool.total === 0, "0 total providers");
    assert(res.runtime.providerPool.blocked === false, "not blocked with no providers");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: null payload uses defaults ------------------------------------
  console.log("\nPreview: null payload\n");

  {
    var res = mod.preview(null);
    assert(res.ok === true, "preview ok with null payload");
    assert(res.dryRun === true, "dryRun true with null payload");
    assert(typeof res.verdict === "string", "verdict present with null payload");
  }

  // --- Preview: empty payload uses defaults -----------------------------------
  console.log("\nPreview: empty payload\n");

  {
    var res = mod.preview({});
    assert(res.ok === true, "preview ok with empty payload");
    assert(res.dryRun === true, "dryRun true with empty payload");
    assert(typeof res.verdict === "string", "verdict present with empty payload");
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

  // --- Gate structure --------------------------------------------------------
  console.log("\nGate structure\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });

    assert(res.gates.length === 7, "7 gates");
    assert(res.gates[0].id === "gate-1", "gate-1 id");
    assert(res.gates[0].name === "Self-Cycle Runner Autonomy", "gate-1 name");
    assert(res.gates[1].id === "gate-2", "gate-2 id");
    assert(res.gates[1].name === "Launch Gate Enforcement", "gate-2 name");
    assert(res.gates[2].id === "gate-3", "gate-3 id");
    assert(res.gates[2].name === "Health Gate Operational", "gate-3 name");
    assert(res.gates[3].id === "gate-4", "gate-4 id");
    assert(res.gates[3].name === "Recovery Path", "gate-4 name");
    assert(res.gates[4].id === "gate-5", "gate-5 id");
    assert(res.gates[4].name === "Merge Control", "gate-5 name");
    assert(res.gates[5].id === "gate-6", "gate-6 id");
    assert(res.gates[5].name === "Human-Owned Boundaries", "gate-6 name");
    assert(res.gates[6].id === "gate-7", "gate-7 id");
    assert(res.gates[6].name === "Observability", "gate-7 name");

    for (var i = 0; i < res.gates.length; i++) {
      var g = res.gates[i];
      assert(typeof g.pass === "boolean", g.id + " pass is boolean");
      assert(typeof g.blocking === "boolean", g.id + " blocking is boolean");
      assert(g.blocking === true, g.id + " is blocking");
      assert(Array.isArray(g.checks), g.id + " checks is array");
      assert(g.checks.length > 0, g.id + " has checks");
      for (var j = 0; j < g.checks.length; j++) {
        assert(typeof g.checks[j].id === "string", g.id + " check " + j + " has id");
        assert(typeof g.checks[j].name === "string", g.id + " check " + j + " has name");
        assert(typeof g.checks[j].pass === "boolean", g.id + " check " + j + " has pass boolean");
      }
    }

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Gate 3.3 and 4.3 are non-blocking ------------------------------------
  console.log("\nNon-blocking checks\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });

    var gate3 = res.gates.find(function (g) { return g.id === "gate-3"; });
    var check33 = gate3.checks.find(function (c) { return c.id === "3.3"; });
    assert(check33.nonBlocking === true, "3.3 is non-blocking");
    assert(check33.pass === false, "3.3 fails (not yet implemented)");
    assert(gate3.pass === true, "gate-3 passes despite 3.3 failing");

    var gate4 = res.gates.find(function (g) { return g.id === "gate-4"; });
    var check43 = gate4.checks.find(function (c) { return c.id === "4.3"; });
    assert(check43.nonBlocking === true, "4.3 is non-blocking");
    assert(check43.pass === false, "4.3 fails (not yet implemented)");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: sanitization strips secrets from providers --------------------
  console.log("\nSanitization\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    var raw = JSON.stringify(res);
    assert(!raw.includes("should-be-stripped"), "no secret value in output");
    assert(!apiKeyRe.test(raw), "no API key pattern in output");
    assert(!ghTokenRe.test(raw), "no GitHub token pattern in output");
    assert(!raw.includes("password"), "no password field in output");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: no temp files created -----------------------------------------
  console.log("\nNo temp files created\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    var files = fs.readdirSync(dir);
    assert(files.length === 3, "only original fixture files remain");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Verdict: ready with yellow health (still partial) ----------------------
  console.log("\nVerdict: yellow health is partial\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("yellow"));
    writeJson(statePath, makePool());
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.runtime.health.state === "yellow", "health is yellow");
    assert(res.runtime.health.blocked === false, "yellow is not blocked");
    // With all gates passing and yellow health (not blocked), verdict should be ready
    assert(res.verdict === "ready", "yellow health with all gates passing is ready");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Verdict: mixed provider statuses --------------------------------------
  console.log("\nVerdict: mixed provider statuses\n");

  {
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("green"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "available", currentConcurrency: 0, maxConcurrency: 2 },
        { id: "prov-b", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
        { id: "prov-c", status: "disabled", currentConcurrency: 0, maxConcurrency: 1 },
      ],
    }));
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.runtime.providerPool.available === 1, "1 available");
    assert(res.runtime.providerPool.total === 3, "3 total");
    assert(res.runtime.providerPool.blocked === false, "not blocked (has available)");
    assert(res.verdict === "ready", "ready with some available providers");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: message for not_ready ----------------------------------------
  console.log("\nPreview: not_ready message\n");

  {
    // Use a non-existent repo root to force all script checks to fail
    // We can't easily override repoRoot, but with empty health and default
    // paths that don't exist, we should get partial at minimum since gate-6
    // always passes. Test the partial message instead.
    var dir = tmpDir();
    var healthPath = path.join(dir, "health.json");
    var statePath = path.join(dir, "state.json");
    var policyPath = path.join(dir, "policy.json");

    writeJson(healthPath, makeHealth("red"));
    writeJson(statePath, makePool({
      providers: [
        { id: "prov-a", status: "exhausted", currentConcurrency: 0, maxConcurrency: 1 },
      ],
    }));
    writeJson(policyPath, makePolicy());

    var res = mod.preview({ healthPath: healthPath, statePath: statePath, policyPath: policyPath });
    assert(res.verdict === "partial", "partial with red health and exhausted pool");
    assert(res.message.includes("PARTIAL"), "message says PARTIAL");
    assert(res.blockers.length > 0, "has blockers");

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
  id: "autonomy-readiness-test",
  label: "Autonomy Readiness Tests",
  description: "Test harness for autonomy-readiness action module (not a real action)",
  dangerous: false,
  preview() {},
  execute() {},
};
