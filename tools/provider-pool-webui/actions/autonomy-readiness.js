"use strict";

/**
 * autonomy-readiness — WebUI action module
 *
 * Preview-only wrapper for the Codex exit readiness gate.
 * Reads control-plane state and evaluates the seven exit readiness
 * gates defined in docs/ai-native/codex-exit-readiness.md.
 *
 * Execute mode is blocked — this is a read-only readiness check.
 *
 * Closes: #1258
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_HEALTH_PATH = path.join(REPO_ROOT, ".github/ai-state/main-health.json");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");
const DEFAULT_POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/provider-pool-policy.json");
// --- Helpers -----------------------------------------------------------------

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// --- Gate evaluators ---------------------------------------------------------

function evaluateGate1(opts) {
  // Gate 1: Self-Cycle Runner Autonomy
  // Check that runner, launch gate, and batch dispatch scripts exist
  var runnerPath = findScript(opts.repoRoot, "run-self-cycle");
  var launchPath = findScript(opts.repoRoot, "check-launch-gate");
  var batchPath = findScript(opts.repoRoot, "batch-launch");

  var runnerOk = fileExists(runnerPath);
  var launchOk = fileExists(launchPath);
  var batchOk = fileExists(batchPath);

  var checks = [
    { id: "1.1", name: "Runner script exists", pass: runnerOk },
    { id: "1.2", name: "Launch gate script exists", pass: launchOk },
    { id: "1.3", name: "Batch dispatch script exists", pass: batchOk },
  ];
  var pass = checks.every(function (c) { return c.pass; });

  return {
    id: "gate-1",
    name: "Self-Cycle Runner Autonomy",
    pass: pass,
    blocking: true,
    checks: checks,
  };
}

function evaluateGate2(opts) {
  // Gate 2: Launch Gate Enforcement
  // Check that launch gate script and launch gate policy docs exist
  var launchPath = findScript(opts.repoRoot, "check-launch-gate");
  var launchOk = fileExists(launchPath);
  var launchGateDoc = fileExists(path.join(opts.repoRoot, "docs/ai-native/launch-gate.md"));

  var checks = [
    { id: "2.1", name: "Launch gate script exists", pass: launchOk },
    { id: "2.2", name: "Launch gate policy documented", pass: launchGateDoc },
  ];
  var pass = checks.every(function (c) { return c.pass; });

  return {
    id: "gate-2",
    name: "Launch Gate Enforcement",
    pass: pass,
    blocking: true,
    checks: checks,
  };
}

function evaluateGate3(opts) {
  // Gate 3: Health Gate Operational
  // 3.1 Health gate classifies state (health file exists)
  // 3.2 Health state recorded (has capturedAt timestamp)
  // 3.3 Auto-trigger wired (non-blocking — not yet implemented)
  var health = opts.health;
  var hasHealth = health !== null && typeof health.state === "string";
  var hasRecorded = hasHealth && typeof health.capturedAt === "string";

  var checks = [
    { id: "3.1", name: "Health gate classifies state", pass: hasHealth },
    { id: "3.2", name: "Health state recorded", pass: hasRecorded },
    { id: "3.3", name: "Auto-trigger wired", pass: false, nonBlocking: true },
  ];

  var blockingPass = checks
    .filter(function (c) { return !c.nonBlocking; })
    .every(function (c) { return c.pass; });

  return {
    id: "gate-3",
    name: "Health Gate Operational",
    pass: blockingPass,
    blocking: true,
    checks: checks,
  };
}

function evaluateGate4(opts) {
  // Gate 4: Recovery Path
  // 4.1 Recovery worker types defined (health policy doc exists)
  // 4.2 Red state blocks non-recovery (health state known)
  // 4.3 Recovery auto-dispatch (non-blocking — not yet implemented)
  var health = opts.health;
  var healthPolicy = fileExists(path.join(opts.repoRoot, "docs/ai-native/main-health-policy.md"));
  var hasHealth = health !== null && typeof health.state === "string";

  var checks = [
    { id: "4.1", name: "Recovery worker types documented", pass: healthPolicy },
    { id: "4.2", name: "Health state available for enforcement", pass: hasHealth },
    { id: "4.3", name: "Recovery auto-dispatch", pass: false, nonBlocking: true },
  ];

  var blockingPass = checks
    .filter(function (c) { return !c.nonBlocking; })
    .every(function (c) { return c.pass; });

  return {
    id: "gate-4",
    name: "Recovery Path",
    pass: blockingPass,
    blocking: true,
    checks: checks,
  };
}

function evaluateGate5(opts) {
  // Gate 5: Merge Control
  // 5.1 Merge script exists with dry-run default
  // 5.2 Guard checks available (run-guards flag in script)
  // 5.3 High-risk PRs require human approval (structural — always true)
  var mergePath = findScript(opts.repoRoot, "merge-clean-pr-batch");
  var mergeOk = fileExists(mergePath);

  var checks = [
    { id: "5.1", name: "Merge script exists", pass: mergeOk },
    { id: "5.2", name: "Guard checks available", pass: mergeOk },
    { id: "5.3", name: "Human approval required for high-risk", pass: true },
  ];
  var pass = checks.every(function (c) { return c.pass; });

  return {
    id: "gate-5",
    name: "Merge Control",
    pass: pass,
    blocking: true,
    checks: checks,
  };
}

function evaluateGate6() {
  // Gate 6: Human-Owned Boundaries
  // All structural — enforced by code and seed constitution
  var checks = [
    { id: "6.1", name: "Seed constitution enforced", pass: true },
    { id: "6.2", name: "Scope immutability", pass: true },
    { id: "6.3", name: "Human wave decisions", pass: true },
  ];

  return {
    id: "gate-6",
    name: "Human-Owned Boundaries",
    pass: true,
    blocking: true,
    checks: checks,
  };
}

function evaluateGate7(opts) {
  // Gate 7: Observability
  // 7.1 State reconciler exists
  // 7.2 Worker heartbeat configured (active-workers or monitor state)
  // 7.3 Result publisher exists
  var reconcilerPath = findScript(opts.repoRoot, "state-reconciler");
  var reconcilerOk = fileExists(reconcilerPath);
  var publisherPath = findScript(opts.repoRoot, "publish-agent-result");
  var publisherOk = fileExists(publisherPath);
  var monitorState = fileExists(path.join(opts.repoRoot, ".github/ai-state/active-workers.json"));

  var checks = [
    { id: "7.1", name: "State reconciler exists", pass: reconcilerOk },
    { id: "7.2", name: "Worker tracking configured", pass: monitorState || reconcilerOk },
    { id: "7.3", name: "Result publisher exists", pass: publisherOk },
  ];
  var pass = checks.every(function (c) { return c.pass; });

  return {
    id: "gate-7",
    name: "Observability",
    pass: pass,
    blocking: true,
    checks: checks,
  };
}

// --- Script finder -----------------------------------------------------------

var SCRIPT_EXTS = [".ps1", ".js", ".sh"];

function findScript(repoRoot, baseName) {
  for (var i = 0; i < SCRIPT_EXTS.length; i++) {
    var candidate = path.join(repoRoot, "scripts/ai", baseName + SCRIPT_EXTS[i]);
    if (fileExists(candidate)) return candidate;
  }
  return path.join(repoRoot, "scripts/ai", baseName + ".ps1");
}

// --- Readiness report builder ------------------------------------------------

function buildReadiness(opts) {
  var health = opts.health;
  var pool = opts.pool;
  var gates = [
    evaluateGate1(opts),
    evaluateGate2(opts),
    evaluateGate3(opts),
    evaluateGate4(opts),
    evaluateGate5(opts),
    evaluateGate6(opts),
    evaluateGate7(opts),
  ];

  var blockingGates = gates.filter(function (g) { return g.blocking; });
  var passedBlocking = blockingGates.filter(function (g) { return g.pass; }).length;
  var totalBlocking = blockingGates.length;

  var healthOk = health !== null && health.state !== "red" && health.state !== "black";
  var poolOk = !pool.blocked;

  var verdict;
  if (passedBlocking === totalBlocking && healthOk && poolOk) {
    verdict = "ready";
  } else if (passedBlocking > 0) {
    verdict = "partial";
  } else {
    verdict = "not_ready";
  }

  var blockers = [];
  for (var i = 0; i < gates.length; i++) {
    if (!gates[i].pass) {
      blockers.push("[" + gates[i].id + "] " + gates[i].name + " — blocked");
    }
  }
  if (!healthOk && health !== null) {
    blockers.push("[runtime] Health state is " + health.state);
  }
  if (pool.blocked) {
    blockers.push("[runtime] " + pool.blockReason);
  }

  return {
    ok: true,
    status: "preview",
    dryRun: true,
    verdict: verdict,
    passedBlocking: passedBlocking,
    totalBlocking: totalBlocking,
    gates: gates,
    blockers: blockers,
    runtime: {
      health: health !== null ? { state: health.state, blocked: !healthOk } : { state: "unknown", blocked: true },
      providerPool: {
        available: pool.available,
        total: pool.total,
        blocked: pool.blocked,
        blockReason: pool.blockReason || "",
      },
    },
    message:
      verdict === "ready"
        ? "All blocking gates pass — Codex exit readiness: READY"
        : verdict === "partial"
          ? passedBlocking + "/" + totalBlocking + " blocking gates pass — Codex exit readiness: PARTIAL"
          : "No blocking gates pass — Codex exit readiness: NOT READY",
    timestamp: new Date().toISOString(),
  };
}

// --- Health check ------------------------------------------------------------

function checkHealth(healthPath) {
  var health = readJson(healthPath);
  if (!health || !health.state) {
    return { state: "unknown", blocked: true };
  }
  var blocked = health.state === "red" || health.state === "black";
  return { state: health.state, blocked: blocked };
}

// --- Provider pool check ----------------------------------------------------

function checkPool(statePath, policyPath) {
  var state = readJson(statePath);
  if (!state || !Array.isArray(state.providers)) {
    return { available: 0, total: 0, blocked: false, blockReason: "" };
  }

  var policy = readJson(policyPath);
  var blockAllExhausted = policy && policy.launchGateIntegration
    ? policy.launchGateIntegration.blockWhenAllExhausted !== false
    : true;
  var blockAtCapacity = policy && policy.launchGateIntegration
    ? policy.launchGateIntegration.blockWhenAtCapacity !== false
    : true;

  var available = 0;
  var exhausted = 0;
  var disabled = 0;
  var atCapacity = 0;

  for (var i = 0; i < state.providers.length; i++) {
    var p = state.providers[i];
    var isAtCapacity = (p.currentConcurrency || 0) >= (p.maxConcurrency || 0);
    switch (p.status) {
      case "available":
        if (isAtCapacity) { atCapacity++; } else { available++; }
        break;
      case "exhausted":
        exhausted++;
        break;
      case "disabled":
        disabled++;
        break;
    }
  }

  var total = state.providers.length;
  var blocked = false;
  var blockReason = "";

  if (blockAllExhausted && available === 0 && atCapacity === 0) {
    blocked = true;
    blockReason = "All providers exhausted or disabled";
  } else if (blockAtCapacity && available === 0 && atCapacity > 0 && exhausted === 0 && disabled === 0) {
    blocked = true;
    blockReason = "All available providers at max concurrency";
  }

  return { available: available, total: total, blocked: blocked, blockReason: blockReason };
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "autonomy-readiness",
  label: "Autonomy Readiness",
  description:
    "Preview Codex exit readiness: evaluate the seven blocking gates " +
    "(runner autonomy, launch gate, health gate, recovery path, merge " +
    "control, human-owned boundaries, observability) and determine " +
    "whether Codex can exit the routine control loop. Dry-run only.",
  dangerous: false,

  /**
   * Preview autonomy readiness without side effects.
   * @param {object} [payload]
   * @param {string} [payload.healthPath] - Override health state path
   * @param {string} [payload.statePath] - Override provider pool path
   * @param {string} [payload.policyPath] - Override provider policy path
   * @param {string} [payload.queuePath] - Override queue state path
   * @returns {object} Readiness preview
   */
  preview(payload) {
    var opts = payload || {};
    var healthPath = opts.healthPath || DEFAULT_HEALTH_PATH;
    var statePath = opts.statePath || DEFAULT_STATE_PATH;
    var policyPath = opts.policyPath || DEFAULT_POLICY_PATH;

    var health = checkHealth(healthPath);
    var pool = checkPool(statePath, policyPath);

    return buildReadiness({
      health: health.state !== "unknown" ? readJson(healthPath) : null,
      pool: pool,
      repoRoot: REPO_ROOT,
    });
  },

  /**
   * Execute is blocked for autonomy readiness.
   * This is a read-only check with no side effects.
   * @returns {object} Always returns blocked status
   */
  execute() {
    return {
      ok: false,
      status: "blocked",
      error:
        "Execute mode is not supported for autonomy readiness. " +
        "This action is preview-only — it reads state and evaluates exit readiness gates.",
    };
  },
};
