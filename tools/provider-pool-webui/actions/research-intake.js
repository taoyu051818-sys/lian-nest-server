"use strict";

/**
 * research-intake — WebUI action module for external research intake preview.
 *
 * Reads fact events and opportunity signals from .github/ai-state/ and
 * returns a sanitized opportunity preview. Preview-only — no execute
 * side effects.
 *
 * Safety policy:
 *   - Read-only. No mutations, no file writes.
 *   - Returns sanitized JSON only. No raw logs/secrets in output.
 *   - Execute mode is blocked.
 *
 * Closes: #1224
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_FACTS_PATH = path.join(
  REPO_ROOT,
  ".github/ai-state/external-facts.ndjson"
);
const DEFAULT_SIGNALS_PATH = path.join(
  REPO_ROOT,
  ".github/ai-state/opportunity-signals.json"
);

// ── Secret patterns to strip from output ─────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /auth/i,
  /bearer/i,
];

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
    if (SECRET_PATTERNS.some(function (p) { return p.test(k); })) continue;
    result[k] = sanitizeValue(v);
  }
  return result;
}

// ── File readers ─────────────────────────────────────────────────────────────

function readNdjson(filePath) {
  try {
    var content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").reduce(function (acc, line) {
      try {
        acc.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
      return acc;
    }, []);
  } catch {
    return [];
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ── Research intake analysis ─────────────────────────────────────────────────

var RESEARCH_EVENT_TYPES = [
  "evidence.intake",
];

var RESEARCH_SOURCE_CLASSES = [
  "external-doc",
  "web-scan",
  "user-paste",
  "opaque-external",
];

function filterResearchFacts(facts) {
  return facts.filter(function (f) {
    return (
      RESEARCH_EVENT_TYPES.indexOf(f.eventType) >= 0 ||
      (f.facts && RESEARCH_SOURCE_CLASSES.indexOf(f.facts.sourceClass) >= 0)
    );
  });
}

function summarizeFact(fact) {
  var facts = fact.facts || {};
  return {
    eventType: fact.eventType || "unknown",
    subject: fact.subject || null,
    sourceClass: facts.sourceClass || null,
    reliabilityTier: facts.reliabilityTier || null,
    researchCategory: facts.researchCategory || null,
    capturedAt: fact.capturedAt || null,
    actor: fact.actor || null,
    sanitized: facts.sanitized === true,
  };
}

function summarizeSignal(signal) {
  return {
    patternId: signal.patternId || null,
    externalProject: signal.externalProject || null,
    lianSurface: signal.lianSurface || null,
    applicability: signal.applicability || null,
    hypothesis: signal.hypothesis || null,
    lifecycle: signal.lifecycle || null,
    sourceFacts: Array.isArray(signal.sourceFacts) ? signal.sourceFacts : [],
  };
}

// ── Action module contract ───────────────────────────────────────────────────

module.exports = {
  id: "research-intake",
  label: "Research Intake Preview",
  description:
    "Preview external research intake: fact events, opportunity signals, " +
    "and pattern extractions. Read-only — no side effects.",
  dangerous: false,

  /**
   * Preview — reads fact events and opportunity signals, returns
   * sanitized opportunity preview.
   * @param {object} [payload]
   * @param {string} [payload.factsPath] - Override external-facts path
   * @param {string} [payload.signalsPath] - Override opportunity-signals path
   * @returns {object} Sanitized opportunity preview
   */
  preview(payload) {
    var opts = payload || {};
    var factsPath = opts.factsPath || DEFAULT_FACTS_PATH;
    var signalsPath = opts.signalsPath || DEFAULT_SIGNALS_PATH;

    var allFacts = readNdjson(factsPath);
    var researchFacts = filterResearchFacts(allFacts);
    var signalsData = readJson(signalsPath);
    var signals =
      signalsData && Array.isArray(signalsData.signals)
        ? signalsData.signals
        : [];

    var summarizedFacts = researchFacts.map(summarizeFact);
    var summarizedSignals = signals.map(summarizeSignal);

    // Count by lifecycle state
    var lifecycleCounts = {};
    for (var i = 0; i < summarizedSignals.length; i++) {
      var lc = summarizedSignals[i].lifecycle || "unknown";
      lifecycleCounts[lc] = (lifecycleCounts[lc] || 0) + 1;
    }

    // Count by applicability
    var applicabilityCounts = {};
    for (var j = 0; j < summarizedSignals.length; j++) {
      var app = summarizedSignals[j].applicability || "unknown";
      applicabilityCounts[app] = (applicabilityCounts[app] || 0) + 1;
    }

    // Count by source class
    var sourceClassCounts = {};
    for (var k = 0; k < summarizedFacts.length; k++) {
      var sc = summarizedFacts[k].sourceClass || "unknown";
      sourceClassCounts[sc] = (sourceClassCounts[sc] || 0) + 1;
    }

    var totalFacts = allFacts.length;
    var totalResearchFacts = researchFacts.length;
    var totalSignals = summarizedSignals.length;

    return sanitizeObject({
      ok: true,
      status: "preview",
      dryRun: true,
      summary: {
        totalFacts: totalFacts,
        researchFacts: totalResearchFacts,
        signals: totalSignals,
        lifecycleCounts: lifecycleCounts,
        applicabilityCounts: applicabilityCounts,
        sourceClassCounts: sourceClassCounts,
      },
      facts: summarizedFacts,
      signals: summarizedSignals,
      message:
        totalResearchFacts === 0 && totalSignals === 0
          ? "No research intake data found — intake loop is idle"
          : totalSignals > 0
            ? totalSignals + " opportunity signal(s) from " +
              totalResearchFacts + " research fact(s)"
            : totalResearchFacts +
              " research fact(s) captured — no signals yet",
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * Execute is blocked for research-intake.
   * Research intake is preview-only — no side effects permitted.
   * @returns {object} Always returns blocked status
   */
  execute() {
    return {
      ok: false,
      status: "blocked",
      error:
        "Execute mode is not supported for research-intake preview. " +
        "Research intake is evidence-only — use the intake loop pipeline " +
        "for full processing.",
    };
  },
};
