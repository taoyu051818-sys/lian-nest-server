#!/usr/bin/env node
"use strict";

/**
 * Provider Pool WebUI — Action Registry
 *
 * Allowlisted action metadata for the WebUI control console.
 * Every action the UI can invoke is registered here with:
 *   - explicit id (no wildcards)
 *   - risk level
 *   - preview/dry-run default
 *   - required fields
 *   - privileged marker
 *   - script mapping
 *
 * Mutating actions default to preview mode and require explicit
 * allowlisting plus confirmation before execution.
 */

// --- Risk levels -----------------------------------------------------------

const RISK = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

// --- Action definitions ----------------------------------------------------

/**
 * Each action entry:
 *   id            — unique dot-delimited identifier
 *   label         — human-readable name
 *   description   — what the action does
 *   risk          — one of RISK values
 *   privileged    — true if the action requires elevated confirmation
 *   readOnly      — true if the action never mutates state
 *   defaultPreview — true to default to dry-run/preview mode
 *   requiredFields — array of field names the caller must supply
 *   script         — path to the script that implements the action (relative to repo root)
 *   confirmMessage — text shown to the operator before execution (privileged actions)
 *   category       — grouping for UI display
 */
const ACTIONS = Object.freeze([
  // --- Read-only actions ---------------------------------------------------
  {
    id: "view.provider.status",
    label: "View Provider Status",
    description: "Display current status, concurrency, and cooldown for a provider.",
    risk: RISK.LOW,
    privileged: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    script: null,
    confirmMessage: null,
    category: "view",
  },
  {
    id: "view.worker.status",
    label: "View Worker Status",
    description: "Display active worker assignments and health.",
    risk: RISK.LOW,
    privileged: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    script: null,
    confirmMessage: null,
    category: "view",
  },
  {
    id: "view.queue.status",
    label: "View Queue Status",
    description: "Display pending dispatch queue depth and blocked reasons.",
    risk: RISK.LOW,
    privileged: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    script: null,
    confirmMessage: null,
    category: "view",
  },
  {
    id: "view.resources",
    label: "View Resource Utilization",
    description: "Display concurrency utilization, headroom, and pressure level.",
    risk: RISK.LOW,
    privileged: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    script: null,
    confirmMessage: null,
    category: "view",
  },
  {
    id: "view.policy",
    label: "View Policy",
    description: "Display provider pool policy with secrets stripped.",
    risk: RISK.LOW,
    privileged: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    script: null,
    confirmMessage: null,
    category: "view",
  },

  // --- Provider management (medium risk) -----------------------------------
  {
    id: "provider.cooldown.reset",
    label: "Reset Provider Cooldown",
    description: "Clear the cooldown timer for an exhausted provider, making it available immediately.",
    risk: RISK.MEDIUM,
    privileged: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["providerId"],
    script: "scripts/ai/reset-provider-cooldown.ps1",
    confirmMessage: "Reset cooldown for provider {providerId}?",
    category: "provider",
  },
  {
    id: "provider.enable",
    label: "Enable Provider",
    description: "Re-enable a disabled provider so it can accept new workers.",
    risk: RISK.MEDIUM,
    privileged: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["providerId"],
    script: "scripts/ai/enable-provider.ps1",
    confirmMessage: "Enable provider {providerId}?",
    category: "provider",
  },
  {
    id: "provider.disable",
    label: "Disable Provider",
    description: "Disable a provider so it stops accepting new workers.",
    risk: RISK.MEDIUM,
    privileged: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["providerId"],
    script: "scripts/ai/disable-provider.ps1",
    confirmMessage: "Disable provider {providerId}?",
    category: "provider",
  },

  // --- Worker management (high risk, privileged) ---------------------------
  {
    id: "worker.kill",
    label: "Kill Worker",
    description: "Terminate a running worker process immediately.",
    risk: RISK.HIGH,
    privileged: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["workerId"],
    script: "scripts/ai/kill-worker.ps1",
    confirmMessage: "KILL worker {workerId}? This cannot be undone.",
    category: "worker",
  },
  {
    id: "worker.drain",
    label: "Drain Worker",
    description: "Gracefully drain a worker — finish current task, then stop.",
    risk: RISK.HIGH,
    privileged: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["workerId"],
    script: "scripts/ai/drain-worker.ps1",
    confirmMessage: "Drain worker {workerId}?",
    category: "worker",
  },

  // --- Worker control (high risk, dangerous) --------------------------------
  {
    id: "worker.control",
    label: "Worker Control",
    description: "List, preview, and stop workers with explicit worker targeting.",
    risk: RISK.HIGH,
    privileged: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["action"],
    script: "tools/provider-pool-webui/actions/worker-control.js",
    confirmMessage: "Execute worker control action?",
    category: "worker",
  },

  // --- Resource management (high risk, privileged) -------------------------
  {
    id: "concurrency.update",
    label: "Update Concurrency Limit",
    description: "Change max concurrency for a provider or the global limit.",
    risk: RISK.HIGH,
    privileged: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["target", "value"],
    script: "scripts/ai/update-concurrency.ps1",
    confirmMessage: "Set concurrency for {target} to {value}?",
    category: "resources",
  },
  {
    id: "queue.clear",
    label: "Clear Queue",
    description: "Remove all pending entries from the dispatch queue.",
    risk: RISK.HIGH,
    privileged: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    script: "scripts/ai/clear-queue.ps1",
    confirmMessage: "Clear all pending queue entries?",
    category: "queue",
  },

  // --- Settings / policy (critical risk, privileged) -----------------------
  {
    id: "settings.key.rotate",
    label: "Rotate Admin Token",
    description: "Generate a new admin token and invalidate the current one.",
    risk: RISK.CRITICAL,
    privileged: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    script: "scripts/ai/rotate-webui-token.ps1",
    confirmMessage: "Rotate admin token? The current token will be invalidated immediately.",
    category: "settings",
  },
  {
    id: "policy.update",
    label: "Update Policy",
    description: "Modify the provider pool policy file (concurrency, strategy, limits).",
    risk: RISK.CRITICAL,
    privileged: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ["field", "value"],
    script: "scripts/ai/update-policy.ps1",
    confirmMessage: "Update policy field {field} to {value}?",
    category: "settings",
  },
]);

// --- Index and lookup ------------------------------------------------------

const ACTION_MAP = new Map(ACTIONS.map((a) => [a.id, a]));
const PRIVILEGED_IDS = ACTIONS.filter((a) => a.privileged).map((a) => a.id);
const MUTABLE_IDS = ACTIONS.filter((a) => !a.readOnly).map((a) => a.id);
const READ_ONLY_IDS = ACTIONS.filter((a) => a.readOnly).map((a) => a.id);

// --- Public API ------------------------------------------------------------

/**
 * Look up an action by id. Returns undefined if not allowlisted.
 * @param {string} id
 * @returns {object|undefined}
 */
function getAction(id) {
  return ACTION_MAP.get(id);
}

/**
 * Check whether an action id is in the allowlist.
 * @param {string} id
 * @returns {boolean}
 */
function isAllowlisted(id) {
  return ACTION_MAP.has(id);
}

/**
 * Check whether an action is privileged.
 * @param {string} id
 * @returns {boolean}
 */
function isPrivileged(id) {
  const action = ACTION_MAP.get(id);
  return action ? action.privileged : false;
}

/**
 * Check whether an action is read-only.
 * @param {string} id
 * @returns {boolean}
 */
function isReadOnly(id) {
  const action = ACTION_MAP.get(id);
  return action ? action.readOnly : false;
}

/**
 * Return the default preview mode for an action.
 * Read-only actions return false; all others return true.
 * Returns null for unknown ids.
 * @param {string} id
 * @returns {boolean|null}
 */
function getDefaultPreview(id) {
  const action = ACTION_MAP.get(id);
  if (!action) return null;
  return action.defaultPreview;
}

/**
 * Validate that all required fields are present for an action.
 * Returns { valid: true } or { valid: false, missing: [...] }.
 * @param {string} id
 * @param {object} fields
 * @returns {{ valid: boolean, missing?: string[] }}
 */
function validateFields(id, fields) {
  const action = ACTION_MAP.get(id);
  if (!action) return { valid: false, missing: ["unknown action"] };
  const missing = action.requiredFields.filter((f) => !(f in fields) || fields[f] === undefined || fields[f] === null);
  return missing.length === 0 ? { valid: true } : { valid: false, missing };
}

/**
 * Render the confirmation message for an action, substituting field placeholders.
 * Returns null for unknown ids or read-only actions.
 * @param {string} id
 * @param {object} fields
 * @returns {string|null}
 */
function renderConfirmMessage(id, fields) {
  const action = ACTION_MAP.get(id);
  if (!action || !action.confirmMessage) return null;
  let msg = action.confirmMessage;
  for (const [key, val] of Object.entries(fields || {})) {
    msg = msg.replace(new RegExp(`\\{${key}\\}`, "g"), String(val));
  }
  return msg;
}

/**
 * Return all actions, optionally filtered by category.
 * @param {string} [category]
 * @returns {object[]}
 */
function listActions(category) {
  if (!category) return [...ACTIONS];
  return ACTIONS.filter((a) => a.category === category);
}

/**
 * Return all allowlisted action ids.
 * @returns {string[]}
 */
function listActionIds() {
  return ACTIONS.map((a) => a.id);
}

/**
 * Return all privileged action ids.
 * @returns {string[]}
 */
function listPrivilegedIds() {
  return [...PRIVILEGED_IDS];
}

/**
 * Return all mutable (non-read-only) action ids.
 * @returns {string[]}
 */
function listMutableIds() {
  return [...MUTABLE_IDS];
}

/**
 * Return all read-only action ids.
 * @returns {string[]}
 */
function listReadOnlyIds() {
  return [...READ_ONLY_IDS];
}

/**
 * Build a sanitized action descriptor for API responses.
 * Strips script paths to avoid leaking internal structure.
 * @param {string} id
 * @returns {object|null}
 */
function describeAction(id) {
  const action = ACTION_MAP.get(id);
  if (!action) return null;
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    risk: action.risk,
    privileged: action.privileged,
    readOnly: action.readOnly,
    defaultPreview: action.defaultPreview,
    requiredFields: [...action.requiredFields],
    category: action.category,
    hasScript: action.script !== null,
  };
}

/**
 * Return registry metadata for API consumption.
 * @returns {object}
 */
function registryMeta() {
  return {
    schemaVersion: 1,
    totalActions: ACTIONS.length,
    privilegedCount: PRIVILEGED_IDS.length,
    mutableCount: MUTABLE_IDS.length,
    readOnlyCount: READ_ONLY_IDS.length,
    riskLevels: Object.values(RISK),
    categories: [...new Set(ACTIONS.map((a) => a.category))],
  };
}

// --- Exports ---------------------------------------------------------------

module.exports = {
  RISK,
  ACTIONS,
  ACTION_MAP,
  getAction,
  isAllowlisted,
  isPrivileged,
  isReadOnly,
  getDefaultPreview,
  validateFields,
  renderConfirmMessage,
  listActions,
  listActionIds,
  listPrivilegedIds,
  listMutableIds,
  listReadOnlyIds,
  describeAction,
  registryMeta,
};
