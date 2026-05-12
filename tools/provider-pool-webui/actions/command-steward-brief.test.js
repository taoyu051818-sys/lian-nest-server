#!/usr/bin/env node
"use strict";

/**
 * command-steward-brief.test.js
 *
 * Tests for the command-steward-brief WebUI action module.
 * Validates contract shape, error handling, sanitization, and source hygiene.
 *
 * Uses a mock for child_process.execSync so tests run without the real script.
 *
 * Run: node tools/provider-pool-webui/actions/command-steward-brief.test.js
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
  const fullPath = path.join(__dirname, "command-steward-brief.js");
  delete require.cache[require.resolve(fullPath)];
  return require(fullPath);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function validBriefJson() {
  return JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    systemStatus: { overall: "operational", health: { state: "green" } },
    providerSummary: { loaded: true, available: 1 },
    workerSummary: { loaded: true, count: 0 },
    blockers: [],
    recommendedNextActions: [],
    humanRequiredItems: [],
  });
}

function briefWithSecrets() {
  return JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    systemStatus: { overall: "operational", health: { state: "green" } },
    authToken: "should-be-stripped",
    secretKey: "should-be-stripped",
    providerSummary: { loaded: true, available: 1 },
    blockers: [],
    recommendedNextActions: [],
    humanRequiredItems: [],
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

if (require.main === module) {

console.log("\ncommand-steward-brief.test.js\n");

// Contract
console.log("Contract\n");
{
  installMock(() => validBriefJson());
  const mod = loadModule();

  assert(mod.id === "command-steward-brief", "id is command-steward-brief");
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
  installMock(() => validBriefJson());
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === true, "preview returns ok");
  assert(r.brief !== undefined, "brief is defined");
  assert(r.brief.schemaVersion === 1, "schemaVersion is 1");
  assert(typeof r.brief.capturedAt === "string", "capturedAt is string");
  assert(r.brief.systemStatus !== undefined, "systemStatus is present");
  assert(r.brief.systemStatus.overall === "operational", "overall is operational");
  assert(Array.isArray(r.brief.blockers), "blockers is array");
  assert(Array.isArray(r.brief.recommendedNextActions), "recommendedNextActions is array");
  assert(Array.isArray(r.brief.humanRequiredItems), "humanRequiredItems is array");

  uninstallMock();
}

// Execute — same as preview (read-only)
console.log("\nExecute — same as preview\n");
{
  installMock(() => validBriefJson());
  const mod = loadModule();

  let r = mod.execute();
  assert(r.ok === true, "execute returns ok");
  assert(r.brief !== undefined, "execute has brief");
  assert(r.brief.schemaVersion === 1, "execute brief has schemaVersion");

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
  installMock(() => briefWithSecrets());
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === true, "preview ok with secrets in input");
  assert(r.brief.authToken === undefined, "authToken is stripped");
  assert(r.brief.secretKey === undefined, "secretKey is stripped");
  assert(r.brief.systemStatus !== undefined, "non-secret data preserved");

  uninstallMock();
}

// Sanitization — long strings truncated
console.log("\nSanitization — long strings\n");
{
  const longBrief = JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-05-12T00:00:00.000Z",
    systemStatus: { overall: "operational", health: { state: "green" } },
    longField: "x".repeat(600),
    blockers: [],
    recommendedNextActions: [],
    humanRequiredItems: [],
  });
  installMock(() => longBrief);
  const mod = loadModule();

  let r = mod.preview();
  assert(r.ok === true, "preview ok with long string");
  assert(r.brief.longField.length <= 510, "long string is truncated");
  assert(r.brief.longField.endsWith("..."), "truncated string ends with ...");

  uninstallMock();
}

// Output shape
console.log("\nOutput shape\n");
{
  installMock(() => validBriefJson());
  const mod = loadModule();

  let r = mod.preview();
  assert(typeof r === "object", "result is object");
  assert(typeof r.ok === "boolean", "ok is boolean");
  assert(r.brief !== undefined, "brief field present");
  assert(typeof r.brief === "object", "brief is object");

  uninstallMock();
}

// Source hygiene
console.log("\nSource hygiene\n");
{
  const fullPath = path.join(__dirname, "command-steward-brief.js");
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
    id: "command-steward-brief-test",
    label: "Command Steward Brief Test Harness",
    description: "Test-only module. Not an action.",
    dangerous: false,
    preview() { return { ok: false, error: "test harness" }; },
    execute() { return { ok: false, error: "test harness" }; },
  };
}
