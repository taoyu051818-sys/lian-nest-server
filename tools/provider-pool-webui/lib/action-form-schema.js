"use strict";

/**
 * Action Form Schema — pure helpers for WebUI form rendering.
 *
 * Maps action registry descriptors (requiredFields, risk, privileged, etc.)
 * to UI-friendly form metadata. No DOM, no server, no side effects.
 */

const { getAction, listActions, RISK } = require("./action-registry");

// --- Field type inference ---------------------------------------------------

const FIELD_TYPES = Object.freeze({
  providerId: Object.freeze({
    type: "text",
    label: "Provider ID",
    placeholder: "e.g. provider-default",
    autocomplete: "provider",
  }),
  workerId: Object.freeze({
    type: "text",
    label: "Worker ID",
    placeholder: "e.g. worker-abc123",
    autocomplete: "worker",
  }),
  target: Object.freeze({
    type: "text",
    label: "Target",
    placeholder: "e.g. provider-default or global",
    autocomplete: "off",
  }),
  value: Object.freeze({
    type: "number",
    label: "Value",
    placeholder: "e.g. 10",
    min: 1,
    step: 1,
  }),
  field: Object.freeze({
    type: "text",
    label: "Policy Field",
    placeholder: "e.g. strategy",
    autocomplete: "off",
  }),
  title: Object.freeze({
    type: "text",
    label: "Issue Title",
    placeholder: "e.g. feat(module): add feature X",
    autocomplete: "off",
  }),
  gapKey: Object.freeze({
    type: "text",
    label: "Gap Key",
    placeholder: "e.g. auth-slice-2",
    autocomplete: "off",
  }),
  labels: Object.freeze({
    type: "text",
    label: "Labels",
    placeholder: "e.g. wave21, gap-fill (comma-separated)",
    autocomplete: "off",
  }),
  prNumbers: Object.freeze({
    type: "text",
    label: "PR Numbers",
    placeholder: "e.g. 760, 759, 758 (comma-separated)",
    autocomplete: "off",
  }),
  repo: Object.freeze({
    type: "text",
    label: "Repository",
    placeholder: "e.g. owner/repo",
    autocomplete: "off",
  }),
  reason: Object.freeze({
    type: "text",
    label: "Reason",
    placeholder: "e.g. credential rotation, quota reset",
    autocomplete: "off",
    helpText: "Required for stop operations. Recorded in the audit log.",
  }),
  action: Object.freeze({
    type: "select",
    label: "Operation",
    options: Object.freeze([
      Object.freeze({ value: "list", label: "List Workers" }),
      Object.freeze({ value: "stop", label: "Stop Workers" }),
    ]),
  }),
  workerIds: Object.freeze({
    type: "text",
    label: "Worker IDs",
    placeholder: "e.g. provider-alpha-slot-0, provider-beta-slot-1",
    autocomplete: "off",
    helpText: "Comma-separated worker IDs. No wildcard — must specify each worker explicitly.",
  }),
  targetIssue: Object.freeze({
    type: "number",
    label: "Target Issue",
    placeholder: "e.g. 764",
    min: 1,
    step: 1,
  }),
  conflictGroup: Object.freeze({
    type: "text",
    label: "Conflict Group",
    placeholder: "e.g. wave21-webui-operation",
    autocomplete: "off",
  }),
  taskType: Object.freeze({
    type: "select",
    label: "Task Type",
    placeholder: "select type",
    options: Object.freeze(["operation", "test", "docs", "bugfix", "feature", "refactor", "execution", "research", "review"]),
  }),
  risk: Object.freeze({
    type: "select",
    label: "Risk",
    placeholder: "select risk",
    options: Object.freeze(["low", "medium", "high", "critical"]),
  }),
  mainHealthPolicy: Object.freeze({
    type: "select",
    label: "Health Policy",
    placeholder: "select policy",
    options: Object.freeze(["standard", "recovery", "none"]),
  }),
  sharedLocks: Object.freeze({
    type: "text",
    label: "Shared Locks",
    placeholder: "e.g. app-module:auth, comma-separated",
    autocomplete: "off",
  }),
  allowedFiles: Object.freeze({
    type: "textarea",
    label: "Allowed Files",
    placeholder: "One glob pattern per line",
  }),
  validationCommands: Object.freeze({
    type: "textarea",
    label: "Validation Commands",
    placeholder: "One command per line",
  }),
  rolePacket: Object.freeze({
    type: "object",
    label: "Role Packet",
    fields: Object.freeze({
      actorRole: Object.freeze({
        type: "text",
        label: "Actor Role",
        placeholder: "e.g. claude-code-worker",
        autocomplete: "off",
      }),
    }),
  }),
  allowlist: Object.freeze({
    type: "textarea",
    label: "Allowlist",
    placeholder: "e.g. 700, 701, 702",
    hint: "Comma-separated issue numbers",
    parse: "csv-number",
  }),
});

const DEFAULT_FIELD = Object.freeze({
  type: "text",
  label: null, // derived from field name
  placeholder: "",
  autocomplete: "off",
});

// --- Risk badge config ------------------------------------------------------

const RISK_BADGE = Object.freeze({
  low: Object.freeze({ level: "low", color: "green", label: "Low Risk", cssClass: "risk-low" }),
  medium: Object.freeze({ level: "medium", color: "yellow", label: "Medium Risk", cssClass: "risk-medium" }),
  high: Object.freeze({ level: "high", color: "orange", label: "High Risk", cssClass: "risk-high" }),
  critical: Object.freeze({ level: "critical", color: "red", label: "Critical Risk", cssClass: "risk-critical" }),
});

// --- Public API --------------------------------------------------------------

/**
 * Derive a form field descriptor from a field name.
 *
 * @param {string} fieldName
 * @returns {object} Field descriptor { name, type, label, placeholder, required, ... }
 */
function buildFieldDescriptor(fieldName) {
  const known = FIELD_TYPES[fieldName];
  const base = known || {
    ...DEFAULT_FIELD,
    label: humanizeFieldName(fieldName),
  };
  return Object.freeze({
    name: fieldName,
    required: true,
    ...base,
    label: base.label || humanizeFieldName(fieldName),
  });
}

/**
 * Build form field descriptors for an array of required field names.
 *
 * @param {string[]} requiredFields
 * @returns {object[]}
 */
function buildFormFields(requiredFields) {
  if (!Array.isArray(requiredFields)) return [];
  return requiredFields.map(buildFieldDescriptor);
}

/**
 * Get risk badge metadata for a risk level.
 *
 * @param {string} risk - One of RISK values
 * @returns {object|null}
 */
function riskBadge(risk) {
  return RISK_BADGE[risk] || null;
}

/**
 * Build a complete form schema for a single action.
 *
 * @param {string} actionId
 * @returns {object|null} Form schema or null if action not found
 */
function buildFormSchema(actionId) {
  const action = getAction(actionId);
  if (!action) return null;

  const fields = buildFormFields(action.requiredFields);
  const badge = riskBadge(action.risk);

  return Object.freeze({
    actionId: action.id,
    title: action.label,
    description: action.description,
    category: action.category,
    risk: action.risk,
    riskBadge: badge,
    privileged: action.privileged,
    readOnly: action.readOnly,
    defaultPreview: action.defaultPreview,
    fields,
    hasConfirmMessage: typeof action.confirmMessage === "string" && action.confirmMessage.length > 0,
    submitLabel: action.readOnly ? "View" : (action.privileged ? "Execute (Privileged)" : "Execute"),
    previewLabel: "Preview",
  });
}

/**
 * Build form schemas for multiple actions (or all actions).
 *
 * @param {string[]} [actionIds] - If omitted, returns schemas for all actions
 * @returns {object[]}
 */
function buildFormSchemas(actionIds) {
  if (!actionIds) {
    return listActions().map((a) => buildFormSchema(a.id)).filter(Boolean);
  }
  return actionIds.map(buildFormSchema).filter(Boolean);
}

/**
 * Build form schemas grouped by category.
 *
 * @returns {Object<string, object[]>}
 */
function buildFormSchemasByCategory() {
  const grouped = {};
  for (const action of listActions()) {
    if (!grouped[action.category]) grouped[action.category] = [];
    grouped[action.category].push(buildFormSchema(action.id));
  }
  return grouped;
}

/**
 * Get summary metadata for the form schema system.
 *
 * @returns {object}
 */
function formSchemaMeta() {
  const all = buildFormSchemas();
  return {
    schemaVersion: 1,
    totalForms: all.length,
    withFields: all.filter((f) => f.fields.length > 0).length,
    readOnlyForms: all.filter((f) => f.readOnly).length,
    privilegedForms: all.filter((f) => f.privileged).length,
    riskDistribution: {
      low: all.filter((f) => f.risk === RISK.LOW).length,
      medium: all.filter((f) => f.risk === RISK.MEDIUM).length,
      high: all.filter((f) => f.risk === RISK.HIGH).length,
      critical: all.filter((f) => f.risk === RISK.CRITICAL).length,
    },
  };
}

// --- Server action form fields -----------------------------------------------

const SERVER_ACTION_FIELDS = Object.freeze({
  "plan.next.batch": Object.freeze(["reason", "allowlist"]),
});

/**
 * Build form field descriptors for a server action module descriptor.
 *
 * Server action modules are loaded dynamically from tools/provider-pool-webui/actions/
 * and may not be in the static action registry. This function accepts the
 * server-provided metadata (id, label, description, requiredFields, dangerous)
 * and returns structured field descriptors using the same FIELD_TYPES mapping.
 *
 * @param {object} serverAction - { id, label, description, requiredFields, dangerous }
 * @returns {object[]} Array of field descriptors
 */
function buildServerFormFields(serverAction) {
  if (!serverAction || !Array.isArray(serverAction.requiredFields)) return [];
  return serverAction.requiredFields.map((fieldName) => {
    const desc = buildFieldDescriptor(fieldName);
    return desc;
  });
}

/**
 * Build form field descriptors for a known server action id.
 *
 * @param {string} actionId
 * @returns {object[]}
 */
function buildServerActionFormFields(actionId) {
  const fields = SERVER_ACTION_FIELDS[actionId];
  if (!fields) return [];
  return buildFormFields(fields);
}

/**
 * Build a complete form schema for a server action module.
 *
 * @param {string} actionId
 * @param {object} meta - Server action metadata { id, label, description, dangerous }
 * @returns {object|null}
 */
function buildServerActionFormSchema(actionId, meta) {
  if (!meta || meta.id !== actionId) return null;
  const fields = buildServerActionFormFields(actionId);
  return Object.freeze({
    actionId,
    title: meta.label || actionId,
    description: meta.description || "",
    risk: meta.dangerous ? "high" : "low",
    riskBadge: meta.dangerous ? RISK_BADGE.high : RISK_BADGE.low,
    privileged: false,
    readOnly: false,
    defaultPreview: true,
    fields,
    hasConfirmMessage: false,
    submitLabel: meta.dangerous ? "Execute (Dangerous)" : "Execute",
    previewLabel: "Preview",
  });
}

// --- Internal helpers --------------------------------------------------------

function humanizeFieldName(name) {
  if (!name || typeof name !== "string") return "";
  // camelCase → "Camel Case"
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  buildFieldDescriptor,
  buildFormFields,
  buildFormSchema,
  buildFormSchemas,
  buildFormSchemasByCategory,
  buildServerFormFields,
  buildServerActionFormFields,
  buildServerActionFormSchema,
  formSchemaMeta,
  riskBadge,
  FIELD_TYPES,
  RISK_BADGE,
  SERVER_ACTION_FIELDS,
};
