#!/usr/bin/env node
/**
 * generate-context-bundle.js — Context bundle generator (dry-run skeleton)
 *
 * Scans docs/ai-native/ and scripts/ai/ to build a bounded context manifest
 * for a given issue. Dry-run mode (default) prints the manifest to stdout
 * without writing files.
 *
 * Usage:
 *   node scripts/ai/generate-context-bundle.js --help
 *   node scripts/ai/generate-context-bundle.js --issue 333
 *   node scripts/ai/generate-context-bundle.js --issue 333 --outDir ./bundles
 *   node scripts/ai/generate-context-bundle.js --issue 333 --execute
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
generate-context-bundle.js — Context bundle generator (dry-run skeleton)

USAGE
    node scripts/ai/generate-context-bundle.js [options]

OPTIONS
    --issue <number>     GitHub issue number (required)
    --outDir <path>      Output directory for bundle manifest
                         (default: ./context-bundles)
    --execute            Write bundle files. Without this flag the script
                         runs in dry-run mode and only prints the manifest.
    --help               Show this help message and exit.

EXIT CODES
    0   Success (dry-run or execute)
    1   Validation failure
    2   Invalid arguments

EXAMPLES
    node scripts/ai/generate-context-bundle.js --help
    node scripts/ai/generate-context-bundle.js --issue 333
    node scripts/ai/generate-context-bundle.js --issue 333 --outDir ./bundles
    node scripts/ai/generate-context-bundle.js --issue 333 --execute
`;

function parseArgs(argv) {
  const args = { issue: null, outDir: "./context-bundles", execute: false, help: false };
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
const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts", "ai");

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({
      relativePath: path.relative(REPO_ROOT, path.join(dir, f)).replace(/\\/g, "/"),
      absolutePath: path.join(dir, f),
      sizeBytes: fs.statSync(path.join(dir, f)).size,
    }));
}

function listSchemaFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".schema.json"))
    .sort()
    .map((f) => ({
      relativePath: path.relative(REPO_ROOT, path.join(dir, f)).replace(/\\/g, "/"),
      absolutePath: path.join(dir, f),
      sizeBytes: fs.statSync(path.join(dir, f)).size,
    }));
}

// ── Bundle generation ────────────────────────────────────────────────────────

function buildBundleManifest(issueNumber) {
  const docs = listMarkdownFiles(DOCS_DIR);
  const schemas = listSchemaFiles(SCRIPTS_DIR);

  const totalBytes = [...docs, ...schemas].reduce((sum, f) => sum + f.sizeBytes, 0);

  return {
    version: 1,
    issue: issueNumber,
    generatedAt: new Date().toISOString(),
    dryRun: true,
    summary: {
      docCount: docs.length,
      schemaCount: schemas.length,
      totalBytes,
    },
    docs: docs.map((d) => d.relativePath),
    schemas: schemas.map((s) => s.relativePath),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(HELP_TEXT.trimStart());
    process.exit(0);
  }

  if (!args.issue) {
    writeFail("--issue is required. Run with --help for usage.");
  }

  writeStep(`Scanning docs for issue #${args.issue}...`);

  const manifest = buildBundleManifest(args.issue);

  writeStep(`Found ${manifest.summary.docCount} docs, ${manifest.summary.schemaCount} schemas (${manifest.summary.totalBytes} bytes)`);

  if (!args.execute) {
    // ── Dry-run mode ─────────────────────────────────────────────────────
    writeWarn("Dry-run mode. No files were written.");
    writeWarn(`Target directory: ${path.resolve(args.outDir)}`);
    process.stdout.write("\n");
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    process.exit(0);
  }

  // ── Execute mode ─────────────────────────────────────────────────────────
  // Skeleton placeholder: write the manifest to outDir.
  const outDir = path.resolve(args.outDir);
  const outPath = path.join(outDir, `bundle-${args.issue}.json`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  writeOk(`Bundle written to ${outPath}`);
}

main();
