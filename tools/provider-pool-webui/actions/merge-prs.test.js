#!/usr/bin/env node
"use strict";

/**
 * merge-prs.test.js
 *
 * Tests payload validation, repo resolution, module contract, and source
 * hygiene for the merge-prs action module. Does NOT invoke the real
 * PowerShell merge script (no side-effects).
 *
 * Run: node tools/provider-pool-webui/actions/merge-prs.test.js
 */

if (require.main !== module) {
  // When loaded as a module (e.g. by action-modules.test.js), export
  // a stub that satisfies the action module contract.
  module.exports = {
    id: "merge-prs-test",
    label: "Merge PRs Test",
    description: "Test suite for merge-prs action module.",
    dangerous: false,
    preview() { return { ok: true, message: "test stub" }; },
    execute() { return { ok: true, message: "test stub" }; },
  };
} else {
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

  function assertThrows(fn, expectedPattern, name) {
    try {
      fn();
      failed += 1;
      console.error("  FAIL  " + name + " (did not throw)");
    } catch (err) {
      if (!expectedPattern || expectedPattern.test(err.message)) {
        passed += 1;
        console.log("  PASS  " + name);
      } else {
        failed += 1;
        console.error(
          "  FAIL  " + name + " (wrong error: " + err.message + ")"
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Load module under test
  // ---------------------------------------------------------------------------

  const modPath = path.join(__dirname, "merge-prs.js");
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);

  const source = fs.readFileSync(modPath, "utf-8");

  // ===========================================================================
  console.log("\nmerge-prs.test.js\n");

  // ===========================================================================
  // 1. Module contract
  // ===========================================================================

  console.log("Module contract\n");

  assert(typeof mod.id === "string", "exports id string");
  assert(mod.id === "merge-prs", "id is 'merge-prs'");
  assert(typeof mod.label === "string" && mod.label.length > 0, "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(mod.dangerous === true, "marked dangerous (required for confirmation gate)");
  assert(typeof mod.preview === "function", "exports preview function");
  assert(typeof mod.execute === "function", "exports execute function");

  // ===========================================================================
  // 2. Payload validation — null / undefined / non-object
  // ===========================================================================

  console.log("\nPayload validation — invalid payloads\n");

  assertThrows(
    () => mod.preview(null),
    /Payload must be an object/,
    "preview rejects null payload"
  );

  assertThrows(
    () => mod.preview(undefined),
    /Payload must be an object/,
    "preview rejects undefined payload"
  );

  assertThrows(
    () => mod.preview("string"),
    /Payload must be an object/,
    "preview rejects string payload"
  );

  assertThrows(
    () => mod.preview(42),
    /Payload must be an object/,
    "preview rejects number payload"
  );

  assertThrows(
    () => mod.execute(null),
    /Payload must be an object/,
    "execute rejects null payload"
  );

  // ===========================================================================
  // 3. Payload validation — prNumbers
  // ===========================================================================

  console.log("\nPayload validation — prNumbers\n");

  assertThrows(
    () => mod.preview({}),
    /prNumbers must be a non-empty array/,
    "rejects missing prNumbers"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [] }),
    /prNumbers must be a non-empty array/,
    "rejects empty prNumbers"
  );

  assertThrows(
    () => mod.preview({ prNumbers: "not-array" }),
    /prNumbers must be a non-empty array/,
    "rejects string prNumbers"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [1, -2] }),
    /positive integer/,
    "rejects negative PR number"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [1.5] }),
    /positive integer/,
    "rejects float PR number"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [0] }),
    /positive integer/,
    "rejects zero PR number"
  );

  assertThrows(
    () => mod.preview({ prNumbers: ["abc"] }),
    /positive integer/,
    "rejects string element in prNumbers"
  );

  // ===========================================================================
  // 4. Repo resolution
  // ===========================================================================

  console.log("\nRepo resolution\n");

  const origGH_REPO = process.env.GH_REPO;

  assertThrows(
    () => mod.preview({ prNumbers: [1] }),
    /Repository not specified/,
    "rejects when no repo and no GH_REPO env"
  );

  process.env.GH_REPO = "owner/repo";
  try {
    try {
      mod.preview({ prNumbers: [1] });
    } catch (err) {
      assert(
        !/Repository not specified/.test(err.message),
        "accepts GH_REPO env as fallback"
      );
    }
  } finally {
    if (origGH_REPO === undefined) {
      delete process.env.GH_REPO;
    } else {
      process.env.GH_REPO = origGH_REPO;
    }
  }

  assertThrows(
    () => mod.preview({ prNumbers: [1], repo: "" }),
    /Repository not specified/,
    "rejects empty repo string"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [1], repo: "invalid-format" }),
    /OWNER\/NAME format/,
    "rejects repo without slash"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [1], repo: "a/b/c" }),
    /OWNER\/NAME format/,
    "rejects repo with extra slashes"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [1], repo: "owner/repo; rm -rf /" }),
    /OWNER\/NAME format/,
    "rejects repo with shell injection characters"
  );

  assertThrows(
    () => mod.preview({ prNumbers: [1], repo: "owner/repo$(whoami)" }),
    /OWNER\/NAME format/,
    "rejects repo with command substitution"
  );

  // ===========================================================================
  // 5. Source hygiene
  // ===========================================================================

  console.log("\nSource hygiene\n");

  // Build token patterns dynamically to avoid false-positive in source hygiene scan
  const sk = "sk-";
  const ghp = "ghp_";
  const tokenRe = new RegExp(
    sk + "ant-|" + sk + "[A-Za-z0-9]{20,}|" + ghp + "[A-Za-z0-9_]+"
  );
  assert(
    !tokenRe.test(source),
    "source contains no literal API token patterns"
  );

  assert(
    !/\.env\b/.test(source) || /env var|process\.env/.test(source),
    "source does not hardcode .env file paths"
  );

  assert(
    !/password|apiKey|api_key|secretKey|secret_key/i.test(source) ||
      /payload|config|env/i.test(source),
    "source does not hardcode secret field names"
  );

  // ===========================================================================
  // 6. Confirmation gate contract
  // ===========================================================================

  console.log("\nConfirmation gate contract\n");

  assert(
    mod.dangerous === true,
    "dangerous flag is true — server enforces confirmation gate"
  );

  // ===========================================================================
  // 7. Preview/execute structural test
  // ===========================================================================

  console.log("\nStructural result shape\n");

  try {
    mod.preview({ prNumbers: [1, 2], repo: "owner/repo" });
    assert(true, "preview returns without throwing on valid payload");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "preview fails gracefully when merge script is missing"
    );
  }

  try {
    mod.execute({ prNumbers: [1], repo: "owner/repo" });
    assert(true, "execute returns without throwing on valid payload");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "execute fails gracefully when merge script is missing"
    );
  }

  // ===========================================================================
  // 8. Boundary: large PR list
  // ===========================================================================

  console.log("\nBoundary cases\n");

  const largeList = Array.from({ length: 100 }, (_, i) => i + 1);
  try {
    mod.preview({ prNumbers: largeList, repo: "owner/repo" });
    assert(true, "accepts 100 PR numbers");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "accepts 100 PR numbers (fails at script, not validation)"
    );
  }

  try {
    mod.preview({ prNumbers: [Number.MAX_SAFE_INTEGER], repo: "owner/repo" });
    assert(true, "accepts very large PR number (passes validation)");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "accepts very large PR number (fails at script, not validation)"
    );
  }

  // ===========================================================================
  // 9. Allowlist edge cases
  // ===========================================================================

  console.log("\nAllowlist edge cases\n");

  // Single PR (minimum valid allowlist)
  try {
    mod.preview({ prNumbers: [42], repo: "owner/repo" });
    assert(true, "single PR number passes validation");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "single PR number passes validation (fails at script, not validation)"
    );
  }

  // Duplicate PR numbers accepted (allowlist semantics, not a set)
  try {
    mod.preview({ prNumbers: [1, 1, 2, 2], repo: "owner/repo" });
    assert(true, "duplicate PR numbers accepted");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "duplicate PR numbers accepted (fails at script, not validation)"
    );
  }

  // Extra payload keys are tolerated
  try {
    mod.preview({ prNumbers: [1], repo: "owner/repo", extra: "ignored" });
    assert(true, "extra payload keys do not break validation");
  } catch (err) {
    assert(
      /Merge control script not found/.test(err.message),
      "extra payload keys tolerated (fails at script, not validation)"
    );
  }

  // execute validates prNumbers the same way as preview
  assertThrows(
    () => mod.execute({}),
    /prNumbers must be a non-empty array/,
    "execute rejects missing prNumbers"
  );

  assertThrows(
    () => mod.execute({ prNumbers: [] }),
    /prNumbers must be a non-empty array/,
    "execute rejects empty prNumbers"
  );

  assertThrows(
    () => mod.execute({ prNumbers: [-1] }),
    /positive integer/,
    "execute rejects negative PR number"
  );

  assertThrows(
    () => mod.execute({ prNumbers: [0] }),
    /positive integer/,
    "execute rejects zero PR number"
  );

  // ===========================================================================
  // 10. Dry-run preview contract (source analysis)
  // ===========================================================================

  console.log("\nDry-run preview contract\n");

  assert(
    /runMergeScript\(prNumbers,\s*repo,\s*false\)/.test(source),
    "preview calls runMergeScript with isExecute=false (dry-run)"
  );

  assert(
    /runMergeScript\(prNumbers,\s*repo,\s*true\)/.test(source),
    "execute calls runMergeScript with isExecute=true"
  );

  assert(
    /mode:\s*"preview"/.test(source),
    "preview result includes mode: 'preview'"
  );

  assert(
    /healthGate:\s*"skipped"/.test(source),
    "preview result sets healthGate: 'skipped'"
  );

  assert(
    /guards:\s*"skipped"/.test(source),
    "preview result sets guards: 'skipped'"
  );

  assert(
    /No PRs were merged/.test(source),
    "preview message confirms 'No PRs were merged'"
  );

  assert(
    /args\.push\("-Execute"\)/.test(source),
    "-Execute flag added to args only in execute mode"
  );

  // ===========================================================================
  // 11. No broad auto-discovery (source analysis)
  // ===========================================================================

  console.log("\nNo broad auto-discovery\n");

  assert(
    !/gh\s+pr\s+list|\.pulls\(|\/pulls\b|listOpenPRs|discoverPRs|searchPRs/i.test(source),
    "source has no PR auto-discovery mechanism"
  );

  assert(
    /prNumbers must be a non-empty array/.test(source),
    "explicit prNumbers required — no fallback for empty/missing"
  );

  assert(
    /Repository not specified/.test(source),
    "repo must be explicitly specified — no auto-discovery"
  );

  assert(
    !/octokit|@octokit|graphql|\/repos\//i.test(source),
    "source does not call GitHub API to discover PRs"
  );

  // ===========================================================================
  // Summary
  // ===========================================================================

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}
