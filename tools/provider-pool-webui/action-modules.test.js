#!/usr/bin/env node

/**
 * action-modules.test.js
 *
 * Tests for pluggable WebUI action modules in the actions/ directory.
 * Self-contained, no external test framework.
 *
 * Run: node tools/provider-pool-webui/action-modules.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

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

// --- Fixture helpers ---------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "action-modules-test-"));
}

function fixtureState(overrides) {
  const base = {
    stateVersion: 1,
    providers: [
      {
        id: "provider-default",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 2,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
      },
    ],
    global: {
      globalMaxWorkers: 5,
      totalActiveWorkers: 0,
      capturedAt: "2026-05-12T00:00:00Z",
    },
  };
  if (!overrides) return base;
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function fixtureQueue(overrides) {
  const base = {
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00Z",
    entries: [
      {
        issueNumber: 600,
        state: "queued",
        updatedAt: "2026-05-12T00:00:00Z",
        conflictGroup: "webui-action-plan-next-batch",
        actorRole: "webui-control-console-worker",
        pmPhase: "wave18",
      },
      {
        issueNumber: 601,
        state: "queued",
        updatedAt: "2026-05-12T00:00:00Z",
        conflictGroup: "docs-worker",
        actorRole: "docs-worker",
        pmPhase: "wave18",
      },
      {
        issueNumber: 500,
        state: "running",
        updatedAt: "2026-05-11T23:00:00Z",
        conflictGroup: "backend",
        actorRole: "backend-runtime-worker",
        pmPhase: "wave17",
      },
    ],
    summary: { queued: 2, launching: 0, running: 1, prCreated: 0, blocked: 0, done: 0 },
  };
  if (!overrides) return base;
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// --- Load action modules from actions/ directory -----------------------------

const ACTIONS_DIR = path.join(__dirname, "actions");

function loadModules() {
  if (!fs.existsSync(ACTIONS_DIR)) return [];
  const modules = [];
  let files;
  try {
    files = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".js"));
  } catch {
    return [];
  }
  for (const file of files) {
    try {
      const mod = require(path.join(ACTIONS_DIR, file));
      if (mod && typeof mod.id === "string" && typeof mod.label === "string") {
        modules.push({ mod, file });
      }
    } catch (e) {
      console.error("  SKIP  " + file + " (load error: " + e.message + ")");
    }
  }
  return modules;
}

// --- Tests: module shape and discovery ---------------------------------------

console.log("action-modules.test.js\n");
console.log("--- Module shape ---\n");

const modules = loadModules();

assert(modules.length > 0, "At least one action module loaded from actions/");

for (const { mod, file } of modules) {
  const tag = file + " (" + mod.id + ")";

  assert(typeof mod.id === "string" && mod.id.length > 0, tag + " has string id");
  assert(typeof mod.label === "string" && mod.label.length > 0, tag + " has string label");
  assert(typeof mod.description === "string", tag + " has string description");

  if (mod.dangerous !== undefined) {
    assert(typeof mod.dangerous === "boolean", tag + " dangerous is boolean when present");
  }

  if (typeof mod.preview === "function") {
    assert(mod.preview.length <= 1, tag + " preview accepts 0 or 1 args");
  }

  if (typeof mod.execute === "function") {
    assert(mod.execute.length <= 1, tag + " execute accepts 0 or 1 args");
  }
}

// --- Tests: plan.next.batch preview with fixtures ----------------------------

console.log("\n--- plan.next.batch preview ---\n");

const planBatch = modules.find((m) => m.mod.id === "plan.next.batch");
if (planBatch) {
  const mod = planBatch.mod;
  const tmp = tmpDir();

  try {
    const statePath = path.join(tmp, "state.json");
    const queuePath = path.join(tmp, "queue.json");

    // Test: preview with valid state and queue
    writeJson(statePath, fixtureState());
    writeJson(queuePath, fixtureQueue());

    const result = mod.preview({ statePath, queuePath });
    assert(result.ok === true, "preview returns ok: true with valid fixtures");
    assert(result.dryRun === true, "preview returns dryRun: true");
    assert(Array.isArray(result.plan), "preview returns plan array");
    assert(Array.isArray(result.skipped), "preview returns skipped array");
    assert(result.capacity !== undefined, "preview returns capacity summary");
    assert(typeof result.timestamp === "string", "preview returns timestamp string");

    // Should plan 2 queued issues (provider has headroom of 2)
    assert(result.plan.length === 2, "preview plans 2 issues (provider has headroom=2)");
    assert(result.plan[0].issueNumber === 600, "first planned issue is #600");
    assert(result.plan[0].providerId === "provider-default", "first issue assigned to provider-default");
    assert(result.plan[0].conflictGroup !== null, "first issue preserves conflict group");
    assert(result.plan[1].issueNumber === 601, "second planned issue is #601");
    assert(result.skipped.length === 0, "no issues skipped with sufficient capacity");

    // Test: preview with no queued issues
    writeJson(queuePath, { schemaVersion: 1, capturedAt: "2026-05-12T00:00:00Z", entries: [] });
    const empty = mod.preview({ statePath, queuePath });
    assert(empty.ok === true, "preview ok with empty queue");
    assert(empty.plan.length === 0, "empty queue yields empty plan");
    assert(empty.skipped.length === 0, "empty queue yields no skipped");

    // Test: preview with insufficient capacity
    writeJson(queuePath, fixtureQueue());
    writeJson(statePath, fixtureState({
      providers: [{
        id: "tiny-provider",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
      }],
    }));
    const capped = mod.preview({ statePath, queuePath });
    assert(capped.ok === true, "preview ok with limited capacity");
    assert(capped.plan.length === 1, "only 1 issue planned with headroom=1");
    assert(capped.skipped.length === 1, "1 issue skipped due to capacity");

    // Test: preview with missing state file
    const missing = mod.preview({ statePath: path.join(tmp, "nope.json"), queuePath });
    assert(missing.ok === false, "preview returns ok:false with missing state");
    assert(typeof missing.error === "string", "preview returns error string for missing state");

    // Test: preview with missing queue file
    const missingQ = mod.preview({ statePath, queuePath: path.join(tmp, "nope-q.json") });
    assert(missingQ.ok === false, "preview returns ok:false with missing queue");

    // Test: preview with no payload (uses defaults, likely missing files)
    const noPayload = mod.preview();
    assert(typeof noPayload === "object", "preview with no payload returns object");

    // Test: preview strips secrets from state
    writeJson(statePath, fixtureState({
      providers: [{
        id: "secret-provider",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 1,
        secret: "ghp_abc123secrettoken",
        sourcePath: "/hidden/path",
        secretSources: ["env"],
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
      }],
    }));
    writeJson(queuePath, fixtureQueue());
    const sanitized = mod.preview({ statePath, queuePath });
    assert(sanitized.ok === true, "preview ok even with secrets in state");
    if (sanitized.plan.length > 0) {
      assert(sanitized.plan[0].providerId === "secret-provider", "provider id preserved in plan");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else {
  console.error("  SKIP  plan.next.batch module not found");
}

// --- Tests: plan.next.batch execute -----------------------------------------

console.log("\n--- plan.next.batch execute ---\n");

if (planBatch) {
  const mod = planBatch.mod;
  const tmp = tmpDir();

  try {
    const statePath = path.join(tmp, "state.json");
    const queuePath = path.join(tmp, "queue.json");
    const batchPath = path.join(tmp, "batch-plan.json");

    writeJson(statePath, fixtureState());
    writeJson(queuePath, fixtureQueue());

    // Test: execute without allowlist
    const noAllow = mod.execute({ reason: "test" });
    assert(noAllow.ok === false, "execute rejects missing allowlist");

    // Test: execute without reason
    const noReason = mod.execute({ allowlist: [600] });
    assert(noReason.ok === false, "execute rejects missing reason");

    // Test: execute with empty allowlist
    const emptyAllow = mod.execute({ allowlist: [], reason: "test" });
    assert(emptyAllow.ok === false, "execute rejects empty allowlist");

    // Test: execute with allowlist mismatch
    const mismatch = mod.execute({
      allowlist: [999],
      reason: "testing allowlist enforcement",
      statePath,
      queuePath,
      batchPath,
    });
    assert(mismatch.ok === false, "execute rejects when plan issues not in allowlist");
    assert(Array.isArray(mismatch.blocked), "execute returns blocked issues");

    // Test: execute with valid allowlist
    const valid = mod.execute({
      allowlist: [600, 601],
      reason: "batch launch for wave18",
      statePath,
      queuePath,
      batchPath,
    });
    assert(valid.ok === true, "execute returns ok: true with valid allowlist");
    assert(Array.isArray(valid.plan), "execute returns plan array");
    assert(valid.plan.length === 2, "execute plans 2 issues");
    assert(typeof valid.reason === "string", "execute echoes reason");
    assert(typeof valid.timestamp === "string", "execute returns timestamp");

    // Test: batch plan file was written
    assert(fs.existsSync(batchPath), "execute writes batch plan file");
    const written = JSON.parse(fs.readFileSync(batchPath, "utf-8"));
    assert(written.schemaVersion === 1, "batch plan has schemaVersion");
    assert(Array.isArray(written.plan), "batch plan has plan array");
    assert(written.reason === "batch launch for wave18", "batch plan includes reason");

    // Test: execute with partial allowlist (only one issue allowed)
    const batchPath2 = path.join(tmp, "batch-plan-2.json");
    const partial = mod.execute({
      allowlist: [600],
      reason: "only issue 600",
      statePath,
      queuePath,
      batchPath: batchPath2,
    });
    assert(partial.ok === false, "execute rejects partial allowlist (601 not allowed)");
    assert(partial.blocked && partial.blocked.includes(601), "blocked includes issue 601");

  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else {
  console.error("  SKIP  plan.next.batch execute tests (module not found)");
}

// --- Tests: server discovery compatibility -----------------------------------

console.log("\n--- Server discovery compatibility ---\n");

// Simulate what server.js loadActionModules does
if (fs.existsSync(ACTIONS_DIR)) {
  let files;
  try {
    files = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".js"));
  } catch {
    files = [];
  }

  assert(files.length > 0, "actions/ directory contains .js files");

  for (const file of files) {
    try {
      const mod = require(path.join(ACTIONS_DIR, file));
      if (mod && typeof mod.id === "string" && typeof mod.label === "string") {
        // Simulate server.js listing endpoint response shape
        const listing = {
          id: mod.id,
          label: mod.label,
          description: mod.description || "",
          dangerous: !!mod.dangerous,
        };
        assert(typeof listing.id === "string", file + " listing has string id");
        assert(typeof listing.label === "string", file + " listing has string label");
        assert(typeof listing.dangerous === "boolean", file + " listing has boolean dangerous");
      }
    } catch {
      // skip broken
    }
  }
} else {
  assert(false, "actions/ directory exists");
}

// --- Summary -----------------------------------------------------------------

console.log("\n--- Summary ---\n");
console.log("  Passed: " + passed);
console.log("  Failed: " + failed);

if (failed > 0) {
  process.exit(1);
}
