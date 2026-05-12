"use strict";

/**
 * task-board — WebUI action module for task board projection preview.
 *
 * Reads the task-board.json projection from .github/ai-state/ and
 * returns a sanitized snapshot. Preview-only — no mutations, no writes.
 *
 * Safety policy:
 *   - Read-only. Both preview and execute return the same output.
 *   - Returns sanitized JSON only. No raw stdout/stderr in output.
 *   - Missing projection file returns empty task list (not an error).
 *   - Strips secret-bearing keys and truncates long strings.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_BOARD_PATH = path.join(REPO_ROOT, ".github/ai-state/task-board.json");

const VALID_STATES = ["open", "ready", "running", "blocked", "done"];

// ── Secret patterns to strip from output ─────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /auth/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === "string") {
    if (value.length > 500) return value.slice(0, 500) + "...";
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some((p) => p.test(k))) continue;
    result[k] = sanitizeValue(v);
  }
  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    let raw = fs.readFileSync(filePath, "utf-8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validateTaskEntry(entry, index) {
  if (!entry || typeof entry !== "object") {
    throw new Error("tasks[" + index + "] must be an object");
  }
  if (!Number.isInteger(entry.issue) || entry.issue < 1) {
    throw new Error("tasks[" + index + "].issue must be a positive integer");
  }
  if (typeof entry.state !== "string" || !VALID_STATES.includes(entry.state)) {
    throw new Error(
      "tasks[" + index + "].state must be one of: " + VALID_STATES.join(", ")
    );
  }
  if (typeof entry.conflictGroup !== "string" || entry.conflictGroup.length === 0) {
    throw new Error("tasks[" + index + "].conflictGroup must be a non-empty string");
  }
  if (entry.worker !== null && entry.worker !== undefined) {
    if (typeof entry.worker !== "object") {
      throw new Error("tasks[" + index + "].worker must be an object or null");
    }
    if (typeof entry.worker.branch !== "string" || entry.worker.branch.length === 0) {
      throw new Error("tasks[" + index + "].worker.branch must be a non-empty string");
    }
    if (typeof entry.worker.claimant !== "string" || entry.worker.claimant.length === 0) {
      throw new Error("tasks[" + index + "].worker.claimant must be a non-empty string");
    }
  }
  if (entry.blockedReason !== null && entry.blockedReason !== undefined) {
    if (typeof entry.blockedReason !== "string") {
      throw new Error("tasks[" + index + "].blockedReason must be a string or null");
    }
  }
  if (entry.linkedPR !== null && entry.linkedPR !== undefined) {
    if (!Number.isInteger(entry.linkedPR) || entry.linkedPR < 1) {
      throw new Error("tasks[" + index + "].linkedPR must be a positive integer or null");
    }
  }
}

function validateProjection(data) {
  if (!data || typeof data !== "object") {
    throw new Error("projection must be an object");
  }
  if (data.markerVersion !== 1) {
    throw new Error("markerVersion must be 1");
  }
  if (typeof data.capturedAt !== "string" || data.capturedAt.length === 0) {
    throw new Error("capturedAt must be a non-empty string");
  }
  if (!Array.isArray(data.tasks)) {
    throw new Error("tasks must be an array");
  }
  for (let i = 0; i < data.tasks.length; i++) {
    validateTaskEntry(data.tasks[i], i);
  }
}

// ── Core logic ───────────────────────────────────────────────────────────────

function readBoard(boardPath) {
  const data = readJson(boardPath);
  if (data === null) {
    return {
      ok: true,
      status: "empty",
      markerVersion: 1,
      capturedAt: new Date().toISOString(),
      taskCount: 0,
      tasks: [],
      summary: { open: 0, ready: 0, running: 0, blocked: 0, done: 0 },
      message: "No task-board.json found. Task board is empty.",
    };
  }

  validateProjection(data);

  const summary = { open: 0, ready: 0, running: 0, blocked: 0, done: 0 };
  for (const t of data.tasks) {
    if (summary[t.state] !== undefined) summary[t.state]++;
  }

  return {
    ok: true,
    status: "snapshot",
    markerVersion: data.markerVersion,
    capturedAt: data.capturedAt,
    taskCount: data.tasks.length,
    tasks: data.tasks.map(sanitizeObject),
    summary,
  };
}

// ── Action module contract ───────────────────────────────────────────────────

module.exports = {
  id: "task-board",
  label: "Task Board",
  description:
    "Preview the task board projection. Read-only — no mutations or side effects.",
  dangerous: false,

  /**
   * Preview — reads task-board.json and returns sanitized snapshot.
   */
  preview(payload) {
    const p = payload || {};
    const boardPath = p._boardPath || DEFAULT_BOARD_PATH;
    return readBoard(boardPath);
  },

  /**
   * Execute — identical to preview. This action is read-only.
   */
  execute(payload) {
    const p = payload || {};
    const boardPath = p._boardPath || DEFAULT_BOARD_PATH;
    return readBoard(boardPath);
  },
};
