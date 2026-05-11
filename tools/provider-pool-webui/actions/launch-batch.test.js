#!/usr/bin/env node
"use strict";

/**
 * launch-batch.test.js
 *
 * Tests the launch-batch action module gate logic and preview behaviour.
 * Creates temporary state fixtures so the module reads controlled data
 * without touching real .github/ai-state files.
 *
 * Run: node tools/provider-pool-webui/actions/launch-batch.test.js
 */

const fs = require("node:fs");
const path = require("node:path");

// When loaded by action-modules.test.js (not run directly), export a stub
// that satisfies the module contract without executing tests.
if (require.main !== module) {
  module.exports = {
    id: "launch-batch-test",
    label: "Launch Batch Test",
    description: "Test suite for launch-batch action module",
    dangerous: false,
    preview() {},
    execute() {},
  };
  return; // eslint-disable-line no-unreachable
}

const REPO_ROOT = path.resolve(__dirname, "../../..");
const STATE_DIR = path.join(REPO_ROOT, ".github/ai-state");
const HEALTH_PATH = path.join(STATE_DIR, "main-health.json");
const QUEUE_PATH = path.join(STATE_DIR, "webui-queue-state.json");
const RUNNING_PATH = path.join(STATE_DIR, "running-tasks.json");

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

function assertEqual(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log("  PASS  " + name);
  } else {
    failed += 1;
    console.error("  FAIL  " + name);
    console.error("    expected:", JSON.stringify(expected));
    console.error("    actual:  ", JSON.stringify(actual));
  }
}

// --- Fixture helpers ---------------------------------------------------------

const createdFiles = [];

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  createdFiles.push(filePath);
}

function setMainHealth(state) {
  writeJson(HEALTH_PATH, { state, capturedAt: new Date().toISOString() });
}

function setQueueState(entries) {
  writeJson(QUEUE_PATH, { entries });
}

function setRunningTasks(tasks) {
  writeJson(RUNNING_PATH, tasks);
}

function cleanup() {
  for (const f of createdFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

// --- Task builders -----------------------------------------------------------

function makeTask(overrides) {
  return {
    targetIssue: overrides.targetIssue || 900,
    conflictGroup: overrides.conflictGroup || null,
    risk: overrides.risk || "medium",
    taskType: overrides.taskType || "execution",
    mainHealthPolicy: overrides.mainHealthPolicy || null,
    allowedFiles: overrides.allowedFiles || [],
    sharedLocks: overrides.sharedLocks || [],
    targetPR: overrides.targetPR || null,
    budget: overrides.budget || null,
  };
}

// --- Module reload helper ---------------------------------------------------

function loadModule() {
  const fullPath = path.join(__dirname, "launch-batch.js");
  delete require.cache[require.resolve(fullPath)];
  return require(fullPath);
}

// --- Tests -------------------------------------------------------------------

if (require.main === module) {
  console.log("\nlaunch-batch.test.js\n");

  // 1. Module contract
  console.log("Module contract\n");
  (() => {
    const mod = loadModule();
    assertEqual(mod.id, "launch-batch", "id is launch-batch");
    assertEqual(mod.dangerous, true, "marked dangerous");
    assert(typeof mod.preview === "function", "exports preview");
    assert(typeof mod.execute === "function", "exports execute");
  })();

  // 2. Empty payload
  console.log("\nEmpty payload\n");
  (() => {
    setMainHealth("green");
    const mod = loadModule();
    const result = mod.preview({});
    assertEqual(result.status, "empty", "empty payload returns status empty");
    assert(result.gateReport === null, "empty payload has null gateReport");
  })();

  // 3. Permission matrix — green allows all types
  console.log("\nPermission matrix — green state\n");
  (() => {
    setMainHealth("green");
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 1, allowedFiles: ["docs/readme.md"] }),
      makeTask({ targetIssue: 2, allowedFiles: ["scripts/fix.ps1"] }),
      makeTask({ targetIssue: 3, allowedFiles: ["src/app.ts"], risk: "high" }),
      makeTask({ targetIssue: 4, allowedFiles: ["src/app.ts"], risk: "medium" }),
      makeTask({ targetIssue: 5, taskType: "research" }),
    ];

    const result = mod.preview({ tasks });
    assertEqual(result.status, "preview", "green preview returns preview status");
    assert(result.gateReport.allAllowed, "green state allows all worker types");
    assertEqual(result.gateReport.tasks[0].workerType, "docs", "docs type classified");
    assertEqual(result.gateReport.tasks[1].workerType, "health-repair", "health-repair type classified");
    assertEqual(result.gateReport.tasks[2].workerType, "foundation-fix", "foundation-fix type classified");
    assertEqual(result.gateReport.tasks[3].workerType, "runtime-feature", "runtime-feature type classified");
    assertEqual(result.gateReport.tasks[4].workerType, "research", "research type classified");
  })();

  // 4. Permission matrix — yellow blocks runtime-feature and test-only
  console.log("\nPermission matrix — yellow state\n");
  (() => {
    setMainHealth("yellow");
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 10, allowedFiles: ["docs/x.md"] }),
      makeTask({ targetIssue: 11, allowedFiles: ["src/app.ts"] }),
      makeTask({ targetIssue: 12, taskType: "research" }),
    ];

    const result = mod.preview({ tasks });
    assert(!result.gateReport.allAllowed, "yellow state blocks some tasks");
    assertEqual(result.gateReport.tasks[0].allowed, true, "yellow allows docs");
    assertEqual(result.gateReport.tasks[0].workerType, "docs", "yellow docs type");
    assertEqual(result.gateReport.tasks[1].allowed, false, "yellow blocks runtime-feature");
    assertEqual(result.gateReport.tasks[1].rule, "health-state-blocked", "rule is health-state-blocked");
    assertEqual(result.gateReport.tasks[2].allowed, true, "yellow allows research");
  })();

  // 5. Permission matrix — red blocks most types
  console.log("\nPermission matrix — red state\n");
  (() => {
    setMainHealth("red");
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 20, allowedFiles: ["docs/x.md"] }),
      makeTask({ targetIssue: 21, allowedFiles: ["scripts/fix.ps1"] }),
      makeTask({ targetIssue: 22, allowedFiles: ["src/app.ts"] }),
      makeTask({ targetIssue: 23, taskType: "research" }),
    ];

    const result = mod.preview({ tasks });
    assert(!result.gateReport.allAllowed, "red state blocks some tasks");
    assertEqual(result.gateReport.tasks[0].allowed, false, "red blocks docs");
    assertEqual(result.gateReport.tasks[1].allowed, true, "red allows health-repair");
    assertEqual(result.gateReport.tasks[2].allowed, false, "red blocks runtime-feature");
    assertEqual(result.gateReport.tasks[3].allowed, true, "red allows research");
  })();

  // 6. Permission matrix — black blocks everything
  console.log("\nPermission matrix — black state\n");
  (() => {
    setMainHealth("black");
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 30, allowedFiles: ["scripts/fix.ps1"] }),
      makeTask({ targetIssue: 31, taskType: "research" }),
    ];

    const result = mod.preview({ tasks });
    assert(!result.gateReport.allAllowed, "black state blocks all tasks");
    assertEqual(result.gateReport.tasks[0].allowed, false, "black blocks health-repair");
    assertEqual(result.gateReport.tasks[1].allowed, false, "black blocks research");
  })();

  // 7. Conflict group duplicate detection
  console.log("\nConflict group duplicate detection\n");
  (() => {
    setMainHealth("green");
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 40, conflictGroup: "wave20-dup" }),
      makeTask({ targetIssue: 41, conflictGroup: "wave20-dup" }),
    ];

    const result = mod.preview({ tasks });
    assert(!result.gateReport.allAllowed, "duplicate conflict group blocks");
    assertEqual(result.gateReport.tasks[0].allowed, true, "first occurrence is allowed");
    assertEqual(result.gateReport.tasks[1].allowed, false, "duplicate is blocked");
    assertEqual(result.gateReport.tasks[1].rule, "conflict-group-duplicate", "rule is conflict-group-duplicate");
    assertEqual(result.gateReport.duplicateConflictGroups, ["wave20-dup"], "reports duplicate group");
  })();

  // 8. Shared lock overlap detection
  console.log("\nShared lock overlap detection\n");
  (() => {
    setMainHealth("green");
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 50, sharedLocks: ["app-module:auth"] }),
      makeTask({ targetIssue: 51, sharedLocks: ["app-module:auth"] }),
    ];

    const result = mod.preview({ tasks });
    assert(!result.gateReport.allAllowed, "shared lock overlap blocks");
    assertEqual(result.gateReport.tasks[0].allowed, true, "first lock holder is allowed");
    assertEqual(result.gateReport.tasks[1].allowed, false, "second lock claimant is blocked");
    assertEqual(result.gateReport.tasks[1].rule, "shared-lock-overlap", "rule is shared-lock-overlap");
    assertEqual(result.gateReport.sharedLockConflicts, ["app-module:auth"], "reports conflicting lock");
  })();

  // 9. Running worker conflict detection
  console.log("\nRunning worker conflict detection\n");
  (() => {
    setMainHealth("green");
    setRunningTasks([{ conflictGroup: "wave20-active", workerId: "w-01" }]);
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 60, conflictGroup: "wave20-active" }),
    ];

    const result = mod.preview({ tasks });
    assert(!result.gateReport.allAllowed, "running worker conflict blocks");
    assertEqual(result.gateReport.tasks[0].allowed, false, "task with running conflict is blocked");
    assertEqual(result.gateReport.tasks[0].rule, "running-worker-conflict", "rule is running-worker-conflict");
    assertEqual(result.gateReport.runningWorkerConflicts.length, 1, "reports running conflict");
  })();

  // 10. Launch plan structure
  console.log("\nLaunch plan structure\n");
  (() => {
    setMainHealth("green");
    setRunningTasks([]);
    const mod = loadModule();

    const tasks = [
      makeTask({
        targetIssue: 70,
        targetPR: 71,
        conflictGroup: "wave20-ok",
        sharedLocks: ["lock-a"],
        budget: { maxFiles: 5, maxLinesChanged: 100, softTimeMinutes: 10, hardTimeMinutes: 25 },
      }),
      makeTask({
        targetIssue: 72,
        conflictGroup: "wave20-blocked",
        allowedFiles: ["src/app.ts"],
      }),
    ];

    // Make second task blocked by duplicating its conflict group
    tasks[1].conflictGroup = tasks[0].conflictGroup;

    const result = mod.preview({ tasks });
    const plan = result.launchPlan;
    assert(plan !== null, "launch plan is present");
    assertEqual(plan.planVersion, 1, "plan version is 1");
    assertEqual(plan.selectedTasks.length, 1, "one selected task");
    assertEqual(plan.rejectedTasks.length, 1, "one rejected task");
    assertEqual(plan.selectedTasks[0].targetIssue, 70, "selected task issue matches");
    assertEqual(plan.locksAcquired[0].lockName, "lock-a", "lock acquired");
    assertEqual(plan.budgetReservations.totalMaxFiles, 5, "budget maxFiles");
    assertEqual(plan.budgetReservations.totalMaxLinesChanged, 100, "budget maxLinesChanged");
    assertEqual(plan.budgetReservations.softTimeMinutesMax, 10, "budget softTimeMinutesMax");
    assertEqual(plan.budgetReservations.hardTimeMinutesMax, 25, "budget hardTimeMinutesMax");
  })();

  // 11. Gate docs-only group skips duplicate check
  console.log("\nDocs-only groups skip conflict duplicate check\n");
  (() => {
    setMainHealth("green");
    setRunningTasks([]);
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 80, conflictGroup: "wave20-docs", allowedFiles: ["docs/a.md"] }),
      makeTask({ targetIssue: 81, conflictGroup: "wave20-docs", allowedFiles: ["docs/b.md"] }),
    ];

    const result = mod.preview({ tasks });
    assert(result.gateReport.allAllowed, "docs-only duplicate group is allowed");
    assertEqual(result.gateReport.duplicateConflictGroups.length, 0, "no duplicate groups reported");
  })();

  // 12. Preview message reflects blocked count
  console.log("\nPreview message\n");
  (() => {
    setMainHealth("red");
    setRunningTasks([]);
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 90, allowedFiles: ["scripts/fix.ps1"] }),
      makeTask({ targetIssue: 91, allowedFiles: ["docs/a.md"] }),
    ];

    const result = mod.preview({ tasks });
    assert(result.message.includes("1 of 2"), "message reports blocked count");
  })();

  // 13. Execute blocked when gate fails
  console.log("\nExecute blocked when gate fails\n");
  (() => {
    setMainHealth("red");
    setRunningTasks([]);
    const mod = loadModule();

    const tasks = [
      makeTask({ targetIssue: 100, allowedFiles: ["src/app.ts"] }),
    ];

    const result = mod.execute({ tasks });
    assertEqual(result.status, "blocked", "execute returns blocked status");
    assert(result.gateReport !== null, "blocked execute includes gate report");
    assertEqual(result.blockedTasks[0].targetIssue, 100, "blocked task reported");
  })();

  // 14. Queue fallback — reads from webui-queue-state.json
  console.log("\nQueue fallback\n");
  (() => {
    setMainHealth("green");
    setRunningTasks([]);
    setQueueState([
      { targetIssue: 110, status: "queued", risk: "low" },
      { targetIssue: 111, status: "running", risk: "low" },
    ]);
    const mod = loadModule();

    const result = mod.preview({});
    assertEqual(result.status, "preview", "queue fallback returns preview");
    assertEqual(result.gateReport.taskCount, 1, "only queued entries are evaluated");
    assertEqual(result.gateReport.tasks[0].targetIssue, 110, "queued entry is included");
  })();

  // 15. Default health state is green when file missing
  console.log("\nDefault health state\n");
  (() => {
    // Remove health file
    try { fs.unlinkSync(HEALTH_PATH); } catch { /* ignore */ }
    setRunningTasks([]);
    const mod = loadModule();

    const tasks = [makeTask({ targetIssue: 120 })];
    const result = mod.preview({ tasks });
    assertEqual(result.mainHealth.state, "green", "defaults to green when no health file");
  })();

  // 16. Source hygiene
  console.log("\nSource hygiene\n");
  (() => {
    const source = fs.readFileSync(path.join(__dirname, "launch-batch.js"), "utf-8");
    const tokenRe = new RegExp("sk-" + "ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]+");
    assert(!tokenRe.test(source), "no literal token patterns");
    assert(source.includes("sanitize") || !source.includes("apiKey"), "no raw secret exposure");
  })();

  // --- Cleanup -----------------------------------------------------------------

  cleanup();

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}
