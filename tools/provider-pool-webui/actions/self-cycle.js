"use strict";

/**
 * self-cycle — WebUI action module
 *
 * Preview-only wrapper for the self-cycle runner pipeline.
 * Reads provider pool state, queue state, main health state, and launch
 * policy to produce a dry-run pipeline preview without executing any
 * worker launches or external commands.
 *
 * Execute mode is blocked — requires explicit confirmation and external
 * orchestration beyond this module's scope.
 *
 * Closes: #1191
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_HEALTH_PATH = path.join(REPO_ROOT, ".github/ai-state/main-health.json");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");
const DEFAULT_POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/provider-pool-policy.json");
const DEFAULT_QUEUE_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-queue-state.json");

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
  const { secret, sourcePath, secretSources, apiKey, token, ...safe } = p;
  return safe;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const { secret, token, apiKey, password, credential, auth, ...safe } = entry;
  return safe;
}

// --- Pipeline checks ---------------------------------------------------------

function checkHealth(healthPath) {
  const health = readJson(healthPath);
  if (!health || !health.state) {
    return { state: "green", source: "default", blocked: false };
  }
  const state = health.state;
  const blocked = state === "red" || state === "black";
  return { state, source: "file", blocked };
}

function checkProviderPool(statePath, policyPath) {
  const state = readJson(statePath);
  if (!state || !Array.isArray(state.providers)) {
    return { available: 0, exhausted: 0, disabled: 0, atCapacity: 0, total: 0, blocked: false, providers: [] };
  }

  const policy = readJson(policyPath);
  const blockAllExhausted = policy && policy.launchGateIntegration
    ? policy.launchGateIntegration.blockWhenAllExhausted !== false
    : true;
  const blockAtCapacity = policy && policy.launchGateIntegration
    ? policy.launchGateIntegration.blockWhenAtCapacity !== false
    : true;

  let available = 0;
  let exhausted = 0;
  let disabled = 0;
  let atCapacity = 0;

  const providers = state.providers.map(sanitizeProvider);

  for (const p of state.providers) {
    const isAtCapacity = (p.currentConcurrency || 0) >= (p.maxConcurrency || 0);
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

  const total = state.providers.length;
  let blocked = false;
  let blockReason = "";

  if (blockAllExhausted && available === 0 && atCapacity === 0) {
    blocked = true;
    blockReason = "All providers exhausted or disabled";
  } else if (blockAtCapacity && available === 0 && atCapacity > 0 && exhausted === 0 && disabled === 0) {
    blocked = true;
    blockReason = "All available providers at max concurrency";
  }

  return { available, exhausted, disabled, atCapacity, total, blocked, blockReason, providers };
}

function checkQueue(queuePath) {
  const queue = readJson(queuePath);
  if (!queue || !Array.isArray(queue.entries)) {
    return { total: 0, queued: 0, entries: [] };
  }
  const queued = queue.entries
    .filter(function (e) { return e.state === "queued"; })
    .map(sanitizeEntry);
  return { total: queue.entries.length, queued: queued.length, entries: queued };
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "self-cycle",
  label: "Self-Cycle Preview",
  description:
    "Preview the self-cycle pipeline: health gate, provider pool preflight, " +
    "queue status, and launch readiness. Dry-run only — never launches workers.",
  dangerous: false,

  /**
   * Preview the self-cycle pipeline without side effects.
   * @param {object} [payload]
   * @param {string} [payload.healthPath] - Override health state path
   * @param {string} [payload.statePath] - Override provider pool path
   * @param {string} [payload.policyPath] - Override provider policy path
   * @param {string} [payload.queuePath] - Override queue state path
   * @returns {object} Pipeline preview
   */
  preview(payload) {
    var opts = payload || {};
    var healthPath = opts.healthPath || DEFAULT_HEALTH_PATH;
    var statePath = opts.statePath || DEFAULT_STATE_PATH;
    var policyPath = opts.policyPath || DEFAULT_POLICY_PATH;
    var queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;

    var health = checkHealth(healthPath);
    var pool = checkProviderPool(statePath, policyPath);
    var queue = checkQueue(queuePath);

    var pipelineBlocked = health.blocked || pool.blocked;
    var steps = [
      {
        name: "health-gate",
        status: health.blocked ? "blocked" : "pass",
        detail: health.blocked
          ? "Main health is " + health.state + " — launches blocked"
          : "Main health is " + health.state,
      },
      {
        name: "provider-pool-preflight",
        status: pool.blocked ? "blocked" : "pass",
        detail: pool.blocked
          ? pool.blockReason
          : pool.available + " provider(s) available",
      },
      {
        name: "queue-status",
        status: queue.queued > 0 ? "ready" : "empty",
        detail: queue.queued + " queued issue(s)",
      },
    ];

    return {
      ok: true,
      status: "preview",
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
      steps: steps,
      message: pipelineBlocked
        ? "Pipeline blocked — review health gate or provider pool"
        : queue.queued > 0
          ? "Pipeline ready — " + queue.queued + " issue(s) can proceed"
          : "Pipeline clear — no queued issues",
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Execute is blocked for self-cycle.
   * Self-cycle execution requires external orchestration (PowerShell runner).
   * @returns {object} Always returns blocked status
   */
  execute() {
    return {
      ok: false,
      status: "blocked",
      error:
        "Execute mode is not supported for self-cycle preview. " +
        "Use scripts/ai/run-self-cycle.ps1 -Execute for full cycle execution.",
    };
  },
};
