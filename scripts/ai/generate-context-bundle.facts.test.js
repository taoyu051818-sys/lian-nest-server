#!/usr/bin/env node

/**
 * generate-context-bundle.facts.test.js
 *
 * Self-contained fixture tests for the context bundle fact projection.
 * Validates that policy, state, and schema scanning produces correct
 * manifest entries under controlled temp-directory fixtures.
 *
 * Run: node scripts/ai/generate-context-bundle.facts.test.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Replicate core scanning logic from generate-context-bundle.js ──────────

function listFilesByExtension(repoRoot, dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => ({
      relativePath: path.relative(repoRoot, path.join(dir, f)).replace(/\\/g, "/"),
      absolutePath: path.join(dir, f),
      sizeBytes: fs.statSync(path.join(dir, f)).size,
    }));
}

function buildManifest(repoRoot, issueNumber) {
  const docsDir = path.join(repoRoot, "docs", "ai-native");
  const schemasDir = path.join(repoRoot, "schemas");
  const scriptsDir = path.join(repoRoot, "scripts", "ai");
  const policyDir = path.join(repoRoot, ".github", "ai-policy");
  const stateDir = path.join(repoRoot, ".github", "ai-state");

  const docs = listFilesByExtension(repoRoot, docsDir, ".md");
  const schemas = [
    ...listFilesByExtension(repoRoot, schemasDir, ".schema.json"),
    ...listFilesByExtension(repoRoot, scriptsDir, ".schema.json"),
  ];
  const policies = listFilesByExtension(repoRoot, policyDir, ".json");
  const state = listFilesByExtension(repoRoot, stateDir, ".json");

  const totalBytes = [...docs, ...schemas, ...policies, ...state].reduce(
    (sum, f) => sum + f.sizeBytes,
    0,
  );

  return {
    version: 2,
    issue: issueNumber,
    generatedAt: new Date().toISOString(),
    dryRun: true,
    summary: {
      docCount: docs.length,
      schemaCount: schemas.length,
      policyCount: policies.length,
      stateCount: state.length,
      totalBytes,
    },
    docs: docs.map((d) => d.relativePath),
    schemas: schemas.map((s) => s.relativePath),
    policies: policies.map((p) => p.relativePath),
    state: state.map((s) => s.relativePath),
  };
}

// ── Test harness ───────────────────────────────────────────────────────────

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

// ── Fixture helpers ────────────────────────────────────────────────────────

function createTmpRepo(dirs) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-bundle-facts-"));
  for (const [relDir, files] of Object.entries(dirs)) {
    const absDir = path.join(tmpDir, relDir);
    fs.mkdirSync(absDir, { recursive: true });
    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(absDir, filename), content, "utf-8");
    }
  }
  return tmpDir;
}

function removeTmpDir(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log("\ngenerate-context-bundle.facts.test.js\n");

// 1. Manifest structure has all required keys
{
  const tmpDir = createTmpRepo({});
  const manifest = buildManifest(tmpDir, 100);
  const requiredKeys = [
    "version", "issue", "generatedAt", "dryRun",
    "summary", "docs", "schemas", "policies", "state",
  ];
  for (const key of requiredKeys) {
    assert(key in manifest, `manifest has key "${key}"`);
  }
  assert(manifest.version === 2, "manifest version is 2");
  assert(manifest.issue === 100, "manifest issue matches input");
  assert(manifest.dryRun === true, "manifest dryRun is true");
  removeTmpDir(tmpDir);
}

// 2. Summary has all required sub-keys
{
  const tmpDir = createTmpRepo({});
  const manifest = buildManifest(tmpDir, 101);
  const summaryKeys = ["docCount", "schemaCount", "policyCount", "stateCount", "totalBytes"];
  for (const key of summaryKeys) {
    assert(key in manifest.summary, `summary has key "${key}"`);
  }
  removeTmpDir(tmpDir);
}

// 3. Empty repo produces zero counts and empty arrays
{
  const tmpDir = createTmpRepo({});
  const manifest = buildManifest(tmpDir, 200);
  assert(manifest.summary.docCount === 0, "empty repo: docCount 0");
  assert(manifest.summary.schemaCount === 0, "empty repo: schemaCount 0");
  assert(manifest.summary.policyCount === 0, "empty repo: policyCount 0");
  assert(manifest.summary.stateCount === 0, "empty repo: stateCount 0");
  assert(manifest.summary.totalBytes === 0, "empty repo: totalBytes 0");
  assert(manifest.docs.length === 0, "empty repo: docs empty");
  assert(manifest.schemas.length === 0, "empty repo: schemas empty");
  assert(manifest.policies.length === 0, "empty repo: policies empty");
  assert(manifest.state.length === 0, "empty repo: state empty");
  removeTmpDir(tmpDir);
}

// 4. Policy files are projected correctly
{
  const tmpDir = createTmpRepo({
    ".github/ai-policy": {
      "launch-policy.json": '{"version":1}',
      "risk-policy.json": '{"level":"low"}',
    },
  });
  const manifest = buildManifest(tmpDir, 300);
  assert(manifest.summary.policyCount === 2, "policy projection: count 2");
  assert(manifest.policies.length === 2, "policy projection: array length 2");
  assert(
    manifest.policies.includes(".github/ai-policy/launch-policy.json"),
    "policy projection: includes launch-policy.json",
  );
  assert(
    manifest.policies.includes(".github/ai-policy/risk-policy.json"),
    "policy projection: includes risk-policy.json",
  );
  removeTmpDir(tmpDir);
}

// 5. State files are projected correctly
{
  const tmpDir = createTmpRepo({
    ".github/ai-state": {
      "active-workers.json": '{"workers":[]}',
      "worker-trust.json": '{"trust":{}}',
      "launch-locks.json": '{"locks":[]}',
    },
  });
  const manifest = buildManifest(tmpDir, 301);
  assert(manifest.summary.stateCount === 3, "state projection: count 3");
  assert(manifest.state.length === 3, "state projection: array length 3");
  assert(
    manifest.state.includes(".github/ai-state/active-workers.json"),
    "state projection: includes active-workers.json",
  );
  assert(
    manifest.state.includes(".github/ai-state/launch-locks.json"),
    "state projection: includes launch-locks.json",
  );
  assert(
    manifest.state.includes(".github/ai-state/worker-trust.json"),
    "state projection: includes worker-trust.json",
  );
  removeTmpDir(tmpDir);
}

// 6. Schema files from schemas/ directory are projected correctly
{
  const tmpDir = createTmpRepo({
    schemas: {
      "task-v2.schema.json": '{"type":"object"}',
      "launch-plan.schema.json": '{"type":"object"}',
    },
  });
  const manifest = buildManifest(tmpDir, 302);
  assert(manifest.summary.schemaCount === 2, "schema projection: count 2");
  assert(manifest.schemas.length === 2, "schema projection: array length 2");
  assert(
    manifest.schemas.includes("schemas/task-v2.schema.json"),
    "schema projection: includes task-v2.schema.json",
  );
  assert(
    manifest.schemas.includes("schemas/launch-plan.schema.json"),
    "schema projection: includes launch-plan.schema.json",
  );
  removeTmpDir(tmpDir);
}

// 7. Schema files from scripts/ai/ are projected correctly
{
  const tmpDir = createTmpRepo({
    "scripts/ai": {
      "task.schema.json": '{"type":"object"}',
      "monitor-state.schema.json": '{"type":"object"}',
    },
  });
  const manifest = buildManifest(tmpDir, 303);
  assert(manifest.summary.schemaCount === 2, "script schema projection: count 2");
  assert(
    manifest.schemas.includes("scripts/ai/task.schema.json"),
    "script schema projection: includes task.schema.json",
  );
  assert(
    manifest.schemas.includes("scripts/ai/monitor-state.schema.json"),
    "script schema projection: includes monitor-state.schema.json",
  );
  removeTmpDir(tmpDir);
}

// 8. Schemas from both directories are merged and sorted
{
  const tmpDir = createTmpRepo({
    schemas: {
      "task-v2.schema.json": '{"type":"object"}',
    },
    "scripts/ai": {
      "task.schema.json": '{"type":"object"}',
    },
  });
  const manifest = buildManifest(tmpDir, 304);
  assert(manifest.summary.schemaCount === 2, "merged schemas: count 2");
  assert(manifest.schemas[0] === "schemas/task-v2.schema.json", "merged schemas: sorted first");
  assert(manifest.schemas[1] === "scripts/ai/task.schema.json", "merged schemas: sorted second");
  removeTmpDir(tmpDir);
}

// 9. Docs are projected correctly
{
  const tmpDir = createTmpRepo({
    "docs/ai-native": {
      "context-bundles.md": "# Context Bundles\n",
      "context-bundle-fact-projection.md": "# Fact Projection\n",
    },
  });
  const manifest = buildManifest(tmpDir, 305);
  assert(manifest.summary.docCount === 2, "doc projection: count 2");
  assert(
    manifest.docs.includes("docs/ai-native/context-bundles.md"),
    "doc projection: includes context-bundles.md",
  );
  removeTmpDir(tmpDir);
}

// 10. All five categories populated simultaneously
{
  const tmpDir = createTmpRepo({
    "docs/ai-native": { "readme.md": "# Readme\n" },
    schemas: { "task-v2.schema.json": '{}' },
    "scripts/ai": { "task.schema.json": '{}' },
    ".github/ai-policy": { "risk-policy.json": '{}' },
    ".github/ai-state": { "active-workers.json": '{}' },
  });
  const manifest = buildManifest(tmpDir, 306);
  assert(manifest.summary.docCount === 1, "all categories: docCount 1");
  assert(manifest.summary.schemaCount === 2, "all categories: schemaCount 2");
  assert(manifest.summary.policyCount === 1, "all categories: policyCount 1");
  assert(manifest.summary.stateCount === 1, "all categories: stateCount 1");
  assert(
    manifest.summary.totalBytes > 0,
    "all categories: totalBytes > 0",
  );
  removeTmpDir(tmpDir);
}

// 11. totalBytes is the sum of all file sizes
{
  const tmpDir = createTmpRepo({
    ".github/ai-policy": { "test.json": '12345' },
  });
  const manifest = buildManifest(tmpDir, 307);
  assert(manifest.summary.totalBytes === 5, "totalBytes matches file size");
  removeTmpDir(tmpDir);
}

// 12. Files are sorted alphabetically within each category
{
  const tmpDir = createTmpRepo({
    ".github/ai-policy": {
      "z-last.json": '{}',
      "a-first.json": '{}',
      "m-middle.json": '{}',
    },
  });
  const manifest = buildManifest(tmpDir, 308);
  assert(manifest.policies[0].includes("a-first.json"), "sorted: a-first first");
  assert(manifest.policies[1].includes("m-middle.json"), "sorted: m-middle second");
  assert(manifest.policies[2].includes("z-last.json"), "sorted: z-last third");
  removeTmpDir(tmpDir);
}

// 13. Non-matching extensions are ignored
{
  const tmpDir = createTmpRepo({
    ".github/ai-policy": {
      "valid.json": '{}',
      "invalid.txt": 'not json extension',
      "also-valid.json": '{}',
    },
  });
  const manifest = buildManifest(tmpDir, 309);
  assert(manifest.summary.policyCount === 2, "non-matching ext: only .json counted");
  removeTmpDir(tmpDir);
}

// 14. .schema.json extension is distinguished from .json
{
  const tmpDir = createTmpRepo({
    schemas: {
      "task-v2.schema.json": '{}',
      "not-a-schema.json": '{}',
    },
  });
  const manifest = buildManifest(tmpDir, 310);
  assert(manifest.summary.schemaCount === 1, "schema ext: only .schema.json counted");
  assert(
    manifest.schemas.includes("schemas/task-v2.schema.json"),
    "schema ext: correct file included",
  );
  removeTmpDir(tmpDir);
}

// 15. Missing ai-policy directory produces empty policies array
{
  const tmpDir = createTmpRepo({
    ".github/ai-state": { "active-workers.json": '{}' },
  });
  const manifest = buildManifest(tmpDir, 311);
  assert(manifest.summary.policyCount === 0, "missing policy dir: count 0");
  assert(manifest.policies.length === 0, "missing policy dir: empty array");
  assert(manifest.summary.stateCount === 1, "missing policy dir: state still works");
  removeTmpDir(tmpDir);
}

// 16. Missing ai-state directory produces empty state array
{
  const tmpDir = createTmpRepo({
    ".github/ai-policy": { "risk-policy.json": '{}' },
  });
  const manifest = buildManifest(tmpDir, 312);
  assert(manifest.summary.stateCount === 0, "missing state dir: count 0");
  assert(manifest.state.length === 0, "missing state dir: empty array");
  assert(manifest.summary.policyCount === 1, "missing state dir: policy still works");
  removeTmpDir(tmpDir);
}

// 17. Missing schemas/ directory but scripts/ai/ schemas still work
{
  const tmpDir = createTmpRepo({
    "scripts/ai": { "task.schema.json": '{}' },
  });
  const manifest = buildManifest(tmpDir, 313);
  assert(manifest.summary.schemaCount === 1, "missing schemas dir: scripts/ai schemas count");
  assert(
    manifest.schemas.includes("scripts/ai/task.schema.json"),
    "missing schemas dir: scripts/ai schema included",
  );
  removeTmpDir(tmpDir);
}

// 18. Relative paths use forward slashes
{
  const tmpDir = createTmpRepo({
    ".github/ai-policy": { "test.json": '{}' },
    ".github/ai-state": { "test.json": '{}' },
    schemas: { "test.schema.json": '{}' },
  });
  const manifest = buildManifest(tmpDir, 314);
  for (const p of manifest.policies) {
    assert(!p.includes("\\"), "forward slashes: policy " + p);
  }
  for (const s of manifest.state) {
    assert(!s.includes("\\"), "forward slashes: state " + s);
  }
  for (const s of manifest.schemas) {
    assert(!s.includes("\\"), "forward slashes: schema " + s);
  }
  removeTmpDir(tmpDir);
}

// 19. generatedAt is a valid ISO-8601 string
{
  const tmpDir = createTmpRepo({});
  const manifest = buildManifest(tmpDir, 315);
  const parsed = new Date(manifest.generatedAt);
  assert(!isNaN(parsed.getTime()), "generatedAt is valid ISO-8601");
  removeTmpDir(tmpDir);
}

// 20. Real repo: policy files match expected count
{
  const repoRoot = path.resolve(__dirname, "..", "..");
  const policyDir = path.join(repoRoot, ".github", "ai-policy");
  const policyFiles = fs.readdirSync(policyDir).filter((f) => f.endsWith(".json")).sort();
  assert(policyFiles.length >= 7, "real repo: at least 7 policy JSON files");
  assert(
    policyFiles.includes("launch-policy.json"),
    "real repo: launch-policy.json present",
  );
  assert(
    policyFiles.includes("risk-policy.json"),
    "real repo: risk-policy.json present",
  );
  assert(
    policyFiles.includes("merge-policy.json"),
    "real repo: merge-policy.json present",
  );
}

// 21. Real repo: state files match expected count
{
  const repoRoot = path.resolve(__dirname, "..", "..");
  const stateDir = path.join(repoRoot, ".github", "ai-state");
  const stateFiles = fs.readdirSync(stateDir).filter((f) => f.endsWith(".json")).sort();
  assert(stateFiles.length >= 5, "real repo: at least 5 state JSON files");
  assert(
    stateFiles.includes("active-workers.json"),
    "real repo: active-workers.json present",
  );
  assert(
    stateFiles.includes("worker-trust.json"),
    "real repo: worker-trust.json present",
  );
}

// 22. Real repo: schema files from both directories
{
  const repoRoot = path.resolve(__dirname, "..", "..");
  const schemasDir = path.join(repoRoot, "schemas");
  const scriptsDir = path.join(repoRoot, "scripts", "ai");
  const topSchemas = fs.readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json")).sort();
  const scriptSchemas = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".schema.json")).sort();
  assert(topSchemas.length >= 5, "real repo: at least 5 top-level schemas");
  assert(scriptSchemas.length >= 2, "real repo: at least 2 script-local schemas");
  assert(
    topSchemas.includes("task-v2.schema.json"),
    "real repo: task-v2.schema.json present",
  );
  assert(
    scriptSchemas.includes("task.schema.json"),
    "real repo: scripts/ai/task.schema.json present",
  );
}

// 23. Real repo: full manifest builds cleanly
{
  const repoRoot = path.resolve(__dirname, "..", "..");
  const manifest = buildManifest(repoRoot, 456);
  assert(manifest.version === 2, "real repo manifest: version 2");
  assert(manifest.summary.policyCount >= 7, "real repo manifest: policyCount >= 7");
  assert(manifest.summary.stateCount >= 5, "real repo manifest: stateCount >= 5");
  assert(manifest.summary.schemaCount >= 7, "real repo manifest: schemaCount >= 7");
  assert(manifest.summary.docCount >= 1, "real repo manifest: docCount >= 1");
  assert(manifest.summary.totalBytes > 0, "real repo manifest: totalBytes > 0");
  assert(manifest.policies.length === manifest.summary.policyCount, "real repo: policies array matches count");
  assert(manifest.state.length === manifest.summary.stateCount, "real repo: state array matches count");
  assert(manifest.schemas.length === manifest.summary.schemaCount, "real repo: schemas array matches count");
  assert(manifest.docs.length === manifest.summary.docCount, "real repo: docs array matches count");
}

// 24. Real repo: self-test passes via subprocess
{
  const { execSync } = require("child_process");
  const scriptPath = path.resolve(__dirname, "generate-context-bundle.js");
  try {
    const output = execSync(`node "${scriptPath}" --self-test`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    assert(output.includes("OK:"), "self-test subprocess: produces OK output");
  } catch (err) {
    assert(false, "self-test subprocess: exited non-zero");
  }
}

// 25. Real repo: dry-run produces valid JSON manifest
{
  const { execSync } = require("child_process");
  const scriptPath = path.resolve(__dirname, "generate-context-bundle.js");
  try {
    const output = execSync(`node "${scriptPath}" --issue 999`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    // Extract JSON block between first { and last }
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}");
    const jsonString = output.slice(jsonStart, jsonEnd + 1);
    const manifest = JSON.parse(jsonString);
    assert(manifest.version === 2, "dry-run JSON: version 2");
    assert(manifest.issue === 999, "dry-run JSON: issue 999");
    assert(manifest.dryRun === true, "dry-run JSON: dryRun true");
  } catch (err) {
    assert(false, "dry-run subprocess: produced valid JSON");
  }
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
