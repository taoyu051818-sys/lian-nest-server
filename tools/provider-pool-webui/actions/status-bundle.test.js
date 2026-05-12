#!/usr/bin/env node
"use strict";

/**
 * status-bundle.test.js
 *
 * Tests for the status-bundle WebUI action module.
 * Validates contract shape, error handling, sanitization, and source hygiene.
 *
 * Uses a mock for child_process.execSync so tests run without the real script.
 *
 * Run: node tools/provider-pool-webui/actions/status-bundle.test.js
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

const cp = require("node:child_process");
const originalExecSync = cp.execSync;

function installMock(handler) {
  cp.execSync = handler;
}

function uninstallMock() {
  cp.execSync = originalExecSync;
}

function loadModule() {
  const fullPath = path.join(__dirname, "status-bundle.js");
  delete require.cache[require.resolve(fullPath)];
  return require(fullPath);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function validBundleJson() {
  return JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    health: {
      loaded: true,
      state: "green",
      capturedAt: "2026-01-01T00:00:00.000Z",
      checks: ["tsc", "lint"],
      failedChecks: [],
      reason: null,
    },
    openPullRequests: { loaded: true, count: 1, pullRequests: [{ number: 50, title: "feat: something", author: "bot", headRefName: "claude/issue-50" }] },
    openIssues: { loaded: true, count: 2, issues: [{ number: 100, title: "test issue", state: "OPEN", labels: [] }] },
    activeWorkers: { loaded: true, count: 1, workers: [{ issue: 100, conflictGroup: "runtime-feature", state: "active" }] },
    recentTelemetry: { loaded: true, metaSignals: { failureScore: 0, frictionScore: 0, riskScore: 10, trust: 90, topPain: "none" } },
    blockers: [],
    inputSources: { healthLoaded: true, activeWorkersLoaded: true, metaSignalsLoaded: true, riskSignalsLoaded: false, prDataLoaded: true, issueDataLoaded: true },
  });
}

function bundleWithSecrets() {
  return JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    health: { loaded: true, state: "green", capturedAt: null, checks: [], failedChecks: [], reason: null },
    openPullRequests: { loaded: false, count: 0, pullRequests: [] },
    openIssues: { loaded: false, count: 0, issues: [] },
    activeWorkers: { loaded: false, count: 0, workers: [] },
    recentTelemetry: { loaded: false },
    blockers: [],
    inputSources: { healthLoaded: false, activeWorkersLoaded: false, metaSignalsLoaded: false, riskSignalsLoaded: false, prDataLoaded: false, issueDataLoaded: false },
    authToken: "should-be-stripped",
    secretKey: "should-be-stripped",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

if (require.main === module) {

console.log("\nstatus-bundle.test.js\n");

// Contract
console.log("Contract\n");
{
  installMock(() => validBundleJson());
  const mod = loadModule();

  assert(mod.id === "status-bundle", "id is status-bundle");
  assert(typeof mod.label === "string" && mod.label.length > 0, "label is non-empty string");
  assert(typeof mod.description === "string" && mod.description.length > 0, "description is non-empty string");
  assert(mod.dangerous === false, "dangerous is false");
  assert(typeof mod.preview === "function", "preview is a function");
  assert(typeof mod.execute === "function", "execute is a function");

  uninstallMock();
}

// Preview — happy path
console.log("\nPreview — happy path\n");
{
  installMock(() => validBundleJson());
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === true, "preview returns ok");
  assert(r.bundle !== undefined, "bundle is defined");
  assert(r.bundle.schemaVersion === 1, "schemaVersion is 1");
  assert(typeof r.bundle.capturedAt === "string", "capturedAt is string");
  assert(r.bundle.health !== undefined, "health is present");
  assert(r.bundle.health.loaded === true, "health loaded");
  assert(r.bundle.health.state === "green", "health state is green");
  assert(r.bundle.openPullRequests !== undefined, "openPullRequests is present");
  assert(r.bundle.openPullRequests.count === 1, "pr count is 1");
  assert(r.bundle.openIssues !== undefined, "openIssues is present");
  assert(r.bundle.openIssues.count === 2, "issue count is 2");
  assert(r.bundle.activeWorkers !== undefined, "activeWorkers is present");
  assert(r.bundle.activeWorkers.count === 1, "worker count is 1");
  assert(Array.isArray(r.bundle.blockers), "blockers is array");

  uninstallMock();
}

// Execute — same as preview (read-only)
console.log("\nExecute — same as preview\n");
{
  installMock(() => validBundleJson());
  const mod = loadModule();

  let r = mod.execute();
  assert(r.ok === true, "execute returns ok");
  assert(r.bundle !== undefined, "execute has bundle");
  assert(r.bundle.schemaVersion === 1, "execute bundle has schemaVersion");

  uninstallMock();
}

// Error — script not found
console.log("\nError — script not found\n");
{
  const origExistsSync = fs.existsSync;
  fs.existsSync = () => false;
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === false, "returns ok=false when script missing");
  assert(typeof r.error === "string", "error is string");
  assert(r.error.includes("not found"), "error mentions not found");

  fs.existsSync = origExistsSync;
}

// Error — script returns invalid JSON
console.log("\nError — invalid JSON\n");
{
  installMock(() => "this is not json {{{");
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === false, "returns ok=false for invalid JSON");
  assert(typeof r.error === "string", "error is string");
  assert(r.error.includes("invalid JSON"), "error mentions invalid JSON");

  uninstallMock();
}

// Error — script execution fails
console.log("\nError — script execution fails\n");
{
  installMock(() => { throw new Error("spawn failed"); });
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === false, "returns ok=false on execution failure");
  assert(typeof r.error === "string", "error is string");
  assert(r.error.includes("execution failed"), "error mentions execution failed");

  uninstallMock();
}

// Error — script execution with stderr
console.log("\nError — script with stderr\n");
{
  installMock(() => {
    const err = new Error("exit code 1");
    err.stderr = "some error output";
    throw err;
  });
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === false, "returns ok=false");
  assert(r.detail !== undefined, "includes detail from stderr");
  assert(typeof r.detail === "string", "detail is string");

  uninstallMock();
}

// Sanitization — secret keys stripped
console.log("\nSanitization — secret keys\n");
{
  installMock(() => bundleWithSecrets());
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === true, "preview ok with secrets in input");
  assert(r.bundle.authToken === undefined, "authToken is stripped");
  assert(r.bundle.secretKey === undefined, "secretKey is stripped");
  assert(r.bundle.health !== undefined, "non-secret data preserved");

  uninstallMock();
}

// Sanitization — long strings truncated
console.log("\nSanitization — long strings\n");
{
  const longBundle = JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    health: { loaded: false, state: "unknown", capturedAt: null, checks: [], failedChecks: [], reason: null },
    openPullRequests: { loaded: false, count: 0, pullRequests: [] },
    openIssues: { loaded: false, count: 0, issues: [] },
    activeWorkers: { loaded: false, count: 0, workers: [] },
    recentTelemetry: { loaded: false },
    blockers: [],
    inputSources: { healthLoaded: false, activeWorkersLoaded: false, metaSignalsLoaded: false, riskSignalsLoaded: false, prDataLoaded: false, issueDataLoaded: false },
    longField: "x".repeat(600),
  });
  installMock(() => longBundle);
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === true, "preview ok with long string");
  assert(r.bundle.longField.length <= 510, "long string is truncated");
  assert(r.bundle.longField.endsWith("..."), "truncated string ends with ...");

  uninstallMock();
}

// Output shape
console.log("\nOutput shape\n");
{
  installMock(() => validBundleJson());
  const mod = loadModule();

  let r = mod.preview();
  assert(typeof r === "object", "result is object");
  assert(typeof r.ok === "boolean", "ok is boolean");
  assert(r.bundle !== undefined, "bundle field present");
  assert(typeof r.bundle === "object", "bundle is object");

  uninstallMock();
}

// Source hygiene
console.log("\nSource hygiene\n");
{
  const fullPath = path.join(__dirname, "status-bundle.js");
  const source = fs.readFileSync(fullPath, "utf-8");

  assert(!/\.env\b/.test(source), "no .env references");
  assert(!/ANTHROPIC_API_KEY/.test(source), "no API key env var");
  assert(!/process\.env\./.test(source), "no process.env access");
  assert(source.includes("SECRET_PATTERNS"), "defines SECRET_PATTERNS");
  assert(source.includes("sanitizeObject"), "defines sanitizeObject");
  assert(source.includes("--stdout"), "passes --stdout flag");
}

// Summary
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} else {
  module.exports = {
    id: "status-bundle-test",
    label: "Status Bundle Test Harness",
    description: "Test-only module. Not an action.",
    dangerous: false,
    preview() { return { ok: false, error: "test harness" }; },
    execute() { return { ok: false, error: "test harness" }; },
  };
}
