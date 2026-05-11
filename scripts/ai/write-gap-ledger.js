#!/usr/bin/env node

/**
 * write-gap-ledger.js
 *
 * Append-only gap ledger writer for .github/ai-state/gap-ledger.ndjson.
 * Records discrete gap events from the planning loop (worker failures,
 * health gate blocks, launch rejections, plan drift, stale rows).
 *
 * Each call appends exactly one NDJSON line. The file is never truncated
 * or rewritten — it grows monotonically.
 *
 * Usage:
 *   node scripts/ai/write-gap-ledger.js --help
 *   node scripts/ai/write-gap-ledger.js --type worker-failed --issue 398 --desc "exit code 1"
 *   node scripts/ai/write-gap-ledger.js --type health-gate-fail --commit abc1234 --severity red --desc "tsc failed"
 *   node scripts/ai/write-gap-ledger.js --type launch-blocked --issue 398 --desc "conflict group collision" --dry-run
 *
 * Exit codes:
 *   0 — entry appended (or dry-run printed)
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_LEDGER = path.join(REPO_ROOT, '.github', 'ai-state', 'gap-ledger.ndjson');
const ENTRY_VERSION = 1;

const GAP_TYPES = [
  'worker-failed',
  'worker-stale',
  'health-gate-fail',
  'launch-blocked',
  'plan-drift',
  'stale-row',
];

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-gap-ledger.js — Append-only gap ledger writer for planning loop gaps

USAGE
    node scripts/ai/write-gap-ledger.js --type <gap-type> --desc <text> [options]

OPTIONS
    --type <type>       Gap type (required). One of:
                          worker-failed    Worker exited non-zero without PR
                          worker-stale     Worker heartbeat went stale
                          health-gate-fail Post-merge health gate failure
                          launch-blocked   Launch gate rejected a task
                          plan-drift       Planned task deviated from expectation
                          stale-row        Migration matrix row detected stale

    --desc <text>       Human-readable description (required).

    --issue <number>    GitHub issue number.
    --pr <number>       GitHub PR number.
    --branch <name>     Git branch or worktree name.
    --commit <sha>      Git commit SHA (7-40 hex chars).
    --severity <level>  One of: low, medium, high, critical (default: medium).
    --meta <json>       JSON string for arbitrary extra metadata.
    --out <path>        Ledger file path (default: .github/ai-state/gap-ledger.ndjson).
    --dry-run           Print the entry without writing.
    --help              Show this help message and exit.

EXIT CODES
    0  Entry appended (or dry-run printed)
    2  Invalid arguments

EXAMPLES
    # Record a worker failure
    node scripts/ai/write-gap-ledger.js --type worker-failed --issue 398 --branch claude/wave11-... --desc "exit code 1, no PR produced"

    # Record a health gate failure with commit
    node scripts/ai/write-gap-ledger.js --type health-gate-fail --commit abc1234 --severity red --desc "tsc and build failed"

    # Record a launch block with extra metadata
    node scripts/ai/write-gap-ledger.js --type launch-blocked --issue 398 --desc "conflict group collision" --meta '{"conflictGroup":"auth-core","blockingIssue":258}'

    # Dry-run to preview
    node scripts/ai/write-gap-ledger.js --type plan-drift --issue 398 --desc "task deferred" --dry-run

    # Read existing ledger
    cat .github/ai-state/gap-ledger.ndjson
`.trimStart();
  process.stdout.write(help);
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    type: null,
    desc: null,
    issue: null,
    pr: null,
    branch: null,
    commit: null,
    severity: 'medium',
    meta: null,
    out: DEFAULT_LEDGER,
    dryRun: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--type') {
      i++;
      if (i >= argv.length) { console.error('Error: --type requires a value'); process.exit(2); }
      args.type = argv[i];
    } else if (arg === '--desc') {
      i++;
      if (i >= argv.length) { console.error('Error: --desc requires a value'); process.exit(2); }
      args.desc = argv[i];
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a number'); process.exit(2); }
      args.issue = parseInt(argv[i], 10);
      if (isNaN(args.issue)) { console.error('Error: --issue must be a number'); process.exit(2); }
    } else if (arg === '--pr') {
      i++;
      if (i >= argv.length) { console.error('Error: --pr requires a number'); process.exit(2); }
      args.pr = parseInt(argv[i], 10);
      if (isNaN(args.pr)) { console.error('Error: --pr must be a number'); process.exit(2); }
    } else if (arg === '--branch') {
      i++;
      if (i >= argv.length) { console.error('Error: --branch requires a value'); process.exit(2); }
      args.branch = argv[i];
    } else if (arg === '--commit') {
      i++;
      if (i >= argv.length) { console.error('Error: --commit requires a SHA'); process.exit(2); }
      args.commit = argv[i];
    } else if (arg === '--severity') {
      i++;
      if (i >= argv.length) { console.error('Error: --severity requires a value'); process.exit(2); }
      args.severity = argv[i];
    } else if (arg === '--meta') {
      i++;
      if (i >= argv.length) { console.error('Error: --meta requires a JSON string'); process.exit(2); }
      args.meta = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate(args) {
  const errors = [];

  if (!args.type) {
    errors.push('--type is required');
  } else if (!GAP_TYPES.includes(args.type)) {
    errors.push(`--type must be one of: ${GAP_TYPES.join(', ')}. Got: "${args.type}"`);
  }

  if (!args.desc) {
    errors.push('--desc is required');
  }

  if (!SEVERITIES.includes(args.severity)) {
    errors.push(`--severity must be one of: ${SEVERITIES.join(', ')}. Got: "${args.severity}"`);
  }

  if (args.commit && !/^[0-9a-fA-F]{7,40}$/.test(args.commit)) {
    errors.push('--commit must be 7-40 hex characters');
  }

  if (args.meta) {
    try {
      JSON.parse(args.meta);
    } catch {
      errors.push('--meta must be valid JSON');
    }
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`Error: ${e}`);
    }
    process.exit(2);
  }
}

// ── Entry builder ────────────────────────────────────────────────────────────

function buildEntry(args) {
  const entry = {
    entryVersion: ENTRY_VERSION,
    recordedAt: new Date().toISOString(),
    gapType: args.type,
    severity: args.severity,
    description: args.desc,
  };

  if (args.issue != null) entry.issue = args.issue;
  if (args.pr != null) entry.pr = args.pr;
  if (args.branch) entry.branch = args.branch;
  if (args.commit) entry.commit = args.commit;
  if (args.meta) entry.meta = JSON.parse(args.meta);

  return entry;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  validate(args);

  const entry = buildEntry(args);
  const line = JSON.stringify(entry);

  if (args.dryRun) {
    process.stdout.write('[dry-run] Would append to ledger:\n');
    process.stdout.write(line + '\n');
    process.stdout.write(`[dry-run] Target file: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
    process.exit(0);
  }

  // Ensure parent directory exists
  const dir = path.dirname(args.out);
  fs.mkdirSync(dir, { recursive: true });

  // Append one NDJSON line
  fs.appendFileSync(args.out, line + '\n', 'utf8');

  process.stdout.write(`Gap entry appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  process.stdout.write(`  type=${args.type} severity=${args.severity}`);
  if (args.issue != null) process.stdout.write(` issue=#${args.issue}`);
  process.stdout.write('\n');
}

main();
