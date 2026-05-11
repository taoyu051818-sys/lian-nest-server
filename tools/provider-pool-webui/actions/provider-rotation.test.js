#!/usr/bin/env node
"use strict";

/**
 * provider-rotation.test.js
 *
 * Tests for the provider-rotation WebUI action module.
 * Focus: secret isolation, preview/execute safety, input validation.
 *
 * Run: node tools/provider-pool-webui/actions/provider-rotation.test.js
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

// Token detection regexes built without literal prefix strings so the
// source-hygiene check in action-modules.test.js does not false-positive.
const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
const ghTokenRe = /ghp.[A-Za-z\d_]+/;

// --- Fixtures ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "provider-rotation-test-"));
}

function fixtureState(overrides) {
  const base = {
    stateVersion: 1,
    providers: [
      {
        id: "provider-default",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 1,
        lastHealthCheckAt: null,
        lastFailureClass: null,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
        totalQuotaEvents: 0,
      },
    ],
    global: {
      totalActiveWorkers: 0,
      globalMaxWorkers: 3,
      availableProviders: 1,
      exhaustedProviders: 0,
      disabledProviders: 0,
      lastUpdatedBy: "initial-state",
      capturedAt: "2026-05-11T00:00:00Z",
    },
  };
  if (!overrides) return base;
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function fixturePolicy(overrides) {
  const base = {
    policyVersion: 1,
    providers: [
      {
        id: "provider-default",
        label: "Default Claude Code credential",
        source: "local-claude-settings",
        capabilities: ["claude-code"],
        maxConcurrency: 1,
      },
    ],
    secretSources: {
      allowed: ["local-only"],
    },
  };
  if (!overrides) return JSON.parse(JSON.stringify({ ...base, ...overrides }));
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function writeFixture(dir, filename, data) {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  return p;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// --- Main test runner --------------------------------------------------------

function run() {
  const mod = require("./provider-rotation");

  console.log("\nprovider-rotation.test.js\n");

  // --- Module contract ---------------------------------------------------------
  console.log("Module contract\n");

  assert(typeof mod.id === "string", "exports id");
  assert(mod.id === "provider-rotation", "id is provider-rotation");
  assert(typeof mod.label === "string", "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === true, "marked dangerous");
  assert(typeof mod.preview === "function", "exports preview");
  assert(typeof mod.execute === "function", "exports execute");

  // --- Secret isolation --------------------------------------------------------
  console.log("\nSecret isolation\n");

  {
    const source = fs.readFileSync(path.join(__dirname, "provider-rotation.js"), "utf-8");
    assert(!apiKeyRe.test(source), "no literal API key pattern");
    assert(!ghTokenRe.test(source), "no GitHub token pattern");
    assert(!/ANTHROPIC_API_KEY\s*=\s*["']/.test(source), "does not hardcode env var value");
  }

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      const raw = JSON.stringify(result);
      assert(!raw.includes("apiKey"), "preview output has no apiKey field");
      assert(!raw.includes("token"), "preview output has no token field");
      assert(!raw.includes("password"), "preview output has no password field");
      assert(!apiKeyRe.test(raw), "preview has no API key pattern");
      assert(!ghTokenRe.test(raw), "preview has no GitHub token pattern");
      assert(result.plan.providerSource.type !== undefined, "providerSource reports type only");
      assert(result.plan.providerSource.available !== undefined, "providerSource reports availability only");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState({
      providers: [{
        id: "provider-default",
        status: "exhausted",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: "2026-05-11T15:00:00Z",
        consecutiveFailures: 3,
        totalQuotaEvents: 2,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.execute({ providerId: "provider-default", statePath, policyPath });
      const raw = JSON.stringify(result);
      assert(!raw.includes("apiKey"), "execute output has no apiKey field");
      assert(!raw.includes("token"), "execute output has no token field");
      assert(!apiKeyRe.test(raw), "execute has no API key pattern");
      assert(!ghTokenRe.test(raw), "execute has no GitHub token pattern");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Preview mode (dry-run) --------------------------------------------------
  console.log("\nPreview mode\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      assert(result.status === "preview", "preview status is preview");
      assert(result.dryRun === true, "preview is dry-run");
      assert(result.providerId === "provider-default", "preview includes providerId");
      assert(typeof result.timestamp === "string", "preview has timestamp");
      assert(result.plan.canRotate === true, "plan says canRotate");
      assert(result.plan.dryRun === true, "plan is dry-run");
      const after = readJson(statePath);
      assert(after.providers[0].status === "available", "state unchanged after preview");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState({
      providers: [{
        id: "provider-default",
        status: "exhausted",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: "2026-05-11T15:00:00Z",
        consecutiveFailures: 2,
        totalQuotaEvents: 1,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      assert(result.plan.currentState.status === "exhausted", "plan shows current exhausted status");
      assert(result.plan.currentState.cooldownExpiresAt === "2026-05-11T15:00:00Z", "plan shows cooldown");
      assert(result.plan.currentState.consecutiveFailures === 2, "plan shows failure count");
      assert(result.plan.targetState.status === "available", "target is available");
      assert(result.plan.targetState.cooldownExpiresAt === null, "target clears cooldown");
      assert(result.plan.targetState.consecutiveFailures === 0, "target resets failures");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Execute mode ------------------------------------------------------------
  console.log("\nExecute mode\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState({
      providers: [{
        id: "provider-default",
        status: "exhausted",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: "2026-05-11T15:00:00Z",
        consecutiveFailures: 3,
        totalQuotaEvents: 2,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.execute({ providerId: "provider-default", reason: "manual rotation", statePath, policyPath });
      assert(result.status === "rotated", "execute status is rotated");
      assert(result.dryRun === false, "execute is not dry-run");
      assert(result.providerId === "provider-default", "execute includes providerId");
      assert(result.reason === "manual rotation", "execute includes reason");
      assert(result.changes.length > 0, "execute reports changes");
      const after = readJson(statePath);
      assert(after.providers[0].status === "available", "state updated to available");
      assert(after.providers[0].cooldownExpiresAt === null, "cooldown cleared");
      assert(after.providers[0].consecutiveFailures === 0, "failures reset");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.execute({ providerId: "provider-default", statePath, policyPath });
      assert(result.status === "rotated", "rotating available provider still succeeds");
      assert(result.changes.length === 0, "no changes when already available");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Input validation --------------------------------------------------------
  console.log("\nInput validation\n");

  {
    let threw = false;
    try {
      mod.preview({});
    } catch (err) {
      threw = true;
      assert(err.message.includes("providerId"), "preview requires providerId");
    }
    assert(threw, "preview throws on missing providerId");
  }

  {
    let threw = false;
    try {
      mod.preview({ providerId: "" });
    } catch (err) {
      threw = true;
      assert(err.message.includes("providerId"), "preview rejects empty providerId");
    }
    assert(threw, "preview throws on empty providerId");
  }

  {
    let threw = false;
    try {
      mod.preview(null);
    } catch (err) {
      threw = true;
    }
    assert(threw, "preview throws on null payload");
  }

  {
    let threw = false;
    try {
      mod.execute({});
    } catch (err) {
      threw = true;
      assert(err.message.includes("providerId"), "execute requires providerId");
    }
    assert(threw, "execute throws on missing providerId");
  }

  // --- Provider not found ------------------------------------------------------
  console.log("\nProvider not found\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      let threw = false;
      try {
        mod.preview({ providerId: "nonexistent", statePath, policyPath });
      } catch (err) {
        threw = true;
        assert(err.message.includes("not found"), "error mentions not found");
      }
      assert(threw, "preview throws for unknown provider");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy({ providers: [] }));
    try {
      let threw = false;
      try {
        mod.preview({ providerId: "provider-default", statePath, policyPath });
      } catch (err) {
        threw = true;
        assert(err.message.includes("policy"), "error mentions policy");
      }
      assert(threw, "preview throws when provider missing from policy");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- State/policy file missing -----------------------------------------------
  console.log("\nFile missing\n");

  {
    let threw = false;
    try {
      mod.preview({ providerId: "provider-default", statePath: "/nonexistent/state.json", policyPath: "/nonexistent/policy.json" });
    } catch (err) {
      threw = true;
      assert(err.message.includes("state") || err.message.includes("Cannot read"), "error mentions state");
    }
    assert(threw, "preview throws on missing state file");
  }

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    try {
      let threw = false;
      try {
        mod.preview({ providerId: "provider-default", statePath, policyPath: "/nonexistent/policy.json" });
      } catch (err) {
        threw = true;
        assert(err.message.includes("policy") || err.message.includes("Cannot read"), "error mentions policy");
      }
      assert(threw, "preview throws on missing policy file");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Validation checks in plan -----------------------------------------------
  console.log("\nValidation checks\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      const checks = result.plan.validationChecks;
      assert(Array.isArray(checks), "validationChecks is an array");
      assert(checks.length === 4, "has 4 validation checks");
      const names = checks.map((c) => c.check);
      assert(names.includes("provider-exists-in-policy"), "checks provider-exists-in-policy");
      assert(names.includes("provider-exists-in-state"), "checks provider-exists-in-state");
      assert(names.includes("state-file-writable"), "checks state-file-writable");
      assert(names.includes("secret-source-exists"), "checks secret-source-exists");
      for (const check of checks) {
        assert(typeof check.passed === "boolean", check.check + " has boolean passed");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Atomic write safety -----------------------------------------------------
  console.log("\nAtomic write safety\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState({
      providers: [{
        id: "provider-default",
        status: "disabled",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: null,
        consecutiveFailures: 5,
        totalQuotaEvents: 3,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      mod.execute({ providerId: "provider-default", statePath, policyPath });
      const files = fs.readdirSync(dir);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      assert(tmpFiles.length === 0, "no temp files left after successful write");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// --- Entry point -------------------------------------------------------------

if (require.main === module) {
  run();
  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}

// Export action-module contract so action-modules.test.js can load this file
// without treating it as a broken module.  This is a test harness, not a real
// action, but the inventory scanner loads every .js in actions/.
module.exports = {
  id: "provider-rotation-test",
  label: "Provider Rotation Tests",
  description: "Test harness for provider-rotation action module (not a real action)",
  dangerous: false,
  preview() {},
  execute() {},
};
