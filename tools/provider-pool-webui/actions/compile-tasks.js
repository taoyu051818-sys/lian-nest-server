#!/usr/bin/env node
"use strict";

/**
 * compile-tasks — WebUI action module
 *
 * Compiles issue JSON into worker task contracts.
 * Pure transformation — no file I/O, no secrets, no raw logs.
 * Both preview and execute are safe (non-destructive).
 */

const REPO_URL = "https://github.com/taoyu051818-sys/lian-nest-server";

const REQUIRED_FIELDS = [
  "targetIssue",
  "taskType",
  "risk",
  "conflictGroup",
  "allowedFiles",
  "validationCommands",
  "rolePacket",
];

const VALID_TASK_TYPES = ["execution", "research", "review"];
const VALID_RISKS = ["low", "medium", "high"];

const OPTIONAL_FIELDS = [
  "attentionAreas",
  "reviewAndAcceptance",
  "budgets",
  "complexityAssessment",
  "stragglerPolicy",
  "pmPhase",
];

const V2_OPTIONAL_FIELDS = [
  "writeSet",
  "sharedLocks",
  "dependsOnFacts",
  "producesFacts",
  "telemetry",
  "rollbackPlan",
  "sourceOfTruthDocs",
  "blockedBy",
  "mainHealthPolicy",
  "generatedCodePolicy",
];

// --- Validation helpers -----------------------------------------------------

function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("Payload must be a non-null object");
    return { errors, warnings };
  }

  // Check required fields
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const val = payload[field];
    if (val === undefined || val === null) {
      missing.push(field);
    } else if (Array.isArray(val) && val.length === 0) {
      missing.push(field + " (empty array)");
    } else if (typeof val === "string" && val.trim() === "") {
      missing.push(field + " (empty string)");
    }
  }
  if (missing.length > 0) {
    errors.push("Missing required fields: " + missing.join(", "));
  }

  // Enum checks
  if (payload.taskType && !VALID_TASK_TYPES.includes(payload.taskType)) {
    errors.push(
      "Invalid taskType: " + payload.taskType + ". Must be one of: " + VALID_TASK_TYPES.join(", ")
    );
  }
  if (payload.risk && !VALID_RISKS.includes(payload.risk)) {
    errors.push(
      "Invalid risk: " + payload.risk + ". Must be one of: " + VALID_RISKS.join(", ")
    );
  }

  // allowedFiles non-empty
  if (Array.isArray(payload.allowedFiles) && payload.allowedFiles.length === 0) {
    errors.push("allowedFiles must not be empty");
  }

  // rolePacket.actorRole required
  if (
    payload.rolePacket &&
    typeof payload.rolePacket === "object" &&
    !payload.rolePacket.actorRole
  ) {
    errors.push("rolePacket.actorRole is required");
  }

  // Warnings
  if (
    !payload.forbiddenFiles ||
    (Array.isArray(payload.forbiddenFiles) && payload.forbiddenFiles.length === 0)
  ) {
    warnings.push("forbiddenFiles is empty or missing — worker may edit unintended files");
  }

  if (Array.isArray(payload.allowedFiles)) {
    for (const pattern of payload.allowedFiles) {
      if (pattern === "*" || pattern === "**" || pattern === "**/*") {
        warnings.push(
          "allowedFiles contains broad pattern '" + pattern + "' — issue may be underspecified"
        );
      }
    }
  }

  if (Array.isArray(payload.validationCommands) && payload.validationCommands.length < 1) {
    warnings.push("validationCommands has fewer than 1 entry — no validation evidence will be produced");
  }

  // LLM contract warnings
  if (payload.llmExtracted === true) {
    if (
      !Array.isArray(payload.knowledgeRefs) ||
      payload.knowledgeRefs.length === 0
    ) {
      warnings.push(
        "llmExtracted=true but knowledgeRefs is missing or empty — LLM should populate semantic references"
      );
    }
    if (
      typeof payload.promptHandoff !== "string" ||
      payload.promptHandoff.trim() === ""
    ) {
      warnings.push(
        "llmExtracted=true but promptHandoff is missing or empty — LLM should produce a concise handoff"
      );
    }
  }

  return { errors, warnings };
}

// --- Compiler ---------------------------------------------------------------

function compileTask(payload, outputMode) {
  const v2 = outputMode === "v2";

  const task = {
    taskType: payload.taskType,
    risk: payload.risk,
    conflictGroup: payload.conflictGroup,
    targetIssue: payload.targetIssue,
    targetPR: payload.targetPR !== undefined ? payload.targetPR : null,
    issues: Array.isArray(payload.issues) ? payload.issues : [],
    expectedPR: payload.expectedPR !== undefined ? payload.expectedPR : true,
    allowedFiles: [...payload.allowedFiles],
    forbiddenFiles: Array.isArray(payload.forbiddenFiles)
      ? [...payload.forbiddenFiles]
      : [],
    validationCommands: [...payload.validationCommands],
    rolePacket: {
      actorRole: payload.rolePacket.actorRole,
      description:
        payload.rolePacket.description ||
        "Worker for issue #" + payload.targetIssue,
    },
    sourceIssue: REPO_URL + "/issues/" + payload.targetIssue,
  };

  // Pass through semantic context
  if (Array.isArray(payload.knowledgeRefs)) {
    task.knowledgeRefs = [...payload.knowledgeRefs];
  }
  if (typeof payload.promptHandoff === "string") {
    task.promptHandoff = payload.promptHandoff;
  }
  if (payload.llmExtracted !== undefined) {
    task.llmExtracted = !!payload.llmExtracted;
  }

  // Pass through optional fields
  for (const field of OPTIONAL_FIELDS) {
    if (payload[field] !== undefined) {
      task[field] = payload[field];
    }
  }

  // v2 transformations
  if (v2) {
    // Promote rolePacket → top-level
    task.actorRole = payload.rolePacket.actorRole;
    if (payload.rolePacket.description) {
      task.roleDescription = payload.rolePacket.description;
    }

    // Promote attentionAreas → top-level
    if (payload.attentionAreas && typeof payload.attentionAreas === "object") {
      if (Array.isArray(payload.attentionAreas.focus)) {
        task.attentionFocus = [...payload.attentionAreas.focus];
      }
      if (Array.isArray(payload.attentionAreas.knownBlindspots)) {
        task.knownBlindspots = [...payload.attentionAreas.knownBlindspots];
      }
    }

    // Promote reviewAndAcceptance → top-level
    if (payload.reviewAndAcceptance && typeof payload.reviewAndAcceptance === "object") {
      if (Array.isArray(payload.reviewAndAcceptance.requiredReviewRoles)) {
        task.requiredReviewRoles = [...payload.reviewAndAcceptance.requiredReviewRoles];
      }
      if (payload.reviewAndAcceptance.acceptanceOwner) {
        task.acceptanceOwner = payload.reviewAndAcceptance.acceptanceOwner;
      }
    }

    // Rename validationCommands → validation
    task.validation = task.validationCommands;
    delete task.validationCommands;

    // Rename budgets → budget
    if (task.budgets !== undefined) {
      task.budget = task.budgets;
      delete task.budgets;
    }

    // workerClass: derive from conflictGroup if not provided
    task.workerClass =
      typeof payload.workerClass === "string" && payload.workerClass.trim()
        ? payload.workerClass
        : payload.conflictGroup;

    // Pass through v2-only fields
    for (const field of V2_OPTIONAL_FIELDS) {
      if (payload[field] !== undefined) {
        task[field] = payload[field];
      }
    }
  }

  return task;
}

// --- Action module ----------------------------------------------------------

module.exports = {
  id: "compile-tasks",
  label: "Compile Tasks",
  description: "Compile issue JSON into worker task contracts",
  dangerous: false,

  preview(payload) {
    const { errors, warnings } = validatePayload(payload);
    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    const outputMode = payload.outputMode === "v2" ? "v2" : "v1";
    const task = compileTask(payload, outputMode);

    return {
      valid: true,
      outputMode,
      targetIssue: task.targetIssue,
      taskType: task.taskType,
      risk: task.risk,
      conflictGroup: task.conflictGroup,
      allowedFileCount: task.allowedFiles ? task.allowedFiles.length : 0,
      forbiddenFileCount: task.forbiddenFiles ? task.forbiddenFiles.length : 0,
      validationCommandCount: task.validation
        ? task.validation.length
        : task.validationCommands
          ? task.validationCommands.length
          : 0,
      warnings,
      dryRun: true,
    };
  },

  execute(payload) {
    const { errors, warnings } = validatePayload(payload);
    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    const outputMode = payload.outputMode === "v2" ? "v2" : "v1";
    const task = compileTask(payload, outputMode);

    return {
      ok: true,
      outputMode,
      task,
      warnings,
    };
  },
};
