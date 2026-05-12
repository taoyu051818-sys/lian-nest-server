"use strict";

/**
 * health-state — WebUI action module for main branch health state.
 *
 * Preview reads the current main-health.json and validates the requested
 * state transition without side effects. Execute calls
 * write-main-health-state.ps1 to persist the new marker.
 *
 * Dangerous: requires confirm:true for execute.
 * All output is sanitized JSON — no raw stdout/stderr.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_HEALTH_PATH = path.join(REPO_ROOT, ".github/ai-state/main-health.json");
const DEFAULT_SCRIPT_PATH = path.join(REPO_ROOT, "scripts/ai/write-main-health-state.ps1");

const VALID_STATES = ["green", "yellow", "red", "black"];
const VALID_WORKER_CLASSES = ["all", "fix-only", "docs"];

// --- Helpers -----------------------------------------------------------------

function readJson(filePath) {
  try {
    let raw = fs.readFileSync(filePath, "utf-8");
    // Strip UTF-8 BOM (Windows PowerShell -Encoding UTF8 emits BOM)
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("payload must be an object");
  }

  const { state, checks, failedChecks, allowedWorkerClasses, commitSha, reason } = payload;

  if (!state || typeof state !== "string") {
    throw new Error("state is required and must be a string");
  }
  if (!VALID_STATES.includes(state)) {
    throw new Error("state must be one of: " + VALID_STATES.join(", ") + ". Got: " + state);
  }

  if (commitSha !== undefined && commitSha !== null) {
    if (typeof commitSha !== "string" || !/^[0-9a-fA-F]{7,40}$/.test(commitSha)) {
      throw new Error("commitSha must be 7-40 hex characters");
    }
  }

  if (checks !== undefined && checks !== null) {
    if (!Array.isArray(checks)) {
      throw new Error("checks must be an array of strings");
    }
    for (const c of checks) {
      if (typeof c !== "string" || c.length === 0) {
        throw new Error("checks entries must be non-empty strings");
      }
    }
  }

  if (failedChecks !== undefined && failedChecks !== null) {
    if (!Array.isArray(failedChecks)) {
      throw new Error("failedChecks must be an array of strings");
    }
    for (const fc of failedChecks) {
      if (typeof fc !== "string" || fc.length === 0) {
        throw new Error("failedChecks entries must be non-empty strings");
      }
    }
    // Every failed check must appear in checks
    if (Array.isArray(checks) && checks.length > 0) {
      const checkSet = new Set(checks);
      for (const fc of failedChecks) {
        if (!checkSet.has(fc)) {
          throw new Error("failedChecks entry '" + fc + "' is not in checks list");
        }
      }
    } else if (failedChecks.length > 0) {
      throw new Error("failedChecks provided but checks is empty");
    }
  }

  if (allowedWorkerClasses !== undefined && allowedWorkerClasses !== null) {
    if (!Array.isArray(allowedWorkerClasses)) {
      throw new Error("allowedWorkerClasses must be an array of strings");
    }
    for (const wc of allowedWorkerClasses) {
      if (!VALID_WORKER_CLASSES.includes(wc)) {
        throw new Error("allowedWorkerClasses entry '" + wc + "' is not valid. Valid: " + VALID_WORKER_CLASSES.join(", "));
      }
    }
  }

  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("reason must be a non-empty string");
    }
  }
}

function buildScriptArgs(payload, scriptPath, healthPath) {
  const args = ["-NoProfile", "-NonInteractive", "-File", scriptPath, "-State", payload.state];

  if (payload.commitSha) {
    args.push("-CommitSha", payload.commitSha);
  }

  args.push("-OutputPath", healthPath);

  if (Array.isArray(payload.checks) && payload.checks.length > 0) {
    args.push("-Checks", payload.checks.join(","));
  }

  if (Array.isArray(payload.failedChecks) && payload.failedChecks.length > 0) {
    args.push("-FailedChecks", payload.failedChecks.join(","));
  }

  if (Array.isArray(payload.allowedWorkerClasses) && payload.allowedWorkerClasses.length > 0) {
    args.push("-AllowedWorkerClasses", payload.allowedWorkerClasses.join(","));
  }

  if (payload.reason) {
    args.push("-Reason", payload.reason);
  }

  return args;
}

function runScript(args, isDryRun) {
  if (isDryRun) {
    args.push("-DryRun");
  }

  try {
    const stdout = execFileSync("powershell", args, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout || "",
      error: "Script exited with code " + (err.status || 1),
    };
  }
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "health-state",
  label: "Health State",
  description:
    "Preview or write the main branch health state marker. " +
    "Preview validates the requested state with no side effects. " +
    "Execute persists the marker via write-main-health-state.ps1.",
  dangerous: true,

  preview(payload) {
    validatePayload(payload);

    const healthPath = (payload._healthPath) || DEFAULT_HEALTH_PATH;
    const scriptPath = (payload._scriptPath) || DEFAULT_SCRIPT_PATH;
    const current = readJson(healthPath);

    const args = buildScriptArgs(payload, scriptPath, healthPath);
    const scriptResult = runScript(args, true);

    return {
      status: "preview",
      dryRun: true,
      currentState: current ? { state: current.state, capturedAt: current.capturedAt } : null,
      requestedState: payload.state,
      checks: payload.checks || [],
      failedChecks: payload.failedChecks || [],
      allowedWorkerClasses: payload.allowedWorkerClasses || null,
      reason: payload.reason || null,
      scriptValidation: scriptResult.exitCode === 0 ? "passed" : "failed",
      message:
        scriptResult.exitCode === 0
          ? "State transition to '" + payload.state + "' is valid. Pass confirm:true to execute."
          : "Validation failed: " + (scriptResult.error || "unknown error"),
    };
  },

  execute(payload) {
    validatePayload(payload);

    const healthPath = (payload._healthPath) || DEFAULT_HEALTH_PATH;
    const scriptPath = (payload._scriptPath) || DEFAULT_SCRIPT_PATH;

    const args = buildScriptArgs(payload, scriptPath, healthPath);
    const scriptResult = runScript(args, false);

    if (scriptResult.exitCode !== 0) {
      return {
        status: "error",
        requestedState: payload.state,
        error: scriptResult.error || "Script execution failed",
        message: "Failed to write health state marker.",
      };
    }

    // Read back the written marker to confirm
    const written = readJson(healthPath);

    return {
      status: "written",
      dryRun: false,
      marker: written ? {
        state: written.state,
        commitSha: written.commitSha ? written.commitSha.substring(0, 8) : null,
        capturedAt: written.capturedAt,
        checks: written.checks || [],
        failedChecks: written.failedChecks || [],
        allowedWorkerClasses: written.allowedWorkerClasses || [],
      } : null,
      message: "Health state updated to '" + payload.state + "'.",
    };
  },
};
