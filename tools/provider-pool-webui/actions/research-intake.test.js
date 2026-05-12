#!/usr/bin/env node
"use strict";

/**
 * research-intake.test.js
 *
 * Tests for the research-intake WebUI action module.
 * Validates contract shape, preview output, sanitization, fixture reading,
 * execute blocking, and source hygiene.
 *
 * Uses temporary fixture files so tests run without real .github/ai-state/ data.
 *
 * Run: node tools/provider-pool-webui/actions/research-intake.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

// Token detection regexes
const apiKeyRe = /sk.ant.[A-Za-z\d]{20,}/;
const ghTokenRe = /ghp.[A-Za-z\d_]+/;

// --- Fixtures ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "research-intake-test-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function writeNdjson(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  var content = events.map(function (e) { return JSON.stringify(e); }).join("\n");
  fs.writeFileSync(filePath, content, "utf-8");
}

function makeFactEvent(overrides) {
  var base = {
    eventVersion: 1,
    eventType: "evidence.intake",
    subject: "Karpathy Skills pattern",
    facts: {
      sourceClass: "external-doc",
      reliabilityTier: "B",
      rawHash: "abc123",
      researchCategory: "agent-pattern",
      sanitized: true,
    },
    capturedAt: "2026-05-12T10:00:00Z",
    actor: "research-intake",
  };
  if (!overrides) return base;
  return Object.assign({}, base, overrides);
}

function makeSignal(overrides) {
  var base = {
    patternId: "pat-abc123",
    externalProject: "Karpathy Skills",
    lianSurface: "opportunity signal schema",
    applicability: "partial",
    hypothesis: "If LIAN adopts structured tool definitions, signal quality will improve.",
    lifecycle: "draft",
    sourceFacts: ["evt-001"],
  };
  if (!overrides) return base;
  return Object.assign({}, base, overrides);
}

function makeSignalsFile(signals) {
  return { schemaVersion: 1, signals: signals || [] };
}

// --- Main test runner --------------------------------------------------------

if (require.main === module) {

console.log("\nresearch-intake.test.js\n");

// --- Module contract ---------------------------------------------------------
console.log("Module contract\n");

{
  var mod = require("./research-intake");

  assert(typeof mod.id === "string", "exports id");
  assert(mod.id === "research-intake", "id is research-intake");
  assert(typeof mod.label === "string", "exports label");
  assert(mod.label.length > 0, "label is non-empty");
  assert(typeof mod.description === "string", "exports description");
  assert(mod.description.length > 0, "description is non-empty");
  assert(typeof mod.dangerous === "boolean", "exports dangerous boolean");
  assert(mod.dangerous === false, "not dangerous");
  assert(typeof mod.preview === "function", "exports preview");
  assert(typeof mod.execute === "function", "exports execute");
}

// --- Preview: empty state (no files) -----------------------------------------
console.log("\nPreview: empty state\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();

  var res = mod.preview({
    factsPath: path.join(dir, "nonexistent.ndjson"),
    signalsPath: path.join(dir, "nonexistent.json"),
  });

  assert(res.ok === true, "preview ok with missing files");
  assert(res.status === "preview", "status is preview");
  assert(res.dryRun === true, "dryRun is true");
  assert(res.summary.totalFacts === 0, "0 total facts");
  assert(res.summary.researchFacts === 0, "0 research facts");
  assert(res.summary.signals === 0, "0 signals");
  assert(Array.isArray(res.facts), "facts is array");
  assert(Array.isArray(res.signals), "signals is array");
  assert(res.facts.length === 0, "empty facts array");
  assert(res.signals.length === 0, "empty signals array");
  assert(typeof res.message === "string", "message is string");
  assert(res.message.includes("No research intake"), "message says no data");
  assert(typeof res.timestamp === "string", "timestamp present");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: with research facts -------------------------------------------
console.log("\nPreview: with research facts\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [
    makeFactEvent(),
    makeFactEvent({ subject: "QwenPaw pattern", facts: { sourceClass: "web-scan", reliabilityTier: "C", rawHash: "def456", researchCategory: "orchestration", sanitized: true } }),
    { eventVersion: 1, eventType: "health.change", subject: "unrelated event", facts: {}, capturedAt: "2026-05-12T09:00:00Z", actor: "health-check" },
  ]);
  writeJson(signalsPath, makeSignalsFile([]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.ok === true, "preview ok");
  assert(res.summary.totalFacts === 3, "3 total facts");
  assert(res.summary.researchFacts === 2, "2 research facts (filtered)");
  assert(res.summary.signals === 0, "0 signals");
  assert(res.facts.length === 2, "2 summarized facts");
  assert(res.facts[0].eventType === "evidence.intake", "first fact type");
  assert(res.facts[0].subject === "Karpathy Skills pattern", "first fact subject");
  assert(res.facts[0].sourceClass === "external-doc", "first fact source class");
  assert(res.facts[0].reliabilityTier === "B", "first fact reliability tier");
  assert(res.facts[0].sanitized === true, "first fact sanitized flag");
  assert(res.message.includes("2 research fact"), "message mentions facts");
  assert(res.message.includes("no signals yet"), "message mentions no signals");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: with signals ---------------------------------------------------
console.log("\nPreview: with signals\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [makeFactEvent()]);
  writeJson(signalsPath, makeSignalsFile([
    makeSignal(),
    makeSignal({ patternId: "pat-def456", applicability: "direct", lifecycle: "validated", externalProject: "QwenPaw" }),
  ]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.ok === true, "preview ok with signals");
  assert(res.summary.signals === 2, "2 signals");
  assert(res.signals.length === 2, "2 summarized signals");
  assert(res.signals[0].patternId === "pat-abc123", "first signal patternId");
  assert(res.signals[0].externalProject === "Karpathy Skills", "first signal project");
  assert(res.signals[0].applicability === "partial", "first signal applicability");
  assert(res.signals[0].lifecycle === "draft", "first signal lifecycle");
  assert(res.signals[1].lifecycle === "validated", "second signal lifecycle");
  assert(res.message.includes("2 opportunity signal"), "message mentions signals");
  assert(res.message.includes("1 research fact"), "message mentions facts");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: lifecycle counts -----------------------------------------------
console.log("\nPreview: lifecycle and applicability counts\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, []);
  writeJson(signalsPath, makeSignalsFile([
    makeSignal({ lifecycle: "draft", applicability: "partial" }),
    makeSignal({ lifecycle: "draft", applicability: "direct" }),
    makeSignal({ lifecycle: "validated", applicability: "direct" }),
  ]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.summary.lifecycleCounts.draft === 2, "2 draft signals");
  assert(res.summary.lifecycleCounts.validated === 1, "1 validated signal");
  assert(res.summary.applicabilityCounts.partial === 1, "1 partial applicability");
  assert(res.summary.applicabilityCounts.direct === 2, "2 direct applicability");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: source class counts --------------------------------------------
console.log("\nPreview: source class counts\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [
    makeFactEvent(),
    makeFactEvent({ facts: { sourceClass: "web-scan", reliabilityTier: "C", sanitized: true } }),
    makeFactEvent({ facts: { sourceClass: "external-doc", reliabilityTier: "B", sanitized: true } }),
  ]);
  writeJson(signalsPath, makeSignalsFile([]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.summary.sourceClassCounts["external-doc"] === 2, "2 external-doc");
  assert(res.summary.sourceClassCounts["web-scan"] === 1, "1 web-scan");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Sanitization: secrets stripped ------------------------------------------
console.log("\nSanitization: secrets stripped\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [
    makeFactEvent({ authToken: "should-be-stripped", secretKey: "should-be-stripped" }),
  ]);
  writeJson(signalsPath, makeSignalsFile([
    makeSignal({ token: "should-be-stripped", apiKey: "should-be-stripped" }),
  ]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });
  var raw = JSON.stringify(res);

  assert(!raw.includes("should-be-stripped"), "no secret values in output");
  assert(!raw.includes("authToken"), "no authToken field in output");
  assert(!raw.includes("secretKey"), "no secretKey field in output");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Sanitization: long strings truncated ------------------------------------
console.log("\nSanitization: long strings truncated\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [
    makeFactEvent({ subject: "x".repeat(600) }),
  ]);
  writeJson(signalsPath, makeSignalsFile([]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.facts[0].subject.length <= 510, "long subject is truncated");
  assert(res.facts[0].subject.endsWith("..."), "truncated string ends with ...");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Sanitization: no raw stdout/stderr --------------------------------------
console.log("\nSanitization: output is sanitized JSON\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [makeFactEvent()]);
  writeJson(signalsPath, makeSignalsFile([]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });
  var raw = JSON.stringify(res);

  assert(!apiKeyRe.test(raw), "no API key pattern in output");
  assert(!ghTokenRe.test(raw), "no GitHub token pattern in output");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: null payload uses defaults -------------------------------------
console.log("\nPreview: null payload\n");

{
  var mod = require("./research-intake");

  var res = mod.preview(null);
  assert(res.ok === true, "preview ok with null payload");
  assert(res.dryRun === true, "dryRun true with null payload");
}

// --- Preview: empty payload uses defaults ------------------------------------
console.log("\nPreview: empty payload\n");

{
  var mod = require("./research-intake");

  var res = mod.preview({});
  assert(res.ok === true, "preview ok with empty payload");
  assert(res.dryRun === true, "dryRun true with empty payload");
}

// --- Execute: always blocked -------------------------------------------------
console.log("\nExecute: always blocked\n");

{
  var mod = require("./research-intake");

  var res = mod.execute({});
  assert(res.ok === false, "execute returns not ok");
  assert(res.status === "blocked", "execute status is blocked");
  assert(typeof res.error === "string", "error is string");
  assert(res.error.includes("not supported"), "error says not supported");
  assert(res.error.includes("evidence-only"), "error mentions evidence-only");
}

{
  var mod = require("./research-intake");

  var res = mod.execute(null);
  assert(res.ok === false, "execute with null returns not ok");
  assert(res.status === "blocked", "execute null status is blocked");
}

{
  var mod = require("./research-intake");

  var res = mod.execute({ confirm: true });
  assert(res.ok === false, "execute with confirm still blocked");
  assert(res.status === "blocked", "execute confirm status is blocked");
}

// --- Preview: malformed NDJSON lines skipped ---------------------------------
console.log("\nPreview: malformed NDJSON lines\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  fs.writeFileSync(factsPath, [
    JSON.stringify(makeFactEvent()),
    "not valid json {{{",
    JSON.stringify(makeFactEvent({ subject: "second fact" })),
  ].join("\n"), "utf-8");
  writeJson(signalsPath, makeSignalsFile([]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.ok === true, "preview ok with malformed lines");
  assert(res.summary.totalFacts === 2, "2 valid facts parsed");
  assert(res.summary.researchFacts === 2, "2 research facts");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: signals with missing fields ------------------------------------
console.log("\nPreview: signals with missing fields\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, []);
  writeJson(signalsPath, makeSignalsFile([
    { patternId: "pat-minimal" },
    { externalProject: "Test", lifecycle: "accepted" },
  ]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(res.ok === true, "preview ok with partial signals");
  assert(res.signals.length === 2, "2 signals");
  assert(res.signals[0].patternId === "pat-minimal", "first signal patternId");
  assert(res.signals[0].externalProject === null, "missing project is null");
  assert(res.signals[0].lifecycle === null, "missing lifecycle is null");
  assert(res.signals[1].lifecycle === "accepted", "second signal lifecycle");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Preview: no temp files created ------------------------------------------
console.log("\nPreview: no temp files created\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [makeFactEvent()]);
  writeJson(signalsPath, makeSignalsFile([makeSignal()]));

  mod.preview({ factsPath: factsPath, signalsPath: signalsPath });
  var files = fs.readdirSync(dir);
  assert(files.length === 2, "only original fixture files remain");
  assert(files.indexOf("external-facts.ndjson") >= 0, "ndjson file exists");
  assert(files.indexOf("signals.json") >= 0, "signals file exists");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Output shape ------------------------------------------------------------
console.log("\nOutput shape\n");

{
  var mod = require("./research-intake");
  var dir = tmpDir();
  var factsPath = path.join(dir, "external-facts.ndjson");
  var signalsPath = path.join(dir, "signals.json");

  writeNdjson(factsPath, [makeFactEvent()]);
  writeJson(signalsPath, makeSignalsFile([makeSignal()]));

  var res = mod.preview({ factsPath: factsPath, signalsPath: signalsPath });

  assert(typeof res === "object", "result is object");
  assert(typeof res.ok === "boolean", "ok is boolean");
  assert(typeof res.status === "string", "status is string");
  assert(typeof res.dryRun === "boolean", "dryRun is boolean");
  assert(typeof res.summary === "object", "summary is object");
  assert(typeof res.summary.totalFacts === "number", "totalFacts is number");
  assert(typeof res.summary.researchFacts === "number", "researchFacts is number");
  assert(typeof res.summary.signals === "number", "signals count is number");
  assert(typeof res.summary.lifecycleCounts === "object", "lifecycleCounts is object");
  assert(typeof res.summary.applicabilityCounts === "object", "applicabilityCounts is object");
  assert(typeof res.summary.sourceClassCounts === "object", "sourceClassCounts is object");
  assert(Array.isArray(res.facts), "facts is array");
  assert(Array.isArray(res.signals), "signals is array");
  assert(typeof res.message === "string", "message is string");
  assert(typeof res.timestamp === "string", "timestamp is string");

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Source hygiene ----------------------------------------------------------
console.log("\nSource hygiene\n");

{
  var fullPath = path.join(__dirname, "research-intake.js");
  var source = fs.readFileSync(fullPath, "utf-8");

  assert(!/\.env\b/.test(source), "no .env references");
  assert(!/ANTHROPIC_API_KEY/.test(source), "no API key env var");
  assert(!/process\.env\./.test(source), "no process.env access");
  assert(source.includes("SECRET_PATTERNS"), "defines SECRET_PATTERNS");
  assert(source.includes("sanitizeObject"), "defines sanitizeObject");
  assert(source.includes("dryRun"), "sets dryRun flag");
}

// --- Summary -----------------------------------------------------------------
console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} else {
  module.exports = {
    id: "research-intake-test",
    label: "Research Intake Test Harness",
    description: "Test-only module. Not an action.",
    dangerous: false,
    preview() { return { ok: false, error: "test harness" }; },
    execute() { return { ok: false, error: "test harness" }; },
  };
}
