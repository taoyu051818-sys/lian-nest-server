#!/usr/bin/env node

/**
 * action-registry.test.js
 *
 * Tests for the WebUI action registry.
 * No external test framework — uses a simple assert helper.
 *
 * Run: node tools/provider-pool-webui/action-registry.test.js
 */

const {
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
} = require("./lib/action-registry");

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

// --- RISK constants --------------------------------------------------------

console.log("\nRISK constants\n");

assert(RISK.LOW === "low", "RISK.LOW is 'low'");
assert(RISK.MEDIUM === "medium", "RISK.MEDIUM is 'medium'");
assert(RISK.HIGH === "high", "RISK.HIGH is 'high'");
assert(RISK.CRITICAL === "critical", "RISK.CRITICAL is 'critical'");
assert(Object.isFrozen(RISK), "RISK object is frozen");

// --- ACTIONS array ---------------------------------------------------------

console.log("\nACTIONS array\n");

assert(Array.isArray(ACTIONS), "ACTIONS is an array");
assert(ACTIONS.length > 0, "ACTIONS is not empty");
assert(Object.isFrozen(ACTIONS), "ACTIONS array is frozen");

// Every action has the required shape
for (const action of ACTIONS) {
  const prefix = `action[${action.id}]`;
  assert(typeof action.id === "string", `${prefix} has string id`);
  assert(typeof action.label === "string", `${prefix} has string label`);
  assert(typeof action.description === "string", `${prefix} has string description`);
  assert(Object.values(RISK).includes(action.risk), `${prefix} has valid risk level`);
  assert(typeof action.privileged === "boolean", `${prefix} has boolean privileged`);
  assert(typeof action.readOnly === "boolean", `${prefix} has boolean readOnly`);
  assert(typeof action.defaultPreview === "boolean", `${prefix} has boolean defaultPreview`);
  assert(Array.isArray(action.requiredFields), `${prefix} has array requiredFields`);
  assert(typeof action.category === "string", `${prefix} has string category`);
}

// --- No duplicate ids ------------------------------------------------------

console.log("\nNo duplicate ids\n");

{
  const ids = ACTIONS.map((a) => a.id);
  const unique = new Set(ids);
  assert(ids.length === unique.size, "All action ids are unique");
}

// --- No wildcard ids -------------------------------------------------------

console.log("\nNo wildcard ids\n");

{
  const hasWildcard = ACTIONS.some((a) => a.id.includes("*") || a.id.includes("**"));
  assert(!hasWildcard, "No action id contains wildcards");
}

// --- ACTION_MAP consistency ------------------------------------------------

console.log("\nACTION_MAP consistency\n");

assert(ACTION_MAP.size === ACTIONS.length, "ACTION_MAP has same size as ACTIONS");
for (const action of ACTIONS) {
  assert(ACTION_MAP.get(action.id) === action, `ACTION_MAP contains ${action.id}`);
}

// --- getAction -------------------------------------------------------------

console.log("\ngetAction\n");

{
  const a = getAction("view.provider.status");
  assert(a !== undefined, "getAction returns defined for known id");
  assert(a.id === "view.provider.status", "getAction returns correct action");
  assert(getAction("nonexistent.action") === undefined, "getAction returns undefined for unknown id");
}

// --- isAllowlisted ---------------------------------------------------------

console.log("\nisAllowlisted\n");

assert(isAllowlisted("view.provider.status") === true, "view.provider.status is allowlisted");
assert(isAllowlisted("worker.kill") === true, "worker.kill is allowlisted");
assert(isAllowlisted("nonexistent") === false, "nonexistent is not allowlisted");
assert(isAllowlisted("") === false, "empty string is not allowlisted");

// --- isPrivileged ----------------------------------------------------------

console.log("\nisPrivileged\n");

assert(isPrivileged("view.provider.status") === false, "view.provider.status is not privileged");
assert(isPrivileged("worker.kill") === true, "worker.kill is privileged");
assert(isPrivileged("concurrency.update") === true, "concurrency.update is privileged");
assert(isPrivileged("settings.key.rotate") === true, "settings.key.rotate is privileged");
assert(isPrivileged("policy.update") === true, "policy.update is privileged");
assert(isPrivileged("nonexistent") === false, "nonexistent returns false");

// --- isReadOnly ------------------------------------------------------------

console.log("\nisReadOnly\n");

assert(isReadOnly("view.provider.status") === true, "view.provider.status is read-only");
assert(isReadOnly("view.policy") === true, "view.policy is read-only");
assert(isReadOnly("worker.kill") === false, "worker.kill is not read-only");
assert(isReadOnly("provider.cooldown.reset") === false, "provider.cooldown.reset is not read-only");
assert(isReadOnly("nonexistent") === false, "nonexistent returns false");

// --- getDefaultPreview -----------------------------------------------------

console.log("\ngetDefaultPreview\n");

assert(getDefaultPreview("view.provider.status") === false, "read-only actions default preview is false");
assert(getDefaultPreview("provider.cooldown.reset") === true, "mutable actions default preview is true");
assert(getDefaultPreview("worker.kill") === true, "worker.kill defaults to preview");
assert(getDefaultPreview("settings.key.rotate") === true, "settings.key.rotate defaults to preview");
assert(getDefaultPreview("nonexistent") === null, "unknown id returns null");

// --- All mutable actions default to preview --------------------------------

console.log("\nAll mutable actions default to preview\n");

{
  const mutableNonPreview = ACTIONS.filter((a) => !a.readOnly && !a.defaultPreview);
  assert(mutableNonPreview.length === 0, "Every mutable action has defaultPreview=true");
}

// --- All privileged actions are mutable ------------------------------------

console.log("\nAll privileged actions are mutable\n");

{
  const privilegedReadOnly = ACTIONS.filter((a) => a.privileged && a.readOnly);
  assert(privilegedReadOnly.length === 0, "No privileged action is read-only");
}

// --- validateFields --------------------------------------------------------

console.log("\nvalidateFields\n");

{
  const r1 = validateFields("view.provider.status", {});
  assert(r1.valid === true, "read-only action with no required fields passes");

  const r2 = validateFields("worker.kill", { workerId: "w-1" });
  assert(r2.valid === true, "worker.kill with workerId passes");

  const r3 = validateFields("worker.kill", {});
  assert(r3.valid === false, "worker.kill without workerId fails");
  assert(r3.missing.includes("workerId"), "missing includes workerId");

  const r4 = validateFields("concurrency.update", { target: "global", value: 10 });
  assert(r4.valid === true, "concurrency.update with both fields passes");

  const r5 = validateFields("concurrency.update", { target: "global" });
  assert(r5.valid === false, "concurrency.update missing value fails");
  assert(r5.missing.includes("value"), "missing includes value");

  const r6 = validateFields("nonexistent", {});
  assert(r6.valid === false, "unknown action fails validation");

  const r7 = validateFields("provider.cooldown.reset", { providerId: null });
  assert(r7.valid === false, "null required field fails validation");
}

// --- renderConfirmMessage --------------------------------------------------

console.log("\nrenderConfirmMessage\n");

{
  const m1 = renderConfirmMessage("worker.kill", { workerId: "w-42" });
  assert(m1 === "KILL worker w-42? This cannot be undone.", "renders worker.kill message");

  const m2 = renderConfirmMessage("view.provider.status", {});
  assert(m2 === null, "read-only action returns null");

  const m3 = renderConfirmMessage("nonexistent", {});
  assert(m3 === null, "unknown action returns null");

  const m4 = renderConfirmMessage("settings.key.rotate", {});
  assert(typeof m4 === "string" && m4.length > 0, "settings.key.rotate has confirm message");
}

// --- listActions ------------------------------------------------------------

console.log("\nlistActions\n");

{
  const all = listActions();
  assert(all.length === ACTIONS.length, "listActions() returns all actions");

  const views = listActions("view");
  assert(views.length > 0, "listActions('view') returns non-empty");
  assert(views.every((a) => a.category === "view"), "all view actions have category 'view'");

  const workers = listActions("worker");
  assert(workers.length > 0, "listActions('worker') returns non-empty");
  assert(workers.every((a) => a.category === "worker"), "all worker actions have category 'worker'");

  const empty = listActions("nonexistent-category");
  assert(empty.length === 0, "listActions with unknown category returns empty");
}

// --- listActionIds ----------------------------------------------------------

console.log("\nlistActionIds\n");

{
  const ids = listActionIds();
  assert(ids.length === ACTIONS.length, "listActionIds returns correct count");
  assert(ids.includes("view.provider.status"), "includes view.provider.status");
  assert(ids.includes("worker.kill"), "includes worker.kill");
  assert(ids.includes("settings.key.rotate"), "includes settings.key.rotate");
}

// --- listPrivilegedIds ------------------------------------------------------

console.log("\nlistPrivilegedIds\n");

{
  const ids = listPrivilegedIds();
  assert(ids.length > 0, "listPrivilegedIds is non-empty");
  assert(ids.every((id) => isPrivileged(id)), "all returned ids are privileged");
  assert(!ids.includes("view.provider.status"), "excludes read-only actions");
}

// --- listMutableIds ---------------------------------------------------------

console.log("\nlistMutableIds\n");

{
  const ids = listMutableIds();
  assert(ids.length > 0, "listMutableIds is non-empty");
  assert(ids.every((id) => !isReadOnly(id)), "all returned ids are mutable");
  assert(!ids.includes("view.provider.status"), "excludes read-only actions");
}

// --- listReadOnlyIds --------------------------------------------------------

console.log("\nlistReadOnlyIds\n");

{
  const ids = listReadOnlyIds();
  assert(ids.length > 0, "listReadOnlyIds is non-empty");
  assert(ids.every((id) => isReadOnly(id)), "all returned ids are read-only");
  assert(!ids.includes("worker.kill"), "excludes mutable actions");
}

// --- describeAction ---------------------------------------------------------

console.log("\ndescribeAction\n");

{
  const d1 = describeAction("worker.kill");
  assert(d1 !== null, "describeAction returns non-null for known id");
  assert(d1.id === "worker.kill", "has correct id");
  assert(d1.risk === RISK.HIGH, "has correct risk");
  assert(d1.privileged === true, "has correct privileged flag");
  assert(d1.hasScript === true, "hasScript is true for worker.kill");
  assert(typeof d1.label === "string", "has label");
  assert(Array.isArray(d1.requiredFields), "has requiredFields array");

  const d2 = describeAction("view.provider.status");
  assert(d2.hasScript === false, "hasScript is false for read-only action");

  const d3 = describeAction("nonexistent");
  assert(d3 === null, "returns null for unknown id");
}

// --- describeAction does not leak script paths ------------------------------

console.log("\ndescribeAction does not leak script paths\n");

{
  for (const id of listActionIds()) {
    const d = describeAction(id);
    const json = JSON.stringify(d);
    assert(!json.includes(".ps1"), `${id} describeAction JSON has no .ps1 path`);
    assert(!json.includes(".js"), `${id} describeAction JSON has no .js path`);
  }
}

// --- registryMeta ----------------------------------------------------------

console.log("\nregistryMeta\n");

{
  const meta = registryMeta();
  assert(meta.schemaVersion === 1, "schemaVersion is 1");
  assert(meta.totalActions === ACTIONS.length, "totalActions matches ACTIONS length");
  assert(meta.privilegedCount === listPrivilegedIds().length, "privilegedCount matches");
  assert(meta.mutableCount === listMutableIds().length, "mutableCount matches");
  assert(meta.readOnlyCount === listReadOnlyIds().length, "readOnlyCount matches");
  assert(Array.isArray(meta.riskLevels), "riskLevels is array");
  assert(meta.riskLevels.length === 4, "riskLevels has 4 entries");
  assert(Array.isArray(meta.categories), "categories is array");
  assert(meta.categories.length > 0, "categories is non-empty");
}

// --- Privileged actions have confirm messages -------------------------------

console.log("\nPrivileged actions have confirm messages\n");

{
  for (const action of ACTIONS) {
    if (action.privileged) {
      assert(typeof action.confirmMessage === "string" && action.confirmMessage.length > 0,
        `privileged action ${action.id} has confirmMessage`);
    }
  }
}

// --- Mutable actions have scripts ------------------------------------------

console.log("\nMutable actions have scripts\n");

{
  for (const action of ACTIONS) {
    if (!action.readOnly) {
      assert(typeof action.script === "string" && action.script.length > 0,
        `mutable action ${action.id} has script`);
    }
  }
}

// --- Read-only actions have no scripts -------------------------------------

console.log("\nRead-only actions have no scripts\n");

{
  for (const action of ACTIONS) {
    if (action.readOnly) {
      assert(action.script === null, `read-only action ${action.id} has null script`);
    }
  }
}

// --- Summary ---------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
