#!/usr/bin/env node
"use strict";

/**
 * plan-next-batch.test.js
 *
 * Tests for the plan-next-batch WebUI action module.
 * Covers state input handling, sanitization, conflict group dedup,
 * provider capacity, allowlist validation, and error paths.
 *
 * Run: node tools/provider-pool-webui/actions/plan-next-batch.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mod = require("./plan-next-batch");

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

// --- Fixtures ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-next-batch-test-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function makeState(overrides) {
  const base = {
    providers: [
      {
        id: "provider-default",
        status: "available",
        maxConcurrency: 3,
        currentConcurrency: 1,
        secret: "should-be-stripped",
        apiKey: "should-be-stripped",
        token: "should-be-stripped",
      },
    ],
  };
  if (!overrides) return base;
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function makeQueue(entries) {
  return { entries: entries || [] };
}

// --- Module contract ---------------------------------------------------------

console.log("\nplan-next-batch.test.js\n");

console.log("Module contract\n");

assert(typeof mod.id === "string", "exports id");
assert(mod.id === "plan.next.batch", "id is plan.next.batch");
assert(typeof mod.label === "string", "exports label");
assert(typeof mod.description === "string", "exports description");
assert(mod.dangerous === false, "not dangerous");
assert(typeof mod.preview === "function", "exports preview");
assert(typeof mod.execute === "function", "exports execute");

// --- Preview: valid inputs ---------------------------------------------------

console.log("\nPreview: valid inputs\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 100, state: "queued", conflictGroup: "wave20-alpha", actorRole: "execution" },
    { issueNumber: 101, state: "queued", conflictGroup: "wave20-beta" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok with valid inputs");
  assert(res.dryRun === true, "preview sets dryRun true");
  assert(Array.isArray(res.plan), "plan is array");
  assert(res.plan.length === 2, "plan includes both issues");
  assert(res.plan[0].issueNumber === 100, "first planned issue correct");
  assert(res.plan[0].providerId === "provider-default", "first assigned provider");
  assert(res.plan[0].conflictGroup === "wave20-alpha", "first conflict group preserved");
  assert(res.plan[0].actorRole === "execution", "actor role preserved");
  assert(res.plan[1].conflictGroup === "wave20-beta", "second conflict group preserved");
  assert(res.capacity.availableProviders === 1, "1 available provider");
  assert(res.capacity.queuedIssues === 2, "2 queued issues");
  assert(res.capacity.planned === 2, "2 planned");
  assert(res.capacity.skippedCount === 0, "0 skipped");
  assert(typeof res.timestamp === "string", "timestamp present");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: missing state file ---------------------------------------------

console.log("\nPreview: missing state file\n");

{
  const dir = tmpDir();
  const queuePath = path.join(dir, "queue.json");
  writeJson(queuePath, makeQueue([]));

  const res = mod.preview({ statePath: path.join(dir, "nonexistent.json"), queuePath });
  assert(res.ok === false, "preview fails with missing state");
  assert(res.error.includes("Cannot read provider pool state"), "error mentions state");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: missing queue file ---------------------------------------------

console.log("\nPreview: missing queue file\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  writeJson(statePath, makeState());

  const res = mod.preview({ statePath, queuePath: path.join(dir, "nonexistent.json") });
  assert(res.ok === false, "preview fails with missing queue");
  assert(res.error.includes("Cannot read queue state"), "error mentions queue");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: no providers ---------------------------------------------------

console.log("\nPreview: no providers\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, { providers: [] });
  writeJson(queuePath, makeQueue([
    { issueNumber: 200, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok with no providers");
  assert(res.plan.length === 0, "no issues planned");
  assert(res.skipped.length === 1, "1 skipped");
  assert(res.skipped[0].reason.includes("No provider capacity"), "skipped for capacity");
  assert(res.capacity.availableProviders === 0, "0 providers");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: conflict group dedup -------------------------------------------

console.log("\nPreview: conflict group dedup\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 300, state: "queued", conflictGroup: "wave20-shared" },
    { issueNumber: 301, state: "queued", conflictGroup: "wave20-shared" },
    { issueNumber: 302, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok with conflict dedup");
  assert(res.plan.length === 2, "2 planned (one conflict group + one no group)");
  assert(res.plan[0].issueNumber === 300, "first conflict group member planned");
  assert(res.plan[1].issueNumber === 302, "no-group issue planned");
  assert(res.skipped.length === 1, "1 skipped for conflict");
  assert(res.skipped[0].issueNumber === 301, "duplicate conflict group skipped");
  assert(res.skipped[0].reason.includes("Conflict group"), "reason mentions conflict group");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: provider capacity exhaustion -----------------------------------

console.log("\nPreview: provider capacity exhaustion\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  const state = makeState();
  state.providers[0].maxConcurrency = 1;
  state.providers[0].currentConcurrency = 0;
  writeJson(statePath, state);
  writeJson(queuePath, makeQueue([
    { issueNumber: 400, state: "queued" },
    { issueNumber: 401, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok with limited capacity");
  assert(res.plan.length === 1, "1 planned (capacity exhausted)");
  assert(res.plan[0].issueNumber === 400, "first issue planned");
  assert(res.skipped.length === 1, "1 skipped for capacity");
  assert(res.skipped[0].issueNumber === 401, "second issue skipped");
  assert(res.skipped[0].reason.includes("No provider capacity"), "reason mentions capacity");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: sanitization strips secrets from state -------------------------

console.log("\nPreview: sanitization strips secrets\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");

  // The internal sanitization strips secret fields; verify module output has no secrets
  const raw = JSON.stringify(res);
  assert(!raw.includes("should-be-stripped"), "no secret value in output");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: sanitization strips secrets from queue entries -----------------

console.log("\nPreview: sanitization strips entry secrets\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    {
      issueNumber: 500,
      state: "queued",
      secret: "entry-secret-value",
      token: "entry-token-value",
      apiKey: "entry-api-key",
      password: "entry-password",
      credential: "entry-cred",
      auth: "entry-auth",
    },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok with sensitive entries");

  const raw = JSON.stringify(res);
  assert(!raw.includes("entry-secret-value"), "entry secret stripped");
  assert(!raw.includes("entry-token-value"), "entry token stripped");
  assert(!raw.includes("entry-api-key"), "entry apiKey stripped");
  assert(!raw.includes("entry-password"), "entry password stripped");
  assert(!raw.includes("entry-cred"), "entry credential stripped");
  assert(!raw.includes("entry-auth"), "entry auth stripped");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: non-queued entries are ignored ---------------------------------

console.log("\nPreview: non-queued entries ignored\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 600, state: "running" },
    { issueNumber: 601, state: "blocked" },
    { issueNumber: 602, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");
  assert(res.plan.length === 1, "only queued entry planned");
  assert(res.plan[0].issueNumber === 602, "queued issue planned");
  assert(res.capacity.queuedIssues === 1, "queuedCount reflects only queued");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: exhausted providers skipped ------------------------------------

console.log("\nPreview: exhausted providers skipped\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  const state = {
    providers: [
      { id: "provider-a", status: "exhausted", maxConcurrency: 5, currentConcurrency: 5 },
      { id: "provider-b", status: "available", maxConcurrency: 2, currentConcurrency: 0 },
    ],
  };
  writeJson(statePath, state);
  writeJson(queuePath, makeQueue([
    { issueNumber: 700, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok with exhausted provider");
  assert(res.plan[0].providerId === "provider-b", "assigned to available provider");
  assert(res.capacity.availableProviders === 1, "only 1 provider counted");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: valid with allowlist -------------------------------------------

console.log("\nExecute: valid with allowlist\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");
  const batchPath = path.join(dir, "batch-plan.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 800, state: "queued", conflictGroup: "wave20-x" },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    batchPath,
    allowlist: [800],
    reason: "test batch",
  });

  assert(res.ok === true, "execute ok with valid allowlist");
  assert(res.plan.length === 1, "1 planned");
  assert(res.plan[0].issueNumber === 800, "planned issue matches");
  assert(res.reason === "test batch", "reason echoed");
  assert(res.batchPath === "written", "batchPath indicates written");
  assert(typeof res.timestamp === "string", "timestamp present");

  // Verify batch plan file was written
  const written = JSON.parse(fs.readFileSync(batchPath, "utf-8"));
  assert(written.schemaVersion === 1, "batch plan schemaVersion 1");
  assert(written.reason === "test batch", "batch plan has reason");
  assert(written.plan.length === 1, "batch plan has 1 entry");
  assert(written.plan[0].issueNumber === 800, "batch plan issue matches");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: missing allowlist ----------------------------------------------

console.log("\nExecute: missing allowlist\n");

{
  const res = mod.execute({ reason: "test" });
  assert(res.ok === false, "execute fails without allowlist");
  assert(res.error.includes("allowlist"), "error mentions allowlist");
}

// --- Execute: empty allowlist ------------------------------------------------

console.log("\nExecute: empty allowlist\n");

{
  const res = mod.execute({ allowlist: [], reason: "test" });
  assert(res.ok === false, "execute fails with empty allowlist");
  assert(res.error.includes("allowlist"), "error mentions allowlist");
}

// --- Execute: missing reason -------------------------------------------------

console.log("\nExecute: missing reason\n");

{
  const res = mod.execute({ allowlist: [1] });
  assert(res.ok === false, "execute fails without reason");
  assert(res.error.includes("reason"), "error mentions reason");
}

// --- Execute: empty reason ---------------------------------------------------

console.log("\nExecute: empty reason\n");

{
  const res = mod.execute({ allowlist: [1], reason: "  " });
  assert(res.ok === false, "execute fails with blank reason");
  assert(res.error.includes("reason"), "error mentions reason");
}

// --- Execute: blocked issues (not in allowlist) ------------------------------

console.log("\nExecute: blocked issues\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 900, state: "queued" },
    { issueNumber: 901, state: "queued" },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    allowlist: [900],
    reason: "partial allowlist",
  });

  assert(res.ok === false, "execute fails with blocked issues");
  assert(res.error.includes("not in allowlist"), "error mentions allowlist");
  assert(Array.isArray(res.blocked), "blocked is array");
  assert(res.blocked.includes(901), "901 is blocked");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: missing state file ---------------------------------------------

console.log("\nExecute: missing state file\n");

{
  const dir = tmpDir();
  const queuePath = path.join(dir, "queue.json");
  writeJson(queuePath, makeQueue([]));

  const res = mod.execute({
    statePath: path.join(dir, "nonexistent.json"),
    queuePath,
    allowlist: [1],
    reason: "test",
  });
  assert(res.ok === false, "execute fails with missing state");
  assert(res.error.includes("Cannot read provider pool state"), "error mentions state");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: missing queue file ---------------------------------------------

console.log("\nExecute: missing queue file\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  writeJson(statePath, makeState());

  const res = mod.execute({
    statePath,
    queuePath: path.join(dir, "nonexistent.json"),
    allowlist: [1],
    reason: "test",
  });
  assert(res.ok === false, "execute fails with missing queue");
  assert(res.error.includes("Cannot read queue state"), "error mentions queue");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: empty plan (no queued issues) ----------------------------------

console.log("\nExecute: empty plan\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([]));

  const res = mod.execute({
    statePath,
    queuePath,
    allowlist: [1],
    reason: "nothing queued",
  });
  assert(res.ok === true, "execute ok with empty plan");
  assert(res.plan.length === 0, "empty plan");
  assert(res.message.includes("No issues to batch"), "message explains empty");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: allowlist with string coercion ---------------------------------

console.log("\nExecute: allowlist string coercion\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 1000, state: "queued" },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    allowlist: ["1000"],
    reason: "string allowlist",
  });
  assert(res.ok === true, "execute ok with string allowlist (coerced via Number)");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: batch plan file write failure ----------------------------------

console.log("\nExecute: batch plan write failure\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 1100, state: "queued" },
  ]));

  // Use a path that cannot be written (file as directory)
  const badBatchPath = path.join(dir, "provider-pool.json", "batch.json");

  const res = mod.execute({
    statePath,
    queuePath,
    batchPath: badBatchPath,
    allowlist: [1100],
    reason: "write test",
  });
  assert(res.ok === false, "execute fails on write error");
  assert(res.error.includes("Failed to write batch plan"), "error mentions write failure");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: provider with zero headroom skipped ----------------------------

console.log("\nPreview: zero headroom provider\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  const state = {
    providers: [
      { id: "provider-full", status: "available", maxConcurrency: 2, currentConcurrency: 2 },
      { id: "provider-open", status: "available", maxConcurrency: 1, currentConcurrency: 0 },
    ],
  };
  writeJson(statePath, state);
  writeJson(queuePath, makeQueue([
    { issueNumber: 1200, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");
  assert(res.plan[0].providerId === "provider-open", "assigned to provider with headroom");
  assert(res.capacity.availableProviders === 1, "1 provider with headroom counted");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: output shape completeness on success --------------------------

console.log("\nPreview: output shape completeness\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");
  assert(Array.isArray(res.skipped), "skipped is array even when empty");
  assert(res.skipped.length === 0, "skipped empty when nothing queued");
  assert(res.capacity.skippedCount === 0, "skippedCount 0 when nothing queued");
  assert(res.capacity.planned === 0, "planned 0 when nothing queued");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: error responses include path hints -----------------------------

console.log("\nPreview: error responses include paths\n");

{
  const dir = tmpDir();
  const missingState = path.join(dir, "no-state.json");
  const missingQueue = path.join(dir, "no-queue.json");

  const resState = mod.preview({ statePath: missingState, queuePath: missingQueue });
  assert(resState.statePath === missingState, "state error includes statePath");

  const statePath = path.join(dir, "provider-pool.json");
  writeJson(statePath, makeState());
  const resQueue = mod.preview({ statePath, queuePath: missingQueue });
  assert(resQueue.queuePath === missingQueue, "queue error includes queuePath");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: plan entries default null for missing optional fields ----------

console.log("\nPreview: plan entry null defaults\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 1300, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");
  assert(res.plan[0].conflictGroup === null, "missing conflictGroup defaults to null");
  assert(res.plan[0].actorRole === null, "missing actorRole defaults to null");
  assert(typeof res.plan[0].issueNumber === "number", "issueNumber is number");
  assert(typeof res.plan[0].providerId === "string", "providerId is string");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: success output includes skipped --------------------------------

console.log("\nExecute: success output includes skipped\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 1400, state: "queued", conflictGroup: "wave-e" },
    { issueNumber: 1401, state: "queued", conflictGroup: "wave-e" },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    allowlist: [1400, 1401],
    reason: "skipped check",
  });

  assert(res.ok === true, "execute ok");
  assert(res.plan.length === 1, "1 planned (conflict dedup)");
  assert(Array.isArray(res.skipped), "skipped is array");
  assert(res.skipped.length === 1, "1 skipped for conflict");
  assert(res.skipped[0].issueNumber === 1401, "skipped issue correct");
  assert(typeof res.skipped[0].reason === "string", "skipped reason is string");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: no secrets in written batch plan file -------------------------

console.log("\nExecute: no secrets in batch plan file\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");
  const batchPath = path.join(dir, "batch-plan.json");

  const state = {
    providers: [
      {
        id: "prov-sec",
        status: "available",
        maxConcurrency: 2,
        currentConcurrency: 0,
        secret: "provider-s3cret",
        apiKey: "pk-s3cret",
        token: "tok-s3cret",
      },
    ],
  };
  writeJson(statePath, state);
  writeJson(queuePath, makeQueue([
    {
      issueNumber: 1500,
      state: "queued",
      secret: "entry-s3cret",
      token: "entry-tok",
      apiKey: "entry-key",
    },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    batchPath,
    allowlist: [1500],
    reason: "security check",
  });

  assert(res.ok === true, "execute ok");

  const fileContent = fs.readFileSync(batchPath, "utf-8");
  assert(!fileContent.includes("provider-s3cret"), "no provider secret in file");
  assert(!fileContent.includes("pk-s3cret"), "no provider apiKey in file");
  assert(!fileContent.includes("tok-s3cret"), "no provider token in file");
  assert(!fileContent.includes("entry-s3cret"), "no entry secret in file");
  assert(!fileContent.includes("entry-tok"), "no entry token in file");
  assert(!fileContent.includes("entry-key"), "no entry apiKey in file");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: batch plan file capturedAt is ISO string ----------------------

console.log("\nExecute: batch plan capturedAt shape\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");
  const batchPath = path.join(dir, "batch-plan.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 1600, state: "queued" },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    batchPath,
    allowlist: [1600],
    reason: "timestamp check",
  });

  assert(res.ok === true, "execute ok");

  const written = JSON.parse(fs.readFileSync(batchPath, "utf-8"));
  assert(typeof written.capturedAt === "string", "capturedAt is string");
  assert(!isNaN(Date.parse(written.capturedAt)), "capturedAt is valid ISO date");
  assert(written.schemaVersion === 1, "schemaVersion is 1");
  assert(Array.isArray(written.skipped), "batch plan has skipped array");
  assert(written.plan[0].issueNumber === 1600, "plan entry preserved");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Execute: empty plan returns skipped array ------------------------------

console.log("\nExecute: empty plan returns skipped\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, { providers: [] });
  writeJson(queuePath, makeQueue([
    { issueNumber: 1700, state: "queued" },
  ]));

  const res = mod.execute({
    statePath,
    queuePath,
    allowlist: [1700],
    reason: "empty plan skipped check",
  });

  assert(res.ok === true, "execute ok with empty plan");
  assert(res.plan.length === 0, "no planned issues");
  assert(Array.isArray(res.skipped), "skipped is array");
  assert(res.skipped.length === 1, "1 skipped");
  assert(res.skipped[0].issueNumber === 1700, "skipped issue correct");
  assert(res.skipped[0].reason.includes("No provider capacity"), "skipped reason mentions capacity");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: multiple providers with mixed capacity ------------------------

console.log("\nPreview: mixed provider capacity assignment\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  const state = {
    providers: [
      { id: "prov-a", status: "available", maxConcurrency: 1, currentConcurrency: 0 },
      { id: "prov-b", status: "available", maxConcurrency: 2, currentConcurrency: 0 },
    ],
  };
  writeJson(statePath, state);
  writeJson(queuePath, makeQueue([
    { issueNumber: 1800, state: "queued" },
    { issueNumber: 1801, state: "queued" },
    { issueNumber: 1802, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");
  assert(res.plan.length === 3, "all 3 planned");
  assert(res.plan[0].providerId === "prov-a", "first assigned to prov-a");
  assert(res.plan[1].providerId === "prov-b", "second assigned to prov-b");
  assert(res.plan[2].providerId === "prov-b", "third assigned to prov-b");
  assert(res.capacity.availableProviders === 2, "2 providers counted");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: plan entry shape is consistent with all keys ------------------

console.log("\nPreview: plan entry shape consistency\n");

{
  const dir = tmpDir();
  const statePath = path.join(dir, "provider-pool.json");
  const queuePath = path.join(dir, "queue.json");

  writeJson(statePath, makeState());
  writeJson(queuePath, makeQueue([
    { issueNumber: 1900, state: "queued", conflictGroup: "wave-f", actorRole: "execution" },
    { issueNumber: 1901, state: "queued" },
  ]));

  const res = mod.preview({ statePath, queuePath });
  assert(res.ok === true, "preview ok");

  const entryKeys = Object.keys(res.plan[0]).sort();
  assert(entryKeys.join(",") === "actorRole,conflictGroup,issueNumber,providerId", "plan entry keys consistent");

  const entryKeys2 = Object.keys(res.plan[1]).sort();
  assert(entryKeys2.join(",") === "actorRole,conflictGroup,issueNumber,providerId", "plan entry keys consistent for defaults");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Summary -----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
