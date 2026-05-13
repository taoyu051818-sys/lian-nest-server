"use strict";

/**
 * produce-issues — WebUI action module
 *
 * Preview-first issue producer: validates issue specifications and
 * drafts high-quality issue proposals with evidence, CONTROL APPENDIX,
 * allowedFiles, forbiddenFiles, validation commands, conflictGroup,
 * risk, and rollback/follow-up structure.
 *
 * Preview returns draft proposals; execute is blocked — use
 * create-issues to actually create GitHub issues from proposals.
 *
 * Closes: #1330
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_SPECS_PATH = path.join(REPO_ROOT, ".github/ai-state/issue-specs.json");

// --- Validation constants ---------------------------------------------------

const REQUIRED_SPEC_FIELDS = ["title", "goal", "risk", "conflictGroup", "allowedFiles", "validationCommands"];

const VALID_RISKS = ["low", "medium", "high", "critical"];
const VALID_TASK_TYPES = ["execution", "research", "review"];

// --- Helpers -----------------------------------------------------------------

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function validateSpec(spec, index) {
  const errors = [];
  const prefix = "spec[" + index + "]";

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    errors.push(prefix + ": must be a non-null object");
    return errors;
  }

  for (const field of REQUIRED_SPEC_FIELDS) {
    const val = spec[field];
    if (val === undefined || val === null) {
      errors.push(prefix + ": missing required field '" + field + "'");
    } else if (typeof val === "string" && val.trim() === "") {
      errors.push(prefix + ": field '" + field + "' must not be empty");
    } else if (Array.isArray(val) && val.length === 0) {
      errors.push(prefix + ": field '" + field + "' must not be empty array");
    }
  }

  if (spec.risk && !VALID_RISKS.includes(spec.risk)) {
    errors.push(prefix + ": invalid risk '" + spec.risk + "'. Must be one of: " + VALID_RISKS.join(", "));
  }

  if (spec.taskType && !VALID_TASK_TYPES.includes(spec.taskType)) {
    errors.push(prefix + ": invalid taskType '" + spec.taskType + "'. Must be one of: " + VALID_TASK_TYPES.join(", "));
  }

  if (Array.isArray(spec.allowedFiles)) {
    for (const pattern of spec.allowedFiles) {
      if (pattern === "*" || pattern === "**" || pattern === "**/*") {
        errors.push(prefix + ": allowedFiles contains overly broad pattern '" + pattern + "'");
      }
    }
  }

  return errors;
}

function buildIssueBody(spec) {
  var lines = [];

  // Goal section
  lines.push("## Goal");
  lines.push(spec.goal);
  lines.push("");

  // Evidence section (if provided)
  if (spec.evidence) {
    lines.push("## Evidence");
    if (Array.isArray(spec.evidence)) {
      for (var i = 0; i < spec.evidence.length; i++) {
        lines.push("- " + spec.evidence[i]);
      }
    } else {
      lines.push(spec.evidence);
    }
    lines.push("");
  }

  // Scope section
  lines.push("## Scope");
  lines.push(spec.scope || "Auto-generated from issue specification.");
  lines.push("");

  // Acceptance criteria (if provided)
  if (spec.acceptance && spec.acceptance.length > 0) {
    lines.push("## Acceptance");
    for (var j = 0; j < spec.acceptance.length; j++) {
      lines.push("- " + spec.acceptance[j]);
    }
    lines.push("");
  }

  // Constraints (if provided)
  if (spec.constraints && spec.constraints.length > 0) {
    lines.push("## Constraints");
    for (var k = 0; k < spec.constraints.length; k++) {
      lines.push("- " + spec.constraints[k]);
    }
    lines.push("");
  }

  // CONTROL APPENDIX
  lines.push("---");
  lines.push("CONTROL APPENDIX (launcher generated)");
  lines.push("Task type: " + (spec.taskType || "execution"));
  lines.push("Risk: " + spec.risk);
  lines.push("Conflict group: " + spec.conflictGroup);
  lines.push("Target issue: " + (spec.targetIssue || "none"));
  lines.push("Target PR: " + (spec.targetPR || "none"));
  lines.push("Issues: " + (spec.issues ? spec.issues.join(", ") : "none"));
  lines.push("Expected PR: " + (spec.expectedPR !== undefined ? spec.expectedPR : true));
  lines.push("Allowed files:");
  for (var m = 0; m < spec.allowedFiles.length; m++) {
    lines.push("- " + spec.allowedFiles[m]);
  }

  // Forbidden files
  if (spec.forbiddenFiles && spec.forbiddenFiles.length > 0) {
    lines.push("Forbidden files:");
    for (var n = 0; n < spec.forbiddenFiles.length; n++) {
      lines.push("- " + spec.forbiddenFiles[n]);
    }
  }

  // Validation commands
  lines.push("Validation commands:");
  for (var p = 0; p < spec.validationCommands.length; p++) {
    lines.push("- " + spec.validationCommands[p]);
  }

  // Rollback plan (if provided)
  if (spec.rollbackPlan) {
    lines.push("Rollback plan: " + spec.rollbackPlan);
  }

  // Follow-up (if provided)
  if (spec.followUp) {
    lines.push("Follow-up: " + spec.followUp);
  }

  // Budgets (if provided)
  if (spec.budgets) {
    lines.push("Budgets: " + JSON.stringify(spec.budgets));
  }

  // Role packet
  if (spec.rolePacket) {
    lines.push("Role packet:");
    lines.push("Actor role: " + (spec.rolePacket.actorRole || "unspecified"));
    if (spec.rolePacket.description) {
      lines.push(spec.rolePacket.description);
    }
  }

  return lines.join("\n");
}

function classifyProposal(spec) {
  var evidence = spec.evidence;
  var hasEvidence = !!(evidence && (Array.isArray(evidence) ? evidence.length > 0 : true));
  var risk = spec.risk || "medium";
  var hasForbiddenFiles = spec.forbiddenFiles && spec.forbiddenFiles.length > 0;

  // Gate-worthy: high-risk or touches forbidden scopes
  if (risk === "high" || hasForbiddenFiles) {
    return {
      classification: "gate-worthy",
      reason: risk === "high"
        ? "High-risk task requires human gate review before execution."
        : "Touches forbidden file scope (" + spec.forbiddenFiles.join(", ") + ") — requires human approval.",
    };
  }

  // Agent-judgment only: no evidence, low risk, no acceptance criteria
  if (!hasEvidence && risk === "low" && (!spec.acceptance || spec.acceptance.length === 0)) {
    return {
      classification: "agent-judgment-only",
      reason: "Low-risk task with no recorded evidence and no acceptance criteria. Agent judgment is sufficient — no issue tracking needed.",
    };
  }

  // Tool-worthy: recurring pattern with verifiable output (has evidence + validation commands)
  if (hasEvidence && spec.validationCommands && spec.validationCommands.length > 1) {
    return {
      classification: "tool-worthy",
      reason: "Task has evidence of recurrence and multiple validation commands. A tool would make this more reliable and verifiable.",
    };
  }

  // Issue-worthy: has evidence, acceptance criteria, or is medium risk
  return {
    classification: "issue-worthy",
    reason: hasEvidence
      ? "Has documented evidence and bounded scope. Worthy of issue tracking for accountability."
      : "Medium-risk or has acceptance criteria. Issue tracking ensures verification before completion.",
  };
}

function draftProposal(spec, labels) {
  var classification = classifyProposal(spec);
  return {
    title: spec.title,
    body: buildIssueBody(spec),
    labels: labels.slice(),
    priority: spec.priority || "medium",
    taskType: spec.taskType || "execution",
    risk: spec.risk,
    conflictGroup: spec.conflictGroup,
    allowedFiles: spec.allowedFiles.slice(),
    forbiddenFiles: spec.forbiddenFiles ? spec.forbiddenFiles.slice() : [],
    validationCommands: spec.validationCommands.slice(),
    hasEvidence: !!(spec.evidence && (Array.isArray(spec.evidence) ? spec.evidence.length > 0 : true)),
    hasAcceptance: !!(spec.acceptance && spec.acceptance.length > 0),
    hasRollback: !!spec.rollbackPlan,
    hasFollowUp: !!spec.followUp,
    classification: classification.classification,
    classificationReason: classification.reason,
  };
}

// --- Quality scoring ---------------------------------------------------------

function scoreProposal(proposal) {
  var score = 0;
  var maxScore = 7;
  var feedback = [];

  // Has evidence
  if (proposal.hasEvidence) {
    score++;
  } else {
    feedback.push("Missing evidence section");
  }

  // Has acceptance criteria
  if (proposal.hasAcceptance) {
    score++;
  } else {
    feedback.push("Missing acceptance criteria");
  }

  // Has forbidden files
  if (proposal.forbiddenFiles.length > 0) {
    score++;
  } else {
    feedback.push("No forbidden files specified");
  }

  // Has rollback plan
  if (proposal.hasRollback) {
    score++;
  } else {
    feedback.push("No rollback plan");
  }

  // Has follow-up
  if (proposal.hasFollowUp) {
    score++;
  } else {
    feedback.push("No follow-up defined");
  }

  // Allowed files not overly broad
  var broadPatterns = proposal.allowedFiles.filter(function (p) {
    return p === "*" || p === "**" || p === "**/*" || p === "src/**";
  });
  if (broadPatterns.length === 0) {
    score++;
  } else {
    feedback.push("allowedFiles has overly broad patterns");
  }

  // Has classification with reason
  if (proposal.classification && proposal.classificationReason) {
    score++;
  } else {
    feedback.push("Missing evidence-based classification");
  }

  return {
    score: score,
    maxScore: maxScore,
    percentage: Math.round((score / maxScore) * 100),
    feedback: feedback,
    classification: proposal.classification || "unclassified",
    classificationReason: proposal.classificationReason || "",
  };
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "produce-issues",
  label: "Produce Issues",
  description:
    "Preview-first issue producer: drafts high-quality proposals with evidence, " +
    "CONTROL APPENDIX, allowedFiles, forbiddenFiles, validation commands, and quality scoring. " +
    "Execute is blocked — use create-issues to create GitHub issues.",
  dangerous: false,

  /**
   * Preview: validate specs and draft proposals with quality scoring.
   * @param {object} [payload]
   * @param {object[]} [payload.specs] - Array of issue specifications
   * @param {string} [payload.specsPath] - Path to specs JSON file
   * @param {string[]} [payload.labels] - Labels to apply to proposals
   * @returns {object} Draft proposals with quality scores
   */
  preview(payload) {
    var opts = payload || {};
    var specs = Array.isArray(opts.specs) ? opts.specs : [];
    var labels = Array.isArray(opts.labels) ? opts.labels : ["ai-generated"];

    // If no inline specs, try reading from file
    if (specs.length === 0) {
      var specsPath = opts.specsPath || DEFAULT_SPECS_PATH;
      var fileSpecs = readJson(specsPath);
      if (Array.isArray(fileSpecs)) {
        specs = fileSpecs;
      }
    }

    if (specs.length === 0) {
      return {
        ok: true,
        status: "empty",
        proposals: [],
        summary: {
          total: 0,
          valid: 0,
          invalid: 0,
          avgQuality: 0,
          mode: "preview",
        },
        message: "No issue specifications provided",
        timestamp: new Date().toISOString(),
      };
    }

    // Validate all specs
    var allErrors = [];
    var validSpecs = [];
    for (var i = 0; i < specs.length; i++) {
      var errors = validateSpec(specs[i], i);
      if (errors.length > 0) {
        allErrors = allErrors.concat(errors);
      } else {
        validSpecs.push(specs[i]);
      }
    }

    if (validSpecs.length === 0) {
      return {
        ok: false,
        status: "error",
        error: "No valid specs after validation",
        validationErrors: allErrors,
        summary: {
          total: specs.length,
          valid: 0,
          invalid: specs.length,
          avgQuality: 0,
          mode: "preview",
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Draft proposals with quality scoring
    var proposals = [];
    var totalQuality = 0;
    for (var j = 0; j < validSpecs.length; j++) {
      var proposal = draftProposal(validSpecs[j], labels);
      var quality = scoreProposal(proposal);
      proposal.quality = quality;
      proposals.push(proposal);
      totalQuality += quality.percentage;
    }

    // Sort by quality score descending
    proposals.sort(function (a, b) {
      return b.quality.score - a.quality.score;
    });

    var avgQuality = Math.round(totalQuality / proposals.length);

    return {
      ok: true,
      status: "preview",
      dryRun: true,
      proposals: proposals,
      summary: {
        total: specs.length,
        valid: validSpecs.length,
        invalid: specs.length - validSpecs.length,
        avgQuality: avgQuality,
        mode: "preview",
      },
      validationErrors: allErrors.length > 0 ? allErrors : undefined,
      message:
        "Drafted " + proposals.length + " proposal(s) with avg quality " + avgQuality + "%",
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Execute is blocked for produce-issues.
   * Use create-issues to actually create GitHub issues from proposals.
   * @returns {object} Always returns blocked status
   */
  execute() {
    return {
      ok: false,
      status: "blocked",
      error:
        "Execute mode is not supported for produce-issues. " +
        "This action drafts proposals only. Use create-issues to create GitHub issues from proposals.",
    };
  },
};
