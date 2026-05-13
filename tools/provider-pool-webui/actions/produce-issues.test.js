#!/usr/bin/env node
"use strict";

/**
 * produce-issues.test.js
 *
 * Tests for the produce-issues WebUI action module.
 * Focus: module contract, preview with specs, validation, quality scoring,
 * CONTROL APPENDIX generation, sanitization, execute blocking.
 *
 * Run: node tools/provider-pool-webui/actions/produce-issues.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// --- require.main guard for action-modules.test.js ---------------------------

if (require.main !== module) {
  module.exports = {
    id: "produce-issues-test",
    label: "Produce Issues Tests",
    description: "Test suite for produce-issues (no-op when required as module)",
    dangerous: false,
    preview() { return { dryRun: true }; },
    execute() { return { ok: true }; },
  };
} else {

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

// Token detection regexes
const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
const ghTokenRe = /ghp.[A-Za-z\d_]+/;

// --- Fixtures ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "produce-issues-test-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function validSpec(overrides) {
  return {
    title: "feat: add example feature",
    goal: "Add example feature to improve DX",
    risk: "medium",
    conflictGroup: "wave-example",
    allowedFiles: ["src/example.ts", "src/example.test.ts"],
    forbiddenFiles: ["src/auth/**"],
    validationCommands: ["npm run check", "npm test"],
    evidence: ["Gap identified in code review", "Missing from current implementation"],
    acceptance: ["Feature works as described", "Tests pass"],
    constraints: ["No breaking changes"],
    scope: "Implement the example feature module",
    rollbackPlan: "Revert the PR",
    followUp: "Add integration tests in next sprint",
    ...overrides,
  };
}

// --- Main test runner --------------------------------------------------------

function run() {
  var mod = require("./produce-issues");

  console.log("\nproduce-issues.test.js\n");

  // --- Module contract ---------------------------------------------------------
  console.log("Module contract\n");

  assert(typeof mod.id === "string", "exports id");
  assert(mod.id === "produce-issues", "id is produce-issues");
  assert(typeof mod.label === "string", "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === false, "not dangerous");
  assert(typeof mod.preview === "function", "exports preview");
  assert(typeof mod.execute === "function", "exports execute");

  // --- Secret isolation --------------------------------------------------------
  console.log("\nSecret isolation\n");

  {
    var source = fs.readFileSync(path.join(__dirname, "produce-issues.js"), "utf-8");
    assert(!apiKeyRe.test(source), "no literal API key pattern");
    assert(!ghTokenRe.test(source), "no GitHub token pattern");
    assert(!/ANTHROPIC_API_KEY\s*=\s*["']/.test(source), "does not hardcode env var value");
  }

  // --- Preview: empty specs ---------------------------------------------------
  console.log("\nPreview: empty specs\n");

  {
    var res = mod.preview({});
    assert(res.ok === true, "preview ok with empty payload");
    assert(res.status === "empty", "status is empty");
    assert(res.proposals.length === 0, "no proposals");
    assert(res.summary.total === 0, "total is 0");
    assert(typeof res.message === "string", "message is string");
    assert(res.message.includes("No issue specifications"), "message explains empty");
    assert(typeof res.timestamp === "string", "timestamp present");
  }

  // --- Preview: null payload --------------------------------------------------
  console.log("\nPreview: null payload\n");

  {
    var res = mod.preview(null);
    assert(res.ok === true, "preview ok with null");
    assert(res.status === "empty", "status empty with null");
  }

  // --- Preview: valid inline specs --------------------------------------------
  console.log("\nPreview: valid inline specs\n");

  {
    var res = mod.preview({
      specs: [validSpec()],
      labels: ["ai-generated", "wave-1"],
    });
    assert(res.ok === true, "preview ok");
    assert(res.status === "preview", "status is preview");
    assert(res.dryRun === true, "dryRun is true");
    assert(res.proposals.length === 1, "1 proposal drafted");
    assert(res.summary.total === 1, "total is 1");
    assert(res.summary.valid === 1, "valid is 1");
    assert(res.summary.invalid === 0, "invalid is 0");
    assert(res.summary.avgQuality > 0, "avg quality > 0");
  }

  // --- Preview: proposal structure --------------------------------------------
  console.log("\nPreview: proposal structure\n");

  {
    var res = mod.preview({ specs: [validSpec()] });
    var proposal = res.proposals[0];
    assert(typeof proposal.title === "string", "proposal has title");
    assert(typeof proposal.body === "string", "proposal has body");
    assert(Array.isArray(proposal.labels), "proposal has labels");
    assert(typeof proposal.priority === "string", "proposal has priority");
    assert(typeof proposal.taskType === "string", "proposal has taskType");
    assert(typeof proposal.risk === "string", "proposal has risk");
    assert(typeof proposal.conflictGroup === "string", "proposal has conflictGroup");
    assert(Array.isArray(proposal.allowedFiles), "proposal has allowedFiles");
    assert(Array.isArray(proposal.forbiddenFiles), "proposal has forbiddenFiles");
    assert(Array.isArray(proposal.validationCommands), "proposal has validationCommands");
    assert(typeof proposal.hasEvidence === "boolean", "proposal has hasEvidence");
    assert(typeof proposal.hasAcceptance === "boolean", "proposal has hasAcceptance");
    assert(typeof proposal.hasRollback === "boolean", "proposal has hasRollback");
    assert(typeof proposal.hasFollowUp === "boolean", "proposal has hasFollowUp");
    assert(typeof proposal.quality === "object", "proposal has quality");
    assert(typeof proposal.classification === "string", "proposal has classification");
    assert(typeof proposal.classificationReason === "string", "proposal has classificationReason");
  }

  // --- Preview: body contains CONTROL APPENDIX --------------------------------
  console.log("\nPreview: CONTROL APPENDIX in body\n");

  {
    var res = mod.preview({ specs: [validSpec()] });
    var body = res.proposals[0].body;
    assert(body.includes("CONTROL APPENDIX"), "body contains CONTROL APPENDIX");
    assert(body.includes("Task type: execution"), "body contains task type");
    assert(body.includes("Risk: medium"), "body contains risk");
    assert(body.includes("Conflict group: wave-example"), "body contains conflict group");
    assert(body.includes("Allowed files:"), "body contains allowed files header");
    assert(body.includes("- src/example.ts"), "body contains allowed file entry");
    assert(body.includes("Forbidden files:"), "body contains forbidden files header");
    assert(body.includes("- src/auth/**"), "body contains forbidden file entry");
    assert(body.includes("Validation commands:"), "body contains validation header");
    assert(body.includes("- npm run check"), "body contains validation command");
    assert(body.includes("Rollback plan: Revert the PR"), "body contains rollback");
    assert(body.includes("Follow-up: Add integration tests"), "body contains follow-up");
  }

  // --- Preview: body contains evidence and acceptance -------------------------
  console.log("\nPreview: evidence and acceptance in body\n");

  {
    var res = mod.preview({ specs: [validSpec()] });
    var body = res.proposals[0].body;
    assert(body.includes("## Evidence"), "body contains evidence section");
    assert(body.includes("- Gap identified in code review"), "body contains evidence entry");
    assert(body.includes("## Acceptance"), "body contains acceptance section");
    assert(body.includes("- Feature works as described"), "body contains acceptance entry");
    assert(body.includes("## Constraints"), "body contains constraints section");
    assert(body.includes("- No breaking changes"), "body contains constraint entry");
  }

  // --- Preview: quality scoring -----------------------------------------------
  console.log("\nPreview: quality scoring\n");

  {
    // Full quality spec
    var res = mod.preview({ specs: [validSpec()] });
    var quality = res.proposals[0].quality;
    assert(quality.score === 7, "full spec scores 7/7");
    assert(quality.maxScore === 7, "max score is 7");
    assert(quality.percentage === 100, "100% quality");
    assert(quality.feedback.length === 0, "no feedback for full spec");
    assert(typeof quality.classification === "string", "quality has classification");
    assert(typeof quality.classificationReason === "string", "quality has classificationReason");
  }

  {
    // Minimal spec (missing evidence, acceptance, forbidden, rollback, follow-up)
    var res = mod.preview({
      specs: [validSpec({
        evidence: undefined,
        acceptance: undefined,
        forbiddenFiles: [],
        rollbackPlan: undefined,
        followUp: undefined,
      })],
    });
    var quality = res.proposals[0].quality;
    assert(quality.score === 2, "minimal spec scores 2/7 (allowed files + classification)");
    assert(quality.percentage === 29, "29% quality for minimal");
    assert(quality.feedback.length === 5, "5 feedback items for minimal");
  }

  // --- Preview: multiple specs sorted by quality ------------------------------
  console.log("\nPreview: multiple specs sorted by quality\n");

  {
    var res = mod.preview({
      specs: [
        validSpec({ title: "minimal spec", evidence: undefined, acceptance: undefined, forbiddenFiles: [], rollbackPlan: undefined, followUp: undefined }),
        validSpec({ title: "full spec" }),
      ],
    });
    assert(res.proposals.length === 2, "2 proposals");
    assert(res.proposals[0].title === "full spec", "full spec sorted first");
    assert(res.proposals[1].title === "minimal spec", "minimal spec sorted second");
    assert(res.summary.avgQuality > 0, "avg quality computed");
  }

  // --- Preview: validation errors for invalid specs ---------------------------
  console.log("\nPreview: validation errors\n");

  {
    var res = mod.preview({
      specs: [
        { title: "missing fields" },
        null,
        validSpec({ risk: "invalid-risk" }),
      ],
    });
    assert(res.ok === false, "not ok with all invalid");
    assert(res.status === "error", "status is error");
    assert(Array.isArray(res.validationErrors), "has validation errors");
    assert(res.validationErrors.length > 0, "has at least one error");
    assert(res.summary.invalid === 3, "all 3 invalid");
  }

  {
    // Mix of valid and invalid
    var res = mod.preview({
      specs: [
        { title: "missing fields" },
        validSpec(),
      ],
    });
    assert(res.ok === true, "ok with some valid");
    assert(res.proposals.length === 1, "1 valid proposal");
    assert(res.summary.invalid === 1, "1 invalid");
    assert(res.validationErrors.length > 0, "has validation errors for invalid");
  }

  // --- Preview: overly broad allowedFiles rejected ----------------------------
  console.log("\nPreview: broad allowedFiles rejected\n");

  {
    var res = mod.preview({
      specs: [validSpec({ allowedFiles: ["*"] })],
    });
    assert(res.ok === false, "rejected for broad pattern");
    assert(res.validationErrors.some(function (e) { return e.includes("overly broad"); }), "error mentions broad");
  }

  // --- Preview: reads from specsPath file -------------------------------------
  console.log("\nPreview: reads from specsPath file\n");

  {
    var dir = tmpDir();
    var specsPath = path.join(dir, "specs.json");
    writeJson(specsPath, [validSpec({ title: "from-file spec" })]);

    var res = mod.preview({ specsPath: specsPath });
    assert(res.ok === true, "ok from file");
    assert(res.proposals.length === 1, "1 proposal from file");
    assert(res.proposals[0].title === "from-file spec", "correct title from file");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Preview: missing specs file returns empty ------------------------------
  console.log("\nPreview: missing specs file returns empty\n");

  {
    var res = mod.preview({ specsPath: "/nonexistent/specs.json" });
    assert(res.ok === true, "ok with missing file");
    assert(res.status === "empty", "status empty");
    assert(res.proposals.length === 0, "no proposals");
  }

  // --- Preview: labels passthrough --------------------------------------------
  console.log("\nPreview: labels passthrough\n");

  {
    var res = mod.preview({
      specs: [validSpec()],
      labels: ["custom-label", "wave-5"],
    });
    assert(res.proposals[0].labels[0] === "custom-label", "custom label applied");
    assert(res.proposals[0].labels[1] === "wave-5", "second label applied");
  }

  // --- Preview: default labels ------------------------------------------------
  console.log("\nPreview: default labels\n");

  {
    var res = mod.preview({ specs: [validSpec()] });
    assert(res.proposals[0].labels[0] === "ai-generated", "default label is ai-generated");
  }

  // --- Preview: output has no raw stdout/stderr -------------------------------
  console.log("\nPreview: output is sanitized JSON\n");

  {
    var res = mod.preview({ specs: [validSpec()] });
    var raw = JSON.stringify(res);
    assert(!apiKeyRe.test(raw), "no API key pattern in output");
    assert(!ghTokenRe.test(raw), "no GitHub token pattern in output");
    assert(!raw.includes("password"), "no password field in output");
    assert(!raw.includes("secret"), "no secret field in output");
    assert(!raw.includes("token"), "no token field in output");
  }

  // --- Preview: no temp files created -----------------------------------------
  console.log("\nPreview: no temp files created\n");

  {
    var dir = tmpDir();
    var specsPath = path.join(dir, "specs.json");
    writeJson(specsPath, [validSpec()]);

    mod.preview({ specsPath: specsPath });
    var files = fs.readdirSync(dir);
    assert(files.length === 1, "only original fixture file remains");
    assert(files[0] === "specs.json", "specs.json still exists");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Execute: always blocked ------------------------------------------------
  console.log("\nExecute: always blocked\n");

  {
    var res = mod.execute({});
    assert(res.ok === false, "execute returns not ok");
    assert(res.status === "blocked", "execute status is blocked");
    assert(typeof res.error === "string", "error is string");
    assert(res.error.includes("not supported"), "error says not supported");
    assert(res.error.includes("create-issues"), "error references create-issues");
  }

  {
    var res = mod.execute(null);
    assert(res.ok === false, "execute with null returns not ok");
    assert(res.status === "blocked", "execute null status is blocked");
  }

  {
    var res = mod.execute({ confirm: true });
    assert(res.ok === false, "execute with confirm still blocked");
    assert(res.status === "blocked", "execute confirm status is blocked");
  }

  // --- Preview: invalid taskType rejected -------------------------------------
  console.log("\nPreview: invalid taskType rejected\n");

  {
    var res = mod.preview({
      specs: [validSpec({ taskType: "invalid-type" })],
    });
    assert(res.ok === false, "rejected for invalid taskType");
    assert(res.validationErrors.some(function (e) { return e.includes("invalid-type"); }), "error mentions invalid type");
  }

  // --- Preview: spec with string evidence -------------------------------------
  console.log("\nPreview: string evidence\n");

  {
    var res = mod.preview({
      specs: [validSpec({ evidence: "Single evidence string" })],
    });
    assert(res.ok === true, "ok with string evidence");
    assert(res.proposals[0].hasEvidence === true, "hasEvidence true for string");
    assert(res.proposals[0].body.includes("Single evidence string"), "evidence in body");
  }

  // --- Preview: quality feedback for partial specs ----------------------------
  console.log("\nPreview: quality feedback\n");

  {
    var res = mod.preview({
      specs: [validSpec({
        evidence: undefined,
        forbiddenFiles: [],
        followUp: undefined,
      })],
    });
    var feedback = res.proposals[0].quality.feedback;
    assert(feedback.includes("Missing evidence section"), "feedback for missing evidence");
    assert(feedback.includes("No forbidden files specified"), "feedback for missing forbidden");
    assert(feedback.includes("No follow-up defined"), "feedback for missing follow-up");
    assert(!feedback.includes("Missing acceptance criteria"), "no feedback for present acceptance");
  }

  // --- Preview: classification logic -----------------------------------------
  console.log("\nPreview: classification logic\n");

  {
    // Gate-worthy: high-risk spec
    var res = mod.preview({ specs: [validSpec({ risk: "high" })] });
    assert(res.proposals[0].classification === "gate-worthy", "high-risk is gate-worthy");
    assert(res.proposals[0].classificationReason.includes("High-risk"), "reason mentions high-risk");
  }

  {
    // Gate-worthy: forbidden files
    var res = mod.preview({ specs: [validSpec({ forbiddenFiles: ["src/auth/**"] })] });
    assert(res.proposals[0].classification === "gate-worthy", "forbidden files is gate-worthy");
    assert(res.proposals[0].classificationReason.includes("forbidden"), "reason mentions forbidden");
  }

  {
    // Agent-judgment only: low-risk, no evidence, no acceptance
    var res = mod.preview({ specs: [validSpec({
      risk: "low",
      evidence: undefined,
      acceptance: undefined,
      forbiddenFiles: [],
    })] });
    assert(res.proposals[0].classification === "agent-judgment-only", "low-risk no-evidence is agent-judgment-only");
    assert(res.proposals[0].classificationReason.includes("Agent judgment"), "reason mentions agent judgment");
  }

  {
    // Tool-worthy: evidence + multiple validation commands (no forbidden files)
    var res = mod.preview({ specs: [validSpec({
      validationCommands: ["npm run check", "npm test", "npm run lint"],
      forbiddenFiles: [],
    })] });
    assert(res.proposals[0].classification === "tool-worthy", "evidence + multiple validations is tool-worthy");
    assert(res.proposals[0].classificationReason.includes("tool"), "reason mentions tool");
  }

  {
    // Issue-worthy: has evidence, medium risk, no forbidden files, single validation command
    var res = mod.preview({ specs: [validSpec({
      forbiddenFiles: [],
      validationCommands: ["npm run check"],
    })] });
    assert(res.proposals[0].classification === "issue-worthy", "medium-risk with evidence is issue-worthy");
    assert(res.proposals[0].classificationReason.length > 0, "issue-worthy has reason");
  }
}

// --- Entry point -------------------------------------------------------------

run();
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} // end require.main guard
