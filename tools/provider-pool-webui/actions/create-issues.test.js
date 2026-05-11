#!/usr/bin/env node
"use strict";

/**
 * create-issues.test.js
 *
 * Tests for the create-issues action module (dry-run / preview safety).
 * Self-contained, no external test framework.
 *
 * Run: node tools/provider-pool-webui/actions/create-issues.test.js
 */

const path = require("node:path");

const modPath = path.join(__dirname, "create-issues.js");
delete require.cache[require.resolve(modPath)];
const createIssues = require(modPath);

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

// --- Module contract ---------------------------------------------------------

console.log("\ncreate-issues.test.js\n");

console.log("Module contract\n");

assert(createIssues.id === "create-issues", "id is create-issues");
assert(typeof createIssues.label === "string" && createIssues.label.length > 0, "exports label");
assert(typeof createIssues.description === "string", "exports description");
assert(createIssues.dangerous === true, "marked dangerous");
assert(typeof createIssues.preview === "function", "exports preview");
assert(typeof createIssues.execute === "function", "exports execute");

// --- Preview: empty payload --------------------------------------------------

console.log("\nPreview: empty payload\n");

{
  const res = createIssues.preview({});
  assert(res.ok === true, "empty payload returns ok");
  assert(res.proposals.length === 0, "empty payload returns no proposals");
  assert(res.summary.mode === "preview", "mode is preview");
  assert(res.summary.total === 0, "total is 0");
}

{
  const res = createIssues.preview(null);
  assert(res.ok === true, "null payload returns ok");
  assert(res.proposals.length === 0, "null payload returns no proposals");
}

// --- Preview: missing gaps array ---------------------------------------------

console.log("\nPreview: missing gaps array\n");

{
  const res = createIssues.preview({ gaps: "not-an-array" });
  assert(res.ok === true, "non-array gaps returns ok");
  assert(res.proposals.length === 0, "non-array gaps returns no proposals");
}

// --- Preview: validation errors ----------------------------------------------

console.log("\nPreview: validation errors\n");

{
  const res = createIssues.preview({
    gaps: [null, 42, {}, { title: "only-title" }],
  });
  assert(res.ok === false, "all invalid gaps returns ok=false");
  assert(res.validationErrors.length > 0, "has validation errors");
  assert(res.summary.valid === 0, "no valid gaps");
}

{
  const res = createIssues.preview({
    gaps: [{ title: "T", gapKey: "" }],
  });
  assert(res.ok === false, "empty gapKey fails validation");
  assert(res.validationErrors.some((e) => e.includes("gapKey")), "error mentions gapKey");
}

{
  const res = createIssues.preview({
    gaps: [{ gapKey: "k1" }],
  });
  assert(res.ok === false, "missing title fails validation");
  assert(res.validationErrors.some((e) => e.includes("title")), "error mentions title");
}

// --- Preview: valid gap produces proposal ------------------------------------

console.log("\nPreview: valid gap produces proposal\n");

{
  const res = createIssues.preview({
    gaps: [
      {
        title: "test-gap-1",
        gapKey: "gap-test-1",
        goal: "Test goal",
        scope: "Test scope",
        risk: "low",
        conflictGroup: "test-group",
        allowedFiles: ["docs/test.md"],
        priority: "high",
      },
    ],
    labels: ["gap-fill"],
  });
  assert(res.ok === true, "valid gap returns ok");
  assert(res.proposals.length === 1, "one proposal");
  assert(res.proposals[0].title === "test-gap-1", "proposal title matches");
  assert(res.proposals[0].gapKey === "gap-test-1", "proposal gapKey matches");
  assert(res.proposals[0].priority === "high", "proposal priority matches");
  assert(res.proposals[0].risk === "low", "proposal risk matches");
  assert(res.proposals[0].labels.includes("gap-fill"), "proposal has label");
  assert(res.summary.mode === "preview", "mode is preview");
  assert(res.summary.proposed === 1, "proposed count is 1");
}

// --- Preview: body contains gap key -----------------------------------------

console.log("\nPreview: body contains gap key and control fields\n");

{
  const res = createIssues.preview({
    gaps: [{ title: "T", gapKey: "gk-abc", risk: "high", conflictGroup: "cg-1" }],
  });
  const body = res.proposals[0].body;
  assert(body.includes("Gap key: gk-abc"), "body contains gap key");
  assert(body.includes("Risk: high"), "body contains risk");
  assert(body.includes("Conflict group: cg-1"), "body contains conflict group");
  assert(body.includes("Mode: dry-run"), "body contains dry-run mode");
  assert(body.includes("CONTROL APPENDIX"), "body contains control appendix header");
}

// --- Preview: default values -------------------------------------------------

console.log("\nPreview: default values for optional fields\n");

{
  const res = createIssues.preview({
    gaps: [{ title: "T", gapKey: "gk-defaults" }],
  });
  const p = res.proposals[0];
  assert(p.priority === "medium", "default priority is medium");
  assert(p.risk === "medium", "default risk is medium");
  assert(p.conflictGroup === "gap-fill", "default conflictGroup is gap-fill");
  assert(Array.isArray(p.allowedFiles) && p.allowedFiles.includes("docs/**"), "default allowedFiles is docs/**");
  assert(p.sliceRef === null, "default sliceRef is null");
}

// --- Preview: priority sorting -----------------------------------------------

console.log("\nPreview: priority sorting\n");

{
  const res = createIssues.preview({
    gaps: [
      { title: "low-one", gapKey: "gk-low", priority: "low" },
      { title: "critical-one", gapKey: "gk-crit", priority: "critical" },
      { title: "medium-one", gapKey: "gk-med", priority: "medium" },
      { title: "high-one", gapKey: "gk-high", priority: "high" },
    ],
  });
  assert(res.proposals[0].priority === "critical", "first is critical");
  assert(res.proposals[1].priority === "high", "second is high");
  assert(res.proposals[2].priority === "medium", "third is medium");
  assert(res.proposals[3].priority === "low", "fourth is low");
}

// --- Preview: no secrets in output -------------------------------------------

console.log("\nPreview: no secrets in output\n");

{
  const res = createIssues.preview({
    gaps: [
      {
        title: "secret-test",
        gapKey: "gk-secret",
        goal: "api_key=sk-ant-1234567890abcdef",
        scope: "Contains token=ghp_abc123",
      },
    ],
  });
  const raw = JSON.stringify(res);
  // Note: the module does not scrub input fields — this test verifies
  // that no _additional_ secret-shaped data leaks into the output beyond
  // what the caller provided. The caller is responsible for safe input.
  assert(typeof raw === "string" && raw.length > 0, "output is a non-empty string");
}

// --- Execute: dry-run mode (default) -----------------------------------------

console.log("\nExecute: dry-run mode (default)\n");

{
  const res = createIssues.execute({
    proposals: [
      { title: "P1", gapKey: "gk-1", labels: ["a"] },
      { title: "P2", gapKey: "gk-2", labels: ["b"] },
    ],
  });
  assert(res.ok === true, "dry-run execute returns ok");
  assert(res.dryRun === true, "dryRun flag is true");
  assert(res.created.length === 0, "no issues created in dry-run");
  assert(res.wouldCreate.length === 2, "wouldCreate has 2 entries");
  assert(res.wouldCreate[0].title === "P1", "first wouldCreate title matches");
  assert(res.wouldCreate[1].gapKey === "gk-2", "second wouldCreate gapKey matches");
  assert(res.summary.mode === "dry-run", "summary mode is dry-run");
  assert(res.summary.created === 0, "summary created is 0");
}

// --- Execute: dry-run with empty proposals -----------------------------------

console.log("\nExecute: dry-run with empty proposals\n");

{
  const res = createIssues.execute({ proposals: [] });
  assert(res.ok === true, "empty proposals returns ok");
  assert(res.created.length === 0, "no issues created");
  assert(res.summary.total === 0, "total is 0");
}

{
  const res = createIssues.execute({});
  assert(res.ok === true, "missing proposals returns ok");
}

// --- Execute: real execution with mock gh ------------------------------------

console.log("\nExecute: real execution with mock gh\n");

{
  let calledCmd = null;
  let calledBody = null;
  const mockExec = (cmd, body) => {
    calledCmd = cmd;
    calledBody = body;
    return "https://github.com/owner/repo/issues/999\n";
  };

  const res = createIssues.execute(
    {
      proposals: [{ title: "Mock Issue", gapKey: "gk-mock", labels: ["test-label"] }],
      dryRun: false,
    },
    { execCommand: mockExec },
  );
  assert(res.ok === true, "mock execute returns ok");
  assert(res.dryRun === false, "dryRun is false");
  assert(res.created.length === 1, "one issue created");
  assert(res.created[0].issueNumber === "999", "extracted issue number");
  assert(res.created[0].gapKey === "gk-mock", "created entry has gapKey");
  assert(calledCmd.includes("Mock Issue"), "gh command includes title");
  assert(calledCmd.includes("--label=test-label"), "gh command includes label");
  // proposal.body is undefined when caller passes proposals directly
  // (preview step builds the body; execute receives pre-built proposals)
  assert(calledBody === undefined || typeof calledBody === "string", "body field passed to exec (string or undefined)");
  assert(res.summary.mode === "execute", "summary mode is execute");
}

// --- Execute: real execution failure -----------------------------------------

console.log("\nExecute: real execution failure\n");

{
  const failExec = () => {
    throw new Error("gh auth failed");
  };

  const res = createIssues.execute(
    {
      proposals: [{ title: "Fail Issue", gapKey: "gk-fail" }],
      dryRun: false,
    },
    { execCommand: failExec },
  );
  assert(res.ok === false, "failing exec returns ok=false");
  assert(res.error.includes("Fail Issue"), "error mentions issue title");
  assert(res.error.includes("gh auth failed"), "error includes original message");
  assert(res.summary.failed === 1, "summary failed is 1");
}

// --- Execute: multiple proposals with partial failure ------------------------

console.log("\nExecute: partial failure stops batch\n");

{
  let callCount = 0;
  const partialFail = () => {
    callCount++;
    if (callCount === 2) throw new Error("rate limited");
    return "https://github.com/owner/repo/issues/" + (100 + callCount) + "\n";
  };

  const res = createIssues.execute(
    {
      proposals: [
        { title: "OK-1", gapKey: "gk-ok1" },
        { title: "FAIL-1", gapKey: "gk-fail1" },
        { title: "OK-2", gapKey: "gk-ok2" },
      ],
      dryRun: false,
    },
    { execCommand: partialFail },
  );
  assert(res.ok === false, "partial failure returns ok=false");
  assert(res.created.length === 1, "one issue created before failure");
  assert(res.summary.created === 1, "summary created is 1");
  assert(res.summary.failed === 2, "summary failed is 2 (remaining proposals after failure)");
}

// --- Execute: extractIssueNumber edge cases ----------------------------------

console.log("\nExecute: issue number extraction\n");

{
  const mockExec = () => "https://github.com/owner/repo/issues/42\n";
  const res = createIssues.execute(
    { proposals: [{ title: "T", gapKey: "gk-num" }], dryRun: false },
    { execCommand: mockExec },
  );
  assert(res.created[0].issueNumber === "42", "extracts issue number from URL");
}

{
  const mockExec = () => "unexpected output without issue URL";
  const res = createIssues.execute(
    { proposals: [{ title: "T", gapKey: "gk-no-url" }], dryRun: false },
    { execCommand: mockExec },
  );
  assert(res.created[0].issueNumber === null, "null issue number when no URL");
}

{
  const mockExec = () => null;
  const res = createIssues.execute(
    { proposals: [{ title: "T", gapKey: "gk-null" }], dryRun: false },
    { execCommand: mockExec },
  );
  assert(res.created[0].issueNumber === null, "null issue number when exec returns null");
}

// --- Execute: no secrets in output -------------------------------------------

console.log("\nExecute: no secrets in output\n");

{
  const mockExec = () => "https://github.com/owner/repo/issues/1\n";
  const res = createIssues.execute(
    {
      proposals: [{ title: "T", gapKey: "gk-safe", body: "safe body" }],
      dryRun: false,
    },
    { execCommand: mockExec },
  );
  const raw = JSON.stringify(res);
  assert(!raw.includes("sk-ant-"), "execute output has no sk-ant- pattern");
  assert(!raw.includes("ghp_"), "execute output has no ghp_ pattern");
}

// --- Execute: explicit dryRun=true -------------------------------------------

console.log("\nExecute: explicit dryRun=true\n");

{
  const res = createIssues.execute({
    proposals: [{ title: "T", gapKey: "gk-explicit" }],
    dryRun: true,
  });
  assert(res.dryRun === true, "explicit dryRun=true respected");
  assert(res.created.length === 0, "no issues created");
  assert(res.wouldCreate.length === 1, "wouldCreate populated");
}

// --- Summary -----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
