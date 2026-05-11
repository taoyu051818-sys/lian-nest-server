"use strict";

/**
 * Safe action runner for allowlisted WebUI actions.
 *
 * Only the actions defined in provider-ui-policy.md are permitted.
 * All actions default to preview (dry-run) mode.
 * Mutations require explicit confirmation and produce audit entries.
 * Never reads, logs, or returns secrets.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-pool.json");
const DEFAULT_POLICY_PATH = path.join(REPO_ROOT, ".github/ai-policy/provider-pool-policy.json");
const DEFAULT_AUDIT_PATH = path.join(REPO_ROOT, ".github/ai-state/provider-ui-audit.ndjson");
const DEFAULT_TIMEOUT_MS = 5000;

// --- Allowlist ---------------------------------------------------------------

const ALLOWED_ACTIONS = new Set([
  "disable-provider",
  "enable-provider",
  "reset-cooldown",
  "adjust-max-concurrency",
  "adjust-global-max-workers",
]);

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

function appendAuditEntry(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

function sanitizeProvider(provider) {
  if (!provider || typeof provider !== "object") return provider;
  const { secret, sourcePath, secretSources, ...safe } = provider;
  return safe;
}

function sanitizeState(state) {
  if (!state || typeof state !== "object") return state;
  const sanitized = { ...state };
  if (Array.isArray(sanitized.providers)) {
    sanitized.providers = sanitized.providers.map(sanitizeProvider);
  }
  return sanitized;
}

// --- Action handlers ---------------------------------------------------------

/**
 * Each handler returns { ok, changes, summary }.
 * - changes: array of { field, from, to } describing what would change
 * - summary: human-readable sanitized description
 * Handlers do NOT mutate state — the runner applies changes after validation.
 */

function handleDisableProvider(state, params) {
  const providerId = params.providerId;
  const provider = (state.providers || []).find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found: " + providerId };
  }
  if (provider.status === "disabled") {
    return { ok: false, error: "Provider is already disabled" };
  }
  return {
    ok: true,
    changes: [{ target: providerId, field: "status", from: provider.status, to: "disabled" }],
    summary: "Disable provider " + providerId + " (was " + provider.status + ")",
  };
}

function handleEnableProvider(state, params) {
  const providerId = params.providerId;
  const provider = (state.providers || []).find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found: " + providerId };
  }
  if (provider.status !== "disabled") {
    return { ok: false, error: "Provider is not disabled (current: " + provider.status + ")" };
  }
  return {
    ok: true,
    changes: [{ target: providerId, field: "status", from: "disabled", to: "available" }],
    summary: "Enable provider " + providerId,
  };
}

function handleResetCooldown(state, params) {
  const providerId = params.providerId;
  const provider = (state.providers || []).find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found: " + providerId };
  }
  if (!provider.cooldownExpiresAt) {
    return { ok: false, error: "Provider has no active cooldown" };
  }
  return {
    ok: true,
    changes: [
      { target: providerId, field: "cooldownExpiresAt", from: provider.cooldownExpiresAt, to: null },
      { target: providerId, field: "status", from: provider.status, to: "available" },
    ],
    summary: "Reset cooldown for provider " + providerId,
  };
}

function handleAdjustMaxConcurrency(state, params) {
  const providerId = params.providerId;
  const value = params.value;
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: "value must be a positive integer" };
  }
  const provider = (state.providers || []).find((p) => p.id === providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found: " + providerId };
  }
  const globalMax = state.global?.globalMaxWorkers || 0;
  if (value > globalMax) {
    return {
      ok: false,
      error: "value (" + value + ") exceeds globalMaxWorkers (" + globalMax + ")",
    };
  }
  return {
    ok: true,
    changes: [
      { target: providerId, field: "maxConcurrency", from: provider.maxConcurrency, to: value },
    ],
    summary: "Set maxConcurrency for " + providerId + " from " + provider.maxConcurrency + " to " + value,
  };
}

function handleAdjustGlobalMaxWorkers(state, params) {
  const value = params.value;
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: "value must be a positive integer" };
  }
  const current = state.global?.globalMaxWorkers || 0;
  return {
    ok: true,
    changes: [{ target: "global", field: "globalMaxWorkers", from: current, to: value }],
    summary: "Set globalMaxWorkers from " + current + " to " + value,
  };
}

const ACTION_HANDLERS = {
  "disable-provider": handleDisableProvider,
  "enable-provider": handleEnableProvider,
  "reset-cooldown": handleResetCooldown,
  "adjust-max-concurrency": handleAdjustMaxConcurrency,
  "adjust-global-max-workers": handleAdjustGlobalMaxWorkers,
};

// --- Validation --------------------------------------------------------------

function validateParams(action, params) {
  if (!params || typeof params !== "object") {
    return "params object is required";
  }

  if (action === "disable-provider" || action === "enable-provider" || action === "reset-cooldown") {
    if (!params.providerId || typeof params.providerId !== "string") {
      return "providerId is required";
    }
  }

  if (action === "adjust-max-concurrency") {
    if (!params.providerId || typeof params.providerId !== "string") {
      return "providerId is required";
    }
    if (params.value === undefined || params.value === null) {
      return "value is required";
    }
  }

  if (action === "adjust-global-max-workers") {
    if (params.value === undefined || params.value === null) {
      return "value is required";
    }
  }

  return null;
}

// --- Apply changes to state --------------------------------------------------

function applyChanges(state, changes) {
  const next = JSON.parse(JSON.stringify(state));
  for (const change of changes) {
    if (change.target === "global") {
      if (!next.global) next.global = {};
      next.global[change.field] = change.to;
    } else {
      const provider = (next.providers || []).find((p) => p.id === change.target);
      if (provider) {
        provider[change.field] = change.to;
      }
    }
  }
  return next;
}

// --- Timeout wrapper ---------------------------------------------------------

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Action timed out after " + ms + "ms")), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// --- Main entry point --------------------------------------------------------

/**
 * Run an allowlisted action in preview or execute mode.
 *
 * @param {string} action - Action name (must be in ALLOWED_ACTIONS)
 * @param {object} opts
 * @param {boolean}  [opts.dryRun=true]    - Preview only; do not write state
 * @param {boolean}  [opts.confirm=false]  - Required true for execute mode
 * @param {object}   [opts.params={}]      - Action-specific parameters
 * @param {number}   [opts.timeoutMs=5000] - Operation timeout
 * @param {string}   [opts.actor="webui"]  - Who initiated the action
 * @param {string}   [opts.statePath]      - Override state file path
 * @param {string}   [opts.policyPath]     - Override policy file path
 * @param {string}   [opts.auditPath]      - Override audit log path
 * @returns {Promise<object>} Result with { ok, action, mode, changes, summary, timestamp }
 */
async function runAction(action, opts) {
  const options = opts || {};
  const dryRun = options.dryRun !== false;
  const confirm = options.confirm === true;
  const params = options.params;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const actor = options.actor || "webui";
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const policyPath = options.policyPath || DEFAULT_POLICY_PATH;
  const auditPath = options.auditPath || DEFAULT_AUDIT_PATH;
  const timestamp = new Date().toISOString();

  const exec = async () => {
    // 1. Allowlist check
    if (!ALLOWED_ACTIONS.has(action)) {
      return {
        ok: false,
        action,
        mode: "rejected",
        error: "Action not allowlisted: " + action,
        timestamp,
      };
    }

    // 2. Params validation
    if (!params || typeof params !== "object") {
      return {
        ok: false,
        action,
        mode: "rejected",
        error: "params object is required",
        timestamp,
      };
    }
    const paramError = validateParams(action, params);
    if (paramError) {
      return {
        ok: false,
        action,
        mode: "rejected",
        error: paramError,
        timestamp,
      };
    }

    // 3. Load state
    const state = readJson(statePath);
    if (!state) {
      return {
        ok: false,
        action,
        mode: "rejected",
        error: "Cannot read provider pool state",
        timestamp,
      };
    }

    // 4. Load policy (for reference validation)
    const policy = readJson(policyPath);

    // 5. Run action handler
    const handler = ACTION_HANDLERS[action];
    const result = handler(state, params);
    if (!result.ok) {
      return {
        ok: false,
        action,
        mode: "rejected",
        error: result.error,
        timestamp,
      };
    }

    // 6. Prepare audit entry (always, even in preview)
    const auditEntry = {
      timestamp,
      action,
      params: sanitizeParams(params),
      actor,
      mode: dryRun ? "preview" : "execute",
      changes: result.changes,
      summary: result.summary,
    };

    // 7. Preview mode
    if (dryRun) {
      return {
        ok: true,
        action,
        mode: "preview",
        changes: result.changes,
        summary: result.summary,
        audit: auditEntry,
        timestamp,
      };
    }

    // 8. Execute mode requires confirmation
    if (!confirm) {
      return {
        ok: false,
        action,
        mode: "confirmation-required",
        changes: result.changes,
        summary: result.summary,
        error: "Execute mode requires confirm=true",
        timestamp,
      };
    }

    // 9. Apply changes
    const newState = applyChanges(state, result.changes);
    writeJson(statePath, newState);

    // 10. Write audit entry
    appendAuditEntry(auditPath, auditEntry);

    return {
      ok: true,
      action,
      mode: "execute",
      changes: result.changes,
      summary: result.summary,
      audit: auditEntry,
      timestamp,
    };
  };

  return withTimeout(exec(), timeoutMs);
}

// Sanitize params for audit — never include secrets
function sanitizeParams(params) {
  if (!params || typeof params !== "object") return {};
  const safe = {};
  for (const key of Object.keys(params)) {
    const lk = key.toLowerCase();
    if (lk.includes("secret") || lk.includes("token") || lk.includes("key") || lk.includes("password")) {
      continue;
    }
    safe[key] = params[key];
  }
  return safe;
}

module.exports = {
  ALLOWED_ACTIONS,
  runAction,
  // Exported for testing
  readJson,
  applyChanges,
  sanitizeParams,
};
