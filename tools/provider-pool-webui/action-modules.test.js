#!/usr/bin/env node
"use strict";

/**
 * Tests for WebUI action modules.
 *
 * Validates the worker-control action module's structure, validation,
 * and behavior using temporary fixture files.
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

// --- Setup -------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "action-modules-test-"));
const statePath = path.join(tmpDir, "provider-pool.json");

// Create test state fixture
const testState = {
  global: {
    capturedAt: "2026-05-12T00:00:00.000Z",
    totalActiveWorkers: 3,
    globalMaxWorkers: 10,
    availableProviders: 2,
    exhaustedProviders: 0,
    disabledProviders: 0,
  },
  providers: [
    {
      id: "provider-1",
      status: "available",
      currentConcurrency: 2,
      maxConcurrency: 5,
      consecutiveFailures: 0,
    },
    {
      id: "provider-2",
      status: "available",
      currentConcurrency: 1,
      maxConcurrency: 5,
      consecutiveFailures: 0,
    },
  ],
};

fs.writeFileSync(statePath, JSON.stringify(testState, null, 2));

// --- Load module -------------------------------------------------------------

const mod = require(path.join(__dirname, "actions", "worker-control.js"));

// --- Module structure tests --------------------------------------------------

console.log("\n--- worker-control: module structure ---");

assert(typeof mod.id === "string", "id is a string");
assert(mod.id === "worker.control", "id is 'worker.control'");
assert(typeof mod.label === "string", "label is a string");
assert(mod.label === "Worker Control", "label is 'Worker Control'");
assert(typeof mod.description === "string", "description is a string");
assert(mod.dangerous === true, "dangerous is true");
assert(typeof mod.preview === "function", "preview is a function");
assert(typeof mod.execute === "function", "execute is a function");

// --- Preview validation tests ------------------------------------------------

console.log("\n--- worker-control: preview validation ---");

// Missing payload
var noPayload = mod.preview(null);
assert(noPayload.ok === false, "preview with null payload fails");
assert(noPayload.error === "payload is required", "null payload error message");

// Missing action
var noAction = mod.preview({});
assert(noAction.ok === false, "preview without action fails");
assert(noAction.error === "action is required", "missing action error message");

// Unknown action
var unknown = mod.preview({ action: "unknown" });
assert(unknown.ok === false, "preview with unknown action fails");
assert(unknown.error === "Unknown action: unknown", "unknown action error message");

// --- List action tests -------------------------------------------------------

console.log("\n--- worker-control: list action ---");

// Preview list
var listPreview = mod.preview({ action: "list", _statePath: statePath });
assert(listPreview.ok === true, "list preview returns ok");
assert(Array.isArray(listPreview.workers), "list preview returns workers array");
assert(listPreview.workers.length === 3, "list preview returns 3 workers");
assert(listPreview.total === 3, "list preview total is 3");

// Validate worker structure
var firstWorker = listPreview.workers[0];
assert(firstWorker.workerId === "provider-1-slot-0", "first worker ID is correct");
assert(firstWorker.providerId === "provider-1", "first worker providerId is correct");
assert(firstWorker.status === "running", "first worker status is 'running'");
assert(firstWorker.startedAt === "2026-05-12T00:00:00.000Z", "first worker startedAt is correct");

// Execute list (should behave same as preview)
var listExec = mod.execute({ action: "list", _statePath: statePath });
assert(listExec.ok === true, "execute list returns ok");
assert(listExec.workers.length === 3, "execute list returns 3 workers");

// List with missing state file
var listNoState = mod.preview({ action: "list", _statePath: path.join(tmpDir, "nonexistent.json") });
assert(listNoState.ok === false, "list with missing state file fails");
assert(listNoState.error === "Cannot load worker state", "missing state error message");

// --- Stop preview tests ------------------------------------------------------

console.log("\n--- worker-control: stop preview ---");

// Missing workerIds
var stopNoIds = mod.preview({ action: "stop", _statePath: statePath });
assert(stopNoIds.ok === false, "stop preview without workerIds fails");
assert(stopNoIds.error === "workerIds array is required for stop action", "missing workerIds error");

// Empty workerIds
var stopEmptyIds = mod.preview({ action: "stop", workerIds: [], _statePath: statePath });
assert(stopEmptyIds.ok === false, "stop preview with empty workerIds fails");

// Non-array workerIds
var stopBadIds = mod.preview({ action: "stop", workerIds: "not-an-array", _statePath: statePath });
assert(stopBadIds.ok === false, "stop preview with non-array workerIds fails");

// Valid single worker
var stopOne = mod.preview({ action: "stop", workerIds: ["provider-1-slot-0"], _statePath: statePath });
assert(stopOne.ok === true, "stop preview with valid worker returns ok");
assert(stopOne.preview === true, "stop preview has preview=true flag");
assert(stopOne.workers.length === 1, "stop preview returns 1 worker");
assert(stopOne.total === 1, "stop preview total is 1");
assert(stopOne.workers[0].workerId === "provider-1-slot-0", "stop preview returns correct worker");

// Valid multiple workers
var stopMulti = mod.preview({
  action: "stop",
  workerIds: ["provider-1-slot-0", "provider-1-slot-1", "provider-2-slot-0"],
  _statePath: statePath,
});
assert(stopMulti.ok === true, "stop preview with multiple workers returns ok");
assert(stopMulti.workers.length === 3, "stop preview returns 3 workers");
assert(stopMulti.message === "Would stop 3 worker(s)", "stop preview message is correct");

// Non-existent worker
var stopNotFound = mod.preview({ action: "stop", workerIds: ["nonexistent-worker"], _statePath: statePath });
assert(stopNotFound.ok === false, "stop preview with non-existent worker fails");
assert(stopNotFound.error.includes("Workers not found"), "error mentions workers not found");
assert(stopNotFound.error.includes("nonexistent-worker"), "error includes the missing worker ID");

// Mix of valid and invalid
var stopMix = mod.preview({
  action: "stop",
  workerIds: ["provider-1-slot-0", "nonexistent"],
  _statePath: statePath,
});
assert(stopMix.ok === false, "stop preview with mix of valid/invalid fails");
assert(stopMix.error.includes("nonexistent"), "error mentions the invalid worker");

// --- Stop execute tests ------------------------------------------------------

console.log("\n--- worker-control: stop execute ---");

// Missing workerIds
var execNoIds = mod.execute({ action: "stop", _statePath: statePath });
assert(execNoIds.ok === false, "stop execute without workerIds fails");

// Missing reason
var execNoReason = mod.execute({ action: "stop", workerIds: ["provider-1-slot-0"], _statePath: statePath });
assert(execNoReason.ok === false, "stop execute without reason fails");
assert(execNoReason.error === "reason is required for stop action", "missing reason error");

// Empty reason
var execEmptyReason = mod.execute({
  action: "stop",
  workerIds: ["provider-1-slot-0"],
  reason: "",
  _statePath: statePath,
});
assert(execEmptyReason.ok === false, "stop execute with empty reason fails");

// Whitespace-only reason
var execWhitespaceReason = mod.execute({
  action: "stop",
  workerIds: ["provider-1-slot-0"],
  reason: "   ",
  _statePath: statePath,
});
assert(execWhitespaceReason.ok === false, "stop execute with whitespace-only reason fails");

// Non-existent worker
var execNotFound = mod.execute({
  action: "stop",
  workerIds: ["nonexistent"],
  reason: "test",
  _statePath: statePath,
});
assert(execNotFound.ok === false, "stop execute with non-existent worker fails");

// Valid single stop
var execStopOne = mod.execute({
  action: "stop",
  workerIds: ["provider-1-slot-0"],
  reason: "Scaling down for maintenance",
  _statePath: statePath,
});
assert(execStopOne.ok === true, "stop execute with valid payload returns ok");
assert(execStopOne.stopped === 1, "stop execute stopped 1 worker");
assert(execStopOne.workers.length === 1, "stop execute returns 1 worker ID");
assert(execStopOne.workers[0] === "provider-1-slot-0", "stop execute returns correct worker ID");
assert(execStopOne.reason === "Scaling down for maintenance", "stop execute returns reason");
assert(typeof execStopOne.timestamp === "string", "stop execute returns timestamp");

// Verify state was updated
var stateAfterOne = JSON.parse(fs.readFileSync(statePath, "utf-8"));
assert(stateAfterOne.providers[0].currentConcurrency === 1, "provider-1 concurrency decreased to 1");
assert(stateAfterOne.providers[1].currentConcurrency === 1, "provider-2 concurrency unchanged");
assert(stateAfterOne.global.totalActiveWorkers === 2, "global active workers decreased to 2");

// Valid multi-stop
var execStopMulti = mod.execute({
  action: "stop",
  workerIds: ["provider-1-slot-0", "provider-2-slot-0"],
  reason: "End of day shutdown",
  _statePath: statePath,
});
assert(execStopMulti.ok === true, "multi-stop execute returns ok");
assert(execStopMulti.stopped === 2, "multi-stop stopped 2 workers");
assert(execStopMulti.workers.length === 2, "multi-stop returns 2 worker IDs");

// Verify state after multi-stop
var stateAfterMulti = JSON.parse(fs.readFileSync(statePath, "utf-8"));
assert(stateAfterMulti.providers[0].currentConcurrency === 0, "provider-1 concurrency is 0");
assert(stateAfterMulti.providers[1].currentConcurrency === 0, "provider-2 concurrency is 0");
assert(stateAfterMulti.global.totalActiveWorkers === 0, "global active workers is 0");

// --- Execute validation tests ------------------------------------------------

console.log("\n--- worker-control: execute validation ---");

// Missing payload
var execNoPayload = mod.execute(null);
assert(execNoPayload.ok === false, "execute with null payload fails");

// Missing action
var execNoAction = mod.execute({});
assert(execNoAction.ok === false, "execute without action fails");

// Unknown action
var execUnknown = mod.execute({ action: "unknown", _statePath: statePath });
assert(execUnknown.ok === false, "execute with unknown action fails");
assert(execUnknown.error === "Unknown action: unknown", "unknown action error");

// --- Cleanup -----------------------------------------------------------------

fs.rmSync(tmpDir, { recursive: true, force: true });

// --- Summary -----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
