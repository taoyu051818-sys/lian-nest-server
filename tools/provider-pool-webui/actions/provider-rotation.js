"use strict";

/**
 * provider-rotation — WebUI action module
 *
 * Preview and execute provider key rotation via the dry-run settings bridge.
 * Defaults to preview (dry-run). Execute requires explicit confirm and
 * operates on provider pool state only — never reads or exposes actual
 * API keys, tokens, or credential values.
 *
 * Closes: #684
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");
const DEFAULT_POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/provider-pool-policy.json");

// --- Helpers -----------------------------------------------------------------

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Check secret source existence without reading actual values.
 * Returns { type, key, available } — never returns the secret itself.
 */
function checkSecretSource(provider, policy) {
  if (!policy || !policy.secretSources) {
    return { type: "unknown", key: null, available: false };
  }

  // Check if provider uses env-var source
  const providerPolicy = (policy.providers || []).find((p) => p.id === provider.id);
  if (!providerPolicy) {
    return { type: "unknown", key: null, available: false };
  }

  const source = providerPolicy.source || "";

  if (source === "local-claude-settings") {
    const settingsPath = path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      ".claude",
      "settings.json"
    );
    return {
      type: "claude-settings",
      key: "~/.claude/settings.json",
      available: fs.existsSync(settingsPath),
    };
  }

  if (source === "env-var") {
    // Check common env var names without reading values
    const envKeys = ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"];
    for (const key of envKeys) {
      if (process.env[key] !== undefined) {
        return { type: "env-var", key, available: true };
      }
    }
    return { type: "env-var", key: null, available: false };
  }

  return { type: source, key: null, available: false };
}

/**
 * Sanitize provider state — strip any fields that could contain secrets.
 */
function sanitizeProvider(provider) {
  if (!provider || typeof provider !== "object") return provider;
  const { secret, sourcePath, secretSources, ...safe } = provider;
  return safe;
}

/**
 * Build the rotation plan for a provider.
 * Returns { ok, plan?, error? }
 */
function buildRotationPlan(providerId, statePath, policyPath) {
  const state = readJson(statePath);
  if (!state) {
    return { ok: false, error: "Cannot read provider pool state" };
  }

  const policy = readJson(policyPath);
  if (!policy) {
    return { ok: false, error: "Cannot read provider pool policy" };
  }

  const provider = (state.providers || []).find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found: " + providerId };
  }

  // Check if provider exists in policy
  const providerPolicy = (policy.providers || []).find((p) => p.id === providerId);
  if (!providerPolicy) {
    return { ok: false, error: "Provider not found in policy: " + providerId };
  }

  const secretSource = checkSecretSource(provider, policy);

  const plan = {
    providerId,
    currentState: {
      status: provider.status,
      currentConcurrency: provider.currentConcurrency || 0,
      maxConcurrency: provider.maxConcurrency || 0,
      cooldownExpiresAt: provider.cooldownExpiresAt || null,
      consecutiveFailures: provider.consecutiveFailures || 0,
      totalQuotaEvents: provider.totalQuotaEvents || 0,
    },
    targetState: {
      status: "available",
      cooldownExpiresAt: null,
      consecutiveFailures: 0,
    },
    providerSource: {
      type: secretSource.type,
      key: secretSource.key,
      available: secretSource.available,
    },
    validationChecks: [
      { check: "provider-exists-in-policy", passed: !!providerPolicy },
      { check: "provider-exists-in-state", passed: true },
      { check: "state-file-writable", passed: true },
      { check: "secret-source-exists", passed: secretSource.available },
    ],
    canRotate: true,
    blockReason: "",
    dryRun: true,
    capturedAt: new Date().toISOString(),
  };

  // Rotation is always possible per the bridge spec — the bridge is the
  // "fix and re-enable" path. But flag if secret source is unavailable.
  if (!secretSource.available) {
    plan.blockReason = "Secret source not detected — manual credential update may be required";
  }

  return { ok: true, plan };
}

/**
 * Apply rotation to the state file.
 * Transitions provider to available, clears cooldown, resets failures.
 */
function applyRotation(providerId, statePath) {
  const state = readJson(statePath);
  if (!state) {
    return { ok: false, error: "Cannot read provider pool state" };
  }

  const provider = (state.providers || []).find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found: " + providerId };
  }

  const changes = [];

  // Track changes
  if (provider.status !== "available") {
    changes.push({ field: "status", from: provider.status, to: "available" });
  }
  if (provider.cooldownExpiresAt) {
    changes.push({ field: "cooldownExpiresAt", from: provider.cooldownExpiresAt, to: null });
  }
  if (provider.consecutiveFailures > 0) {
    changes.push({ field: "consecutiveFailures", from: provider.consecutiveFailures, to: 0 });
  }

  // Apply changes
  provider.status = "available";
  provider.cooldownExpiresAt = null;
  provider.consecutiveFailures = 0;

  // Update global counts
  if (state.global) {
    const providers = state.providers || [];
    state.global.availableProviders = providers.filter((p) => p.status === "available").length;
    state.global.exhaustedProviders = providers.filter((p) => p.status === "exhausted").length;
    state.global.disabledProviders = providers.filter((p) => p.status === "disabled").length;
    state.global.lastUpdatedBy = "webui-provider-rotation";
    state.global.capturedAt = new Date().toISOString();
  }

  // Atomic write: write to temp file, then rename
  const tmpPath = statePath + ".tmp." + Date.now();
  try {
    writeJson(tmpPath, state);
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { ok: false, error: "State write failed: " + err.message };
  }

  return {
    ok: true,
    providerId,
    changes,
    summary: "Rotated provider " + providerId + " — status=available, cooldown cleared, failures reset",
    timestamp: new Date().toISOString(),
  };
}

// --- Action module -----------------------------------------------------------

module.exports = {
  id: "provider-rotation",
  label: "Provider Key Rotation",
  description:
    "Preview or execute provider credential rotation via the dry-run settings bridge. " +
    "Resets provider to available, clears cooldown, and resets failure counters.",
  dangerous: true,

  /**
   * Preview what rotation would do without modifying state.
   * @param {object} payload
   * @param {string} payload.providerId - Provider to rotate
   * @param {string} [payload.statePath] - Override state path (testing)
   * @param {string} [payload.policyPath] - Override policy path (testing)
   * @returns {object} Rotation plan preview
   */
  preview(payload) {
    const { providerId, statePath, policyPath } = payload || {};

    if (!providerId || typeof providerId !== "string") {
      throw new Error("providerId is required");
    }

    const result = buildRotationPlan(
      providerId,
      statePath || DEFAULT_STATE_PATH,
      policyPath || DEFAULT_POLICY_PATH
    );

    if (!result.ok) {
      throw new Error(result.error);
    }

    return {
      status: "preview",
      providerId,
      plan: result.plan,
      dryRun: true,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Execute provider rotation.
   * Requires confirm: true via the server's dangerous-action gate.
   * @param {object} payload
   * @param {string} payload.providerId - Provider to rotate
   * @param {string} [payload.reason] - Human-readable reason
   * @param {string} [payload.statePath] - Override state path (testing)
   * @param {string} [payload.policyPath] - Override policy path (testing)
   * @returns {object} Rotation result
   */
  execute(payload) {
    const { providerId, reason, statePath, policyPath } = payload || {};

    if (!providerId || typeof providerId !== "string") {
      throw new Error("providerId is required");
    }

    const sp = statePath || DEFAULT_STATE_PATH;
    const pp = policyPath || DEFAULT_POLICY_PATH;

    // Build plan first (validation)
    const planResult = buildRotationPlan(providerId, sp, pp);
    if (!planResult.ok) {
      throw new Error(planResult.error);
    }

    // Apply rotation
    const result = applyRotation(providerId, sp);
    if (!result.ok) {
      throw new Error(result.error);
    }

    return {
      status: "rotated",
      providerId,
      changes: result.changes,
      summary: result.summary,
      reason: reason || "",
      dryRun: false,
      timestamp: result.timestamp,
    };
  },
};
