"use strict";

/**
 * autopilot-preview — WebUI action module for guarded autopilot preview.
 *
 * Chains all self-cycle dry-run steps into a single non-stop preview:
 * health gate, provider pool preflight, queue status, and launch plan.
 * Returns a comprehensive execute plan with blocked/humanRequired sections.
 *
 * Preview-only — no worker launch, merge, or issue close.
 * Execute mode is blocked.
 *
 * Closes: #1248
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_HEALTH_PATH = path.join(REPO_ROOT, ".github/ai-state/main-health.json");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");
const DEFAULT_POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/provider-pool-policy.json");
const DEFAULT_QUEUE_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-queue-state.json");
const DEFAULT_RUNNING_PATH = path.join(REPO_ROOT, ".github/ai-state/running-tasks.json");

// --- Permission matrix (mirrors launch-batch) --------------------------------

const PERMISSION_MATRIX = {
  green: {
    "runtime-feature": true,
    "foundation-fix": true,
    docs: true,
    "health-repair": true,
    "test-only": true,
    research: true,
  },
  yellow: {
    "runtime-feature": false,
    "foundation-fix": true,
    docs: true,
    "health-repair": true,
    "test-only": false,
    research: true,
  },
  red: {
    "runtime-feature": false,
    "foundation-fix": true,
    docs: false,
    "health-repair": true,
    "test-only": false,
    research: true,
  },
  black: {
    "runtime-feature": false,
    "foundation-fix": false,
    docs: false,
    "health-repair": false,
    "test-only": false,
    research: false,
  },
};

// --- Helpers -----------------------------------------------------------------

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function sanitizeProvider(p) {
  if (!p || typeof p !== "object") return p;
  var secret = p.secret;
  var sourcePath = p.sourcePath;
  var secretSources = p.secretSources;
  var apiKey = p.apiKey;
  var token = p.token;
  var safe = {};
  for (var key in p) {
    if (key === "secret" || key === "sourcePath" || key === "secretSources" || key === "apiKey" || key === "token") continue;
    safe[key] = p[key];
  }
  return safe;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  var secret = entry.secret;
  var token = entry.token;
  var apiKey = entry.apiKey;
  var password = entry.password;
  var credential = entry.credential;
  var auth = entry.auth;
  var safe = {};
  for (var key in entry) {
    if (key === "secret" || key === "token" || key === "apiKey" || key === "password" || key === "credential" || key === "auth") continue;
    safe[key] = entry[key];
  }
  return safe;
}

// --- Step checks -------------------------------------------------------------

function checkHealth(healthPath) {
  var health = readJson(healthPath);
  if (!health || !health.state) {
    return { state: "green", source: "default", blocked: false };
  }
  var state = health.state;
  var blocked = state === "red" || state === "black";
  return { state: state, source: "file", blocked: blocked };
}

function checkProviderPool(statePath, policyPath) {
  var state = readJson(statePath);
  if (!state || !Array.isArray(state.providers)) {
    return { available: 0, exhausted: 0, disabled: 0, atCapacity: 0, total: 0, blocked: false, providers: [] };
  }

  var policy = readJson(policyPath);
  var blockAllExhausted = policy && policy.launchGateIntegration
    ? policy.launchGateIntegration.blockWhenAllExhausted !== false
    : true;
  var blockAtCapacity = policy && policy.launchGateIntegration
    ? policy.launchGateIntegration.blockWhenAtCapacity !== false
    : true;

  var available = 0;
  var exhausted = 0;
  var disabled = 0;
  var atCapacity = 0;

  var providers = state.providers.map(sanitizeProvider);

  for (var i = 0; i < state.providers.length; i++) {
    var p = state.providers[i];
    var isAtCapacity = (p.currentConcurrency || 0) >= (p.maxConcurrency || 0);
    switch (p.status) {
      case "available":
        if (isAtCapacity) { atCapacity++; } else { available++; }
        break;
      case "exhausted":
        exhausted++;
        break;
      case "disabled":
        disabled++;
        break;
    }
  }

  var total = state.providers.length;
  var blocked = false;
  var blockReason = "";

  if (blockAllExhausted && available === 0 && atCapacity === 0) {
    blocked = true;
    blockReason = "All providers exhausted or disabled";
  } else if (blockAtCapacity && available === 0 && atCapacity > 0 && exhausted === 0 && disabled === 0) {
    blocked = true;
    blockReason = "All available providers at max concurrency";
  }

  return {
    available: available,
    exhausted: exhausted,
    disabled: disabled,
    atCapacity: atCapacity,
    total: total,
    blocked: blocked,
    blockReason: blockReason,
    providers: providers,
  };
}

function checkQueue(queuePath) {
  var queue = readJson(queuePath);
  if (!queue || !Array.isArray(queue.entries)) {
    return { total: 0, queued: 0, entries: [] };
  }
  var queued = queue.entries
    .filter(function (e) { return e.state === "queued"; })
    .map(sanitizeEntry);
  return { total: queue.entries.length, queued: queued.length, entries: queued };
}

function classifyWorkerType(task) {
  var explicit = task.mainHealthPolicy;
  if (explicit === "gate-docs-only") return "docs";
  if (explicit === "gate-none") return "research";

  var allowed = task.allowedFiles;
  if (Array.isArray(allowed) && allowed.length > 0) {
    var allDocs = allowed.every(function (f) { return f.startsWith("docs/"); });
    if (allDocs) return "docs";

    var allScripts = allowed.every(function (f) {
      return f.startsWith("scripts/") && !f.startsWith("src/");
    });
    if (allScripts) return "health-repair";

    var hasSrc = allowed.some(function (f) { return f.startsWith("src/"); });
    if (hasSrc && task.risk === "high") return "foundation-fix";
    if (hasSrc) return "runtime-feature";
  }

  if (task.taskType === "research") return "research";

  return "health-repair";
}

function buildLaunchGate(healthState, queueEntries, runningTasks) {
  var results = [];
  var seenGroups = {};
  var seenLocks = {};
  var duplicateConflictGroups = [];
  var sharedLockConflicts = [];
  var runningWorkerConflicts = [];

  var runningGroups = {};
  if (Array.isArray(runningTasks)) {
    for (var r = 0; r < runningTasks.length; r++) {
      if (runningTasks[r].conflictGroup) {
        runningGroups[runningTasks[r].conflictGroup] = true;
      }
    }
  }

  for (var i = 0; i < queueEntries.length; i++) {
    var entry = queueEntries[i];
    var issue = entry.issueNumber;
    var group = entry.conflictGroup || null;
    var workerType = classifyWorkerType(entry);
    var allowed =
      PERMISSION_MATRIX[healthState] &&
      PERMISSION_MATRIX[healthState][workerType] === true;
    var reason = null;
    var rule = null;

    if (!allowed) {
      reason =
        "Worker type '" +
        workerType +
        "' is not permitted when main is " +
        healthState +
        ".";
      rule = "health-state-blocked";
    }

    if (group && workerType !== "docs") {
      if (seenGroups[group]) {
        duplicateConflictGroups.push(group);
        if (!reason) {
          reason = "Duplicate conflict group '" + group + "' in batch.";
          rule = "conflict-group-duplicate";
        }
      } else {
        seenGroups[group] = issue;
      }
    }

    var locks = Array.isArray(entry.sharedLocks) ? entry.sharedLocks : [];
    for (var j = 0; j < locks.length; j++) {
      if (seenLocks[locks[j]]) {
        sharedLockConflicts.push(locks[j]);
        if (!reason) {
          reason = "Shared lock '" + locks[j] + "' claimed by multiple tasks.";
          rule = "shared-lock-overlap";
        }
      } else {
        seenLocks[locks[j]] = issue;
      }
    }

    if (group && runningGroups[group]) {
      runningWorkerConflicts.push({ issue: issue, conflictGroup: group });
      if (!reason) {
        reason =
          "Conflict group '" +
          group +
          "' matches an already-active worker.";
        rule = "running-worker-conflict";
      }
    }

    results.push({
      targetIssue: issue,
      conflictGroup: group,
      risk: entry.risk || "medium",
      taskType: entry.taskType || "execution",
      workerType: workerType,
      mainState: healthState,
      allowed: !reason,
      reason: reason,
      rule: rule,
      humanRequired: !allowed || (group && runningGroups[group]),
    });
  }

  return {
    taskCount: results.length,
    tasks: results,
    duplicateConflictGroups: duplicateConflictGroups.filter(function (v, i, a) { return a.indexOf(v) === i; }),
    sharedLockConflicts: sharedLockConflicts.filter(function (v, i, a) { return a.indexOf(v) === i; }),
    runningWorkerConflicts: runningWorkerConflicts,
    allAllowed: results.every(function (t) { return t.allowed; }),
  };
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "autopilot-preview",
  label: "Autopilot Preview",
  description:
    "Guarded autopilot preview: chains health gate, provider pool preflight, " +
    "queue status, and launch plan into a single dry-run execute plan. " +
    "Preview-only — never launches workers, merges, or closes issues.",
  dangerous: false,

  /**
   * Preview the full autopilot execute plan without side effects.
   * @param {object} [payload]
   * @param {string} [payload.healthPath] - Override health state path
   * @param {string} [payload.statePath] - Override provider pool path
   * @param {string} [payload.policyPath] - Override provider policy path
   * @param {string} [payload.queuePath] - Override queue state path
   * @param {string} [payload.runningPath] - Override running tasks path
   * @returns {object} Autopilot preview plan
   */
  preview(payload) {
    var opts = payload || {};
    var healthPath = opts.healthPath || DEFAULT_HEALTH_PATH;
    var statePath = opts.statePath || DEFAULT_STATE_PATH;
    var policyPath = opts.policyPath || DEFAULT_POLICY_PATH;
    var queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;
    var runningPath = opts.runningPath || DEFAULT_RUNNING_PATH;

    var health = checkHealth(healthPath);
    var pool = checkProviderPool(statePath, policyPath);
    var queue = checkQueue(queuePath);
    var runningTasks = readJson(runningPath);
    var runningList = Array.isArray(runningTasks) ? runningTasks : [];

    var pipelineBlocked = health.blocked || pool.blocked;

    // Build launch gate report from queued entries
    var gateReport = buildLaunchGate(health.state, queue.entries, runningList);

    // Build the execute plan steps
    var steps = [
      {
        name: "health-gate",
        status: health.blocked ? "blocked" : "pass",
        detail: health.blocked
          ? "Main health is " + health.state + " — launches blocked"
          : "Main health is " + health.state,
        humanRequired: health.blocked,
      },
      {
        name: "provider-pool-preflight",
        status: pool.blocked ? "blocked" : "pass",
        detail: pool.blocked
          ? pool.blockReason
          : pool.available + " provider(s) available",
        humanRequired: pool.blocked,
      },
      {
        name: "queue-status",
        status: queue.queued > 0 ? "ready" : "empty",
        detail: queue.queued + " queued issue(s)",
        humanRequired: false,
      },
      {
        name: "launch-gate",
        status: gateReport.taskCount === 0 ? "pass" : gateReport.allAllowed ? "pass" : "blocked",
        detail: gateReport.taskCount === 0
          ? "No tasks to validate"
          : gateReport.allAllowed
            ? "All " + gateReport.taskCount + " task(s) cleared"
            : (gateReport.taskCount - gateReport.tasks.filter(function (t) { return t.allowed; }).length) + " task(s) blocked",
        humanRequired: !gateReport.allAllowed && gateReport.taskCount > 0,
      },
    ];

    // Collect all blockers
    var blockers = [];
    if (health.blocked) {
      blockers.push({ source: "health-gate", reason: "Main health is " + health.state });
    }
    if (pool.blocked) {
      blockers.push({ source: "provider-pool-preflight", reason: pool.blockReason });
    }
    if (!gateReport.allAllowed && gateReport.taskCount > 0) {
      var blockedTasks = gateReport.tasks.filter(function (t) { return !t.allowed; });
      for (var i = 0; i < blockedTasks.length; i++) {
        blockers.push({
          source: "launch-gate",
          targetIssue: blockedTasks[i].targetIssue,
          reason: blockedTasks[i].reason,
          rule: blockedTasks[i].rule,
        });
      }
    }

    // Compute overall humanRequired
    var anyHumanRequired = steps.some(function (s) { return s.humanRequired; });

    // Determine final status
    var finalStatus;
    if (pipelineBlocked || (!gateReport.allAllowed && gateReport.taskCount > 0)) {
      finalStatus = "autopilot-plan-blocked";
    } else if (queue.queued === 0 && gateReport.taskCount === 0) {
      finalStatus = "autopilot-plan-ready";
    } else {
      finalStatus = "autopilot-plan-ready";
    }

    // Build the execute plan summary
    var executePlan = {
      wouldDiscoverIssues: false,
      wouldRunStateReconciliation: true,
      wouldCheckHealthGate: true,
      wouldCheckProviderPool: true,
      wouldValidateLaunchGate: gateReport.taskCount > 0,
      wouldDispatchWorkers: !pipelineBlocked && gateReport.allAllowed && queue.queued > 0,
      wouldRequireHumanConfirmation: anyHumanRequired || (!pipelineBlocked && gateReport.allAllowed && queue.queued > 0),
    };

    return {
      ok: true,
      status: finalStatus,
      dryRun: true,
      pipelineBlocked: pipelineBlocked,
      health: {
        state: health.state,
        source: health.source,
        blocked: health.blocked,
      },
      providerPool: {
        available: pool.available,
        exhausted: pool.exhausted,
        disabled: pool.disabled,
        atCapacity: pool.atCapacity,
        total: pool.total,
        blocked: pool.blocked,
        blockReason: pool.blockReason || "",
      },
      queue: {
        total: queue.total,
        queued: queue.queued,
      },
      launchGate: {
        taskCount: gateReport.taskCount,
        allAllowed: gateReport.allAllowed,
        blockedCount: gateReport.tasks.filter(function (t) { return !t.allowed; }).length,
        duplicateConflictGroups: gateReport.duplicateConflictGroups,
        sharedLockConflicts: gateReport.sharedLockConflicts,
        runningWorkerConflicts: gateReport.runningWorkerConflicts,
      },
      steps: steps,
      blockers: blockers,
      humanRequired: anyHumanRequired,
      executePlan: executePlan,
      message:
        finalStatus === "autopilot-plan-blocked"
          ? "Autopilot plan blocked — " + blockers.length + " blocker(s) found. Review before executing."
          : queue.queued > 0
            ? "Autopilot plan ready — " + queue.queued + " issue(s) can proceed to execution."
            : "Autopilot plan ready — no queued issues. Pipeline is clear.",
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Execute is blocked for autopilot-preview.
   * Autopilot preview is preview-only — use run-self-cycle.ps1 -AutopilotPlan
   * for full pipeline execution.
   * @returns {object} Always returns blocked status
   */
  execute() {
    return {
      ok: false,
      status: "blocked",
      error:
        "Execute mode is not supported for autopilot-preview. " +
        "Use run-self-cycle.ps1 -AutopilotPlan for full autopilot planning, " +
        "or run-self-cycle.ps1 -Execute for worker dispatch.",
    };
  },
};
