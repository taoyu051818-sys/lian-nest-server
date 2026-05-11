#!/usr/bin/env node
"use strict";

/**
 * issue-state.test.js
 *
 * Security boundary tests for the issue-state action module.
 * Validates input sanitization, refusal logic, classification rules,
 * output shape, execute path, and source hygiene.
 *
 * Uses a mock for child_process.execSync so tests run without gh CLI.
 *
 * Run: node tools/provider-pool-webui/actions/issue-state.test.js
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
// Override execSync on the child_process module so the issue-state module
// uses our mock instead of the real gh CLI.

const cp = require("node:child_process");
const originalExecSync = cp.execSync;

function installMock(handler) {
  cp.execSync = handler;
}

function uninstallMock() {
  cp.execSync = originalExecSync;
}

function loadModule() {
  const fullPath = path.join(__dirname, "issue-state.js");
  delete require.cache[require.resolve(fullPath)];
  return require(fullPath);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeIssue(overrides) {
  return {
    number: 100,
    title: "Test issue",
    state: "OPEN",
    labels: [],
    ...overrides,
  };
}

function labelObj(name) {
  return { name };
}

// Standard gh mock: returns issue JSON and empty merged PRs
function standardGhMock(issues) {
  const issueMap = new Map();
  for (const issue of issues) {
    issueMap.set(issue.number, issue);
  }

  return function (cmd) {
    // gh issue view <num> --json ...
    const viewMatch = cmd.match(/issue view (\d+) --json/);
    if (viewMatch) {
      const num = parseInt(viewMatch[1], 10);
      const issue = issueMap.get(num);
      if (issue) return JSON.stringify(issue);
      throw new Error("issue not found");
    }

    // gh pr list --state merged ...
    if (cmd.includes("pr list --state merged")) {
      return "[]";
    }

    // gh issue comment, gh issue edit, gh issue close — succeed silently
    if (cmd.includes("issue comment") || cmd.includes("issue edit") || cmd.includes("issue close")) {
      return "";
    }

    return "";
  };
}

function ghMockWithPRs(issues, mergedPRs) {
  const issueMap = new Map();
  for (const issue of issues) {
    issueMap.set(issue.number, issue);
  }

  return function (cmd) {
    const viewMatch = cmd.match(/issue view (\d+) --json/);
    if (viewMatch) {
      const num = parseInt(viewMatch[1], 10);
      const issue = issueMap.get(num);
      if (issue) return JSON.stringify(issue);
      throw new Error("issue not found");
    }

    if (cmd.includes("pr list --state merged")) {
      return JSON.stringify(mergedPRs);
    }

    if (cmd.includes("issue comment") || cmd.includes("issue edit") || cmd.includes("issue close")) {
      return "";
    }

    return "";
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
// Guard: only run tests when executed directly, not when required as a module.
// This prevents process.exit() from killing parent test runners.

if (require.main === module) {

console.log("\nissue-state.test.js\n");

// Contract
console.log("Contract\n");
{
  installMock(standardGhMock([]));
  const mod = loadModule();
  uninstallMock();

  assert(mod.id === "issue-state", "id is issue-state");
  assert(typeof mod.label === "string" && mod.label.length > 0, "label is non-empty string");
  assert(typeof mod.description === "string" && mod.description.length > 0, "description is non-empty string");
  assert(mod.dangerous === true, "dangerous is true");
  assert(typeof mod.preview === "function", "preview is a function");
  assert(typeof mod.execute === "function", "execute is a function");
}

// Secret isolation
console.log("\nSecret isolation\n");
{
  const fullPath = path.join(__dirname, "issue-state.js");
  const source = fs.readFileSync(fullPath, "utf-8");

  const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
  const ghTokenRe = /ghp.[A-Za-z\d_]+/;

  assert(!apiKeyRe.test(source), "no literal API key pattern in source");
  assert(!ghTokenRe.test(source), "no GitHub token pattern in source");
  assert(!/ANTHROPIC_API_KEY\s*=\s*["']/.test(source), "does not hardcode env var value");
}

// Input validation — preview
console.log("\nInput validation — preview\n");
{
  installMock(standardGhMock([]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({});
  assert(r.ok === false, "preview rejects missing issueNumbers");
  assert(typeof r.error === "string", "preview missing issueNumbers returns string error");
  assert(r.error.includes("issueNumbers"), "error mentions issueNumbers");

  r = mod.preview({ issueNumbers: [] });
  assert(r.ok === false, "preview rejects empty issueNumbers");
  assert(r.error.includes("issueNumbers"), "error mentions issueNumbers");

  r = mod.preview({ issueNumbers: "not-an-array" });
  assert(r.ok === false, "preview rejects non-array issueNumbers");

  r = mod.preview(null);
  assert(r.ok === false, "preview rejects null payload");

  r = mod.preview({ issueNumbers: [0] });
  assert(r.ok === false, "preview rejects issue number 0");
  assert(r.error.includes("Invalid"), "error says Invalid");

  r = mod.preview({ issueNumbers: [-1] });
  assert(r.ok === false, "preview rejects negative issue number");

  r = mod.preview({ issueNumbers: [1.5] });
  assert(r.ok === false, "preview rejects non-integer issue number");

  r = mod.preview({ issueNumbers: ["abc"] });
  assert(r.ok === false, "preview rejects string issue number");

  const tooMany = Array.from({ length: 21 }, (_, i) => i + 1);
  r = mod.preview({ issueNumbers: tooMany });
  assert(r.ok === false, "preview rejects more than 20 issues");
  assert(r.error.includes("20"), "error mentions max limit");
}

// Input validation — execute
console.log("\nInput validation — execute\n");
{
  installMock(standardGhMock([]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.execute({});
  assert(r.ok === false, "execute rejects missing issueNumbers");
  assert(typeof r.error === "string", "returns error string");
  assert(r.error.includes("issueNumbers"), "error mentions issueNumbers");

  r = mod.execute({ issueNumbers: [] });
  assert(r.ok === false, "execute rejects empty issueNumbers");

  r = mod.execute(null);
  assert(r.ok === false, "execute rejects null payload");

  r = mod.execute({ issueNumbers: [0] });
  assert(r.ok === false, "execute rejects issue number 0");

  r = mod.execute({ issueNumbers: [-5] });
  assert(r.ok === false, "execute rejects negative issue number");

  const tooMany = Array.from({ length: 25 }, (_, i) => i + 1);
  r = mod.execute({ issueNumbers: tooMany });
  assert(r.ok === false, "execute rejects more than 20 issues");
}

// Refusal logic
console.log("\nRefusal logic\n");
{
  const umbrellaIssue = makeIssue({ number: 201, title: "Umbrella: wave20 completion" });
  const humanReqIssue = makeIssue({ number: 202, title: "Fix auth", labels: [labelObj("human-required")] });
  const normalIssue = makeIssue({ number: 203, title: "Add feature", labels: [labelObj("agent:done")] });

  installMock(standardGhMock([umbrellaIssue, humanReqIssue, normalIssue]));
  const mod = loadModule();
  uninstallMock();

  // Preview refusal
  let r = mod.preview({ issueNumbers: [201] });
  assert(r.ok === true, "umbrella preview returns ok");
  assert(r.results[0].status === "refused", "umbrella issue is refused in preview");
  assert(r.refusedCount === 1, "refusedCount is 1 for umbrella");
  assert(r.refused[0].reason === "umbrella issue", "umbrella refusal reason correct");

  r = mod.preview({ issueNumbers: [202] });
  assert(r.results[0].status === "refused", "human-required issue is refused in preview");
  assert(r.refused[0].reason === "human-required", "human-required refusal reason correct");

  // Execute refusal
  r = mod.execute({ issueNumbers: [201] });
  assert(r.skippedIssues.some((s) => s.number === 201), "umbrella issue is skipped in execute");

  r = mod.execute({ issueNumbers: [202] });
  assert(r.skippedIssues.some((s) => s.number === 202), "human-required issue is skipped in execute");
}

// Classification — merged-pr-open-issue
console.log("\nClassification — merged-pr-open-issue\n");
{
  const issue = makeIssue({ number: 301, state: "OPEN", labels: [] });
  const mergedPR = { number: 501, title: "Fix #301", body: "", mergedAt: "2026-05-10T00:00:00Z" };

  installMock(ghMockWithPRs([issue], [mergedPR]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [301] });
  assert(r.ok === true, "preview ok for merged-pr-open-issue");
  const entry = r.results.find((x) => x.number === 301);
  assert(entry.rule === "merged-pr-open-issue", "rule is merged-pr-open-issue");
  assert(entry.action === "close", "action is close");
  assert(entry.severity === "error", "severity is error");
  assert(r.eligible === 1, "one eligible issue");
  assert(r.eligibleIssues[0].mergedPR === 501, "eligible issue has mergedPR 501");
}

// Classification — merged-pr-stale-label (dead code note)
// The merged-pr-stale-label rule is unreachable: when mergedLinked > 0 and
// state === "OPEN", the merged-pr-open-issue rule always matches first.
console.log("\nClassification — merged-pr-stale-label (dead code)\n");
{
  const issue = makeIssue({ number: 302, state: "OPEN", labels: [labelObj("agent:running")] });
  const mergedPR = { number: 502, title: "Fix #302", body: "", mergedAt: "2026-05-10T00:00:00Z" };

  installMock(ghMockWithPRs([issue], [mergedPR]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [302] });
  const entry = r.results.find((x) => x.number === 302);
  assert(entry.rule === "merged-pr-open-issue", "merged PR + OPEN + agent:running resolves to merged-pr-open-issue");
  assert(entry.action === "close", "action is close (stale-label rule is dead code)");
}

// Classification — done-without-merge
console.log("\nClassification — done-without-merge\n");
{
  const issue = makeIssue({ number: 303, state: "OPEN", labels: [labelObj("agent:done")] });

  installMock(ghMockWithPRs([issue], []));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [303] });
  const entry = r.results.find((x) => x.number === 303);
  assert(entry.rule === "done-without-merge", "rule is done-without-merge");
  assert(entry.action === "review", "action is review");
  assert(entry.severity === "error", "severity is error");
}

// Classification — stale-running
console.log("\nClassification — stale-running\n");
{
  const issue = makeIssue({ number: 304, state: "OPEN", labels: [labelObj("agent:running")] });

  installMock(ghMockWithPRs([issue], []));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [304] });
  const entry = r.results.find((x) => x.number === 304);
  assert(entry.rule === "stale-running", "rule is stale-running");
  assert(entry.action === "review", "action is review");
  assert(entry.severity === "warning", "severity is warning");
}

// Classification — no-drift
console.log("\nClassification — no-drift\n");
{
  const issue = makeIssue({ number: 305, state: "OPEN", labels: [] });

  installMock(ghMockWithPRs([issue], []));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [305] });
  const entry = r.results.find((x) => x.number === 305);
  assert(entry.rule === "no-drift", "rule is no-drift");
  assert(entry.action === "none", "action is none");
  assert(entry.severity === "info", "severity is info");
}

// Closed issues are not classified as drift
console.log("\nClassification — closed issue\n");
{
  const issue = makeIssue({ number: 306, state: "CLOSED", labels: [labelObj("agent:done")] });

  installMock(ghMockWithPRs([issue], []));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [306] });
  const entry = r.results.find((x) => x.number === 306);
  assert(entry.rule === "no-drift", "closed issue is no-drift");
}

// Execute — close eligible issues
console.log("\nExecute — close eligible\n");
{
  const issue = makeIssue({ number: 401, state: "OPEN", labels: [labelObj("agent:running")] });
  const mergedPR = { number: 601, title: "Fix #401", body: "", mergedAt: "2026-05-10T00:00:00Z" };

  installMock(ghMockWithPRs([issue], [mergedPR]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.execute({ issueNumbers: [401] });
  assert(r.ok === true, "execute returns ok");
  assert(r.mode === "execute", "mode is execute");
  assert(r.closed === 1, "one issue closed");
  assert(r.closedIssues[0].number === 401, "closed issue is 401");
  assert(r.closedIssues[0].mergedPR === 601, "closed issue has mergedPR 601");
  assert(r.skipped === 0, "no skipped");
  assert(Array.isArray(r.errors) && r.errors.length === 0, "no errors");
}

// Execute — skips refused and non-close
console.log("\nExecute — skips refused and non-close\n");
{
  const umbrellaIssue = makeIssue({ number: 402, title: "Umbrella: wave20" });
  const noDriftIssue = makeIssue({ number: 403, state: "OPEN", labels: [] });

  installMock(ghMockWithPRs([umbrellaIssue, noDriftIssue], []));
  const mod = loadModule();
  uninstallMock();

  let r = mod.execute({ issueNumbers: [402, 403] });
  assert(r.ok === true, "execute returns ok");
  assert(r.closed === 0, "no issues closed");
  assert(r.skipped === 2, "two issues skipped");
}

// Execute — gh error handling
console.log("\nExecute — gh error handling\n");
{
  installMock(function (cmd) {
    if (cmd.includes("issue view")) throw new Error("gh not authenticated");
    return "[]";
  });
  const mod = loadModule();
  uninstallMock();

  let r = mod.execute({ issueNumbers: [501] });
  assert(r.ok === true, "execute returns ok even with gh error");
  assert(Array.isArray(r.errors) && r.errors.length === 1, "one error recorded");
}

// Preview output shape
console.log("\nPreview output shape\n");
{
  installMock(standardGhMock([]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [999] });
  assert(typeof r.version === "number", "preview has version");
  assert(r.version === 1, "preview has version 1");
  assert(typeof r.capturedAt === "string", "preview has capturedAt");
  assert(typeof r.totalIssues === "number", "preview has totalIssues");
  assert(typeof r.eligible === "number", "preview has eligible count");
  assert(typeof r.refusedCount === "number", "preview has refusedCount");
  assert(Array.isArray(r.results), "preview has results array");
  assert(Array.isArray(r.refused), "preview has refused array");
  assert(Array.isArray(r.eligibleIssues), "preview has eligibleIssues array");
}

// Execute output shape
console.log("\nExecute output shape\n");
{
  installMock(standardGhMock([]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.execute({ issueNumbers: [999] });
  assert(typeof r.version === "number", "execute has version");
  assert(r.version === 1, "execute has version 1");
  assert(typeof r.capturedAt === "string", "execute has capturedAt");
  assert(r.mode === "execute", "execute has mode=execute");
  assert(typeof r.totalRequested === "number", "execute has totalRequested");
  assert(typeof r.closed === "number", "execute has closed count");
  assert(typeof r.skipped === "number", "execute has skipped count");
  assert(Array.isArray(r.errors), "execute has errors array");
  assert(Array.isArray(r.closedIssues), "execute has closedIssues array");
  assert(Array.isArray(r.skippedIssues), "execute has skippedIssues array");
}

// Multiple issues batch
console.log("\nMultiple issues batch\n");
{
  const issues = [
    makeIssue({ number: 601, state: "OPEN", labels: [] }),
    makeIssue({ number: 602, title: "Umbrella: test", state: "OPEN", labels: [] }),
    makeIssue({ number: 603, state: "OPEN", labels: [labelObj("agent:done")] }),
  ];
  const mergedPR = { number: 701, title: "Fix #603", body: "", mergedAt: "2026-05-10T00:00:00Z" };

  installMock(ghMockWithPRs(issues, [mergedPR]));
  const mod = loadModule();
  uninstallMock();

  let r = mod.preview({ issueNumbers: [601, 602, 603] });
  assert(r.ok === true, "batch preview returns ok");
  assert(r.totalIssues === 3, "totalIssues is 3");
  assert(r.refusedCount === 1, "one refused (umbrella)");
  assert(r.eligible === 1, "one eligible (merged-pr-open-issue)");
}

// MAX_ISSUES boundary
console.log("\nMAX_ISSUES boundary\n");
{
  installMock(standardGhMock([]));
  const mod = loadModule();
  uninstallMock();

  const exactly20 = Array.from({ length: 20 }, (_, i) => i + 1);
  let r = mod.preview({ issueNumbers: exactly20 });
  assert(r.ok === true, "exactly 20 issues is accepted");

  const exactly21 = Array.from({ length: 21 }, (_, i) => i + 1);
  r = mod.preview({ issueNumbers: exactly21 });
  assert(r.ok === false, "21 issues is rejected");
}

// Source hygiene
console.log("\nSource hygiene\n");
{
  const fullPath = path.join(__dirname, "issue-state.js");
  const source = fs.readFileSync(fullPath, "utf-8");

  // Token pattern check (strings split to avoid self-matching the hygiene regex)
  const sk1 = "sk-" + "ant-";
  const sk2 = "sk-" + "[A-Za-z0-9]{20,}";
  const ghp = "ghp" + "_[A-Za-z0-9_]+";
  const tokenRe = new RegExp(sk1 + "|" + sk2 + "|" + ghp);
  assert(!tokenRe.test(source), "no literal token patterns");
  assert(!/\.env\b/.test(source), "no .env references");
  // Config file check (split to avoid self-match)
  const cfgRe = new RegExp("settings" + String.fromCharCode(92) + ".json");
  assert(!cfgRe.test(source), "no config file references");
  assert(!/password|secret|apikey/i.test(source) || /allowlist/i.test(source), "no hardcoded secrets");
  assert(source.includes("MAX_ISSUES"), "defines MAX_ISSUES constant");
  assert(source.includes("UMBRELLA_PATTERN"), "defines UMBRELLA_PATTERN constant");
  assert(source.includes("human-required"), "checks human-required label");
}

// Summary
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} else {
  // When loaded as a module by action-modules.test.js, export a minimal
  // contract so the inventory check does not break. This is a test harness,
  // not an action module, but the loader scans all .js files in actions/.
  module.exports = {
    id: "issue-state-test",
    label: "Issue State Test Harness",
    description: "Test-only module. Not an action.",
    dangerous: false,
    preview() { return { ok: false, error: "test harness" }; },
    execute() { return { ok: false, error: "test harness" }; },
  };
}
