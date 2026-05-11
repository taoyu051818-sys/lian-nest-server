#!/usr/bin/env node

/**
 * action-modules.test.js
 *
 * Tests for WebUI action modules loaded from actions/ directory.
 * Validates module contract, preview/execute safety, and sanitization.
 * No external test framework — uses a simple assert helper.
 *
 * Run: node tools/provider-pool-webui/action-modules.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ACTIONS_DIR = path.join(__dirname, "actions");

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

function loadAllModules() {
  if (!fs.existsSync(ACTIONS_DIR)) return [];
  const files = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".js"));
  const modules = [];
  for (const file of files) {
    try {
      const mod = require(path.join(ACTIONS_DIR, file));
      modules.push({ file, mod });
    } catch (e) {
      console.error("  SKIP  " + file + " (load error: " + e.message + ")");
    }
  }
  return modules;
}

function createTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "action-test-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Check that an object contains no secret-like values.
 * Returns true if safe.
 */
function hasNoSecrets(obj) {
  const secretPattern = /(api[_-]?key|token|secret|password|credential)/i;
  const json = JSON.stringify(obj);
  // Check that no key in the object matches secret patterns
  function check(o) {
    if (!o || typeof o !== "object") return true;
    for (const [k, v] of Object.entries(o)) {
      if (secretPattern.test(k)) return false;
      if (typeof v === "object" && !check(v)) return false;
    }
    return true;
  }
  return check(obj);
}

// --- Load modules ------------------------------------------------------------

console.log("\n=== Action Module Tests ===\n");

const allModules = loadAllModules();
assert(allModules.length > 0, "At least one action module loaded from actions/");

// --- Module contract tests ---------------------------------------------------

console.log("\nModule contract\n");

for (const { file, mod } of allModules) {
  const prefix = "module[" + file + "]";

  assert(typeof mod.id === "string" && mod.id.length > 0, prefix + " has string id");
  assert(typeof mod.label === "string" && mod.label.length > 0, prefix + " has string label");
  assert(typeof mod.description === "string", prefix + " has string description");
  assert(typeof mod.dangerous === "boolean", prefix + " has boolean dangerous");
  assert(typeof mod.execute === "function", prefix + " has execute function");
}

// --- Provider rotation specific tests ----------------------------------------

console.log("\nprovider-rotation module\n");

const rotationModule = allModules.find((m) => m.mod.id === "provider-rotation");

if (rotationModule) {
  const mod = rotationModule.mod;

  assert(mod.id === "provider-rotation", "id is 'provider-rotation'");
  assert(mod.label === "Provider Key Rotation", "label is 'Provider Key Rotation'");
  assert(mod.dangerous === true, "dangerous is true (requires confirmation)");
  assert(typeof mod.preview === "function", "has preview function");

  // --- Preview tests with temp state -----------------------------------------

  console.log("\nprovider-rotation preview\n");

  const tmpDir = createTmpDir();
  const statePath = path.join(tmpDir, "provider-pool.json");
  const policyPath = path.join(tmpDir, "provider-pool-policy.json");

  writeJson(statePath, {
    stateVersion: 1,
    providers: [
      {
        id: "test-provider",
        status: "exhausted",
        currentConcurrency: 0,
        maxConcurrency: 2,
        cooldownExpiresAt: "2099-12-31T23:59:59Z",
        consecutiveFailures: 3,
        totalQuotaEvents: 5,
      },
    ],
    global: {
      totalActiveWorkers: 0,
      globalMaxWorkers: 3,
      availableProviders: 0,
      exhaustedProviders: 1,
      disabledProviders: 0,
    },
  });

  writeJson(policyPath, {
    policyVersion: 1,
    providers: [
      {
        id: "test-provider",
        label: "Test Provider",
        source: "env-var",
        maxConcurrency: 2,
      },
      {
        id: "disabled-prov",
        label: "Disabled Provider",
        source: "env-var",
        maxConcurrency: 1,
      },
    ],
    secretSources: { allowed: ["env-var"] },
  });

  // Valid preview
  const previewResult = mod.preview({
    providerId: "test-provider",
    statePath,
    policyPath,
  });

  assert(previewResult !== null && typeof previewResult === "object", "preview returns object");
  assert(previewResult.status === "preview", "preview status is 'preview'");
  assert(previewResult.dryRun === true, "preview dryRun is true");
  assert(previewResult.providerId === "test-provider", "preview includes providerId");
  assert(previewResult.plan !== undefined, "preview includes plan");
  assert(previewResult.plan.canRotate === true, "plan.canRotate is true");
  assert(
    previewResult.plan.currentState.status === "exhausted",
    "plan shows current status exhausted"
  );
  assert(
    previewResult.plan.targetState.status === "available",
    "plan shows target status available"
  );
  assert(hasNoSecrets(previewResult), "preview contains no secrets");

  // Preview with nonexistent provider
  let previewThrew = false;
  try {
    mod.preview({ providerId: "nonexistent", statePath, policyPath });
  } catch (e) {
    previewThrew = true;
    assert(e.message.includes("not found"), "preview throws for missing provider");
  }
  assert(previewThrew, "preview throws on invalid provider");

  // Preview with missing providerId
  let missingIdThrew = false;
  try {
    mod.preview({});
  } catch (e) {
    missingIdThrew = true;
    assert(e.message.includes("providerId"), "preview throws for missing providerId");
  }
  assert(missingIdThrew, "preview throws on missing providerId");

  // --- Execute tests with temp state -----------------------------------------

  console.log("\nprovider-rotation execute\n");

  // Execute on a copy of the state
  const execStatePath = path.join(tmpDir, "exec-state.json");
  writeJson(execStatePath, {
    stateVersion: 1,
    providers: [
      {
        id: "test-provider",
        status: "exhausted",
        currentConcurrency: 0,
        maxConcurrency: 2,
        cooldownExpiresAt: "2099-12-31T23:59:59Z",
        consecutiveFailures: 3,
        totalQuotaEvents: 5,
      },
    ],
    global: {
      totalActiveWorkers: 0,
      globalMaxWorkers: 3,
      availableProviders: 0,
      exhaustedProviders: 1,
      disabledProviders: 0,
    },
  });

  const execResult = mod.execute({
    providerId: "test-provider",
    reason: "test rotation",
    statePath: execStatePath,
    policyPath,
  });

  assert(execResult !== null && typeof execResult === "object", "execute returns object");
  assert(execResult.status === "rotated", "execute status is 'rotated'");
  assert(execResult.dryRun === false, "execute dryRun is false");
  assert(execResult.providerId === "test-provider", "execute includes providerId");
  assert(Array.isArray(execResult.changes), "execute includes changes array");
  assert(execResult.changes.length > 0, "execute has at least one change");
  assert(hasNoSecrets(execResult), "execute contains no secrets");

  // Verify state was actually modified
  const updatedState = readJson(execStatePath);
  const updatedProvider = updatedState.providers.find((p) => p.id === "test-provider");
  assert(updatedProvider.status === "available", "state: provider status is now available");
  assert(updatedProvider.cooldownExpiresAt === null, "state: cooldown cleared");
  assert(updatedProvider.consecutiveFailures === 0, "state: failures reset to 0");

  // Execute with nonexistent provider
  let execThrew = false;
  try {
    mod.execute({ providerId: "nonexistent", statePath: execStatePath, policyPath });
  } catch (e) {
    execThrew = true;
    assert(e.message.includes("not found"), "execute throws for missing provider");
  }
  assert(execThrew, "execute throws on invalid provider");

  // Execute with missing providerId
  let execMissingThrew = false;
  try {
    mod.execute({});
  } catch (e) {
    execMissingThrew = true;
  }
  assert(execMissingThrew, "execute throws on missing providerId");

  // --- Disabled provider rotation test ---------------------------------------

  console.log("\nprovider-rotation: disabled provider\n");

  const disabledStatePath = path.join(tmpDir, "disabled-state.json");
  writeJson(disabledStatePath, {
    stateVersion: 1,
    providers: [
      {
        id: "disabled-prov",
        status: "disabled",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
        totalQuotaEvents: 2,
      },
    ],
    global: {
      totalActiveWorkers: 0,
      globalMaxWorkers: 3,
      availableProviders: 0,
      exhaustedProviders: 0,
      disabledProviders: 1,
    },
  });

  const disabledResult = mod.execute({
    providerId: "disabled-prov",
    statePath: disabledStatePath,
    policyPath,
  });

  assert(disabledResult.status === "rotated", "disabled provider rotation succeeds");

  const disabledState = readJson(disabledStatePath);
  assert(
    disabledState.providers[0].status === "available",
    "disabled provider is now available"
  );
  assert(
    disabledState.global.availableProviders === 1,
    "global count updated for disabled provider"
  );

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
} else {
  console.log("  SKIP  provider-rotation module not found\n");
}

// --- Summary -----------------------------------------------------------------

console.log("\n=== Results ===");
console.log("  Passed: " + passed);
console.log("  Failed: " + failed);
console.log("");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed.");
  process.exit(0);
}
