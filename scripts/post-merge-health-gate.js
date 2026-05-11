#!/usr/bin/env node

/**
 * post-merge-health-gate.js
 *
 * Runs a series of post-merge health checks and reports failures with
 * suggested worker categories for follow-up.
 *
 * Usage:
 *   node scripts/post-merge-health-gate.js --quick   # fast checks (default)
 *   node scripts/post-merge-health-gate.js --full    # full checks including tests
 *   node scripts/post-merge-health-gate.js --help    # show help
 *
 * Exit codes:
 *   0 -- all checks passed
 *   1 -- one or more checks failed
 *   2 -- invalid arguments
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// --- Worker category mapping ---
const CATEGORIES = {
  'dependency/generate': [
    'npm install', 'npm ci', 'prisma generate', 'prisma validate',
  ],
  'database foundation': [],
  'boundary guard': [
    'check-repository-boundary', 'test:boundary',
  ],
  'test env': [
    'npm test', 'jest',
  ],
  'conflict refresh': [
    'tsc', 'npm run check',
  ],
  'runtime compile': [
    'npm run build', 'nest build',
  ],
};

// Prisma client error patterns that indicate missing generated client or
// incomplete database foundation. Matched against combined stdout+stderr.
const PRISMA_CLIENT_ERROR_PATTERNS = [
  /has no exported member ['"]?PrismaClient/i,
  /Cannot find module ['"]@prisma\/client['"]/i,
  /Cannot find module ['"]prisma\/config['"]/i,
  /Property '\$connect' does not exist/i,
  /Property '\$disconnect' does not exist/i,
  /is not assignable to type ['"]PrismaClient['"]/i,
];

function categorize(label) {
  const lower = label.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return 'runtime compile';
}

/**
 * Re-classify a failure based on its combined output when the error matches
 * known Prisma generated-client patterns. Returns the refined category or
 * the original category unchanged.
 */
function refineCategory(originalCategory, output) {
  if (!output) return originalCategory;
  if (PRISMA_CLIENT_ERROR_PATTERNS.some(rx => rx.test(output))) {
    return 'dependency/generate';
  }
  return originalCategory;
}

// --- Check definitions ---

function hasPrismaSchema() {
  return fs.existsSync(path.join(ROOT, 'prisma', 'schema.prisma'));
}

function hasBoundaryScript() {
  return fs.existsSync(path.join(ROOT, 'scripts', 'check-repository-boundary.js'));
}

function buildQuickChecks() {
  const checks = [
    { label: 'npm run check (tsc --noEmit)', cmd: 'npm run check' },
    { label: 'npm run build (nest build)', cmd: 'npm run build' },
  ];
  if (hasPrismaSchema()) {
    checks.push({ label: 'npx prisma validate', cmd: 'npx prisma validate' });
  }
  return checks;
}

function buildFullChecks() {
  const checks = buildQuickChecks();
  if (hasBoundaryScript()) {
    checks.push({
      label: 'npm run test:boundary',
      cmd: 'npm run test:boundary',
    });
  }
  checks.push({
    label: 'npm test -- --runInBand',
    cmd: 'npm test -- --runInBand',
  });
  return checks;
}

// --- Runner ---

function runCheck(label, cmd) {
  const tag = `[${label}]`;
  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    console.log(`  PASS  ${tag}`);
    return { label, cmd, passed: true, output: output.toString() };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    const combined = (stderr + stdout).split('\n').slice(-20).join('\n');
    console.log(`  FAIL  ${tag}`);
    if (combined.trim()) {
      for (const line of combined.trim().split('\n')) {
        console.log(`        ${line}`);
      }
    }
    return { label, cmd, passed: false, output: combined };
  }
}

// --- Summary ---

function printSummary(results) {
  const failures = results.filter(r => !r.passed);
  if (failures.length === 0) {
    console.log('\nAll checks passed.');
    return;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`FAILURE SUMMARY (${failures.length} of ${results.length} checks failed)`);
  console.log('='.repeat(50));

  const byCategory = {};
  for (const f of failures) {
    let cat = categorize(f.label);
    cat = refineCategory(cat, f.output);
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(f.label);
  }

  for (const [category, labels] of Object.entries(byCategory)) {
    console.log(`\n  [${category}]`);
    for (const label of labels) {
      console.log(`    - ${label}`);
    }
  }

  console.log('\nSuggested next steps:');
  const cats = Object.keys(byCategory);
  for (const cat of cats) {
    switch (cat) {
      case 'dependency/generate':
        console.log('  - npm install');
        console.log('  - npx prisma generate');
        console.log('  - npx prisma validate');
        console.log('  - If PrismaClient is still unresolved, issue or fix a database baseline migration');
        break;
      case 'boundary guard':
        console.log('  - Fix repository boundary violations in src/repositories/');
        break;
      case 'test env':
        console.log('  - Check test configuration and environment variables');
        break;
      case 'conflict refresh':
        console.log('  - Rebase or merge latest main, resolve type conflicts');
        break;
      case 'runtime compile':
        console.log('  - Fix TypeScript/build errors in source files');
        break;
    }
  }
  console.log('');
}

// --- Help ---

function printHelp() {
  console.log(`
post-merge-health-gate.js — Post-merge health gate runner

USAGE
  node scripts/post-merge-health-gate.js [OPTIONS]

OPTIONS
  --quick    Run fast checks only (default):
               - npm run check  (tsc --noEmit)
               - npm run build  (nest build)
               - npx prisma validate  (if prisma/schema.prisma exists)

  --full     Run all checks including tests:
               - everything in --quick
               - npm run test:boundary  (if boundary script exists)
               - npm test -- --runInBand

  --help     Show this help message

EXIT CODES
  0   All checks passed
  1   One or more checks failed
  2   Invalid arguments

FAILURE CATEGORIES
  dependency/generate  — missing dependencies, stale Prisma generated client,
                         unresolved @prisma/client or prisma/config modules
  database foundation  — Prisma schema/migration issues, missing baseline
  boundary guard       — repository boundary violations
  test env             — test failures, missing test config
  conflict refresh     — TypeScript/type conflicts after merge
  runtime compile      — build/compilation errors
`);
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const isQuick = args.includes('--quick') || args.length === 0;
  const isFull = args.includes('--full');

  if (!isQuick && !isFull) {
    console.error('Unknown option(s):', args.join(' '));
    console.error('Run with --help for usage information.');
    process.exit(2);
  }

  if (isQuick && isFull) {
    console.error('Cannot combine --quick and --full. Choose one.');
    process.exit(2);
  }

  const mode = isFull ? 'full' : 'quick';
  const checks = isFull ? buildFullChecks() : buildQuickChecks();

  console.log(`Post-merge health gate [${mode}]`);
  console.log('-'.repeat(50));
  console.log(`Running ${checks.length} check(s)...\n`);

  const results = [];
  for (const check of checks) {
    results.push(runCheck(check.label, check.cmd));
  }

  printSummary(results);

  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

// --- Exports for testing ---
module.exports = { categorize, refineCategory, PRISMA_CLIENT_ERROR_PATTERNS };

// Only run main when invoked directly, not when required for testing
if (require.main === module) {
  main();
}
