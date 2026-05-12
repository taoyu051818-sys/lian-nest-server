"use strict";

/**
 * control-skills — WebUI action module for control skill registry preview.
 *
 * Discovers and lists all registered control skills from:
 *   1. The static action registry (lib/action-registry.js)
 *   2. Dynamic action modules in the actions/ directory
 *
 * Preview-only. No mutations, no side effects.
 * Returns sanitized JSON — no script paths, no secrets.
 *
 * Closes: #1230
 */

const fs = require("node:fs");
const path = require("node:path");

const ACTIONS_DIR = __dirname;
const REGISTRY_PATH = path.join(__dirname, "../lib/action-registry.js");

// ── Secret patterns to strip from output ─────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /bearer/i,
];

function isSecretKey(key) {
  return SECRET_PATTERNS.some(function (p) { return p.test(key); });
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    if (value.length > 500) return value.slice(0, 500) + "...";
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  var result = {};
  for (var _i = 0, _entries = Object.entries(obj); _i < _entries.length; _i++) {
    var entry = _entries[_i];
    var k = entry[0];
    var v = entry[1];
    if (isSecretKey(k)) continue;
    result[k] = sanitizeValue(v);
  }
  return result;
}

// ── Discover static registry skills ──────────────────────────────────────────

function loadStaticSkills() {
  try {
    var registry = require(REGISTRY_PATH);
    if (!registry || !Array.isArray(registry.ACTIONS)) return [];

    return registry.ACTIONS.map(function (action) {
      return {
        skillId: action.id,
        label: action.label,
        description: action.description,
        risk: action.risk,
        privileged: action.privileged,
        readOnly: action.readOnly,
        defaultPreview: action.defaultPreview,
        requiredFields: (action.requiredFields || []).slice(),
        category: action.category,
        source: "static-registry",
      };
    });
  } catch {
    return [];
  }
}

// ── Discover dynamic action modules ──────────────────────────────────────────

function loadDynamicSkills() {
  var skills = [];

  var files;
  try {
    files = fs.readdirSync(ACTIONS_DIR);
  } catch {
    return [];
  }

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (!file.endsWith(".js")) continue;
    if (file.endsWith(".test.js")) continue;
    if (file === "control-skills.js") continue;

    var fullPath = path.join(ACTIONS_DIR, file);
    try {
      var mod = require(fullPath);
      if (!mod || typeof mod.id !== "string") continue;

      skills.push({
        skillId: mod.id,
        label: typeof mod.label === "string" ? mod.label : mod.id,
        description: typeof mod.description === "string" ? mod.description : "",
        dangerous: !!mod.dangerous,
        hasPreview: typeof mod.preview === "function",
        hasExecute: typeof mod.execute === "function",
        source: "dynamic-module",
        module: file,
      });
    } catch {
      // Skip modules that fail to load
    }
  }

  return skills;
}

// ── Build unified registry ───────────────────────────────────────────────────

function buildRegistry() {
  var staticSkills = loadStaticSkills();
  var dynamicSkills = loadDynamicSkills();

  // Build a set of dynamic skill IDs to avoid duplicates from static registry
  var dynamicIds = new Set();
  for (var i = 0; i < dynamicSkills.length; i++) {
    dynamicIds.add(dynamicSkills[i].skillId);
  }

  // Merge: dynamic modules first, then static entries not already covered
  var merged = [];

  for (var di = 0; di < dynamicSkills.length; di++) {
    merged.push(sanitizeObject(dynamicSkills[di]));
  }

  for (var si = 0; si < staticSkills.length; si++) {
    if (!dynamicIds.has(staticSkills[si].skillId)) {
      merged.push(sanitizeObject(staticSkills[si]));
    }
  }

  // Sort by skillId for stable output
  merged.sort(function (a, b) {
    if (a.skillId < b.skillId) return -1;
    if (a.skillId > b.skillId) return 1;
    return 0;
  });

  return {
    ok: true,
    status: "preview",
    dryRun: true,
    schemaVersion: 1,
    totalSkills: merged.length,
    dynamicCount: dynamicSkills.length,
    staticCount: staticSkills.length,
    skills: merged,
    capturedAt: new Date().toISOString(),
  };
}

// ── Action module contract ───────────────────────────────────────────────────

module.exports = {
  id: "control-skills",
  label: "Control Skills",
  description:
    "Preview the control skill registry — lists all registered static and " +
    "dynamic action modules. Read-only, no mutations or side effects.",
  dangerous: false,

  /**
   * Preview — returns sanitized JSON list of all control skills.
   */
  preview() {
    return buildRegistry();
  },

  /**
   * Execute — identical to preview. This action is read-only.
   */
  execute() {
    return buildRegistry();
  },
};
