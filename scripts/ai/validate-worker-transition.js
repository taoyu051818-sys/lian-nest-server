#!/usr/bin/env node

/**
 * validate-worker-transition.js
 *
 * Validates that a worker status transition is permitted by the explicit
 * state machine defined in schemas/worker-lifecycle-transitions.schema.json.
 *
 * This is a deterministic, local-logic script. No network calls.
 *
 * Usage:
 *   node scripts/ai/validate-worker-transition.js --from running --to completed
 *   node scripts/ai/validate-worker-transition.js --from running --to completed --stdout
 *   node scripts/ai/validate-worker-transition.js --help
 *
 * Exit codes:
 *   0 — transition is valid
 *   1 — transition is invalid
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'worker-lifecycle-transitions.schema.json');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'worker-transition-result.json');

// ── Transition Table ─────────────────────────────────────────────────────────
//
// Derived from the implicit transitions in wait-parallel-workers.ps1,
// batch-launch.ps1, and state-reconciler.ps1. This is the source of truth
// for valid transitions. The schema file mirrors this table.

const TRANSITIONS = {
  // Initial → planned (dry-run scheduling)
  // Initial → running (direct launch without dry-run)
  'null': ['planned', 'running'],

  // Planned → running (worker launched)
  // Planned → failed (launch failed, no process found)
  'planned': ['running', 'failed'],

  // Running → completed (exit code 0)
  // Running → failed (exit code non-zero, result parse error, missing result)
  // Running → stale (exceeded stale threshold)
  // Running → blocked (blocked from progressing)
  // Running → needs-human (human intervention required)
  'running': ['completed', 'failed', 'stale', 'blocked', 'needs-human'],

  // Terminal states: no outbound transitions.
  // Completed workers are done.
  'completed': [],

  // Failed workers may be relaunched (new worker, not status mutation).
  'failed': [],

  // Stale workers are terminal in the projection.
  // The state reconciler may create a new blocked entry but does not
  // mutate the stale entry's status.
  'stale': [],

  // Blocked workers may be unblocked by human or reconciler.
  // Blocked → running (unblocked, work resumes)
  // Blocked → failed (unblocked but determined to have failed)
  'blocked': ['running', 'failed'],

  // Needs-human workers may be resolved.
  // Needs-human → running (human resolved the issue, work resumes)
  // Needs-human → failed (human determined failure)
  'needs-human': ['running', 'failed'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
validate-worker-transition.js — Worker lifecycle transition validator

USAGE
    node scripts/ai/validate-worker-transition.js [options]

OPTIONS
    --from <status>    Current worker status (required)
    --to <status>      Desired target status (required)
    --trigger <name>   Transition trigger (optional, for audit)
    --out <path>       Output path for validation result JSON
                       (default: .github/ai-state/worker-transition-result.json)
    --stdout           Print JSON to stdout instead of writing a file
    --help, -h         Show this help message and exit.

VALID STATUS VALUES
    null, planned, running, completed, failed, stale, blocked, needs-human

EXIT CODES
    0   transition is valid
    1   transition is invalid
    2   invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    trigger: null,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--from') {
      i++;
      if (i >= argv.length) { console.error('Error: --from requires a status value'); process.exit(2); }
      args.from = argv[i];
    } else if (arg === '--to') {
      i++;
      if (i >= argv.length) { console.error('Error: --to requires a status value'); process.exit(2); }
      args.to = argv[i];
    } else if (arg === '--trigger') {
      i++;
      if (i >= argv.length) { console.error('Error: --trigger requires a value'); process.exit(2); }
      args.trigger = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Core Validator ───────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['null', 'planned', 'running', 'completed', 'failed', 'stale', 'blocked', 'needs-human']);

/**
 * Validates a worker status transition.
 *
 * @param {string} fromStatus - Current status (use 'null' for unset)
 * @param {string} toStatus - Desired target status
 * @param {string|null} trigger - Optional trigger name for audit
 * @returns {{ valid: boolean, from: string, to: string, trigger: string|null, allowedTargets: string[], reason: string, capturedAt: string }}
 */
function validateTransition(fromStatus, toStatus, trigger) {
  const from = fromStatus === null ? 'null' : fromStatus;
  const to = toStatus;

  if (!VALID_STATUSES.has(from)) {
    return {
      valid: false,
      from,
      to,
      trigger,
      allowedTargets: [],
      reason: `Invalid from-status: "${from}". Valid values: ${[...VALID_STATUSES].join(', ')}`,
      capturedAt: new Date().toISOString(),
    };
  }

  if (!VALID_STATUSES.has(to)) {
    return {
      valid: false,
      from,
      to,
      trigger,
      allowedTargets: TRANSITIONS[from] || [],
      reason: `Invalid to-status: "${to}". Valid values: ${[...VALID_STATUSES].join(', ')}`,
      capturedAt: new Date().toISOString(),
    };
  }

  const allowedTargets = TRANSITIONS[from] || [];
  const valid = allowedTargets.includes(to);

  return {
    valid,
    from,
    to,
    trigger,
    allowedTargets,
    reason: valid
      ? `Transition ${from} → ${to} is permitted.`
      : `Transition ${from} → ${to} is not permitted. Allowed targets from "${from}": ${allowedTargets.length > 0 ? allowedTargets.join(', ') : '(none — terminal state)'}`,
    capturedAt: new Date().toISOString(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.from === null || args.to === null) {
    console.error('Error: --from and --to are both required.');
    process.exit(2);
  }

  const result = validateTransition(args.from, args.to, args.trigger);
  const json = JSON.stringify(result, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Transition result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  process.exit(result.valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateTransition,
  TRANSITIONS,
  VALID_STATUSES,
};
