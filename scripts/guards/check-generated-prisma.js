#!/usr/bin/env node

/**
 * check-generated-prisma.js
 *
 * Detects generated Prisma client changes in a diff and enforces ownership.
 *
 * Usage:
 *   node scripts/guards/check-generated-prisma.js [options]
 *
 * Options:
 *   --base <ref>           Base ref for diff (default: main)
 *   --allow-generated      Allow generated-only changes (ownership declared)
 *   --json                 Print JSON summary to stdout
 *   --help                 Show help
 *
 * Exit codes:
 *   0 — pass
 *   1 — violation (generated changed without schema or allowlist)
 *   2 — usage error
 *
 * Run standalone: node scripts/guards/check-generated-prisma.js
 */

const { execSync } = require('child_process');

const GENERATED_PREFIX = 'src/generated/prisma/';
const SCHEMA_PATH = 'prisma/schema.prisma';

// --- Exports for testing ---

function parseArgs(argv) {
  const args = { base: 'main', allowGenerated: false, json: false, help: false };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--base':
        i++;
        args.base = raw[i] || '';
        break;
      case '--allow-generated':
        args.allowGenerated = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        args._unknown = raw[i];
        break;
    }
  }
  return args;
}

function classifyChangedFiles(files) {
  const generated = [];
  const schema = [];
  for (const f of files) {
    if (f.startsWith(GENERATED_PREFIX)) generated.push(f);
    else if (f === SCHEMA_PATH) schema.push(f);
  }
  return { generated, schema };
}

function buildDiffFiles(base) {
  try {
    const merged = execSync(
      `git diff --name-only --diff-filter=ACMRD ${base}...HEAD`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const staged = execSync(
      'git diff --cached --name-only --diff-filter=ACMRD',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const lines = [merged, staged].filter(Boolean).join('\n');
    if (!lines) return [];
    return [...new Set(lines.split('\n').map((l) => l.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function runGuard({ files, allowGenerated = false, json = false, base }) {
  const changedFiles = files || buildDiffFiles(base);
  const { generated, schema } = classifyChangedFiles(changedFiles);

  const result = {
    status: 'pass',
    violations: [],
    warnings: [],
    summary: {
      base,
      totalChanged: changedFiles.length,
      generatedChanged: generated.length,
      schemaChanged: schema.length,
      allowGenerated,
    },
    generated,
    schema,
  };

  if (generated.length > 0 && schema.length === 0 && !allowGenerated) {
    result.status = 'fail';
    result.violations.push(
      `Generated Prisma files changed without schema update and without --allow-generated: ${generated.join(', ')}`
    );
  }

  if (schema.length > 0 && generated.length === 0) {
    result.status = result.status === 'fail' ? 'fail' : 'warn';
    result.warnings.push(
      'Schema changed but generated Prisma client was not updated — may need `prisma generate`'
    );
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'fail' ? 1 : 0;
  }

  if (result.status === 'fail') {
    console.error('Generated Prisma guard FAILED:');
    for (const v of result.violations) console.error('  - ' + v);
    return 1;
  }

  if (result.status === 'warn') {
    console.warn('Generated Prisma guard WARNINGS:');
    for (const w of result.warnings) console.warn('  - ' + w);
  }

  console.log('Generated Prisma guard passed.');
  return 0;
}

function printHelp() {
  console.log(`Usage: node scripts/guards/check-generated-prisma.js [options]

Detects generated Prisma client changes and enforces ownership rules.

Options:
  --base <ref>           Base ref for diff (default: main)
  --allow-generated      Allow generated-only changes (ownership declared)
  --json                 Print JSON summary to stdout
  --help, -h             Show this help

Exit codes:
  0  pass
  1  violation (generated changed without schema or allowlist)
  2  usage error

Freshness rules:
  Schema + generated changed   → pass (normal regeneration)
  Only generated changed       → fail (needs --allow-generated)
  Only schema changed          → warn (may need prisma generate)
  Neither changed              → pass`);
}

// --- Main ---

if (require.main === module) {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args._unknown) {
    console.error(`Unknown argument: ${args._unknown}`);
    process.exit(2);
  }

  if (!args.base) {
    console.error('--base requires a ref argument');
    process.exit(2);
  }

  const code = runGuard(args);
  process.exit(code);
}

module.exports = { parseArgs, classifyChangedFiles, buildDiffFiles, runGuard };
