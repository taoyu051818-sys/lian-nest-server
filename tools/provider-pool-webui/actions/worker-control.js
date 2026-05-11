"use strict";

/**
 * Worker Control action module for WebUI.
 *
 * Provides list, preview, and stop operations for workers.
 * Implements explicit worker targeting as a safety feature:
 *   - All stop operations require the caller to specify which workers to operate on
 *   - No wildcard or "all workers" operations are allowed
 *   - Stop operations require a reason for audit purposes
 *   - All output is sanitized (no raw stdout/stderr)
 *
 * Default mode is preview (dry-run). Execute requires explicit confirmation
 * via the server's dangerous-action gate.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");

// --- Helpers -----------------------------------------------------------------

function loadWorkerState(statePath) {
  const filePath = statePath || DEFAULT_STATE_PATH;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getWorkersFromState(state) {
  const workers = [];
  for (const p of state.providers || []) {
    for (let i = 0; i < (p.currentConcurrency || 0); i++) {
      workers.push({
        workerId: p.id + "-slot-" + i,
        providerId: p.id,
        status: "running",
        startedAt: state.global?.capturedAt || null,
      });
    }
  }
  return workers;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "payload is required" };
  }
  if (!payload.action || typeof payload.action !== "string") {
    return { ok: false, error: "action is required" };
  }
  return null;
}

// --- Action handlers ---------------------------------------------------------

function handleList(statePath) {
  const state = loadWorkerState(statePath);
  if (!state) {
    return { ok: false, error: "Cannot load worker state" };
  }
  const workers = getWorkersFromState(state);
  return { ok: true, action: "list", workers: workers, total: workers.length };
}

function handlePreviewStop(payload, statePath) {
  const workerIds = payload.workerIds;
  if (!Array.isArray(workerIds) || workerIds.length === 0) {
    return { ok: false, error: "workerIds array is required for stop action" };
  }

  const state = loadWorkerState(statePath);
  if (!state) {
    return { ok: false, error: "Cannot load worker state" };
  }

  const allWorkers = getWorkersFromState(state);
  const allIds = new Set(allWorkers.map(function (w) { return w.workerId; }));
  const targetWorkers = [];
  const notFound = [];

  for (const id of workerIds) {
    if (allIds.has(id)) {
      targetWorkers.push(allWorkers.find(function (w) { return w.workerId === id; }));
    } else {
      notFound.push(id);
    }
  }

  if (notFound.length > 0) {
    return { ok: false, error: "Workers not found: " + notFound.join(", ") };
  }

  return {
    ok: true,
    action: "stop",
    preview: true,
    workers: targetWorkers,
    total: targetWorkers.length,
    message: "Would stop " + targetWorkers.length + " worker(s)",
  };
}

function handleExecuteStop(payload, statePath) {
  const workerIds = payload.workerIds;
  const reason = payload.reason;

  if (!Array.isArray(workerIds) || workerIds.length === 0) {
    return { ok: false, error: "workerIds array is required for stop action" };
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, error: "reason is required for stop action" };
  }

  const filePath = statePath || DEFAULT_STATE_PATH;
  const state = loadWorkerState(filePath);
  if (!state) {
    return { ok: false, error: "Cannot load worker state" };
  }

  const allWorkers = getWorkersFromState(state);
  const allIds = new Set(allWorkers.map(function (w) { return w.workerId; }));
  const targetWorkers = [];
  const notFound = [];

  for (const id of workerIds) {
    if (allIds.has(id)) {
      targetWorkers.push(allWorkers.find(function (w) { return w.workerId === id; }));
    } else {
      notFound.push(id);
    }
  }

  if (notFound.length > 0) {
    return { ok: false, error: "Workers not found: " + notFound.join(", ") };
  }

  // Build updated state
  const affectedProviders = {};
  for (const w of targetWorkers) {
    affectedProviders[w.providerId] = (affectedProviders[w.providerId] || 0) + 1;
  }

  const newState = JSON.parse(JSON.stringify(state));
  for (const provider of newState.providers || []) {
    if (affectedProviders[provider.id]) {
      provider.currentConcurrency = Math.max(
        0,
        (provider.currentConcurrency || 0) - affectedProviders[provider.id]
      );
    }
  }

  if (newState.global) {
    newState.global.totalActiveWorkers = Math.max(
      0,
      (newState.global.totalActiveWorkers || 0) - targetWorkers.length
    );
  }

  // Write updated state
  fs.writeFileSync(filePath, JSON.stringify(newState, null, 2) + "\n", "utf-8");

  return {
    ok: true,
    action: "stop",
    stopped: targetWorkers.length,
    workers: targetWorkers.map(function (w) { return w.workerId; }),
    reason: reason.trim(),
    timestamp: new Date().toISOString(),
  };
}

// --- Module exports ----------------------------------------------------------

module.exports = {
  id: "worker.control",
  label: "Worker Control",
  description: "List, preview, and stop workers with explicit worker targeting.",
  dangerous: true,

  /**
   * Preview (dry-run) -- returns what would happen without mutating.
   * @param {object} payload - { action: "list"|"stop", workerIds?: string[], _statePath?: string }
   * @returns {object} preview result
   */
  preview(payload) {
    var validation = validatePayload(payload);
    if (validation) return validation;

    var action = payload.action;
    var statePath = payload._statePath;

    if (action === "list") {
      return handleList(statePath);
    }

    if (action === "stop") {
      return handlePreviewStop(payload, statePath);
    }

    return { ok: false, error: "Unknown action: " + action };
  },

  /**
   * Execute -- performs the actual mutation.
   * Stop action writes updated state to the provider pool file.
   * @param {object} payload - { action: "list"|"stop", workerIds?: string[], reason?: string, _statePath?: string }
   * @returns {object} execution result
   */
  execute(payload) {
    var validation = validatePayload(payload);
    if (validation) return validation;

    var action = payload.action;
    var statePath = payload._statePath;

    if (action === "list") {
      return handleList(statePath);
    }

    if (action === "stop") {
      return handleExecuteStop(payload, statePath);
    }

    return { ok: false, error: "Unknown action: " + action };
  },
};
