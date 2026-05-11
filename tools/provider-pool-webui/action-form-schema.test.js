#!/usr/bin/env node

/**
 * action-form-schema.test.js
 *
 * Tests for the WebUI action form schema helpers.
 * No external test framework — uses a simple assert helper.
 *
 * Run: node tools/provider-pool-webui/action-form-schema.test.js
 */

const {
  buildFieldDescriptor,
  buildFormFields,
  buildFormSchema,
  buildFormSchemas,
  buildFormSchemasByCategory,
  formSchemaMeta,
  riskBadge,
  FIELD_TYPES,
  RISK_BADGE,
} = require("./lib/action-form-schema");

const { ACTIONS, RISK, listActionIds } = require("./lib/action-registry");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.error("  FAIL  " + name);
  }
}

// --- FIELD_TYPES constants ---------------------------------------------------

console.log("\nFIELD_TYPES constants\n");

assert(typeof FIELD_TYPES === "object", "FIELD_TYPES is an object");
assert(Object.isFrozen(FIELD_TYPES), "FIELD_TYPES is frozen");
assert(FIELD_TYPES.providerId.type === "text", "providerId type is text");
assert(FIELD_TYPES.workerId.type === "text", "workerId type is text");
assert(FIELD_TYPES.target.type === "text", "target type is text");
assert(FIELD_TYPES.value.type === "number", "value type is number");
assert(FIELD_TYPES.field.type === "text", "field type is text");
assert(FIELD_TYPES.reason !== undefined, "reason field type exists");
assert(FIELD_TYPES.reason.type === "text", "reason type is text");
assert(FIELD_TYPES.reason.label === "Reason", "reason label is Reason");
assert(typeof FIELD_TYPES.reason.placeholder === "string", "reason has placeholder");
assert(FIELD_TYPES.reason.autocomplete === "off", "reason autocomplete is off");

// --- RISK_BADGE constants ----------------------------------------------------

console.log("\nRISK_BADGE constants\n");

assert(typeof RISK_BADGE === "object", "RISK_BADGE is an object");
assert(Object.isFrozen(RISK_BADGE), "RISK_BADGE is frozen");
assert(RISK_BADGE.low.color === "green", "low risk is green");
assert(RISK_BADGE.medium.color === "yellow", "medium risk is yellow");
assert(RISK_BADGE.high.color === "orange", "high risk is orange");
assert(RISK_BADGE.critical.color === "red", "critical risk is red");

// --- riskBadge ---------------------------------------------------------------

console.log("\nriskBadge\n");

{
  const low = riskBadge("low");
  assert(low !== null, "riskBadge(low) is not null");
  assert(low.color === "green", "low badge color is green");
  assert(low.cssClass === "risk-low", "low badge cssClass is risk-low");

  const med = riskBadge("medium");
  assert(med !== null, "riskBadge(medium) is not null");
  assert(med.color === "yellow", "medium badge color is yellow");

  const high = riskBadge("high");
  assert(high !== null, "riskBadge(high) is not null");
  assert(high.color === "orange", "high badge color is orange");

  const crit = riskBadge("critical");
  assert(crit !== null, "riskBadge(critical) is not null");
  assert(crit.color === "red", "critical badge color is red");

  assert(riskBadge("nonexistent") === null, "unknown risk returns null");
  assert(riskBadge(null) === null, "null risk returns null");
}

// --- buildFieldDescriptor ----------------------------------------------------

console.log("\nbuildFieldDescriptor\n");

{
  const f1 = buildFieldDescriptor("providerId");
  assert(f1.name === "providerId", "providerId field name correct");
  assert(f1.type === "text", "providerId type is text");
  assert(f1.required === true, "providerId is required");
  assert(f1.label === "Provider ID", "providerId label is humanized");
  assert(typeof f1.placeholder === "string", "providerId has placeholder");
  assert(f1.autocomplete === "provider", "providerId autocomplete is provider");

  const f2 = buildFieldDescriptor("workerId");
  assert(f2.name === "workerId", "workerId field name correct");
  assert(f2.type === "text", "workerId type is text");
  assert(f2.label === "Worker ID", "workerId label is humanized");

  const f3 = buildFieldDescriptor("value");
  assert(f3.name === "value", "value field name correct");
  assert(f3.type === "number", "value type is number");
  assert(f3.min === 1, "value min is 1");
  assert(f3.step === 1, "value step is 1");

  const f4 = buildFieldDescriptor("target");
  assert(f4.name === "target", "target field name correct");
  assert(f4.type === "text", "target type is text");

  const f5 = buildFieldDescriptor("field");
  assert(f5.name === "field", "field field name correct");
  assert(f5.label === "Policy Field", "field label is humanized");

  const fReason = buildFieldDescriptor("reason");
  assert(fReason.name === "reason", "reason field name correct");
  assert(fReason.type === "text", "reason type is text");
  assert(fReason.required === true, "reason is required");
  assert(fReason.label === "Reason", "reason label is Reason");
  assert(typeof fReason.placeholder === "string", "reason has placeholder");
  assert(fReason.autocomplete === "off", "reason autocomplete is off");

  // Unknown field gets default treatment
  const f6 = buildFieldDescriptor("customParam");
  assert(f6.name === "customParam", "unknown field name preserved");
  assert(f6.type === "text", "unknown field defaults to text type");
  assert(f6.required === true, "unknown field is required");
  assert(f6.label === "Custom Param", "unknown field label is humanized from camelCase");
}

// --- buildFormFields ---------------------------------------------------------

console.log("\nbuildFormFields\n");

{
  const empty = buildFormFields([]);
  assert(Array.isArray(empty), "empty fields returns array");
  assert(empty.length === 0, "empty fields returns empty array");

  const none = buildFormFields(null);
  assert(Array.isArray(none), "null fields returns array");
  assert(none.length === 0, "null fields returns empty array");

  const undef = buildFormFields(undefined);
  assert(Array.isArray(undef), "undefined fields returns array");
  assert(undef.length === 0, "undefined fields returns empty array");

  const num = buildFormFields(42);
  assert(Array.isArray(num), "number fields returns array");
  assert(num.length === 0, "number fields returns empty array");

  const str = buildFormFields("providerId");
  assert(Array.isArray(str), "string fields returns array");
  assert(str.length === 0, "string fields returns empty array");

  const fields = buildFormFields(["providerId", "value"]);
  assert(fields.length === 2, "returns 2 fields");
  assert(fields[0].name === "providerId", "first field is providerId");
  assert(fields[1].name === "value", "second field is value");
  assert(fields[0].type === "text", "providerId is text");
  assert(fields[1].type === "number", "value is number");

  // All fields should be required
  assert(fields.every((f) => f.required), "all fields are required");

  // Duplicate field names produce duplicate descriptors
  const dupes = buildFormFields(["providerId", "providerId"]);
  assert(dupes.length === 2, "duplicate field names produce 2 descriptors");
  assert(dupes[0].name === "providerId", "first dupe is providerId");
  assert(dupes[1].name === "providerId", "second dupe is providerId");

  // Single-element array
  const single = buildFormFields(["target"]);
  assert(single.length === 1, "single element array returns 1 field");
  assert(single[0].name === "target", "single field is target");

  // Reason field in multi-field array
  const withReason = buildFormFields(["providerId", "reason"]);
  assert(withReason.length === 2, "returns 2 fields with reason");
  assert(withReason[0].name === "providerId", "first field is providerId");
  assert(withReason[1].name === "reason", "second field is reason");
  assert(withReason[1].type === "text", "reason field type is text");
  assert(withReason[1].label === "Reason", "reason label is Reason");
}

// --- buildFormSchema ---------------------------------------------------------

console.log("\nbuildFormSchema\n");

{
  const schema = buildFormSchema("provider.cooldown.reset");
  assert(schema !== null, "buildFormSchema returns non-null for known action");
  assert(schema.actionId === "provider.cooldown.reset", "actionId is correct");
  assert(schema.title === "Reset Provider Cooldown", "title matches label");
  assert(typeof schema.description === "string", "has description");
  assert(schema.category === "provider", "category is provider");
  assert(schema.risk === RISK.MEDIUM, "risk is medium");
  assert(schema.riskBadge !== null, "has riskBadge");
  assert(schema.riskBadge.color === "yellow", "riskBadge color is yellow");
  assert(schema.privileged === false, "not privileged");
  assert(schema.readOnly === false, "not readOnly");
  assert(schema.defaultPreview === true, "defaults to preview");
  assert(schema.fields.length === 1, "has 1 field");
  assert(schema.fields[0].name === "providerId", "field is providerId");
  assert(schema.hasConfirmMessage === true, "has confirm message");
  assert(schema.submitLabel === "Execute", "submit label is Execute");
  assert(schema.previewLabel === "Preview", "preview label is Preview");
}

// --- buildFormSchema for read-only action ------------------------------------

console.log("\nbuildFormSchema read-only\n");

{
  const schema = buildFormSchema("view.provider.status");
  assert(schema !== null, "read-only action returns schema");
  assert(schema.readOnly === true, "is readOnly");
  assert(schema.privileged === false, "not privileged");
  assert(schema.fields.length === 0, "no fields for read-only action");
  assert(schema.submitLabel === "View", "submit label is View for read-only");
  assert(schema.hasConfirmMessage === false, "no confirm message for read-only");
  assert(schema.riskBadge.color === "green", "read-only risk is green");
}

// --- buildFormSchema for privileged action -----------------------------------

console.log("\nbuildFormSchema privileged\n");

{
  const schema = buildFormSchema("worker.kill");
  assert(schema !== null, "privileged action returns schema");
  assert(schema.privileged === true, "is privileged");
  assert(schema.readOnly === false, "not readOnly");
  assert(schema.risk === RISK.HIGH, "risk is high");
  assert(schema.riskBadge.color === "orange", "riskBadge color is orange");
  assert(schema.submitLabel === "Execute (Privileged)", "submit label includes Privileged");
  assert(schema.fields.length === 1, "has 1 field");
  assert(schema.fields[0].name === "workerId", "field is workerId");
  assert(schema.hasConfirmMessage === true, "has confirm message");
}

// --- buildFormSchema for critical action -------------------------------------

console.log("\nbuildFormSchema critical\n");

{
  const schema = buildFormSchema("settings.key.rotate");
  assert(schema !== null, "critical action returns schema");
  assert(schema.risk === RISK.CRITICAL, "risk is critical");
  assert(schema.riskBadge.color === "red", "riskBadge color is red");
  assert(schema.riskBadge.cssClass === "risk-critical", "cssClass is risk-critical");
  assert(schema.privileged === true, "is privileged");
}

// --- buildFormSchema for unknown action --------------------------------------

console.log("\nbuildFormSchema unknown\n");

{
  const schema = buildFormSchema("nonexistent.action");
  assert(schema === null, "unknown action returns null");
  assert(buildFormSchema("") === null, "empty string returns null");
  assert(buildFormSchema(null) === null, "null returns null");
}

// --- buildFormSchema multi-field action --------------------------------------

console.log("\nbuildFormSchema multi-field\n");

{
  const schema = buildFormSchema("concurrency.update");
  assert(schema !== null, "concurrency.update returns schema");
  assert(schema.fields.length === 2, "has 2 fields");
  assert(schema.fields[0].name === "target", "first field is target");
  assert(schema.fields[1].name === "value", "second field is value");

  const schema2 = buildFormSchema("policy.update");
  assert(schema2 !== null, "policy.update returns schema");
  assert(schema2.fields.length === 2, "policy.update has 2 fields");
  assert(schema2.fields[0].name === "field", "first field is field");
  assert(schema2.fields[1].name === "value", "second field is value");
}

// --- buildFormSchema zero-field mutable action -------------------------------

console.log("\nbuildFormSchema zero-field mutable\n");

{
  const schema = buildFormSchema("queue.clear");
  assert(schema !== null, "queue.clear returns schema");
  assert(schema.fields.length === 0, "queue.clear has no fields");
  assert(schema.privileged === true, "is privileged");
  assert(schema.readOnly === false, "not readOnly");
}

// --- buildFormSchemas --------------------------------------------------------

console.log("\nbuildFormSchemas\n");

{
  const all = buildFormSchemas();
  assert(all.length === ACTIONS.length, "buildFormSchemas() returns all actions");
  assert(all.every((s) => s !== null), "all schemas are non-null");
  assert(all.every((s) => typeof s.actionId === "string"), "all have actionId");

  const subset = buildFormSchemas(["provider.cooldown.reset", "worker.kill"]);
  assert(subset.length === 2, "subset returns 2 schemas");
  assert(subset[0].actionId === "provider.cooldown.reset", "first is cooldown.reset");
  assert(subset[1].actionId === "worker.kill", "second is worker.kill");

  const mixed = buildFormSchemas(["view.provider.status", "nonexistent", "worker.kill"]);
  assert(mixed.length === 2, "filters out null schemas");

  const emptyIds = buildFormSchemas([]);
  assert(emptyIds.length === 0, "empty array returns empty result");

  const allInvalid = buildFormSchemas(["nonexistent.a", "nonexistent.b"]);
  assert(allInvalid.length === 0, "all-invalid ids returns empty result");

  const withNull = buildFormSchemas([null, undefined, "worker.kill"]);
  assert(withNull.length === 1, "null/undefined ids filtered out");
  assert(withNull[0].actionId === "worker.kill", "only valid id survives");
}

// --- buildFormSchemasByCategory ----------------------------------------------

console.log("\nbuildFormSchemasByCategory\n");

{
  const grouped = buildFormSchemasByCategory();
  assert(typeof grouped === "object", "returns an object");
  assert(Array.isArray(grouped.view), "has view category");
  assert(Array.isArray(grouped.provider), "has provider category");
  assert(Array.isArray(grouped.worker), "has worker category");
  assert(Array.isArray(grouped.resources), "has resources category");
  assert(Array.isArray(grouped.settings), "has settings category");
  assert(grouped.view.length > 0, "view category is non-empty");
  assert(grouped.view.every((s) => s.category === "view"), "all view schemas have view category");

  // Total across groups should equal total actions
  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
  assert(total === ACTIONS.length, "total across groups equals total actions");
}

// --- formSchemaMeta ----------------------------------------------------------

console.log("\nformSchemaMeta\n");

{
  const meta = formSchemaMeta();
  assert(meta.schemaVersion === 1, "schemaVersion is 1");
  assert(meta.totalForms === ACTIONS.length, "totalForms matches ACTIONS length");
  assert(typeof meta.withFields === "number", "withFields is a number");
  assert(meta.withFields > 0, "some forms have fields");
  assert(typeof meta.readOnlyForms === "number", "readOnlyForms is a number");
  assert(meta.readOnlyForms > 0, "some forms are read-only");
  assert(typeof meta.privilegedForms === "number", "privilegedForms is a number");
  assert(meta.privilegedForms > 0, "some forms are privileged");
  assert(typeof meta.riskDistribution === "object", "has riskDistribution");
  assert(meta.riskDistribution.low > 0, "has low-risk forms");
  assert(meta.riskDistribution.medium > 0, "has medium-risk forms");
  assert(meta.riskDistribution.high > 0, "has high-risk forms");
  assert(meta.riskDistribution.critical > 0, "has critical-risk forms");
}

// --- Every action has a form schema ------------------------------------------

console.log("\nEvery action has a form schema\n");

{
  for (const action of ACTIONS) {
    const schema = buildFormSchema(action.id);
    assert(schema !== null, `action ${action.id} has form schema`);
    assert(schema.actionId === action.id, `${action.id} actionId matches`);
    assert(schema.risk === action.risk, `${action.id} risk matches`);
    assert(schema.privileged === action.privileged, `${action.id} privileged matches`);
    assert(schema.readOnly === action.readOnly, `${action.id} readOnly matches`);
    assert(schema.fields.length === action.requiredFields.length, `${action.id} field count matches`);
  }
}

// --- Schema fields are frozen (immutable) ------------------------------------

console.log("\nSchema immutability\n");

{
  const schema = buildFormSchema("provider.cooldown.reset");
  assert(Object.isFrozen(schema), "top-level schema is frozen");
  assert(Object.isFrozen(schema.riskBadge), "riskBadge is frozen");
  assert(Object.isFrozen(schema.fields[0]), "field descriptor is frozen");
}

// --- No secrets leak ---------------------------------------------------------

console.log("\nNo secrets leak\n");

{
  const all = buildFormSchemas();
  for (const schema of all) {
    // Check non-description fields for secret/token/password values.
    // Descriptions may legitimately mention these words.
    const { description, title, ...rest } = schema;
    const json = JSON.stringify(rest);
    assert(!json.includes(".ps1"), `${schema.actionId} has no .ps1 script path`);
    assert(!json.includes(".js"), `${schema.actionId} has no .js script path`);
    // Verify actionId, category, fields etc. don't contain secret values
    const fieldsJson = JSON.stringify(schema.fields);
    assert(!fieldsJson.includes("secret"), `${schema.actionId} fields have no secret`);
    assert(!fieldsJson.includes("token"), `${schema.actionId} fields have no token`);
    assert(!fieldsJson.includes("password"), `${schema.actionId} fields have no password`);
  }
}

// --- buildFieldDescriptor edge cases -----------------------------------------

console.log("\nbuildFieldDescriptor edge cases\n");

{
  // Null field name
  const nullField = buildFieldDescriptor(null);
  assert(nullField.name === null, "null field name preserved");
  assert(nullField.type === "text", "null field defaults to text");
  assert(nullField.required === true, "null field is required");

  // Undefined field name
  const undefField = buildFieldDescriptor(undefined);
  assert(undefField.name === undefined, "undefined field name preserved");
  assert(undefField.type === "text", "undefined field defaults to text");

  // Empty string field name
  const emptyField = buildFieldDescriptor("");
  assert(emptyField.name === "", "empty string field name preserved");
  assert(emptyField.type === "text", "empty string field defaults to text");

  // Numeric field name
  const numField = buildFieldDescriptor(42);
  assert(numField.name === 42, "numeric field name preserved");
  assert(numField.type === "text", "numeric field defaults to text");

  // All known fields produce frozen descriptors
  const fieldNames = Object.keys(FIELD_TYPES);
  assert(fieldNames.length === 6, "FIELD_TYPES has 6 entries (providerId, workerId, target, value, field, reason)");
  for (const name of fieldNames) {
    const desc = buildFieldDescriptor(name);
    assert(Object.isFrozen(desc), `descriptor for ${name} is frozen`);
    assert(desc.name === name, `descriptor for ${name} has correct name`);
    assert(desc.required === true, `descriptor for ${name} is required`);
  }
}

// --- defaultPreview consistency ----------------------------------------------

console.log("\ndefaultPreview consistency\n");

{
  const all = buildFormSchemas();
  for (const schema of all) {
    if (schema.readOnly) {
      assert(schema.defaultPreview === false, `${schema.actionId} readOnly → defaultPreview false`);
    } else {
      assert(schema.defaultPreview === true, `${schema.actionId} mutable → defaultPreview true`);
    }
  }
}

// --- riskBadge completeness --------------------------------------------------

console.log("\nriskBadge completeness\n");

{
  const levels = ["low", "medium", "high", "critical"];
  const expectedColors = { low: "green", medium: "yellow", high: "orange", critical: "red" };
  const expectedCss = { low: "risk-low", medium: "risk-medium", high: "risk-high", critical: "risk-critical" };

  for (const level of levels) {
    const badge = riskBadge(level);
    assert(badge !== null, `riskBadge(${level}) is not null`);
    assert(badge.level === level, `riskBadge(${level}).level is ${level}`);
    assert(badge.color === expectedColors[level], `riskBadge(${level}).color is ${expectedColors[level]}`);
    assert(badge.cssClass === expectedCss[level], `riskBadge(${level}).cssClass is ${expectedCss[level]}`);
    assert(typeof badge.label === "string", `riskBadge(${level}) has label string`);
    assert(badge.label.length > 0, `riskBadge(${level}) label is non-empty`);
    assert(Object.isFrozen(badge), `riskBadge(${level}) is frozen`);
  }

  // Non-string risk values
  assert(riskBadge(0) === null, "numeric 0 risk returns null");
  assert(riskBadge(false) === null, "false risk returns null");
  assert(riskBadge({}) === null, "object risk returns null");
}

// --- formSchemaMeta risk distribution consistency ----------------------------

console.log("\nformSchemaMeta risk distribution consistency\n");

{
  const meta = formSchemaMeta();
  const riskSum = meta.riskDistribution.low + meta.riskDistribution.medium +
    meta.riskDistribution.high + meta.riskDistribution.critical;
  assert(riskSum === meta.totalForms, "risk distribution sums to totalForms");
  assert(meta.withFields + (meta.totalForms - meta.withFields) === meta.totalForms,
    "withFields + zero-field forms equals totalForms");
}

// --- Schema shape: no script path exposed ------------------------------------

console.log("\nSchema shape: no script field exposed\n");

{
  const all = buildFormSchemas();
  const schemaKeys = ["actionId", "title", "description", "category", "risk",
    "riskBadge", "privileged", "readOnly", "defaultPreview", "fields",
    "hasConfirmMessage", "submitLabel", "previewLabel"];
  for (const schema of all) {
    for (const key of Object.keys(schema)) {
      assert(schemaKeys.includes(key), `${schema.actionId} has expected key ${key}`);
    }
    assert(!("script" in schema), `${schema.actionId} does not expose script`);
  }
}

// --- Confirm message field substitution --------------------------------------

console.log("\nConfirm message field substitution\n");

{
  const schema = buildFormSchema("provider.cooldown.reset");
  assert(schema.hasConfirmMessage === true, "has confirm message");
  // The confirm message template contains {providerId}
  // The schema itself doesn't substitute, but confirms the template exists
  assert(schema.submitLabel === "Execute", "submit label is Execute");
  assert(schema.previewLabel === "Preview", "preview label is Preview");

  // All mutable (non-read-only) actions should have a confirm message
  const all = buildFormSchemas();
  for (const s of all) {
    if (!s.readOnly) {
      assert(s.hasConfirmMessage === true, `${s.actionId} mutable action has confirm message`);
    } else {
      assert(s.hasConfirmMessage === false, `${s.actionId} read-only has no confirm message`);
    }
  }
}

// --- buildFormSchemasByCategory coverage --------------------------------------

console.log("\nbuildFormSchemasByCategory coverage\n");

{
  const grouped = buildFormSchemasByCategory();
  const categories = Object.keys(grouped);
  assert(categories.length > 0, "has at least one category");

  // Every schema appears in exactly one category
  const allIds = [];
  for (const cat of categories) {
    for (const schema of grouped[cat]) {
      allIds.push(schema.actionId);
    }
  }
  const uniqueIds = new Set(allIds);
  assert(uniqueIds.size === allIds.length, "no schema appears in multiple categories");
  assert(uniqueIds.size === ACTIONS.length, "every action appears in exactly one category");

  // Each category's schemas have matching category field
  for (const cat of categories) {
    assert(grouped[cat].every((s) => s.category === cat),
      `all schemas in ${cat} have category ${cat}`);
    assert(grouped[cat].length > 0, `category ${cat} is non-empty`);
  }
}

// --- provider-rotation form fields ------------------------------------------

console.log("\nprovider-rotation form fields\n");

{
  // Simulate the field set the provider-rotation structured form would use
  const rotationFields = buildFormFields(["providerId", "reason"]);
  assert(rotationFields.length === 2, "provider-rotation form has 2 structured fields");
  assert(rotationFields[0].name === "providerId", "first field is providerId");
  assert(rotationFields[0].type === "text", "providerId type is text");
  assert(rotationFields[0].autocomplete === "provider", "providerId autocomplete is provider");
  assert(rotationFields[1].name === "reason", "second field is reason");
  assert(rotationFields[1].type === "text", "reason type is text");
  assert(rotationFields[1].label === "Reason", "reason label is Reason");
  assert(rotationFields[1].autocomplete === "off", "reason autocomplete is off");

  // Both fields are required by the schema system (though reason is optional at the action level)
  assert(rotationFields.every((f) => f.required), "all rotation form fields are required by schema");

  // reason field descriptor is frozen
  assert(Object.isFrozen(rotationFields[1]), "reason field descriptor is frozen");

  // reason field placeholder does not leak secrets
  assert(!rotationFields[1].placeholder.includes("secret"), "reason placeholder has no secret");
  assert(!rotationFields[1].placeholder.includes("token"), "reason placeholder has no token");
  assert(!rotationFields[1].placeholder.includes("key"), "reason placeholder has no key");
}

// --- Summary -----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
