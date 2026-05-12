#!/usr/bin/env node
"use strict";

/**
 * autonomy-handoff.test.js
 *
 * Tests for the autonomy-handoff WebUI action module.
 * Validates contract shape, state aggregation, sanitization, error handling,
 * and source hygiene.
 *
 * Uses mock state files via fs.readFileSync override so tests run without
 * real .github/ai-state/ files.
 *
 * Run: node tools/provider-pool-webui/actions/autonomy-handoff.test.js
 */

const fs = require("node:fs");
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

// ── Mock helper ──────────────────────────────────────────────────────────────

const originalReadFileSync = fs.readFileSync;
const originalExistsSync = fs.existsSync;

let mockFiles = {};

function installMock(files) {
  mockFiles = files || {};
  fs.readFileSync = function (filePath, encoding) {
    var key = String(filePath);
    if (key in mockFiles) {
      if (mockFiles[key] === null) throw new Error("ENOENT");
      return mockFiles[key];
    }
    return originalReadFileSync.call(fs, filePath, encoding);
  };
  fs.existsSync = function (filePath) {
    var key = String(filePath);
    if (key in mockFiles) return mockFiles[key] !== null;
    return originalExistsSync.call(fs, filePath);
  };
}

function uninstallMock() {
  mockFiles = {};
  fs.readFileSync = originalReadFileSync;
  fs.existsSync = originalExistsSync;
}

function loadModule() {
  var fullPath = path.join(__dirname, "autonomy-handoff.js");
  delete require.cache[require.resolve(fullPath)];
  return require(fullPath);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

var STATE_DIR_FIXTURE = path.resolve(__dirname, "../../../.github/ai-state");

function statePath(name) {
  return path.join(STATE_DIR_FIXTURE, name);
}

function greenHealth() {
  return JSON.stringify({
    state: "green",
    capturedAt: "2026-05-12T00:00:00.000Z",
    checks: ["tsc", "build"],
    failedChecks: [],
  });
}

function redHealth() {
  return JSON.stringify({
    state: "red",
    capturedAt: "2026-05-12T00:00:00.000Z",
    checks: ["tsc", "build"],
    failedChecks: ["build"],
  });
}

function availableProviders() {
  return JSON.stringify({
    stateVersion: 1,
    providers: [
      { id: "p1", status: "available", currentConcurrency: 0, maxConcurrency: 2 },
      { id: "p2", status: "available", currentConcurrency: 1, maxConcurrency: 1 },
    ],
  });
}

function exhaustedProviders() {
  return JSON.stringify({
    stateVersion: 1,
    providers: [
      { id: "p1", status: "exhausted", currentConcurrency: 0, maxConcurrency: 2 },
    ],
  });
}

function noWorkers() {
  return JSON.stringify({ markerVersion: 1, workers: [] });
}

function activeWorkersData() {
  return JSON.stringify({
    markerVersion: 1,
    workers: [
      { id: "w1", issueNumber: 100, state: "running", startedAt: "2026-05-12T00:00:00.000Z" },
    ],
  });
}

function metaSignalsData() {
  return JSON.stringify({
    signalVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    signals: {
      failureScore: 0,
      frictionScore: 0,
      riskScore: 0,
      cost: 0,
      trust: 100,
      topPain: "none",
    },
  });
}

function readyExitVerdict() {
  return JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    verdict: "ready",
    passedBlocking: 7,
    totalBlocking: 7,
    gates: [
      { id: "gate-1", name: "Self-Cycle Runner Autonomy", pass: true, blocking: true },
      { id: "gate-2", name: "Launch Gate Enforcement", pass: true, blocking: true },
      { id: "gate-3", name: "Health Gate Operational", pass: true, blocking: true },
      { id: "gate-4", name: "Recovery Path", pass: true, blocking: true },
      { id: "gate-5", name: "Merge Control", pass: true, blocking: true },
      { id: "gate-6", name: "Human-Owned Boundaries", pass: true, blocking: true },
      { id: "gate-7", name: "Observability", pass: true, blocking: true },
    ],
    blockers: [],
  });
}

function partialExitVerdict() {
  return JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    verdict: "partial",
    passedBlocking: 5,
    totalBlocking: 7,
    gates: [
      { id: "gate-1", name: "Self-Cycle Runner Autonomy", pass: true, blocking: true },
      { id: "gate-2", name: "Launch Gate Enforcement", pass: true, blocking: true },
      { id: "gate-3", name: "Health Gate Operational", pass: false, blocking: true },
      { id: "gate-4", name: "Recovery Path", pass: true, blocking: true },
      { id: "gate-5", name: "Merge Control", pass: true, blocking: true },
      { id: "gate-6", name: "Human-Owned Boundaries", pass: false, blocking: true },
      { id: "gate-7", name: "Observability", pass: true, blocking: true },
    ],
    blockers: ["Health gate auto-trigger not wired", "Human-owned boundaries incomplete"],
  });
}

function secretsInHealth() {
  return JSON.stringify({
    state: "green",
    authToken: "should-be-stripped",
    secretKey: "should-be-stripped",
    capturedAt: "2026-05-12T00:00:00.000Z",
    checks: [],
    failedChecks: [],
  });
}

function allGreenMock() {
  var h = statePath("main-health.json");
  var pp = statePath("provider-pool.json");
  var aw = statePath("active-workers.json");
  var ms = statePath("meta-signals.json");
  var er = statePath("codex-exit-readiness.json");
  var mock = {};
  mock[h] = greenHealth();
  mock[pp] = availableProviders();
  mock[aw] = noWorkers();
  mock[ms] = metaSignalsData();
  mock[er] = readyExitVerdict();
  return mock;
}

function allRedMock() {
  var h = statePath("main-health.json");
  var pp = statePath("provider-pool.json");
  var aw = statePath("active-workers.json");
  var ms = statePath("meta-signals.json");
  var er = statePath("codex-exit-readiness.json");
  var mock = {};
  mock[h] = redHealth();
  mock[pp] = exhaustedProviders();
  mock[aw] = activeWorkersData();
  mock[ms] = metaSignalsData();
  mock[er] = partialExitVerdict();
  return mock;
}

// ── Tests ────────────────────────────────────────────────────────────────────

if (require.main === module) {

console.log("\nautonomy-handoff.test.js\n");

// Contract
console.log("Contract\n");
{
  installMock(allGreenMock());
  var mod = loadModule();

  assert(mod.id === "autonomy-handoff", "id is autonomy-handoff");
  assert(typeof mod.label === "string" && mod.label.length > 0, "label is non-empty string");
  assert(typeof mod.description === "string" && mod.description.length > 0, "description is non-empty string");
  assert(mod.dangerous === false, "dangerous is false");
  assert(typeof mod.preview === "function", "preview is a function");
  assert(typeof mod.execute === "function", "execute is a function");

  uninstallMock();
}

// Preview — happy path (all green, ready)
console.log("\nPreview — happy path (all green)\n");
{
  installMock(allGreenMock());
  var mod = loadModule();

  var r = mod.preview();
  assert(r.ok === true, "preview returns ok");
  assert(r.schemaVersion === 1, "schemaVersion is 1");
  assert(typeof r.capturedAt === "string", "capturedAt is string");
  assert(r.verdict === "ready", "verdict is ready when all green");
  assert(r.health !== undefined, "health is present");
  assert(r.health.state === "green", "health state is green");
  assert(r.providerPool !== undefined, "providerPool is present");
  assert(r.providerPool.hasCapacity === true, "provider pool has capacity");
  assert(r.activeWorkers !== undefined, "activeWorkers is present");
  assert(r.exitReadiness !== undefined, "exitReadiness is present");
  assert(r.exitReadiness.verdict === "ready", "exit readiness verdict is ready");
  assert(Array.isArray(r.preHandoffChecklist), "preHandoffChecklist is array");
  assert(Array.isArray(r.retirementChecklist), "retirementChecklist is array");
  assert(r.summary !== undefined, "summary is present");
  assert(r.summary.ready === true, "summary.ready is true");
  assert(typeof r.message === "string", "message is string");

  uninstallMock();
}

// Preview — partial (health red, providers exhausted)
console.log("\nPreview — partial (red health)\n");
{
  installMock(allRedMock());
  var mod = loadModule();

  var r = mod.preview();
  assert(r.ok === true, "preview returns ok");
  assert(r.verdict === "not_ready", "verdict is not_ready when health red");
  assert(r.health.state === "red", "health state is red");
  assert(r.health.blocked === true, "health is blocked");
  assert(r.providerPool.hasCapacity === false, "no provider capacity");
  assert(r.activeWorkers.count === 1, "one active worker");
  assert(r.summary.ready === false, "summary.ready is false");
  assert(r.summary.preHandoffPass === false, "preHandoffPass is false");

  uninstallMock();
}

// Preview — missing all state files
console.log("\nPreview — missing state files\n");
{
  var missingMock = {};
  missingMock[statePath("main-health.json")] = null;
  missingMock[statePath("provider-pool.json")] = null;
  missingMock[statePath("active-workers.json")] = null;
  missingMock[statePath("meta-signals.json")] = null;
  missingMock[statePath("codex-exit-readiness.json")] = null;
  installMock(missingMock);
  var mod = loadModule();

  var r = mod.preview();
  assert(r.ok === true, "returns ok even with no state files");
  assert(r.verdict === "not_ready", "verdict is not_ready when files missing");
  assert(r.health.loaded === false, "health not loaded");
  assert(r.providerPool.loaded === false, "providerPool not loaded");
  assert(r.activeWorkers.loaded === false, "activeWorkers not loaded");
  assert(r.metaSignals === null, "metaSignals is null when not loaded");
  assert(r.exitReadiness.loaded === false, "exitReadiness not loaded");
  assert(r.summary.ready === false, "ready is false when files missing");

  uninstallMock();
}

// Execute — same as preview (read-only)
console.log("\nExecute — same as preview\n");
{
  installMock(allGreenMock());
  var mod = loadModule();

  var r = mod.execute();
  assert(r.ok === true, "execute returns ok");
  assert(r.schemaVersion === 1, "execute has schemaVersion");
  assert(r.summary.ready === true, "execute summary.ready matches preview");

  uninstallMock();
}

// Pre-handoff checklist evaluation
console.log("\nPre-handoff checklist\n");
{
  installMock(allGreenMock());
  var mod = loadModule();

  var r = mod.preview();
  assert(r.preHandoffChecklist.length === 4, "4 pre-handoff items");
  assert(r.preHandoffChecklist[0].pass === true, "health green passes");
  assert(r.preHandoffChecklist[1].pass === true, "health marker exists passes");
  assert(r.preHandoffChecklist[2].pass === true, "provider capacity passes");
  assert(r.preHandoffChecklist[3].pass === true, "no workers passes");
  assert(r.summary.preHandoffPass === true, "all pre-handoff pass");

  uninstallMock();
}

// Retirement checklist evaluation
console.log("\nRetirement checklist\n");
{
  installMock(allGreenMock());
  var mod = loadModule();

  var r = mod.preview();
  assert(r.retirementChecklist.length === 7, "7 retirement items");
  for (var i = 0; i < r.retirementChecklist.length; i++) {
    assert(r.retirementChecklist[i].pass === true, "retirement item " + (i + 1) + " passes");
    assert(r.retirementChecklist[i].blocking === true, "retirement item " + (i + 1) + " is blocking");
  }
  assert(r.summary.retirementPass === true, "all retirement items pass");

  uninstallMock();
}

// Sanitization — secret keys stripped
console.log("\nSanitization — secret keys\n");
{
  var h = statePath("main-health.json");
  var pp = statePath("provider-pool.json");
  var aw = statePath("active-workers.json");
  var ms = statePath("meta-signals.json");
  var er = statePath("codex-exit-readiness.json");
  var mock = {};
  mock[h] = secretsInHealth();
  mock[pp] = availableProviders();
  mock[aw] = noWorkers();
  mock[ms] = metaSignalsData();
  mock[er] = readyExitVerdict();
  installMock(mock);
  var mod = loadModule();

  var r = mod.preview();
  assert(r.ok === true, "preview ok with secrets in health");
  assert(r.health.authToken === undefined, "authToken is stripped from health");
  assert(r.health.secretKey === undefined, "secretKey is stripped from health");
  assert(r.health.state === "green", "non-secret data preserved");

  uninstallMock();
}

// Sanitization — long strings truncated
console.log("\nSanitization — long strings\n");
{
  var h = statePath("main-health.json");
  var pp = statePath("provider-pool.json");
  var aw = statePath("active-workers.json");
  var ms = statePath("meta-signals.json");
  var er = statePath("codex-exit-readiness.json");
  var longHealth = JSON.stringify({
    state: "green",
    longField: "x".repeat(600),
    capturedAt: "2026-05-12T00:00:00.000Z",
    checks: [],
    failedChecks: [],
  });
  var mock = {};
  mock[h] = longHealth;
  mock[pp] = availableProviders();
  mock[aw] = noWorkers();
  mock[ms] = metaSignalsData();
  mock[er] = readyExitVerdict();
  installMock(mock);
  var mod = loadModule();

  var r = mod.preview();
  assert(r.ok === true, "preview ok with long string");
  assert(r.health.longField.length <= 510, "long string is truncated");
  assert(r.health.longField.endsWith("..."), "truncated string ends with ...");

  uninstallMock();
}

// Output shape
console.log("\nOutput shape\n");
{
  installMock(allGreenMock());
  var mod = loadModule();

  var r = mod.preview();
  assert(typeof r === "object", "result is object");
  assert(typeof r.ok === "boolean", "ok is boolean");
  assert(typeof r.schemaVersion === "number", "schemaVersion is number");
  assert(typeof r.capturedAt === "string", "capturedAt is string");
  assert(typeof r.verdict === "string", "verdict is string");
  assert(typeof r.health === "object", "health is object");
  assert(typeof r.providerPool === "object", "providerPool is object");
  assert(typeof r.activeWorkers === "object", "activeWorkers is object");
  assert(typeof r.exitReadiness === "object", "exitReadiness is object");
  assert(Array.isArray(r.preHandoffChecklist), "preHandoffChecklist is array");
  assert(Array.isArray(r.retirementChecklist), "retirementChecklist is array");
  assert(typeof r.summary === "object", "summary is object");
  assert(typeof r.message === "string", "message is string");

  uninstallMock();
}

// Verdict logic — partial when pre-handoff passes but exit not ready
console.log("\nVerdict logic — partial\n");
{
  var h = statePath("main-health.json");
  var pp = statePath("provider-pool.json");
  var aw = statePath("active-workers.json");
  var ms = statePath("meta-signals.json");
  var er = statePath("codex-exit-readiness.json");
  var mock = {};
  mock[h] = greenHealth();
  mock[pp] = availableProviders();
  mock[aw] = noWorkers();
  mock[ms] = metaSignalsData();
  mock[er] = partialExitVerdict();
  installMock(mock);
  var mod = loadModule();

  var r = mod.preview();
  assert(r.verdict === "partial", "verdict is partial when exit readiness is partial");
  assert(r.summary.preHandoffPass === true, "pre-handoff passes");
  assert(r.summary.ready === false, "ready is false (exit not ready)");
  assert(r.message.includes("partial"), "message mentions partial");

  uninstallMock();
}

// Source hygiene
console.log("\nSource hygiene\n");
{
  var fullPath = path.join(__dirname, "autonomy-handoff.js");
  var source = fs.readFileSync(fullPath, "utf-8");

  assert(!/\.env\b/.test(source), "no .env references");
  assert(!/ANTHROPIC_API_KEY/.test(source), "no API key env var");
  assert(!/process\.env\./.test(source), "no process.env access");
  assert(source.includes("SECRET_PATTERNS"), "defines SECRET_PATTERNS");
  assert(source.includes("sanitizeObject"), "defines sanitizeObject");
  assert(!/execSync|execFileSync|spawn/.test(source), "no process execution");
  assert(!/gh\s/.test(source), "no GitHub CLI calls");
  assert(source.includes("dangerous: false"), "declares dangerous: false");
}

// Summary
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} else {
  module.exports = {
    id: "autonomy-handoff-test",
    label: "Autonomy Handoff Test Harness",
    description: "Test-only module. Not an action.",
    dangerous: false,
    preview() { return { ok: false, error: "test harness" }; },
    execute() { return { ok: false, error: "test harness" }; },
  };
}
