#!/usr/bin/env node
"use strict";

/**
 * control-skills.test.js
 *
 * Tests for the control-skills WebUI action module.
 * Validates contract shape, registry discovery, sanitization, and source hygiene.
 *
 * Run: node tools/provider-pool-webui/actions/control-skills.test.js
 */

const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed += 1;
    console.log("  PASS  " + name);
  } else {
    failed += 1;
    console.error("  FAIL  " + name);
  }
}

// Token detection regexes
const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
const ghTokenRe = /ghp.[A-Za-z\d_]+/;

// ── Tests ────────────────────────────────────────────────────────────────────

if (require.main === module) {

console.log("\ncontrol-skills.test.js\n");

// Module contract
console.log("Module contract\n");

var mod = require("./control-skills");

assert(typeof mod.id === "string" && mod.id.length > 0, "exports id");
assert(mod.id === "control-skills", "id is control-skills");
assert(typeof mod.label === "string" && mod.label.length > 0, "label is non-empty string");
assert(typeof mod.description === "string" && mod.description.length > 0, "description is non-empty string");
assert(mod.dangerous === false, "dangerous is false");
assert(typeof mod.preview === "function", "preview is a function");
assert(typeof mod.execute === "function", "execute is a function");

// Preview — returns registry
console.log("\nPreview — returns registry\n");

{
  var r = mod.preview();
  assert(r.ok === true, "preview returns ok");
  assert(r.status === "preview", "status is preview");
  assert(r.dryRun === true, "dryRun is true");
  assert(r.schemaVersion === 1, "schemaVersion is 1");
  assert(typeof r.totalSkills === "number", "totalSkills is number");
  assert(r.totalSkills > 0, "totalSkills > 0");
  assert(typeof r.dynamicCount === "number", "dynamicCount is number");
  assert(typeof r.staticCount === "number", "staticCount is number");
  assert(Array.isArray(r.skills), "skills is array");
  assert(r.skills.length === r.totalSkills, "skills length matches totalSkills");
  assert(typeof r.capturedAt === "string", "capturedAt is string");
}

// Preview — includes static registry entries
console.log("\nPreview — static registry entries\n");

{
  var r = mod.preview();
  var staticSkills = r.skills.filter(function (s) { return s.source === "static-registry"; });
  assert(staticSkills.length > 0, "has static registry skills");

  // Check a known static skill exists
  var viewProvider = r.skills.find(function (s) { return s.skillId === "view.provider.status"; });
  assert(viewProvider !== undefined, "finds view.provider.status");
  assert(viewProvider.risk === "low", "view.provider.status risk is low");
  assert(viewProvider.readOnly === true, "view.provider.status is readOnly");
  assert(viewProvider.category === "view", "view.provider.status category is view");
}

// Preview — includes dynamic modules
console.log("\nPreview — dynamic modules\n");

{
  var r = mod.preview();
  var dynamicSkills = r.skills.filter(function (s) { return s.source === "dynamic-module"; });
  assert(dynamicSkills.length > 0, "has dynamic module skills");

  // Check a known dynamic module exists
  var selfCycle = r.skills.find(function (s) { return s.skillId === "self-cycle"; });
  assert(selfCycle !== undefined, "finds self-cycle module");
  assert(selfCycle.hasPreview === true, "self-cycle has preview");
  assert(selfCycle.hasExecute === true, "self-cycle has execute");
  assert(selfCycle.dangerous === false, "self-cycle not dangerous");
}

// Preview — no duplicate skillIds
console.log("\nPreview — no duplicates\n");

{
  var r = mod.preview();
  var ids = r.skills.map(function (s) { return s.skillId; });
  var uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, "no duplicate skillIds");
}

// Preview — skills sorted by skillId
console.log("\nPreview — sorted output\n");

{
  var r = mod.preview();
  var sorted = true;
  for (var i = 1; i < r.skills.length; i++) {
    if (r.skills[i].skillId < r.skills[i - 1].skillId) {
      sorted = false;
      break;
    }
  }
  assert(sorted, "skills sorted by skillId");
}

// Preview — dynamicCount + staticCount >= totalSkills
console.log("\nPreview — count consistency\n");

{
  var r = mod.preview();
  // totalSkills = dynamic + static-not-in-dynamic
  assert(r.dynamicCount + r.staticCount >= r.totalSkills, "dynamicCount + staticCount >= totalSkills");
}

// Execute — same as preview (read-only)
console.log("\nExecute — same as preview\n");

{
  var rPrev = mod.preview();
  var rExec = mod.execute();
  assert(rExec.ok === true, "execute returns ok");
  assert(rExec.status === "preview", "execute status is preview");
  assert(rExec.dryRun === true, "execute dryRun is true");
  assert(rExec.totalSkills === rPrev.totalSkills, "execute totalSkills matches preview");
  assert(rExec.skills.length === rPrev.skills.length, "execute skills count matches preview");
}

// Sanitization — no secrets in output
console.log("\nSanitization — no secrets\n");

{
  var r = mod.preview();
  var raw = JSON.stringify(r);
  assert(!apiKeyRe.test(raw), "no API key pattern in output");
  assert(!ghTokenRe.test(raw), "no GitHub token pattern in output");
  assert(!raw.includes("password"), "no password in output");
  assert(!raw.includes("bearer"), "no bearer in output");
}

// Sanitization — no script paths leaked
console.log("\nSanitization — no script paths\n");

{
  var r = mod.preview();
  var raw = JSON.stringify(r);
  // Dynamic modules include "module" field (just filename), but no full paths
  assert(!raw.includes("scripts/ai/"), "no script paths in output");
  assert(!raw.includes("tools/provider-pool-webui/lib/"), "no lib paths in output");
}

// Source hygiene
console.log("\nSource hygiene\n");

{
  var source = fs.readFileSync(path.join(__dirname, "control-skills.js"), "utf-8");
  assert(!apiKeyRe.test(source), "no literal API key pattern in source");
  assert(!ghTokenRe.test(source), "no GitHub token pattern in source");
  assert(!/\.env\b/.test(source), "no .env references in source");
  assert(!/process\.env\./.test(source), "no process.env access in source");
  assert(!/ANTHROPIC_API_KEY/.test(source), "no API key env var in source");
  assert(source.includes("SECRET_PATTERNS"), "defines SECRET_PATTERNS");
  assert(source.includes("sanitizeObject"), "defines sanitizeObject");
}

// Test source hygiene
console.log("\nTest source hygiene\n");

{
  var testSource = fs.readFileSync(path.join(__dirname, "control-skills.test.js"), "utf-8");
  assert(!apiKeyRe.test(testSource), "no literal API key pattern in test source");
  assert(!ghTokenRe.test(testSource), "no GitHub token pattern in test source");
}

// Output shape — each skill has required fields
console.log("\nOutput shape — skill fields\n");

{
  var r = mod.preview();
  for (var i = 0; i < r.skills.length; i++) {
    var skill = r.skills[i];
    assert(typeof skill.skillId === "string", skill.skillId + " has skillId string");
    assert(typeof skill.label === "string", skill.skillId + " has label string");
    assert(typeof skill.description === "string", skill.skillId + " has description string");
    assert(typeof skill.source === "string", skill.skillId + " has source string");
  }
}

// Summary
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} else {
  module.exports = {
    id: "control-skills-test",
    label: "Control Skills Test Harness",
    description: "Test-only module. Not an action.",
    dangerous: false,
    preview() { return { ok: false, error: "test harness" }; },
    execute() { return { ok: false, error: "test harness" }; },
  };
}
