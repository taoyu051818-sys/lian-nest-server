#!/usr/bin/env node
"use strict";

/**
 * worker-control.test.js
 *
 * Unit tests for the worker-control action module.
 * Uses a temporary state file to avoid touching real provider-pool state.
 *
 * Run: node tools/provider-pool-webui/actions/worker-control.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mod = require("./worker-control");

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

function assertDeepEqual(actual, expected, name) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  assert(match, name);
  if (!match) {
    console.error("    expected:", JSON.stringify(expected));
    console.error("    actual:  ", JSON.stringify(actual));
  }
}

// --- Fixtures ----------------------------------------------------------------

function makeState(overrides) {
  return Object.assign(
    {
      providers: [
        {
          id: "provider-alpha",
          currentConcurrency: 2,
          maxConcurrency: 5,
        },
        {
          id: "provider-beta",
          currentConcurrency: 1,
          maxConcurrency: 3,
        },
      ],
      global: {
        capturedAt: "2026-05-12T00:00:00Z",
        totalActiveWorkers: 3,
      },
    },
    overrides || {},
  );
}

function tmpStatePath(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wc-test-"));
  const filePath = path.join(dir, "provider-pool.json");
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  return { filePath, dir };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// --- Tests -------------------------------------------------------------------

if (require.main !== module) {
  // When loaded by action-modules.test.js via require(), do not execute tests.
  module.exports = {};
} else {

console.log("\nworker-control.test.js\n");

// Module contract
console.log("Module contract\n");
assert(typeof mod.id === "string" && mod.id.length > 0, "exports id");
assert(mod.id === "worker.control", "id is worker.control");
assert(typeof mod.label === "string" && mod.label.length > 0, "exports label");
assert(typeof mod.description === "string", "exports description");
assert(mod.dangerous === true, "marked dangerous");
assert(typeof mod.preview === "function", "exports preview");
assert(typeof mod.execute === "function", "exports execute");

// validatePayload
console.log("\nvalidatePayload\n");
assertDeepEqual(mod.preview(null), { ok: false, error: "payload is required" }, "preview rejects null payload");
assertDeepEqual(mod.execute(null), { ok: false, error: "payload is required" }, "execute rejects null payload");
assertDeepEqual(mod.preview({}), { ok: false, error: "action is required" }, "preview rejects missing action");
assertDeepEqual(mod.execute({}), { ok: false, error: "action is required" }, "execute rejects missing action");
assertDeepEqual(
  mod.preview({ action: 123 }),
  { ok: false, error: "action is required" },
  "preview rejects non-string action",
);
assertDeepEqual(
  mod.execute({ action: 123 }),
  { ok: false, error: "action is required" },
  "execute rejects non-string action",
);

// Unknown action
console.log("\nUnknown action\n");
assertDeepEqual(
  mod.preview({ action: "bogus" }),
  { ok: false, error: "Unknown action: bogus" },
  "preview rejects unknown action",
);
assertDeepEqual(
  mod.execute({ action: "bogus" }),
  { ok: false, error: "Unknown action: bogus" },
  "execute rejects unknown action",
);

// List action
console.log("\nList action\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({ action: "list", _statePath: tmp.filePath });
    assert(result.ok === true, "list preview returns ok");
    assert(result.action === "list", "list preview action is list");
    assert(result.total === 3, "list preview total matches concurrency sum");
    assert(result.workers.length === 3, "list preview returns 3 workers");

    // Verify worker IDs match explicit slot pattern
    var ids = result.workers.map(function (w) { return w.workerId; }).sort();
    assertDeepEqual(ids, ["provider-alpha-slot-0", "provider-alpha-slot-1", "provider-beta-slot-0"], "worker ids follow explicit slot pattern");

    // Verify all workers have status "running"
    assert(result.workers.every(function (w) { return w.status === "running"; }), "all workers have running status");

    // Execute list is identical (read-only)
    var execResult = mod.execute({ action: "list", _statePath: tmp.filePath });
    assertDeepEqual(execResult, result, "execute list returns same result as preview list");
  } finally {
    cleanup(tmp.dir);
  }
})();

// List with empty providers
console.log("\nList with empty providers\n");
(function () {
  var state = makeState({ providers: [], global: { capturedAt: "2026-05-12T00:00:00Z", totalActiveWorkers: 0 } });
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({ action: "list", _statePath: tmp.filePath });
    assert(result.ok === true, "empty providers list returns ok");
    assert(result.total === 0, "empty providers total is 0");
    assert(result.workers.length === 0, "empty providers returns empty array");
  } finally {
    cleanup(tmp.dir);
  }
})();

// List with missing state file
console.log("\nList with missing state file\n");
assertDeepEqual(
  mod.preview({ action: "list", _statePath: "/nonexistent/path.json" }),
  { ok: false, error: "Cannot load worker state" },
  "list fails when state file missing",
);

// Preview stop — validation
console.log("\nPreview stop validation\n");
assertDeepEqual(
  mod.preview({ action: "stop" }),
  { ok: false, error: "workerIds array is required for stop action" },
  "preview stop requires workerIds",
);
assertDeepEqual(
  mod.preview({ action: "stop", workerIds: [] }),
  { ok: false, error: "workerIds array is required for stop action" },
  "preview stop rejects empty workerIds",
);
assertDeepEqual(
  mod.preview({ action: "stop", workerIds: "not-array" }),
  { ok: false, error: "workerIds array is required for stop action" },
  "preview stop rejects non-array workerIds",
);

// Preview stop — happy path
console.log("\nPreview stop happy path\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0"],
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "preview stop returns ok");
    assert(result.preview === true, "preview stop is marked preview");
    assert(result.action === "stop", "preview stop action is stop");
    assert(result.total === 1, "preview stop targets 1 worker");
    assert(result.workers[0].workerId === "provider-alpha-slot-0", "preview stop targets correct worker");
    assert(result.message === "Would stop 1 worker(s)", "preview stop message matches");

    // State file should NOT be modified
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "preview stop does not mutate state");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Preview stop — multiple workers
console.log("\nPreview stop multiple workers\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "provider-alpha-slot-1", "provider-beta-slot-0"],
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "preview stop multiple returns ok");
    assert(result.total === 3, "preview stop multiple targets 3 workers");
    assert(result.message === "Would stop 3 worker(s)", "preview stop multiple message matches");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Preview stop — worker not found
console.log("\nPreview stop worker not found\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "nonexistent-worker"],
      _statePath: tmp.filePath,
    });
    assert(result.ok === false, "preview stop with unknown worker fails");
    assert(result.error.includes("nonexistent-worker"), "error mentions missing worker id");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Preview stop — missing state file
console.log("\nPreview stop missing state file\n");
assertDeepEqual(
  mod.preview({ action: "stop", workerIds: ["x"], _statePath: "/nonexistent/path.json" }),
  { ok: false, error: "Cannot load worker state" },
  "preview stop fails when state file missing",
);

// Execute stop — validation
console.log("\nExecute stop validation\n");
assertDeepEqual(
  mod.execute({ action: "stop" }),
  { ok: false, error: "workerIds array is required for stop action" },
  "execute stop requires workerIds",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"] }),
  { ok: false, error: "reason is required for stop action" },
  "execute stop requires reason",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"], reason: "" }),
  { ok: false, error: "reason is required for stop action" },
  "execute stop rejects empty reason",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"], reason: "   " }),
  { ok: false, error: "reason is required for stop action" },
  "execute stop rejects whitespace-only reason",
);

// Execute stop — happy path (mutates state)
console.log("\nExecute stop happy path\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0"],
      reason: "manual drain for maintenance",
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "execute stop returns ok");
    assert(result.action === "stop", "execute stop action is stop");
    assert(result.stopped === 1, "execute stop reports 1 stopped");
    assertDeepEqual(result.workers, ["provider-alpha-slot-0"], "execute stop reports correct worker");
    assert(result.reason === "manual drain for maintenance", "execute stop includes reason");
    assert(typeof result.timestamp === "string", "execute stop includes timestamp");

    // State file SHOULD be modified
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 1, "execute stop decrements provider concurrency");
    assert(after.providers[1].currentConcurrency === 1, "execute stop leaves other provider unchanged");
    assert(after.global.totalActiveWorkers === 2, "execute stop decrements global totalActiveWorkers");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — multiple workers from same provider
console.log("\nExecute stop multiple workers same provider\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "provider-alpha-slot-1"],
      reason: "scaling down alpha",
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "execute stop multiple same provider returns ok");
    assert(result.stopped === 2, "execute stop multiple reports 2 stopped");

    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 0, "execute stop decrements both slots from provider");
    assert(after.global.totalActiveWorkers === 1, "execute stop decrements global by 2");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — cross-provider
console.log("\nExecute stop cross-provider\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "provider-beta-slot-0"],
      reason: "draining all",
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "execute stop cross-provider returns ok");
    assert(result.stopped === 2, "execute stop cross-provider reports 2 stopped");

    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 1, "execute stop decrements alpha");
    assert(after.providers[1].currentConcurrency === 0, "execute stop decrements beta");
    assert(after.global.totalActiveWorkers === 1, "execute stop decrements global correctly");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — reason is trimmed
console.log("\nExecute stop trims reason\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0"],
      reason: "  maintenance  ",
      _statePath: tmp.filePath,
    });
    assert(result.reason === "maintenance", "execute stop trims reason whitespace");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — worker not found
console.log("\nExecute stop worker not found\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "ghost-worker"],
      reason: "test",
      _statePath: tmp.filePath,
    });
    assert(result.ok === false, "execute stop with unknown worker fails");
    assert(result.error.includes("ghost-worker"), "error mentions missing worker id");

    // State should NOT be modified
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "execute stop failure does not mutate state");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — concurrency floors at 0
console.log("\nExecute stop concurrency floors at 0\n");
(function () {
  var state = makeState({
    providers: [{ id: "p1", currentConcurrency: 1, maxConcurrency: 5 }],
    global: { capturedAt: "2026-05-12T00:00:00Z", totalActiveWorkers: 1 },
  });
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["p1-slot-0"],
      reason: "drain",
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "execute stop last worker returns ok");

    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 0, "concurrency floors at 0");
    assert(after.global.totalActiveWorkers === 0, "totalActiveWorkers floors at 0");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — missing state file
console.log("\nExecute stop missing state file\n");
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"], reason: "test", _statePath: "/nonexistent/path.json" }),
  { ok: false, error: "Cannot load worker state" },
  "execute stop fails when state file missing",
);

// Explicit targeting safety — no wildcard concept
console.log("\nExplicit targeting safety\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    // Empty workerIds is rejected
    var r1 = mod.preview({ action: "stop", workerIds: [], _statePath: tmp.filePath });
    assert(r1.ok === false, "empty workerIds is rejected");

    // No workerIds at all is rejected
    var r2 = mod.execute({ action: "stop", reason: "test", _statePath: tmp.filePath });
    assert(r2.ok === false, "missing workerIds is rejected");

    // Wildcard string is not a valid id
    var r3 = mod.preview({ action: "stop", workerIds: ["*"], _statePath: tmp.filePath });
    assert(r3.ok === false, "wildcard workerId is rejected (not found)");

    // State unchanged after all rejections
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "state unchanged after rejected wildcard");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Preview is read-only (no side effects)
console.log("\nPreview has no side effects\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var before = fs.readFileSync(tmp.filePath, "utf-8");

    mod.preview({ action: "stop", workerIds: ["provider-alpha-slot-0"], _statePath: tmp.filePath });
    mod.preview({ action: "list", _statePath: tmp.filePath });

    var after = fs.readFileSync(tmp.filePath, "utf-8");
    assert(before === after, "preview calls do not modify state file");
  } finally {
    cleanup(tmp.dir);
  }
})();

// --- Safety edge coverage (issue #849) ---------------------------------------

// Duplicate workerIds — preview
console.log("\nPreview stop duplicate workerIds\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "provider-alpha-slot-0"],
      _statePath: tmp.filePath,
    });
    // Duplicate IDs resolve twice — preview succeeds but reports inflated count
    assert(result.ok === true, "preview stop with duplicate ids returns ok");
    assert(result.total === 2, "preview stop duplicate count reflects duplicates");
    // State must still be untouched
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "preview stop duplicates does not mutate state");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Duplicate workerIds — execute (over-decrement safety)
console.log("\nExecute stop duplicate workerIds safety\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "provider-alpha-slot-0"],
      reason: "duplicate id test",
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "execute stop with duplicate ids returns ok");
    // Implementation applies each duplicate — concurrency floors at 0 via Math.max
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency >= 0, "execute stop duplicate does not produce negative concurrency");
    assert(after.global.totalActiveWorkers >= 0, "execute stop duplicate global total stays non-negative");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Non-string elements in workerIds — preview
console.log("\nPreview stop non-string workerIds elements\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var r1 = mod.preview({ action: "stop", workerIds: [123], _statePath: tmp.filePath });
    assert(r1.ok === false, "preview stop rejects numeric workerId element");

    var r2 = mod.preview({ action: "stop", workerIds: [null], _statePath: tmp.filePath });
    assert(r2.ok === false, "preview stop rejects null workerId element");

    var r3 = mod.preview({ action: "stop", workerIds: [undefined], _statePath: tmp.filePath });
    assert(r3.ok === false, "preview stop rejects undefined workerId element");

    // State unchanged
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "non-string workerId rejections do not mutate state");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Non-string elements in workerIds — execute
console.log("\nExecute stop non-string workerIds elements\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var r1 = mod.execute({ action: "stop", workerIds: [123], reason: "test", _statePath: tmp.filePath });
    assert(r1.ok === false, "execute stop rejects numeric workerId element");

    var r2 = mod.execute({ action: "stop", workerIds: [null], reason: "test", _statePath: tmp.filePath });
    assert(r2.ok === false, "execute stop rejects null workerId element");

    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "non-string workerId execute rejections do not mutate state");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop — reason type validation
console.log("\nExecute stop reason type validation\n");
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"], reason: 42 }),
  { ok: false, error: "reason is required for stop action" },
  "execute stop rejects numeric reason",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"], reason: true }),
  { ok: false, error: "reason is required for stop action" },
  "execute stop rejects boolean reason",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: ["x"], reason: {} }),
  { ok: false, error: "reason is required for stop action" },
  "execute stop rejects object reason",
);

// workerIds type edge cases
console.log("\nworkerIds type edge cases\n");
assertDeepEqual(
  mod.preview({ action: "stop", workerIds: 123 }),
  { ok: false, error: "workerIds array is required for stop action" },
  "preview stop rejects numeric workerIds",
);
assertDeepEqual(
  mod.preview({ action: "stop", workerIds: {} }),
  { ok: false, error: "workerIds array is required for stop action" },
  "preview stop rejects object workerIds",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: 123, reason: "test" }),
  { ok: false, error: "workerIds array is required for stop action" },
  "execute stop rejects numeric workerIds",
);
assertDeepEqual(
  mod.execute({ action: "stop", workerIds: {}, reason: "test" }),
  { ok: false, error: "workerIds array is required for stop action" },
  "execute stop rejects object workerIds",
);

// Corrupt state file (invalid JSON)
console.log("\nCorrupt state file\n");
(function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "wc-corrupt-"));
  var filePath = path.join(dir, "provider-pool.json");
  fs.writeFileSync(filePath, "NOT VALID JSON {{{", "utf-8");
  try {
    var r1 = mod.preview({ action: "list", _statePath: filePath });
    assert(r1.ok === false, "list preview fails on corrupt state file");
    assert(r1.error === "Cannot load worker state", "corrupt state returns expected error");

    var r2 = mod.execute({ action: "list", _statePath: filePath });
    assert(r2.ok === false, "list execute fails on corrupt state file");

    var r3 = mod.preview({ action: "stop", workerIds: ["x"], _statePath: filePath });
    assert(r3.ok === false, "preview stop fails on corrupt state file");

    var r4 = mod.execute({ action: "stop", workerIds: ["x"], reason: "test", _statePath: filePath });
    assert(r4.ok === false, "execute stop fails on corrupt state file");
  } finally {
    cleanup(dir);
  }
})();

// Zero-concurrency providers produce no workers
console.log("\nZero-concurrency providers\n");
(function () {
  var state = makeState({
    providers: [
      { id: "idle-provider", currentConcurrency: 0, maxConcurrency: 5 },
    ],
    global: { capturedAt: "2026-05-12T00:00:00Z", totalActiveWorkers: 0 },
  });
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({ action: "list", _statePath: tmp.filePath });
    assert(result.ok === true, "zero-concurrency list returns ok");
    assert(result.total === 0, "zero-concurrency produces 0 workers");
    assert(result.workers.length === 0, "zero-concurrency workers array is empty");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Execute stop output is sanitized — no raw state objects leak
console.log("\nExecute stop output sanitization\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.execute({
      action: "stop",
      workerIds: ["provider-alpha-slot-0"],
      reason: "sanitization check",
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "execute stop sanitization returns ok");
    assert(Array.isArray(result.workers), "execute stop workers is array");
    assert(result.workers.every(function (w) { return typeof w === "string"; }), "execute stop workers contains only strings");
    assert(!result.hasOwnProperty("providers"), "execute stop result has no providers field");
    assert(!result.hasOwnProperty("state"), "execute stop result has no state field");
    assert(!result.hasOwnProperty("global"), "execute stop result has no global field");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Preview stop output is sanitized — workers array contains objects but no secrets
console.log("\nPreview stop output sanitization\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0"],
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "preview stop sanitization returns ok");
    assert(!result.hasOwnProperty("providers"), "preview stop result has no providers field");
    assert(!result.hasOwnProperty("state"), "preview stop result has no state field");
    assert(!result.hasOwnProperty("global"), "preview stop result has no global field");
    // Workers should only contain expected keys
    var worker = result.workers[0];
    var allowedKeys = ["workerId", "providerId", "status", "startedAt"].sort();
    var actualKeys = Object.keys(worker).sort();
    assertDeepEqual(actualKeys, allowedKeys, "preview stop worker has only expected keys");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Multiple not-found workers listed in error
console.log("\nMultiple not-found workers\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["ghost-1", "provider-alpha-slot-0", "ghost-2"],
      _statePath: tmp.filePath,
    });
    assert(result.ok === false, "preview stop with multiple unknown workers fails");
    assert(result.error.includes("ghost-1"), "error mentions first missing worker");
    assert(result.error.includes("ghost-2"), "error mentions second missing worker");
    // State unchanged
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "multiple not-found rejection does not mutate state");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Duplicate workerIds across providers
console.log("\nPreview stop duplicate across providers\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", "provider-beta-slot-0", "provider-alpha-slot-0"],
      _statePath: tmp.filePath,
    });
    assert(result.ok === true, "preview stop cross-provider with duplicate returns ok");
    assert(result.total === 3, "preview stop cross-provider duplicate count includes duplicates");
    var after = JSON.parse(fs.readFileSync(tmp.filePath, "utf-8"));
    assert(after.providers[0].currentConcurrency === 2, "state unchanged after cross-provider duplicate preview");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Mixed valid and non-string workerIds
console.log("\nPreview stop mixed valid and non-string workerIds\n");
(function () {
  var state = makeState();
  var tmp = tmpStatePath(state);
  try {
    var result = mod.preview({
      action: "stop",
      workerIds: ["provider-alpha-slot-0", 42, null],
      _statePath: tmp.filePath,
    });
    assert(result.ok === false, "preview stop with mixed types fails");
    // Non-string elements are treated as not-found
    assert(result.error.includes("42") || result.error.includes("null"), "error mentions non-string elements");
  } finally {
    cleanup(tmp.dir);
  }
})();

// Source hygiene
console.log("\nSource hygiene\n");
(function () {
  var modSource = fs.readFileSync(path.join(__dirname, "worker-control.js"), "utf-8");
  assert(!/sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]+/.test(modSource), "module source contains no literal token patterns");
})();

// Summary
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} // end require.main === module
