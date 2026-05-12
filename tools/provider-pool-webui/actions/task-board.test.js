#!/usr/bin/env node
"use strict";

/**
 * task-board.test.js
 *
 * Unit tests for the task-board action module.
 * Uses temporary directories to avoid touching real .github/ai-state/ files.
 *
 * Run: node tools/provider-pool-webui/actions/task-board.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

function assertThrows(fn, expectedMsg, name) {
  try {
    fn();
    failed += 1;
    console.error("  FAIL  " + name + " (did not throw)");
  } catch (e) {
    const ok = expectedMsg ? e.message.includes(expectedMsg) : true;
    if (ok) {
      passed += 1;
      console.log("  PASS  " + name);
    } else {
      failed += 1;
      console.error("  FAIL  " + name);
      console.error("    expected msg to include:", expectedMsg);
      console.error("    actual msg:", e.message);
    }
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function setupTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tb-test-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function makeTaskEntry(overrides) {
  return Object.assign(
    {
      issue: 258,
      state: "running",
      conflictGroup: "auth-core",
      worker: {
        branch: "claude/wave6-20260511-090000-issue-258",
        claimant: "backend-programmer",
        claimedAt: "2026-05-11T09:00:00Z",
        lastHeartbeat: "2026-05-11T09:25:00Z",
        expiresAt: "2026-05-11T10:30:00Z",
      },
      blockedReason: null,
      linkedPR: null,
    },
    overrides || {}
  );
}

function makeProjection(overrides) {
  return Object.assign(
    {
      markerVersion: 1,
      capturedAt: "2026-05-12T09:00:00Z",
      tasks: [],
    },
    overrides || {}
  );
}

function writeProjection(dir, data) {
  const filePath = path.join(dir, "task-board.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  return filePath;
}

// ── Tests ────────────────────────────────────────────────────────────────────

if (require.main !== module) {
  module.exports = {};
} else {

const mod = require("./task-board");

console.log("\ntask-board.test.js\n");

// ── Module contract ──────────────────────────────────────────────────────────

console.log("Module contract\n");
assert(typeof mod.id === "string" && mod.id.length > 0, "exports id");
assert(mod.id === "task-board", "id is task-board");
assert(typeof mod.label === "string" && mod.label.length > 0, "exports label");
assert(typeof mod.description === "string" && mod.description.length > 0, "exports description");
assert(mod.dangerous === false, "not dangerous");
assert(typeof mod.preview === "function", "exports preview");
assert(typeof mod.execute === "function", "exports execute");

// ── Empty board (no file) ────────────────────────────────────────────────────

console.log("\nEmpty board (no file)\n");
{
  var dir = setupTmpDir();
  var boardPath = path.join(dir, "task-board.json");
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(r.ok === true, "empty board returns ok");
    assert(r.status === "empty", "empty board status is empty");
    assert(r.taskCount === 0, "empty board taskCount is 0");
    assert(Array.isArray(r.tasks) && r.tasks.length === 0, "empty board tasks is empty array");
    assert(r.summary.open === 0, "empty board summary.open is 0");
    assert(r.summary.ready === 0, "empty board summary.ready is 0");
    assert(r.summary.running === 0, "empty board summary.running is 0");
    assert(r.summary.blocked === 0, "empty board summary.blocked is 0");
    assert(r.summary.done === 0, "empty board summary.done is 0");
    assert(typeof r.capturedAt === "string", "empty board has capturedAt");
    assert(typeof r.message === "string", "empty board has message");
  } finally {
    cleanup(dir);
  }
}

// ── Valid board with mixed states ────────────────────────────────────────────

console.log("\nValid board with mixed states\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({ issue: 258, state: "running", conflictGroup: "auth-core" }),
      makeTaskEntry({
        issue: 310,
        state: "blocked",
        conflictGroup: "posts",
        blockedReason: "Waiting on issue #258",
        worker: {
          branch: "claude/wave6-20260511-100000-issue-310",
          claimant: "backend-programmer",
          claimedAt: "2026-05-11T10:00:00Z",
          lastHeartbeat: "2026-05-11T10:15:00Z",
          expiresAt: "2026-05-11T11:30:00Z",
        },
      }),
      makeTaskEntry({
        issue: 275,
        state: "done",
        conflictGroup: "ai-native-docs",
        worker: null,
        linkedPR: 276,
      }),
      makeTaskEntry({ issue: 400, state: "open", conflictGroup: "ui", worker: null }),
      makeTaskEntry({ issue: 401, state: "ready", conflictGroup: "ui", worker: null }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(r.ok === true, "mixed board returns ok");
    assert(r.status === "snapshot", "mixed board status is snapshot");
    assert(r.taskCount === 5, "mixed board taskCount is 5");
    assert(r.markerVersion === 1, "mixed board markerVersion is 1");
    assert(r.capturedAt === "2026-05-12T09:00:00Z", "mixed board capturedAt matches");
    assert(r.summary.open === 1, "summary.open is 1");
    assert(r.summary.ready === 1, "summary.ready is 1");
    assert(r.summary.running === 1, "summary.running is 1");
    assert(r.summary.blocked === 1, "summary.blocked is 1");
    assert(r.summary.done === 1, "summary.done is 1");
  } finally {
    cleanup(dir);
  }
}

// ── Task entry fields preserved ──────────────────────────────────────────────

console.log("\nTask entry fields preserved\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({
        issue: 258,
        state: "running",
        conflictGroup: "auth-core",
        worker: {
          branch: "claude/wave6-issue-258",
          claimant: "backend-programmer",
          claimedAt: "2026-05-11T09:00:00Z",
          lastHeartbeat: "2026-05-11T09:25:00Z",
          expiresAt: "2026-05-11T10:30:00Z",
        },
      }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var r = mod.preview({ _boardPath: boardPath });
    var task = r.tasks[0];
    assert(task.issue === 258, "task.issue preserved");
    assert(task.state === "running", "task.state preserved");
    assert(task.conflictGroup === "auth-core", "task.conflictGroup preserved");
    assert(task.worker.branch === "claude/wave6-issue-258", "task.worker.branch preserved");
    assert(task.worker.claimant === "backend-programmer", "task.worker.claimant preserved");
    assert(task.blockedReason === null, "task.blockedReason is null");
    assert(task.linkedPR === null, "task.linkedPR is null");
  } finally {
    cleanup(dir);
  }
}

// ── Blocked task with reason ─────────────────────────────────────────────────

console.log("\nBlocked task with reason\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({
        issue: 310,
        state: "blocked",
        conflictGroup: "posts",
        blockedReason: "Waiting on dependency #258",
      }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(r.tasks[0].blockedReason === "Waiting on dependency #258", "blockedReason preserved");
    assert(r.summary.blocked === 1, "summary.blocked is 1");
  } finally {
    cleanup(dir);
  }
}

// ── Done task with linked PR ─────────────────────────────────────────────────

console.log("\nDone task with linked PR\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({
        issue: 275,
        state: "done",
        conflictGroup: "ai-native-docs",
        worker: null,
        linkedPR: 276,
      }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(r.tasks[0].linkedPR === 276, "linkedPR preserved");
    assert(r.tasks[0].worker === null, "done task worker is null");
    assert(r.summary.done === 1, "summary.done is 1");
  } finally {
    cleanup(dir);
  }
}

// ── Sanitization — secret keys stripped ──────────────────────────────────────

console.log("\nSanitization — secret keys stripped\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({
        issue: 500,
        state: "running",
        conflictGroup: "test-group",
        token: "should-be-stripped",
        secret: "hidden",
      }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(r.tasks[0].token === undefined, "token key is stripped");
    assert(r.tasks[0].secret === undefined, "secret key is stripped");
    assert(r.tasks[0].issue === 500, "non-secret fields preserved");
  } finally {
    cleanup(dir);
  }
}

// ── Sanitization — long strings truncated ────────────────────────────────────

console.log("\nSanitization — long strings truncated\n");
{
  var dir = setupTmpDir();
  var longReason = "A".repeat(600);
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({
        issue: 501,
        state: "blocked",
        conflictGroup: "test",
        blockedReason: longReason,
      }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(r.tasks[0].blockedReason.length <= 504, "long string is truncated");
    assert(r.tasks[0].blockedReason.endsWith("..."), "truncated string ends with ...");
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — invalid markerVersion ────────────────────────────────

console.log("\nSchema validation — invalid markerVersion\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({ markerVersion: 2 });
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "markerVersion must be 1",
      "rejects markerVersion 2"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — missing capturedAt ───────────────────────────────────

console.log("\nSchema validation — missing capturedAt\n");
{
  var dir = setupTmpDir();
  var projection = { markerVersion: 1, tasks: [] };
  delete projection.capturedAt;
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "capturedAt must be a non-empty string",
      "rejects missing capturedAt"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — invalid task state ───────────────────────────────────

console.log("\nSchema validation — invalid task state\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [makeTaskEntry({ state: "invalid-state" })],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "state must be one of",
      "rejects invalid task state"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — missing conflictGroup ────────────────────────────────

console.log("\nSchema validation — missing conflictGroup\n");
{
  var dir = setupTmpDir();
  var task = makeTaskEntry();
  delete task.conflictGroup;
  var projection = makeProjection({ tasks: [task] });
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "conflictGroup must be a non-empty string",
      "rejects missing conflictGroup"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — invalid issue number ─────────────────────────────────

console.log("\nSchema validation — invalid issue number\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [makeTaskEntry({ issue: -1 })],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "issue must be a positive integer",
      "rejects negative issue number"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — invalid linkedPR ─────────────────────────────────────

console.log("\nSchema validation — invalid linkedPR\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [makeTaskEntry({ linkedPR: -5 })],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "linkedPR must be a positive integer or null",
      "rejects negative linkedPR"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — invalid worker branch ────────────────────────────────

console.log("\nSchema validation — invalid worker branch\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [makeTaskEntry({ worker: { branch: "", claimant: "test" } })],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "worker.branch must be a non-empty string",
      "rejects empty worker branch"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Schema validation — tasks not array ──────────────────────────────────────

console.log("\nSchema validation — tasks not array\n");
{
  var dir = setupTmpDir();
  var projection = { markerVersion: 1, capturedAt: "2026-05-12T00:00:00Z", tasks: "not-array" };
  var boardPath = writeProjection(dir, projection);
  try {
    assertThrows(
      function () { mod.preview({ _boardPath: boardPath }); },
      "tasks must be an array",
      "rejects non-array tasks"
    );
  } finally {
    cleanup(dir);
  }
}

// ── Preview has no side effects ──────────────────────────────────────────────

console.log("\nPreview has no side effects\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [makeTaskEntry({ issue: 600, state: "running", conflictGroup: "test" })],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var before = fs.readFileSync(boardPath, "utf-8");
    mod.preview({ _boardPath: boardPath });
    mod.preview({ _boardPath: boardPath });
    var after = fs.readFileSync(boardPath, "utf-8");
    assert(before === after, "preview calls do not modify board file");
  } finally {
    cleanup(dir);
  }
}

// ── Execute returns same as preview ──────────────────────────────────────────

console.log("\nExecute returns same as preview\n");
{
  var dir = setupTmpDir();
  var projection = makeProjection({
    tasks: [
      makeTaskEntry({ issue: 700, state: "running", conflictGroup: "g1" }),
      makeTaskEntry({ issue: 701, state: "done", conflictGroup: "g2", worker: null, linkedPR: 800 }),
    ],
  });
  var boardPath = writeProjection(dir, projection);
  try {
    var previewResult = mod.preview({ _boardPath: boardPath });
    var executeResult = mod.execute({ _boardPath: boardPath });
    assertDeepEqual(previewResult, executeResult, "execute and preview return identical output");
  } finally {
    cleanup(dir);
  }
}

// ── Payload defaults ─────────────────────────────────────────────────────────

console.log("\nPayload defaults\n");
{
  // null payload should not throw (uses default path)
  var r = mod.preview(null);
  assert(r.ok === true, "null payload returns ok");
  assert(typeof r.status === "string", "null payload has status");

  r = mod.execute(undefined);
  assert(r.ok === true, "undefined payload returns ok");
}

// ── Output shape ─────────────────────────────────────────────────────────────

console.log("\nOutput shape\n");
{
  var dir = setupTmpDir();
  var boardPath = path.join(dir, "task-board.json");
  try {
    var r = mod.preview({ _boardPath: boardPath });
    assert(typeof r.ok === "boolean", "has ok field");
    assert(typeof r.status === "string", "has status field");
    assert(typeof r.markerVersion === "number", "has markerVersion field");
    assert(typeof r.capturedAt === "string", "has capturedAt field");
    assert(typeof r.taskCount === "number", "has taskCount field");
    assert(Array.isArray(r.tasks), "has tasks array");
    assert(typeof r.summary === "object" && r.summary !== null, "has summary object");
    assert(typeof r.summary.open === "number", "summary has open");
    assert(typeof r.summary.ready === "number", "summary has ready");
    assert(typeof r.summary.running === "number", "summary has running");
    assert(typeof r.summary.blocked === "number", "summary has blocked");
    assert(typeof r.summary.done === "number", "summary has done");
  } finally {
    cleanup(dir);
  }
}

// ── Source hygiene ───────────────────────────────────────────────────────────

console.log("\nSource hygiene\n");
{
  var source = fs.readFileSync(path.join(__dirname, "task-board.js"), "utf-8");
  assert(!/sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]+/.test(source), "no literal token patterns");
  assert(!/\.env\b/.test(source), "no .env references");
  assert(!/password/i.test(source) || /secret/i.test(source), "no hardcoded passwords");
  assert(source.includes("SECRET_PATTERNS"), "defines SECRET_PATTERNS");
  assert(source.includes("VALID_STATES"), "defines VALID_STATES");
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} // end require.main === module
