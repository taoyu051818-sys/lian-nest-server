#!/usr/bin/env node

/**
 * action-modules.test.js
 *
 * Tests for action modules in tools/provider-pool-webui/actions/.
 * Validates module contract, preview logic, and execute behavior.
 * No real GitHub mutations — uses mock executor for execute tests.
 *
 * Run: node tools/provider-pool-webui/action-modules.test.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ACTIONS_DIR = path.join(__dirname, "actions");
const createIssues = require("./actions/create-issues");

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

console.log("\naction module contract tests\n");

{
  assert(typeof createIssues.id === "string", "create-issues has string id");
  assert(createIssues.id === "create-issues", "create-issues id is correct");
  assert(typeof createIssues.label === "string", "create-issues has string label");
  assert(createIssues.label === "Create Issues", "create-issues label is correct");
  assert(typeof createIssues.description === "string", "create-issues has description");
  assert(createIssues.description.length > 0, "create-issues description is non-empty");
  assert(createIssues.dangerous === true, "create-issues is dangerous");
  assert(typeof createIssues.preview === "function", "create-issues has preview function");
  assert(typeof createIssues.execute === "function", "create-issues has execute function");
}

// --- Server loadability ------------------------------------------------------

console.log("\nserver loadability tests\n");

{
  const files = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".js"));
  assert(files.includes("create-issues.js"), "create-issues.js exists in actions dir");
  for (const file of files) {
    const mod = require(path.join(ACTIONS_DIR, file));
    assert(typeof mod.id === "string", file + " has string id");
    assert(typeof mod.label === "string", file + " has string label");
    assert(typeof mod.execute === "function", file + " has execute function");
  }
}

// --- Preview: empty/null payload ---------------------------------------------

console.log("\npreview: empty/null payload tests\n");

(async () => {
  {
    const result = createIssues.preview(null);
    assert(result.ok === true, "null payload returns ok");
    assert(result.proposals.length === 0, "null payload returns empty proposals");
    assert(result.summary.total === 0, "null payload summary total is 0");
  }

  {
    const result = createIssues.preview({});
    assert(result.ok === true, "empty payload returns ok");
    assert(result.proposals.length === 0, "empty payload returns empty proposals");
  }

  {
    const result = createIssues.preview({ gaps: [] });
    assert(result.ok === true, "empty gaps array returns ok");
    assert(result.proposals.length === 0, "empty gaps returns empty proposals");
  }

  // --- Preview: valid single gap ----------------------------------------------

  console.log("\npreview: valid single gap tests\n");

  {
    const result = createIssues.preview({
      gaps: [
        {
          title: "Add parity test for auth module",
          gapKey: "missing-parity-test-auth",
          goal: "Ensure auth module has parity coverage",
          scope: "Add test file for auth module",
          priority: "high",
          risk: "low",
          conflictGroup: "parity-tests",
          allowedFiles: ["src/auth/**", "tests/auth/**"],
          sliceRef: "auth-v1",
        },
      ],
      labels: ["type:test", "priority:high"],
    });
    assert(result.ok === true, "valid gap returns ok");
    assert(result.proposals.length === 1, "valid gap produces 1 proposal");
    assert(
      result.proposals[0].title === "Add parity test for auth module",
      "proposal title matches"
    );
    assert(
      result.proposals[0].gapKey === "missing-parity-test-auth",
      "proposal gapKey matches"
    );
    assert(result.proposals[0].priority === "high", "proposal priority matches");
    assert(result.proposals[0].risk === "low", "proposal risk matches");
    assert(
      result.proposals[0].conflictGroup === "parity-tests",
      "proposal conflictGroup matches"
    );
    assert(
      result.proposals[0].sliceRef === "auth-v1",
      "proposal sliceRef matches"
    );
    assert(
      result.proposals[0].labels.includes("type:test"),
      "proposal labels include type:test"
    );
    assert(
      result.proposals[0].labels.includes("priority:high"),
      "proposal labels include priority:high"
    );
    assert(
      result.proposals[0].body.includes("## Goal"),
      "body includes Goal section"
    );
    assert(
      result.proposals[0].body.includes("## Scope"),
      "body includes Scope section"
    );
    assert(
      result.proposals[0].body.includes("## CONTROL APPENDIX"),
      "body includes CONTROL APPENDIX"
    );
    assert(
      result.proposals[0].body.includes("Gap key: missing-parity-test-auth"),
      "body includes gapKey"
    );
    assert(
      result.proposals[0].body.includes("Risk: low"),
      "body includes risk"
    );
    assert(
      result.proposals[0].body.includes("Conflict group: parity-tests"),
      "body includes conflictGroup"
    );
    assert(
      result.proposals[0].body.includes("- src/auth/**"),
      "body includes custom allowed file"
    );
    assert(
      result.proposals[0].body.includes("- tests/auth/**"),
      "body includes second custom allowed file"
    );
    assert(
      result.proposals[0].body.includes("Slice: auth-v1"),
      "body includes sliceRef line"
    );
    assert(
      result.proposals[0].body.includes("Mode: dry-run"),
      "body includes Mode: dry-run"
    );
    assert(
      result.proposals[0].body.includes("Ensure auth module has parity coverage"),
      "body includes custom goal"
    );
    assert(
      result.proposals[0].body.includes("Add test file for auth module"),
      "body includes custom scope"
    );
    assert(result.summary.total === 1, "summary total is 1");
    assert(result.summary.valid === 1, "summary valid is 1");
    assert(result.summary.proposed === 1, "summary proposed is 1");
  }

  // --- Preview: defaults for minimal gap --------------------------------------

  console.log("\npreview: default field tests\n");

  {
    const result = createIssues.preview({
      gaps: [{ title: "Minimal gap", gapKey: "minimal-gap" }],
    });
    assert(result.ok === true, "minimal gap returns ok");
    assert(result.proposals.length === 1, "minimal gap produces 1 proposal");
    assert(result.proposals[0].priority === "medium", "default priority is medium");
    assert(result.proposals[0].risk === "medium", "default risk is medium");
    assert(
      result.proposals[0].conflictGroup === "gap-fill",
      "default conflictGroup is gap-fill"
    );
    assert(
      result.proposals[0].allowedFiles[0] === "docs/**",
      "default allowedFiles is docs/**"
    );
    assert(result.proposals[0].sliceRef === null, "default sliceRef is null");
    assert(
      result.proposals[0].body.includes("Address gap: Minimal gap"),
      "default goal uses title"
    );
    assert(
      result.proposals[0].body.includes("Auto-generated from gap analysis"),
      "default scope is auto-generated"
    );
    assert(
      !result.proposals[0].body.includes("Slice:"),
      "no Slice line when sliceRef is null"
    );
  }

  // --- Preview: multiple gaps with priority ordering --------------------------

  console.log("\npreview: priority ordering tests\n");

  {
    const result = createIssues.preview({
      gaps: [
        { title: "Low priority", gapKey: "gap-low", priority: "low" },
        { title: "Critical priority", gapKey: "gap-critical", priority: "critical" },
        { title: "Medium priority", gapKey: "gap-medium", priority: "medium" },
        { title: "High priority", gapKey: "gap-high", priority: "high" },
      ],
    });
    assert(result.ok === true, "multi-gap returns ok");
    assert(result.proposals.length === 4, "multi-gap produces 4 proposals");
    assert(
      result.proposals[0].priority === "critical",
      "first proposal is critical"
    );
    assert(result.proposals[1].priority === "high", "second proposal is high");
    assert(
      result.proposals[2].priority === "medium",
      "third proposal is medium"
    );
    assert(result.proposals[3].priority === "low", "fourth proposal is low");
    assert(
      result.proposals[0].title === "Critical priority",
      "first title is critical priority"
    );
  }

  // --- Preview: validation errors (missing fields) ----------------------------

  console.log("\npreview: validation error tests\n");

  {
    const result = createIssues.preview({
      gaps: [{ gapKey: "no-title" }],
    });
    assert(result.ok === false, "missing title returns not ok");
    assert(
      result.validationErrors.length === 1,
      "missing title produces 1 validation error"
    );
    assert(
      result.validationErrors[0].includes("missing title"),
      "error mentions missing title"
    );
  }

  {
    const result = createIssues.preview({
      gaps: [{ title: "No key" }],
    });
    assert(result.ok === false, "missing gapKey returns not ok");
    assert(
      result.validationErrors[0].includes("missing gapKey"),
      "error mentions missing gapKey"
    );
  }

  {
    const result = createIssues.preview({
      gaps: ["not-an-object"],
    });
    assert(result.ok === false, "non-object gap returns not ok");
    assert(
      result.validationErrors[0].includes("not an object"),
      "error mentions not an object"
    );
  }

  {
    const result = createIssues.preview({
      gaps: [null, { title: "Valid", gapKey: "valid" }],
    });
    assert(result.ok === true, "null gap + valid gap returns ok");
    assert(result.proposals.length === 1, "only valid gap included");
    assert(result.validationErrors.length === 1, "null gap produces error");
  }

  // --- Preview: deduplication against existing issues -------------------------

  console.log("\npreview: deduplication tests\n");

  {
    // The test environment likely has no gh CLI or no open issues,
    // so listOpenIssues returns []. Dedup should pass all gaps through.
    const result = createIssues.preview({
      gaps: [
        { title: "Issue A", gapKey: "gap-a" },
        { title: "Issue B", gapKey: "gap-b" },
      ],
    });
    assert(result.ok === true, "dedup with no existing issues returns ok");
    assert(result.proposals.length === 2, "both proposals pass when no existing issues");
    assert(result.summary.duplicatesSkipped === 0, "no duplicates skipped");
  }

  // --- Preview: CONTROL APPENDIX body structure -------------------------------

  console.log("\npreview: CONTROL APPENDIX structure tests\n");

  {
    const result = createIssues.preview({
      gaps: [
        {
          title: "Full body test",
          gapKey: "full-body-test",
          goal: "Test full body generation",
          scope: "Verify all CONTROL APPENDIX fields",
          priority: "critical",
          risk: "high",
          conflictGroup: "test-group",
          allowedFiles: ["src/a.ts", "src/b.ts", "tests/c.ts"],
          sliceRef: "slice-v2",
        },
      ],
    });
    const body = result.proposals[0].body;
    assert(body.includes("## Goal\nTest full body generation"), "Goal section is correct");
    assert(body.includes("## Scope\nVerify all CONTROL APPENDIX fields"), "Scope section is correct");
    assert(body.includes("## CONTROL APPENDIX"), "has CONTROL APPENDIX header");
    assert(body.includes("Task type: execution"), "has task type");
    assert(body.includes("Risk: high"), "has risk field");
    assert(body.includes("Conflict group: test-group"), "has conflict group");
    assert(body.includes("- src/a.ts"), "has first allowed file");
    assert(body.includes("- src/b.ts"), "has second allowed file");
    assert(body.includes("- tests/c.ts"), "has third allowed file");
    assert(body.includes("- npm run check"), "has npm run check validation");
    assert(body.includes("- npm run build"), "has npm run build validation");
    assert(body.includes("Slice: slice-v2"), "has slice line");
    assert(body.includes("Mode: dry-run"), "has Mode: dry-run");
    assert(body.includes("Gap key: full-body-test"), "has gap key line");
  }

  // --- Preview: no labels -----------------------------------------------------

  console.log("\npreview: no labels tests\n");

  {
    const result = createIssues.preview({
      gaps: [{ title: "No labels", gapKey: "no-labels" }],
    });
    assert(result.ok === true, "no labels returns ok");
    assert(
      Array.isArray(result.proposals[0].labels),
      "labels defaults to array"
    );
    assert(result.proposals[0].labels.length === 0, "empty labels when none provided");
  }

  // --- Execute: dry-run mode --------------------------------------------------

  console.log("\nexecute: dry-run mode tests\n");

  {
    const result = createIssues.execute({
      proposals: [
        { title: "Test", gapKey: "test", labels: ["type:test"] },
      ],
    });
    assert(result.ok === true, "execute default dry-run returns ok");
    assert(result.dryRun === true, "dryRun is true by default");
    assert(result.created.length === 0, "nothing created in dry-run");
    assert(
      result.wouldCreate.length === 1,
      "wouldCreate shows 1 proposal in dry-run"
    );
    assert(
      result.wouldCreate[0].title === "Test",
      "wouldCreate title matches"
    );
    assert(
      result.wouldCreate[0].gapKey === "test",
      "wouldCreate gapKey matches"
    );
    assert(result.summary.mode === "dry-run", "summary mode is dry-run");
  }

  {
    const result = createIssues.execute({
      proposals: [],
    });
    assert(result.ok === true, "execute empty proposals returns ok");
    assert(result.summary.total === 0, "empty proposals summary total is 0");
  }

  // --- Execute: real mutation with mock executor ------------------------------

  console.log("\nexecute: real mutation (mock gh) tests\n");

  {
    let cmdCalled = null;
    let bodyPassed = null;
    const mockExec = (cmd, body) => {
      cmdCalled = cmd;
      bodyPassed = body;
      return "https://github.com/test/repo/issues/42\n";
    };
    const result = createIssues.execute(
      {
        proposals: [
          {
            title: "Create this issue",
            gapKey: "mock-test",
            body: "## Goal\nTest goal\n\n## CONTROL APPENDIX\nGap key: mock-test",
            labels: ["type:feature"],
          },
        ],
        dryRun: false,
      },
      { execCommand: mockExec }
    );
    assert(result.ok === true, "mock execute returns ok");
    assert(result.dryRun === false, "dryRun is false");
    assert(result.created.length === 1, "1 issue created");
    assert(
      result.created[0].title === "Create this issue",
      "created issue title matches"
    );
    assert(
      result.created[0].gapKey === "mock-test",
      "created issue gapKey matches"
    );
    assert(
      result.created[0].issueNumber === "42",
      "created issue number parsed"
    );
    assert(
      cmdCalled.includes("gh issue create"),
      "gh issue create command called"
    );
    assert(
      cmdCalled.includes("--label=type:feature"),
      "label flag passed"
    );
    assert(bodyPassed.includes("## Goal"), "body passed to executor");
    assert(result.summary.mode === "execute", "summary mode is execute");
    assert(result.summary.created === 1, "summary created is 1");
  }

  // --- Execute: multiple issues -----------------------------------------------

  console.log("\nexecute: multiple issues tests\n");

  {
    let callCount = 0;
    const mockExec = () => {
      callCount++;
      return "https://github.com/test/repo/issues/" + (100 + callCount) + "\n";
    };
    const result = createIssues.execute(
      {
        proposals: [
          { title: "First", gapKey: "g1", labels: [] },
          { title: "Second", gapKey: "g2", labels: ["type:bug"] },
          { title: "Third", gapKey: "g3", labels: [] },
        ],
        dryRun: false,
      },
      { execCommand: mockExec }
    );
    assert(result.ok === true, "multi-execute returns ok");
    assert(result.created.length === 3, "3 issues created");
    assert(callCount === 3, "executor called 3 times");
    assert(result.created[0].issueNumber === "101", "first issue number");
    assert(result.created[1].issueNumber === "102", "second issue number");
    assert(result.created[2].issueNumber === "103", "third issue number");
  }

  // --- Execute: failure during creation ----------------------------------------

  console.log("\nexecute: failure handling tests\n");

  {
    let callCount = 0;
    const mockExec = () => {
      callCount++;
      if (callCount === 2) throw new Error("gh API error");
      return "https://github.com/test/repo/issues/200\n";
    };
    const result = createIssues.execute(
      {
        proposals: [
          { title: "Will succeed", gapKey: "ok1", labels: [] },
          { title: "Will fail", gapKey: "fail1", labels: [] },
          { title: "Never reached", gapKey: "never", labels: [] },
        ],
        dryRun: false,
      },
      { execCommand: mockExec }
    );
    assert(result.ok === false, "failure returns not ok");
    assert(result.created.length === 1, "1 issue created before failure");
    assert(result.error.includes("Will fail"), "error mentions failing proposal");
    assert(result.error.includes("gh API error"), "error includes original message");
    assert(result.summary.created === 1, "summary created is 1");
    assert(result.summary.failed === 2, "summary failed is 2 (errored + never reached)");
  }

  // --- Execute: special characters in title -----------------------------------

  console.log("\nexecute: special characters tests\n");

  {
    let cmdCalled = null;
    const mockExec = (cmd, body) => {
      cmdCalled = cmd;
      return "https://github.com/test/repo/issues/300\n";
    };
    createIssues.execute(
      {
        proposals: [
          {
            title: 'Fix "quotes" and special chars',
            gapKey: "special-chars",
            labels: [],
          },
        ],
        dryRun: false,
      },
      { execCommand: mockExec }
    );
    assert(
      cmdCalled.includes("Fix \\\"quotes\\\""),
      "quotes escaped in command"
    );
  }

  // --- Execute: no labels -----------------------------------------------------

  console.log("\nexecute: no labels tests\n");

  {
    let cmdCalled = null;
    const mockExec = (cmd, body) => {
      cmdCalled = cmd;
      return "https://github.com/test/repo/issues/400\n";
    };
    createIssues.execute(
      {
        proposals: [{ title: "No labels", gapKey: "no-labels", labels: [] }],
        dryRun: false,
      },
      { execCommand: mockExec }
    );
    assert(
      !cmdCalled.includes("--label="),
      "no --label flag when labels empty"
    );
  }

  // --- Summary ----------------------------------------------------------------

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
})();
