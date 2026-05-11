#!/usr/bin/env node
"use strict";

/**
 * compile-tasks.test.js
 *
 * Unit tests for the compile-tasks action module.
 * No external test framework — uses a simple assert helper.
 *
 * Run: node tools/provider-pool-webui/actions/compile-tasks.test.js
 *
 * Guarded with require.main so it is inert when loaded by
 * action-modules.test.js (which requires every .js in actions/).
 */

if (require.main !== module) {
  // When loaded by action-modules.test.js, export a no-op module shape
  // so the inventory contract checks pass. The id is intentionally not
  // in the expectedIds list so it won't be asserted by server discovery.
  module.exports = {
    id: "compile-tasks-test",
    label: "Compile Tasks Tests",
    description: "Test suite for compile-tasks (no-op when required as module)",
    dangerous: false,
    preview() { return { dryRun: true }; },
    execute() { return { ok: true }; },
  };
} else {
  const mod = require("./compile-tasks");

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

  function throws(fn, name) {
    try {
      fn();
      failed++;
      console.error("  FAIL  " + name + " (did not throw)");
    } catch {
      passed++;
      console.log("  PASS  " + name);
    }
  }

  // --- Fixture ----------------------------------------------------------------

  function validPayload(overrides) {
    return {
      targetIssue: 723,
      taskType: "execution",
      risk: "low",
      conflictGroup: "wave20-compile-tasks-tests",
      allowedFiles: ["tools/provider-pool-webui/actions/compile-tasks.test.js"],
      forbiddenFiles: ["src/**", ".env"],
      validationCommands: ["node tools/provider-pool-webui/actions/compile-tasks.test.js"],
      rolePacket: { actorRole: "claude-code-worker", description: "Test worker" },
      ...overrides,
    };
  }

  // --- Module contract --------------------------------------------------------

  console.log("\nModule contract\n");

  assert(typeof mod.id === "string" && mod.id.length > 0, "exports id");
  assert(mod.id === "compile-tasks", "id is 'compile-tasks'");
  assert(typeof mod.label === "string" && mod.label.length > 0, "exports label");
  assert(typeof mod.description === "string", "exports description");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === false, "compile-tasks is not dangerous");
  assert(typeof mod.preview === "function", "exports preview function");
  assert(typeof mod.execute === "function", "exports execute function");

  // --- validatePayload via preview (throws on errors) -------------------------

  console.log("\nvalidatePayload — valid payload\n");

  {
    const result = mod.preview(validPayload());
    assert(result.valid === true, "valid payload returns valid=true");
    assert(result.dryRun === true, "preview returns dryRun=true");
    assert(result.targetIssue === 723, "preview returns targetIssue");
    assert(result.taskType === "execution", "preview returns taskType");
    assert(result.risk === "low", "preview returns risk");
    assert(typeof result.conflictGroup === "string", "preview returns conflictGroup");
    assert(typeof result.allowedFileCount === "number", "preview returns allowedFileCount");
    assert(typeof result.forbiddenFileCount === "number", "preview returns forbiddenFileCount");
    assert(typeof result.validationCommandCount === "number", "preview returns validationCommandCount");
    assert(Array.isArray(result.warnings), "preview returns warnings array");
  }

  // --- validatePayload — missing required fields ------------------------------

  console.log("\nvalidatePayload — missing required fields\n");

  {
    const fields = [
      "targetIssue", "taskType", "risk", "conflictGroup",
      "allowedFiles", "validationCommands", "rolePacket",
    ];
    for (const field of fields) {
      const payload = validPayload();
      delete payload[field];
      throws(() => mod.preview(payload), "throws when " + field + " is missing");
    }
  }

  // --- validatePayload — empty array/string for required fields ---------------

  console.log("\nvalidatePayload — empty values\n");

  {
    throws(
      () => mod.preview(validPayload({ allowedFiles: [] })),
      "throws when allowedFiles is empty array",
    );
    throws(
      () => mod.preview(validPayload({ validationCommands: [] })),
      "throws when validationCommands is empty array",
    );
    throws(
      () => mod.preview(validPayload({ taskType: "" })),
      "throws when taskType is empty string",
    );
    throws(
      () => mod.preview(validPayload({ conflictGroup: "  " })),
      "throws when conflictGroup is whitespace",
    );
  }

  // --- validatePayload — invalid enums ----------------------------------------

  console.log("\nvalidatePayload — invalid enums\n");

  {
    throws(
      () => mod.preview(validPayload({ taskType: "deploy" })),
      "throws for invalid taskType 'deploy'",
    );
    throws(
      () => mod.preview(validPayload({ risk: "extreme" })),
      "throws for invalid risk 'extreme'",
    );
  }

  // --- validatePayload — rolePacket.actorRole required ------------------------

  console.log("\nvalidatePayload — rolePacket.actorRole\n");

  {
    throws(
      () => mod.preview(validPayload({ rolePacket: {} })),
      "throws when rolePacket has no actorRole",
    );
    throws(
      () => mod.preview(validPayload({ rolePacket: { actorRole: "" } })),
      "throws when rolePacket.actorRole is empty string",
    );
  }

  // --- validatePayload — warnings --------------------------------------------

  console.log("\nvalidatePayload — warnings\n");

  {
    const r1 = mod.preview(validPayload({ forbiddenFiles: [] }));
    assert(
      r1.warnings.some((w) => w.includes("forbiddenFiles")),
      "warns when forbiddenFiles is empty",
    );

    const r2 = mod.preview(validPayload({ allowedFiles: ["*"] }));
    assert(
      r2.warnings.some((w) => w.includes("broad pattern")),
      "warns for broad allowedFiles pattern '*'",
    );

    const r3 = mod.preview(validPayload({ allowedFiles: ["**/*"] }));
    assert(
      r3.warnings.some((w) => w.includes("broad pattern")),
      "warns for broad allowedFiles pattern '**/*'",
    );
  }

  // --- validatePayload — llmExtracted warnings --------------------------------

  console.log("\nvalidatePayload — llmExtracted warnings\n");

  {
    const r1 = mod.preview(validPayload({ llmExtracted: true }));
    assert(
      r1.warnings.some((w) => w.includes("knowledgeRefs")),
      "warns when llmExtracted=true but knowledgeRefs missing",
    );
    assert(
      r1.warnings.some((w) => w.includes("promptHandoff")),
      "warns when llmExtracted=true but promptHandoff missing",
    );

    const r2 = mod.preview(validPayload({
      llmExtracted: true,
      knowledgeRefs: ["docs/ai-native/provider-pool-webui-api.md"],
      promptHandoff: "Compile tasks for #723",
    }));
    assert(
      !r2.warnings.some((w) => w.includes("knowledgeRefs")),
      "no knowledgeRefs warning when provided",
    );
    assert(
      !r2.warnings.some((w) => w.includes("promptHandoff")),
      "no promptHandoff warning when provided",
    );
  }

  // --- preview — outputMode ---------------------------------------------------

  console.log("\npreview — outputMode\n");

  {
    const v1 = mod.preview(validPayload());
    assert(v1.outputMode === "v1", "defaults to v1 outputMode");

    const v2 = mod.preview(validPayload({ outputMode: "v2" }));
    assert(v2.outputMode === "v2", "respects outputMode='v2'");

    const fallback = mod.preview(validPayload({ outputMode: "unknown" }));
    assert(fallback.outputMode === "v1", "falls back to v1 for unknown outputMode");
  }

  // --- execute — v1 output ----------------------------------------------------

  console.log("\nexecute — v1 output\n");

  {
    const result = mod.execute(validPayload());
    assert(result.ok === true, "execute returns ok=true");
    assert(result.outputMode === "v1", "execute defaults to v1");
    assert(Array.isArray(result.warnings), "execute returns warnings");

    const task = result.task;
    assert(task.taskType === "execution", "task has taskType");
    assert(task.risk === "low", "task has risk");
    assert(task.targetIssue === 723, "task has targetIssue");
    assert(task.targetPR === null, "task defaults targetPR to null");
    assert(Array.isArray(task.issues), "task has issues array");
    assert(task.expectedPR === true, "task defaults expectedPR to true");
    assert(Array.isArray(task.allowedFiles), "task has allowedFiles");
    assert(task.allowedFiles.length === 1, "task allowedFiles has correct length");
    assert(Array.isArray(task.forbiddenFiles), "task has forbiddenFiles");
    assert(Array.isArray(task.validationCommands), "task has validationCommands");
    assert(task.rolePacket.actorRole === "claude-code-worker", "task has rolePacket.actorRole");
    assert(task.sourceIssue.includes("/issues/723"), "task has sourceIssue URL");
    assert(task.actorRole === undefined, "v1 does not promote actorRole to top-level");
    assert(task.validation === undefined, "v1 does not rename validationCommands");
  }

  // --- execute — v2 output ----------------------------------------------------

  console.log("\nexecute — v2 output\n");

  {
    const payload = validPayload({
      outputMode: "v2",
      attentionAreas: {
        focus: ["testing", "action modules"],
        knownBlindspots: ["secrets exposure"],
      },
      reviewAndAcceptance: {
        requiredReviewRoles: ["control-plane-reviewer"],
        acceptanceOwner: "Codex orchestrator",
      },
      budgets: { maxDiffLines: 350 },
      workerClass: "custom-worker",
    });

    const result = mod.execute(payload);
    assert(result.ok === true, "v2 execute returns ok=true");
    assert(result.outputMode === "v2", "v2 execute has correct outputMode");

    const task = result.task;
    assert(task.actorRole === "claude-code-worker", "v2 promotes actorRole to top-level");
    assert(task.roleDescription === "Test worker", "v2 promotes roleDescription");
    assert(Array.isArray(task.attentionFocus), "v2 promotes attentionFocus");
    assert(task.attentionFocus.length === 2, "v2 attentionFocus has correct length");
    assert(Array.isArray(task.knownBlindspots), "v2 promotes knownBlindspots");
    assert(task.knownBlindspots[0] === "secrets exposure", "v2 knownBlindspots has correct value");
    assert(Array.isArray(task.requiredReviewRoles), "v2 promotes requiredReviewRoles");
    assert(task.acceptanceOwner === "Codex orchestrator", "v2 promotes acceptanceOwner");
    assert(task.validation === undefined || Array.isArray(task.validation), "v2 renames validationCommands to validation");
    assert(task.validationCommands === undefined, "v2 removes validationCommands key");
    assert(task.budget !== undefined, "v2 renames budgets to budget");
    assert(task.budgets === undefined, "v2 removes budgets key");
    assert(task.workerClass === "custom-worker", "v2 uses provided workerClass");
  }

  // --- execute — v2 workerClass fallback --------------------------------------

  console.log("\nexecute — v2 workerClass fallback\n");

  {
    const payload = validPayload({ outputMode: "v2" });
    const result = mod.execute(payload);
    assert(
      result.task.workerClass === payload.conflictGroup,
      "v2 falls back to conflictGroup for workerClass",
    );
  }

  // --- execute — v2 optional fields passthrough --------------------------------

  console.log("\nexecute — v2 optional fields passthrough\n");

  {
    const payload = validPayload({
      outputMode: "v2",
      writeSet: ["tools/**"],
      sharedLocks: ["docs/**"],
      dependsOnFacts: ["main-health-green"],
      producesFacts: ["tasks-compiled"],
      telemetry: { enabled: true },
      rollbackPlan: "revert commit",
      sourceOfTruthDocs: ["docs/ai-native/provider-pool-webui-api.md"],
      blockedBy: [700],
      mainHealthPolicy: "require-green",
      generatedCodePolicy: "review-required",
    });

    const result = mod.execute(payload);
    const task = result.task;
    assert(Array.isArray(task.writeSet), "v2 passes through writeSet");
    assert(Array.isArray(task.sharedLocks), "v2 passes through sharedLocks");
    assert(Array.isArray(task.dependsOnFacts), "v2 passes through dependsOnFacts");
    assert(Array.isArray(task.producesFacts), "v2 passes through producesFacts");
    assert(typeof task.telemetry === "object", "v2 passes through telemetry");
    assert(task.rollbackPlan === "revert commit", "v2 passes through rollbackPlan");
    assert(Array.isArray(task.sourceOfTruthDocs), "v2 passes through sourceOfTruthDocs");
    assert(Array.isArray(task.blockedBy), "v2 passes through blockedBy");
    assert(task.mainHealthPolicy === "require-green", "v2 passes through mainHealthPolicy");
    assert(task.generatedCodePolicy === "review-required", "v2 passes through generatedCodePolicy");
  }

  // --- execute — optional fields passthrough (v1) ------------------------------

  console.log("\nexecute — v1 optional fields passthrough\n");

  {
    const payload = validPayload({
      attentionAreas: { focus: ["testing"] },
      reviewAndAcceptance: { requiredReviewRoles: ["reviewer"] },
      budgets: { maxDiffLines: 100 },
      complexityAssessment: { score: 2 },
      stragglerPolicy: { onHardTimeout: "open-pr-or-comment-blocker" },
      pmPhase: "wave20-webui-self-cycle-completion",
    });

    const result = mod.execute(payload);
    const task = result.task;
    assert(task.attentionAreas !== undefined, "v1 passes through attentionAreas");
    assert(task.reviewAndAcceptance !== undefined, "v1 passes through reviewAndAcceptance");
    assert(task.budgets !== undefined, "v1 passes through budgets");
    assert(task.complexityAssessment !== undefined, "v1 passes through complexityAssessment");
    assert(task.stragglerPolicy !== undefined, "v1 passes through stragglerPolicy");
    assert(task.pmPhase !== undefined, "v1 passes through pmPhase");
  }

  // --- execute — issues and expectedPR defaults --------------------------------

  console.log("\nexecute — issues and expectedPR defaults\n");

  {
    const r1 = mod.execute(validPayload());
    assert(Array.isArray(r1.task.issues), "issues defaults to empty array");
    assert(r1.task.issues.length === 0, "issues is empty by default");
    assert(r1.task.expectedPR === true, "expectedPR defaults to true");

    const r2 = mod.execute(validPayload({ issues: [723, 724], expectedPR: false }));
    assert(r2.task.issues.length === 2, "issues passes through");
    assert(r2.task.expectedPR === false, "expectedPR passes through");
  }

  // --- execute — knowledgeRefs passthrough ------------------------------------

  console.log("\nexecute — knowledgeRefs passthrough\n");

  {
    const payload = validPayload({
      knowledgeRefs: ["docs/ai-native/provider-pool-webui-api.md"],
      promptHandoff: "Compile tasks for #723",
      llmExtracted: true,
    });

    const result = mod.execute(payload);
    assert(
      Array.isArray(result.task.knowledgeRefs),
      "passes through knowledgeRefs",
    );
    assert(
      result.task.promptHandoff === "Compile tasks for #723",
      "passes through promptHandoff",
    );
    assert(result.task.llmExtracted === true, "passes through llmExtracted");
  }

  // --- execute — non-destructive guarantee ------------------------------------

  console.log("\nexecute — non-destructive guarantee\n");

  {
    const payload = validPayload();
    const originalAllowed = [...payload.allowedFiles];
    mod.execute(payload);
    assert(
      JSON.stringify(payload.allowedFiles) === JSON.stringify(originalAllowed),
      "execute does not mutate input payload.allowedFiles",
    );
  }

  // --- preview — file counts match input --------------------------------------

  console.log("\npreview — file counts match input\n");

  {
    const payload = validPayload({
      allowedFiles: ["a.js", "b.js", "c.js"],
      forbiddenFiles: ["x/**", "y/**"],
      validationCommands: ["cmd1", "cmd2"],
    });
    const result = mod.preview(payload);
    assert(result.allowedFileCount === 3, "allowedFileCount matches input length");
    assert(result.forbiddenFileCount === 2, "forbiddenFileCount matches input length");
    assert(result.validationCommandCount === 2, "validationCommandCount matches input length");
  }

  // --- Summary ----------------------------------------------------------------

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}
