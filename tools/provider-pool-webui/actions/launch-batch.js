"use strict";

/**
 * launch-batch — WebUI action module for batch worker launch with gate preview.
 *
 * Reads the current launch policy, main health state, queue state, and
 * running-worker manifest to produce a launch plan.  Preview mode returns
 * the plan without side effects.  Execute mode dispatches the batch via
 * batch-launch.ps1 when the gate passes.
 *
 * Dangerous: requires confirm:true for execute.
 * All output is sanitized JSON — no raw stdout/stderr.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const HEALTH_PATH = path.join(REPO_ROOT, ".github/ai-state/main-health.json");
const POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/launch-policy.json");
const QUEUE_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-queue-state.json");
const RUNNING_PATH = path.join(REPO_ROOT, ".github/ai-state/running-tasks.json");
const BATCH_LAUNCH_SCRIPT = path.join(REPO_ROOT, "scripts/ai/batch-launch.ps1");

// --- Permission matrix ------------------------------------------------------

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

function classifyWorkerType(task) {
  const explicit = task.mainHealthPolicy;
  if (explicit === "gate-docs-only") return "docs";
  if (explicit === "gate-none") return "research";

  const allowed = task.allowedFiles;
  if (Array.isArray(allowed) && allowed.length > 0) {
    const allDocs = allowed.every((f) => f.startsWith("docs/"));
    if (allDocs) return "docs";

    const allScripts = allowed.every(
      (f) => f.startsWith("scripts/") && !f.startsWith("src/")
    );
    if (allScripts) return "health-repair";

    const hasSrc = allowed.some((f) => f.startsWith("src/"));
    if (hasSrc && task.risk === "high") return "foundation-fix";
    if (hasSrc) return "runtime-feature";
  }

  if (task.taskType === "research") return "research";

  return "health-repair";
}

function runGateCheck(tasks, mainState, runningTasks) {
  const results = [];
  const seenGroups = new Map();
  const seenLocks = new Map();
  const duplicateConflictGroups = [];
  const sharedLockConflicts = [];
  const runningWorkerConflicts = [];

  const runningGroups = new Set(
    (runningTasks || []).map((r) => r.conflictGroup).filter(Boolean)
  );

  for (const task of tasks) {
    const issue = task.targetIssue;
    const group = task.conflictGroup || null;
    const workerType = classifyWorkerType(task);
    const allowed =
      PERMISSION_MATRIX[mainState] &&
      PERMISSION_MATRIX[mainState][workerType] === true;
    let reason = null;
    let rule = null;

    if (!allowed) {
      reason =
        "Worker type '" +
        workerType +
        "' is not permitted when main is " +
        mainState +
        ".";
      rule = "health-state-blocked";
    }

    // Conflict group duplicate check (skip docs-only groups)
    if (group && workerType !== "docs") {
      if (seenGroups.has(group)) {
        duplicateConflictGroups.push(group);
        if (!reason) {
          reason = "Duplicate conflict group '" + group + "' in batch.";
          rule = "conflict-group-duplicate";
        }
      } else {
        seenGroups.set(group, issue);
      }
    }

    // Shared lock overlap check
    const locks = Array.isArray(task.sharedLocks) ? task.sharedLocks : [];
    for (const lock of locks) {
      if (seenLocks.has(lock)) {
        sharedLockConflicts.push(lock);
        if (!reason) {
          reason = "Shared lock '" + lock + "' claimed by multiple tasks.";
          rule = "shared-lock-overlap";
        }
      } else {
        seenLocks.set(lock, issue);
      }
    }

    // Running worker conflict check
    if (group && runningGroups.has(group)) {
      runningWorkerConflicts.push({ issue, conflictGroup: group });
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
      targetPR: task.targetPR || null,
      conflictGroup: group,
      risk: task.risk || "medium",
      taskType: task.taskType || "execution",
      workerType,
      mainState,
      allowed: !reason,
      reason,
      rule,
    });
  }

  return {
    reportVersion: 1,
    capturedAt: new Date().toISOString(),
    mainState,
    taskCount: tasks.length,
    tasks: results,
    duplicateConflictGroups: [...new Set(duplicateConflictGroups)],
    sharedLockConflicts: [...new Set(sharedLockConflicts)],
    runningWorkerConflicts,
    allAllowed: results.every((t) => t.allowed),
  };
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "launch-batch",
  label: "Launch Batch",
  description:
    "Run the launch gate on queued tasks and preview or execute a batch dispatch.",
  dangerous: true,

  preview(payload) {
    const tasks = resolveTasks(payload);
    if (!tasks.length) {
      return {
        status: "empty",
        message: "No tasks to evaluate. Provide payload.tasks or queue entries.",
        gateReport: null,
      };
    }

    const mainState = readMainState();
    const runningTasks = readJson(RUNNING_PATH);
    const gateReport = runGateCheck(tasks, mainState, runningTasks);

    const plan = buildLaunchPlan(gateReport, tasks);

    return {
      status: "preview",
      mode: "dry-run",
      mainHealth: { state: mainState, source: HEALTH_PATH },
      gateReport,
      launchPlan: plan,
      message: gateReport.allAllowed
        ? "All " + tasks.length + " task(s) cleared for launch."
        : tasks.length -
          plan.selectedTasks.length +
          " of " +
          tasks.length +
          " task(s) blocked.",
    };
  },

  execute(payload) {
    const tasks = resolveTasks(payload);
    if (!tasks.length) {
      return {
        status: "error",
        message: "No tasks to launch. Provide payload.tasks or queue entries.",
      };
    }

    const mainState = readMainState();
    const runningTasks = readJson(RUNNING_PATH);
    const gateReport = runGateCheck(tasks, mainState, runningTasks);

    if (!gateReport.allAllowed) {
      const blocked = gateReport.tasks.filter((t) => !t.allowed);
      return {
        status: "blocked",
        message:
          "Launch gate blocked " +
          blocked.length +
          " task(s). Resolve blockers before executing.",
        gateReport,
        blockedTasks: blocked.map((t) => ({
          targetIssue: t.targetIssue,
          reason: t.reason,
          rule: t.rule,
        })),
      };
    }

    const plan = buildLaunchPlan(gateReport, tasks);

    // Write the launch plan to a temp file for batch-launch.ps1
    const planPath = path.join(
      REPO_ROOT,
      ".github/ai-state",
      "launch-plan-" + Date.now() + ".json"
    );
    try {
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");
    } catch (e) {
      return {
        status: "error",
        message: "Failed to write launch plan: " + e.message,
      };
    }

    // Dispatch via batch-launch.ps1
    const { execSync } = require("node:child_process");
    let dispatchResult;
    try {
      const stdout = execSync(
        "powershell -NoProfile -File \"" +
          BATCH_LAUNCH_SCRIPT +
          "\" -TaskFile \"" +
          planPath +
          "\" -Execute",
        {
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["ignore", "pipe", "pipe"],
          cwd: REPO_ROOT,
        }
      );
      dispatchResult = {
        dispatched: true,
        exitCode: 0,
        summary: "Batch launched successfully.",
      };
    } catch (e) {
      dispatchResult = {
        dispatched: false,
        exitCode: e.status || 1,
        summary: "Batch launch exited with code " + (e.status || 1) + ".",
      };
    }

    // Clean up temp plan file
    try {
      fs.unlinkSync(planPath);
    } catch {
      // ignore cleanup failure
    }

    return {
      status: dispatchResult.dispatched ? "launched" : "launch-failed",
      mode: "execute",
      mainHealth: { state: mainState },
      gateReport,
      launchPlan: plan,
      dispatch: dispatchResult,
      message: dispatchResult.summary,
    };
  },
};

// --- Internal helpers -------------------------------------------------------

function readMainState() {
  const health = readJson(HEALTH_PATH);
  if (health && health.state) return health.state;
  // Default to green when no health marker exists (same as check-launch-gate.ps1)
  return "green";
}

function resolveTasks(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
    return payload.tasks;
  }
  // Fall back to queue entries with status "queued"
  const queue = readJson(QUEUE_PATH);
  if (queue && Array.isArray(queue.entries)) {
    return queue.entries
      .filter((e) => e.status === "queued")
      .map((e) => ({
        targetIssue: e.targetIssue || e.issue,
        conflictGroup: e.conflictGroup || null,
        risk: e.risk || "medium",
        taskType: e.taskType || "execution",
        mainHealthPolicy: e.mainHealthPolicy || null,
        allowedFiles: e.allowedFiles || [],
        sharedLocks: e.sharedLocks || [],
        targetPR: e.targetPR || null,
      }));
  }
  return [];
}

function buildLaunchPlan(gateReport, tasks) {
  const selectedTasks = [];
  const rejectedTasks = [];
  const locksAcquired = [];
  let totalMaxFiles = 0;
  let totalMaxLinesChanged = 0;
  let softTimeMinutesMax = 0;
  let hardTimeMinutesMax = 0;

  for (let i = 0; i < gateReport.tasks.length; i++) {
    const result = gateReport.tasks[i];
    const task = tasks[i] || {};
    const plannedTask = {
      targetIssue: result.targetIssue,
      targetPR: result.targetPR,
      conflictGroup: result.conflictGroup,
      risk: result.risk,
      taskType: result.taskType,
      workerType: result.workerType,
      sharedLocks: task.sharedLocks || [],
      allowedFiles: task.allowedFiles || [],
      decision: {
        allowed: result.allowed,
        reason: result.reason,
        rule: result.rule,
      },
    };

    if (result.allowed) {
      selectedTasks.push(plannedTask);
      // Collect locks
      for (const lock of plannedTask.sharedLocks) {
        locksAcquired.push({
          lockName: lock,
          holderIssue: result.targetIssue,
          conflictGroup: result.conflictGroup,
        });
      }
      // Accumulate budget
      if (task.budget) {
        totalMaxFiles += task.budget.maxFiles || 0;
        totalMaxLinesChanged += task.budget.maxLinesChanged || 0;
        softTimeMinutesMax = Math.max(
          softTimeMinutesMax,
          task.budget.softTimeMinutes || 0
        );
        hardTimeMinutesMax = Math.max(
          hardTimeMinutesMax,
          task.budget.hardTimeMinutes || 0
        );
      }
    } else {
      rejectedTasks.push(plannedTask);
    }
  }

  return {
    planVersion: 1,
    capturedAt: new Date().toISOString(),
    mainHealth: {
      state: gateReport.mainState,
      capturedAt: gateReport.capturedAt,
    },
    selectedTasks,
    rejectedTasks,
    locksAcquired,
    budgetReservations: {
      totalMaxFiles,
      totalMaxLinesChanged,
      taskCount: selectedTasks.length,
      softTimeMinutesMax: softTimeMinutesMax || null,
      hardTimeMinutesMax: hardTimeMinutesMax || null,
    },
    allAllowed: gateReport.allAllowed,
  };
}
