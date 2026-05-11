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

  // --- Preview leaves no temp files -------------------------------------------
  console.log("\nPreview temp file safety\n");

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
      mod.preview({ providerId: "provider-default", statePath, policyPath });
      const files = fs.readdirSync(dir);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      assert(tmpFiles.length === 0, "preview leaves no temp files");
      // Verify state file is still valid JSON after preview
      const after = readJson(statePath);
      assert(after !== null, "state file is valid JSON after preview");
      assert(after.providers[0].status === "exhausted", "state unchanged after preview (exhausted)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Reason handling --------------------------------------------------------
  console.log("\nReason handling\n");

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
      const result = mod.execute({ providerId: "provider-default", statePath, policyPath });
      assert(result.reason === "", "default reason is empty string");
      assert(typeof result.summary === "string", "execute includes summary string");
      assert(result.summary.includes("provider-default"), "summary mentions providerId");
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
        consecutiveFailures: 1,
        totalQuotaEvents: 1,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.execute({ providerId: "provider-default", reason: "", statePath, policyPath });
      assert(result.reason === "", "explicit empty reason preserved");
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
        cooldownExpiresAt: null,
        consecutiveFailures: 1,
        totalQuotaEvents: 0,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.execute({ providerId: "provider-default", reason: "quota reset after billing update", statePath, policyPath });
      assert(result.reason === "quota reset after billing update", "reason string preserved verbatim");
      const raw = JSON.stringify(result);
      assert(!apiKeyRe.test(raw), "reason field has no API key pattern");
      assert(!ghTokenRe.test(raw), "reason field has no GitHub token pattern");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Execute null payload ---------------------------------------------------
  console.log("\nExecute null payload\n");

  {
    let threw = false;
    try {
      mod.execute(null);
    } catch (err) {
      threw = true;
    }
    assert(threw, "execute throws on null payload");
  }

  // --- Changes array structure ------------------------------------------------
  console.log("\nChanges array structure\n");

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
      const result = mod.execute({ providerId: "provider-default", reason: "test", statePath, policyPath });
      assert(result.changes.length === 3, "exhausted provider has 3 changes");
      const statusChange = result.changes.find((c) => c.field === "status");
      assert(statusChange !== undefined, "changes include status");
      assert(statusChange.from === "exhausted", "status from is exhausted");
      assert(statusChange.to === "available", "status to is available");
      const cooldownChange = result.changes.find((c) => c.field === "cooldownExpiresAt");
      assert(cooldownChange !== undefined, "changes include cooldownExpiresAt");
      assert(cooldownChange.from === "2026-05-11T15:00:00Z", "cooldown from is original value");
      assert(cooldownChange.to === null, "cooldown to is null");
      const failureChange = result.changes.find((c) => c.field === "consecutiveFailures");
      assert(failureChange !== undefined, "changes include consecutiveFailures");
      assert(failureChange.from === 3, "failures from is original count");
      assert(failureChange.to === 0, "failures to is 0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Disabled provider execute ---------------------------------------------
  console.log("\nDisabled provider execute\n");

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
      const result = mod.execute({ providerId: "provider-default", reason: "re-enable after fix", statePath, policyPath });
      assert(result.status === "rotated", "disabled provider rotates successfully");
      const after = readJson(statePath);
      assert(after.providers[0].status === "available", "disabled provider now available");
      assert(after.global.availableProviders === 1, "global available count updated");
      assert(after.global.disabledProviders === 0, "global disabled count updated");
      assert(after.global.lastUpdatedBy === "webui-provider-rotation", "global lastUpdatedBy set");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Preview with disabled provider ----------------------------------------
  console.log("\nPreview with disabled provider\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState({
      providers: [{
        id: "provider-default",
        status: "disabled",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: null,
        consecutiveFailures: 10,
        totalQuotaEvents: 5,
      }],
    }));
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      assert(result.plan.currentState.status === "disabled", "plan shows disabled status");
      assert(result.plan.targetState.status === "available", "target is available");
      assert(result.plan.currentState.consecutiveFailures === 10, "plan shows failure count");
      assert(result.plan.currentState.totalQuotaEvents === 5, "plan shows quota events");
      const after = readJson(statePath);
      assert(after.providers[0].status === "disabled", "state still disabled after preview");
      assert(after.providers[0].consecutiveFailures === 10, "failures unchanged after preview");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Secret source unavailable blockReason ----------------------------------
  console.log("\nSecret source blockReason\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy({
      providers: [{
        id: "provider-default",
        label: "Default",
        source: "env-var",
        capabilities: ["claude-code"],
        maxConcurrency: 1,
      }],
      secretSources: { allowed: ["env-var"] },
    }));
    // Temporarily clear env vars to make secret source unavailable
    const savedApiKey = process.env.ANTHROPIC_API_KEY;
    const savedClaudeKey = process.env.CLAUDE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      assert(typeof result.plan.blockReason === "string", "blockReason is a string");
      assert(result.plan.blockReason.length > 0, "blockReason is non-empty when secret unavailable");
      assert(result.plan.canRotate === true, "canRotate still true even with blockReason");
      const secretCheck = result.plan.validationChecks.find((c) => c.check === "secret-source-exists");
      assert(secretCheck.passed === false, "secret-source-exists fails when env var missing");
    } finally {
      if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
      if (savedClaudeKey !== undefined) process.env.CLAUDE_API_KEY = savedClaudeKey;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- providerSource never leaks secret values --------------------------------
  console.log("\nproviderSource safety\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const result = mod.preview({ providerId: "provider-default", statePath, policyPath });
      const ps = result.plan.providerSource;
      assert(typeof ps.type === "string", "providerSource.type is string");
      assert(ps.type !== undefined && ps.type !== null, "providerSource.type is defined");
      // providerSource should never contain actual secret values
      const raw = JSON.stringify(ps);
      assert(!raw.includes("sk-"), "providerSource has no sk- prefix");
      assert(!apiKeyRe.test(raw), "providerSource has no API key pattern");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Execute on already-available preserves global counts --------------------
  console.log("\nExecute preserves global counts when no-op\n");

  {
    const dir = tmpDir();
    const statePath = writeFixture(dir, "state.json", fixtureState());
    const policyPath = writeFixture(dir, "policy.json", fixturePolicy());
    try {
      const before = readJson(statePath);
      mod.execute({ providerId: "provider-default", statePath, policyPath });
      const after = readJson(statePath);
      assert(after.global.availableProviders === before.global.availableProviders, "available count unchanged on no-op execute");
      assert(after.global.exhaustedProviders === before.global.exhaustedProviders, "exhausted count unchanged on no-op execute");
      assert(after.global.disabledProviders === before.global.disabledProviders, "disabled count unchanged on no-op execute");
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
