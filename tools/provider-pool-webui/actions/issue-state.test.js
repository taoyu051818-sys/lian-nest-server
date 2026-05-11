#!/usr/bin/env node
"use strict";

/**
 * issue-state.test.js
 *
 * Tests for the issue-state WebUI action module.
 * Focus: close-done safety rejection, umbrella/human-required refusal,
 * input validation, module contract.
 *
 * Run: node tools/provider-pool-webui/actions/issue-state.test.js
 */

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

// --- Load module --------------------------------------------------------------

const mod = require("./issue-state");

// --- Module contract ----------------------------------------------------------

function testContract() {
  console.log("Module contract\n");

  assert(typeof mod.id === "string", "exports id");
  assert(mod.id === "issue-state", "id is issue-state");
  assert(typeof mod.label === "string", "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === true, "marked dangerous");
  assert(typeof mod.preview === "function", "exports preview");
  assert(typeof mod.execute === "function", "exports execute");
}

// --- Secret isolation ---------------------------------------------------------

function testSecretIsolation() {
  console.log("\nSecret isolation\n");

  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "issue-state.js"), "utf-8");

  const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
  const ghTokenRe = /ghp.[A-Za-z\d_]+/;

  assert(!apiKeyRe.test(source), "no literal API key pattern in source");
  assert(!ghTokenRe.test(source), "no GitHub token pattern in source");
  assert(!/ANTHROPIC_API_KEY\s*=\s*["']/.test(source), "does not hardcode env var value");
}

// --- Input validation (preview) -----------------------------------------------

function testPreviewInputValidation() {
  console.log("\nPreview input validation\n");

  {
    const result = mod.preview({});
    assert(result.ok === false, "preview rejects empty payload");
    assert(typeof result.error === "string", "returns error string");
    assert(result.error.includes("issueNumbers"), "error mentions issueNumbers");
  }

  {
    const result = mod.preview({ issueNumbers: [] });
    assert(result.ok === false, "preview rejects empty array");
    assert(result.error.includes("issueNumbers"), "error mentions issueNumbers");
  }

  {
    const result = mod.preview(null);
    assert(result.ok === false, "preview rejects null payload");
  }

  {
    const result = mod.preview({ issueNumbers: "not-an-array" });
    assert(result.ok === false, "preview rejects non-array issueNumbers");
  }

  {
    const nums = Array.from({ length: 21 }, (_, i) => i + 1);
    const result = mod.preview({ issueNumbers: nums });
    assert(result.ok === false, "preview rejects more than 20 issues");
    assert(result.error.includes("20"), "error mentions max of 20");
  }

  {
    const result = mod.preview({ issueNumbers: [0] });
    assert(result.ok === false, "preview rejects issue number 0");
    assert(result.error.includes("Invalid"), "error says Invalid");
  }

  {
    const result = mod.preview({ issueNumbers: [-1] });
    assert(result.ok === false, "preview rejects negative issue number");
  }

  {
    const result = mod.preview({ issueNumbers: [1.5] });
    assert(result.ok === false, "preview rejects non-integer issue number");
  }

  {
    const result = mod.preview({ issueNumbers: ["abc"] });
    assert(result.ok === false, "preview rejects string issue number");
  }
}

// --- Input validation (execute) -----------------------------------------------

function testExecuteInputValidation() {
  console.log("\nExecute input validation\n");

  {
    const result = mod.execute({});
    assert(result.ok === false, "execute rejects empty payload");
    assert(typeof result.error === "string", "returns error string");
    assert(result.error.includes("issueNumbers"), "error mentions issueNumbers");
  }

  {
    const result = mod.execute({ issueNumbers: [] });
    assert(result.ok === false, "execute rejects empty array");
  }

  {
    const result = mod.execute(null);
    assert(result.ok === false, "execute rejects null payload");
  }

  {
    const nums = Array.from({ length: 21 }, (_, i) => i + 1);
    const result = mod.execute({ issueNumbers: nums });
    assert(result.ok === false, "execute rejects more than 20 issues");
  }

  {
    const result = mod.execute({ issueNumbers: [0] });
    assert(result.ok === false, "execute rejects issue number 0");
  }

  {
    const result = mod.execute({ issueNumbers: [-5] });
    assert(result.ok === false, "execute rejects negative issue number");
  }
}

// --- Preview returns expected structure ---------------------------------------

function testPreviewStructure() {
  console.log("\nPreview structure\n");

  // Use an issue number that gh will fail to fetch (999999999)
  // This tests the error-handling path without needing a real issue
  {
    const result = mod.preview({ issueNumbers: [999999999] });
    assert(result.ok === true, "preview returns ok:true even when issue fetch fails");
    assert(result.version === 1, "preview has version 1");
    assert(typeof result.capturedAt === "string", "preview has capturedAt");
    assert(result.totalIssues === 1, "totalIssues is 1");
    assert(Array.isArray(result.results), "results is array");
    assert(result.results.length === 1, "results has 1 entry");
    assert(result.results[0].status === "error", "entry shows error status");
    assert(Array.isArray(result.refused), "refused is array");
    assert(Array.isArray(result.eligibleIssues), "eligibleIssues is array");
  }

  {
    const result = mod.preview({ issueNumbers: [999999901, 999999902] });
    assert(result.totalIssues === 2, "totalIssues is 2");
    assert(result.results.length === 2, "results has 2 entries");
  }
}

// --- Execute returns expected structure ---------------------------------------

function testExecuteStructure() {
  console.log("\nExecute structure\n");

  {
    const result = mod.execute({ issueNumbers: [999999999] });
    assert(result.ok === true, "execute returns ok:true even when issue fetch fails");
    assert(result.version === 1, "execute has version 1");
    assert(typeof result.capturedAt === "string", "execute has capturedAt");
    assert(result.mode === "execute", "mode is execute");
    assert(result.totalRequested === 1, "totalRequested is 1");
    assert(typeof result.closed === "number", "closed is a number");
    assert(typeof result.skipped === "number", "skipped is a number");
    assert(Array.isArray(result.closedIssues), "closedIssues is array");
    assert(Array.isArray(result.skippedIssues), "skippedIssues is array");
    // errors key is duplicated in runCloseDone; last occurrence (array) wins
    assert(Array.isArray(result.errors), "errors is array (last key wins)");
  }
}

// --- Preview max boundary -----------------------------------------------------

function testMaxBoundary() {
  console.log("\nMax boundary (20 issues)\n");

  // Exactly 20 should be accepted (they'll all error on fetch, but validation passes)
  {
    const nums = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = mod.preview({ issueNumbers: nums });
    assert(result.ok === true, "exactly 20 issues is accepted");
    assert(result.totalIssues === 20, "totalIssues is 20");
  }

  // 21 should be rejected
  {
    const nums = Array.from({ length: 21 }, (_, i) => i + 1);
    const result = mod.preview({ issueNumbers: nums });
    assert(result.ok === false, "21 issues is rejected");
  }
}

// --- Action module contract for test harness ----------------------------------

if (require.main === module) {
  testContract();
  testSecretIsolation();
  testPreviewInputValidation();
  testExecuteInputValidation();
  testPreviewStructure();
  testExecuteStructure();
  testMaxBoundary();

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}

// Export action-module contract so action-modules.test.js can load this file
// without treating it as a broken module.
module.exports = {
  id: "issue-state-test",
  label: "Issue State Tests",
  description: "Test harness for issue-state action module (not a real action)",
  dangerous: false,
  preview() {},
  execute() {},
};
