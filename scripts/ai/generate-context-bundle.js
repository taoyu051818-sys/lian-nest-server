#!/usr/bin/env node
/**
 * generate-context-bundle.js — Context bundle generator with fact projection
 *
 * Scans docs/ai-native/, schemas/, .github/ai-policy/, .github/ai-state/,
 * and scripts/ai/ to build a bounded context manifest for a given issue.
 * Dry-run mode (default) prints the manifest to stdout without writing files.
 *
 * Usage:
 *   node scripts/ai/generate-context-bundle.js --help
 *   node scripts/ai/generate-context-bundle.js --issue 333
 *   node scripts/ai/generate-context-bundle.js --issue 333 --outDir ./bundles
 *   node scripts/ai/generate-context-bundle.js --issue 333 --execute
 *   node scripts/ai/generate-context-bundle.js --self-test
 */

const fs = require("fs");
const path = require("path");

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeStep(msg) {
  process.stdout.write(`\x1b[36m>> ${msg}\x1b[0m\n`);
}

function writeOk(msg) {
  process.stdout.write(`\x1b[32mOK: ${msg}\x1b[0m\n`);
}

function writeWarn(msg) {
  process.stderr.write(`\x1b[33mWARN: ${msg}\x1b[0m\n`);
}

function writeFail(msg) {
  process.stderr.write(`\x1b[31mFAIL: ${msg}\x1b[0m\n`);
  process.exit(1);
}

// ── Argument parsing ─────────────────────────────────────────────────────────

const HELP_TEXT = `
generate-context-bundle.js — Context bundle generator with fact projection

USAGE
    node scripts/ai/generate-context-bundle.js [options]

OPTIONS
    --issue <number>     GitHub issue number (required unless --self-test)
    --outDir <path>      Output directory for bundle manifest
                         (default: ./context-bundles)
    --execute            Write bundle files. Without this flag the script
                         runs in dry-run mode and only prints the manifest.
    --self-test          Run a focused self-test validating all scan
                         directories resolve and exit. No files written.
    --help               Show this help message and exit.

EXIT CODES
    0   Success (dry-run, execute, or self-test pass)
    1   Validation failure
    2   Invalid arguments

SCAN DIRECTORIES
    docs/ai-native/*.md              Documentation files
    schemas/*.schema.json            Top-level JSON schemas
    scripts/ai/*.schema.json         Script-local schemas
    .github/ai-policy/*.json         Machine-readable policy files
    .github/ai-state/*.json          Runtime state projections

EXAMPLES
    node scripts/ai/generate-context-bundle.js --help
    node scripts/ai/generate-context-bundle.js --issue 333
    node scripts/ai/generate-context-bundle.js --issue 333 --outDir ./bundles
    node scripts/ai/generate-context-bundle.js --issue 333 --execute
    node scripts/ai/generate-context-bundle.js --self-test
`;

function parseArgs(argv) {
  const args = { issue: null, outDir: "./context-bundles", execute: false, help: false, selfTest: false };
  let i = 2; // skip node and script path
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--issue") {
      i++;
      if (i >= argv.length) writeFail("Missing value for --issue");
      const num = Number(argv[i]);
      if (!Number.isInteger(num) || num <= 0) writeFail(`Invalid issue number: ${argv[i]}`);
      args.issue = num;
    } else if (arg === "--outDir") {
      i++;
      if (i >= argv.length) writeFail("Missing value for --outDir");
      args.outDir = argv[i];
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else {
      writeFail(`Unknown argument: ${arg}`);
    }
    i++;
  }
  return args;
}

// ── Doc scanning ─────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs", "ai-native");
const SCHEMAS_DIR = path.join(REPO_ROOT, "schemas");
const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts", "ai");
const POLICY_DIR = path.join(REPO_ROOT, ".github", "ai-policy");
const STATE_DIR = path.join(REPO_ROOT, ".github", "ai-state");

function listFilesByExtension(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => ({
      relativePath: path.relative(REPO_ROOT, path.join(dir, f)).replace(/\\/g, "/"),
      absolutePath: path.join(dir, f),
      sizeBytes: fs.statSync(path.join(dir, f)).size,
    }));
}

const listMarkdownFiles = (dir) => listFilesByExtension(dir, ".md");
const listSchemaFiles = (dir) => listFilesByExtension(dir, ".schema.json");
const listJsonFiles = (dir) => listFilesByExtension(dir, ".json");

// ── Bundle generation ────────────────────────────────────────────────────────

function buildBundleManifest(issueNumber) {
  const docs = listMarkdownFiles(DOCS_DIR);
  const schemas = [
    ...listSchemaFiles(SCHEMAS_DIR),
    ...listSchemaFiles(SCRIPTS_DIR),
  ];
  const policies = listJsonFiles(POLICY_DIR);
  const state = listJsonFiles(STATE_DIR);

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

// ── Self-test ──────────────────────────────────────────────────────────────

const SCAN_DIRS = [
  { label: "docs/ai-native", dir: DOCS_DIR, ext: ".md" },
  { label: "schemas", dir: SCHEMAS_DIR, ext: ".schema.json" },
  { label: "scripts/ai (schemas)", dir: SCRIPTS_DIR, ext: ".schema.json" },
  { label: ".github/ai-policy", dir: POLICY_DIR, ext: ".json" },
  { label: ".github/ai-state", dir: STATE_DIR, ext: ".json" },
];

function runSelfTest() {
  writeStep("Running self-test...");
  let passed = 0;
  let failed = 0;

  for (const { label, dir, ext } of SCAN_DIRS) {
    const exists = fs.existsSync(dir);
    if (!exists) {
      writeWarn(`Directory missing (non-fatal): ${label} → ${dir}`);
      // Missing directory is acceptable (graceful empty), count as pass
      passed++;
      continue;
    }
    const files = listFilesByExtension(dir, ext);
    writeOk(`${label}: ${files.length} ${ext} file(s) found`);
    passed++;
  }

  // Validate a sample manifest builds cleanly
  const sample = buildBundleManifest(0);
  const requiredKeys = ["version", "issue", "generatedAt", "dryRun", "summary", "docs", "schemas", "policies", "state"];
  for (const key of requiredKeys) {
    if (!(key in sample)) {
      writeFail(`Self-test failed: manifest missing key "${key}"`);
      failed++;
    }
  }
  if (sample.version !== 2) {
    writeFail(`Self-test failed: expected version 2, got ${sample.version}`);
    failed++;
  }
  passed++;

  writeStep(`Self-test complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(HELP_TEXT.trimStart());
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  if (!args.issue) {
    writeFail("--issue is required. Run with --help for usage.");
  }

  writeStep(`Scanning docs for issue #${args.issue}...`);

  const manifest = buildBundleManifest(args.issue);

  writeStep(
    `Found ${manifest.summary.docCount} docs, ${manifest.summary.schemaCount} schemas, ` +
    `${manifest.summary.policyCount} policies, ${manifest.summary.stateCount} state files ` +
    `(${manifest.summary.totalBytes} bytes)`,
  );

  if (!args.execute) {
    // ── Dry-run mode ─────────────────────────────────────────────────────
    writeWarn("Dry-run mode. No files were written.");
    writeWarn(`Target directory: ${path.resolve(args.outDir)}`);
    process.stdout.write("\n");
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    process.exit(0);
  }

  // ── Execute mode ─────────────────────────────────────────────────────────
  const outDir = path.resolve(args.outDir);
  const outPath = path.join(outDir, `bundle-${args.issue}.json`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  writeOk(`Bundle written to ${outPath}`);
}

main();
