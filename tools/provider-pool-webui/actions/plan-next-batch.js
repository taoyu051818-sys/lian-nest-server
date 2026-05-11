"use strict";

/**
 * WebUI action module — plan-next-batch
 *
 * Computes the next worker batch plan by reading provider pool state
 * and queue state. Preview is read-only; execute validates an allowlist
 * and writes the batch plan.
 *
 * No secrets, raw logs, or GitHub mutations in any output path.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");
const DEFAULT_QUEUE_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-queue-state.json");
const DEFAULT_BATCH_PATH = path.join(REPO_ROOT, ".github/ai-state/webui-batch-plan.json");

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

function sanitizeState(state) {
  if (!state || typeof state !== "object") return state;
  const out = { ...state };
  if (Array.isArray(out.providers)) {
    out.providers = out.providers.map(sanitizeProvider);
  }
  return out;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const { secret, token, apiKey, password, credential, auth, ...safe } = entry;
  return safe;
}

// --- Core planning logic -----------------------------------------------------

function computeBatchPlan(state, queue) {
  const providers = (state.providers || [])
    .filter((p) => p.status === "available")
    .map((p) => ({
      id: p.id,
      maxConcurrency: p.maxConcurrency || 0,
      currentConcurrency: p.currentConcurrency || 0,
      headroom: Math.max(0, (p.maxConcurrency || 0) - (p.currentConcurrency || 0)),
    }))
    .filter((p) => p.headroom > 0);

  const queuedEntries = (queue.entries || [])
    .filter((e) => e.state === "queued")
    .map(sanitizeEntry);

  const plan = [];
  const skipped = [];
  const usedGroups = new Set();
  let providerIdx = 0;

  for (const entry of queuedEntries) {
    if (providerIdx >= providers.length) {
      skipped.push({
        issueNumber: entry.issueNumber,
        reason: "No provider capacity remaining",
      });
      continue;
    }

    if (entry.conflictGroup && usedGroups.has(entry.conflictGroup)) {
      skipped.push({
        issueNumber: entry.issueNumber,
        reason: "Conflict group already scheduled: " + entry.conflictGroup,
      });
      continue;
    }

    const provider = providers[providerIdx];
    plan.push({
      issueNumber: entry.issueNumber,
      providerId: provider.id,
      conflictGroup: entry.conflictGroup || null,
      actorRole: entry.actorRole || null,
    });

    if (entry.conflictGroup) {
      usedGroups.add(entry.conflictGroup);
    }

    provider.headroom--;
    if (provider.headroom <= 0) {
      providerIdx++;
    }
  }

  return { plan, skipped, providerCount: providers.length, queuedCount: queuedEntries.length };
}

// --- Action module interface -------------------------------------------------

module.exports = {
  id: "plan.next.batch",
  label: "Plan Next Batch",
  description: "Preview the next worker batch: queued issues matched to available provider capacity, respecting conflict groups.",
  dangerous: false,

  preview(payload) {
    const opts = payload || {};
    const statePath = opts.statePath || DEFAULT_STATE_PATH;
    const queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;

    const state = readJson(statePath);
    const queue = readJson(queuePath);

    if (!state) {
      return { ok: false, error: "Cannot read provider pool state", statePath };
    }
    if (!queue) {
      return { ok: false, error: "Cannot read queue state", queuePath };
    }

    const sanitized = sanitizeState(state);
    const result = computeBatchPlan(sanitized, queue);

    return {
      ok: true,
      dryRun: true,
      plan: result.plan,
      skipped: result.skipped,
      capacity: {
        availableProviders: result.providerCount,
        queuedIssues: result.queuedCount,
        planned: result.plan.length,
        skippedCount: result.skipped.length,
      },
      timestamp: new Date().toISOString(),
    };
  },

  execute(payload) {
    const opts = payload || {};

    if (!Array.isArray(opts.allowlist) || opts.allowlist.length === 0) {
      return { ok: false, error: "Execute requires an explicit allowlist array" };
    }
    if (!opts.reason || typeof opts.reason !== "string" || opts.reason.trim().length === 0) {
      return { ok: false, error: "Execute requires a non-empty reason string" };
    }

    const statePath = opts.statePath || DEFAULT_STATE_PATH;
    const queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;
    const batchPath = opts.batchPath || DEFAULT_BATCH_PATH;

    const state = readJson(statePath);
    const queue = readJson(queuePath);

    if (!state) {
      return { ok: false, error: "Cannot read provider pool state" };
    }
    if (!queue) {
      return { ok: false, error: "Cannot read queue state" };
    }

    const sanitized = sanitizeState(state);
    const result = computeBatchPlan(sanitized, queue);

    // Validate every planned issue is in the allowlist
    const allowset = new Set(opts.allowlist.map(Number));
    const blocked = result.plan.filter((p) => !allowset.has(p.issueNumber));
    if (blocked.length > 0) {
      return {
        ok: false,
        error: "Plan includes issues not in allowlist",
        blocked: blocked.map((b) => b.issueNumber),
      };
    }

    if (result.plan.length === 0) {
      return { ok: true, plan: [], skipped: result.skipped, message: "No issues to batch" };
    }

    // Write batch plan
    const batchPlan = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      reason: opts.reason,
      plan: result.plan,
      skipped: result.skipped,
    };

    try {
      fs.mkdirSync(path.dirname(batchPath), { recursive: true });
      fs.writeFileSync(batchPath, JSON.stringify(batchPlan, null, 2) + "\n", "utf-8");
    } catch (e) {
      return { ok: false, error: "Failed to write batch plan: " + e.message };
    }

    return {
      ok: true,
      plan: result.plan,
      skipped: result.skipped,
      reason: opts.reason,
      batchPath: "written",
      timestamp: batchPlan.capturedAt,
    };
  },
};
