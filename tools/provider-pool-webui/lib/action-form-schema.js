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
  allowlist: Object.freeze({
    type: "textarea",
    label: "Allowlist",
    placeholder: "e.g. 700, 701, 702",
    hint: "Comma-separated issue numbers",
    parse: "csv-number",
  }),
  reason: Object.freeze({
    type: "text",
    label: "Reason",
    placeholder: "Why this action?",
    autocomplete: "off",
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
// Maps server action module ids to their required field names.
// Server actions live in tools/provider-pool-webui/actions/ and are loaded
// dynamically by the server. They are not in the client-side action registry,
// so they need their own form field mapping here.

const SERVER_ACTION_FIELDS = Object.freeze({
  "plan.next.batch": Object.freeze(["reason", "allowlist"]),
});

/**
 * Build form field descriptors for a server action module.
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
  buildServerActionFormFields,
  buildServerActionFormSchema,
  formSchemaMeta,
  riskBadge,
  FIELD_TYPES,
  RISK_BADGE,
  SERVER_ACTION_FIELDS,
};
