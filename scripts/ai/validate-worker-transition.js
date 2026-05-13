#!/usr/bin/env node

/**
 * validate-worker-transition.js
 *
 * Validates worker status transitions against the explicit state machine
 * defined in worker-lifecycle-state-machine.json. Prevents status
 * inconsistency by rejecting invalid transitions.
 *
 * This is a deterministic, local-logic script. It reads a transition
 * request (fromStatus, toStatus, reason?) and validates it against the
 * state machine. No network calls and no mutations.
 *
 * Usage:
 *   node scripts/ai/validate-worker-transition.js --help
 *   node scripts/ai/validate-worker-transition.js --from running --to completed
 *   node scripts/ai/validate-worker-transition.js --from running --to failed --reason "exit code 1"
 *   echo '{"from":"running","to":"completed"}' | node scripts/ai/validate-worker-transition.js --stdin
 *
 * Exit codes:
 *   0 — valid transition
 *   1 — invalid transition
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_MACHINE_PATH = path.join(__dirname, 'worker-lifecycle-state-machine.json');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'worker-transition-result.json');

const SCHEMA_VERSION = 1;
const DECISIONS = { VALID: 'valid', INVALID: 'invalid' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
validate-worker-transition.js — Worker lifecycle transition validator

USAGE
    node scripts/ai/validate-worker-transition.js [options]

OPTIONS
    --from <state>       Source worker status (required unless --stdin)
    --to <state>         Target worker status (required unless --stdin)
    --reason <string>    Human-readable reason (required for transitions that have requiresReason=true)
    --stdin              Read transition JSON from stdin
    --out <path>         Output path for validation result JSON
                         (default: .github/ai-state/worker-transition-result.json)
    --stdout             Print JSON to stdout instead of writing a file
    --list-transitions   List all valid transitions and exit
    --help, -h           Show this help message and exit.

TRANSITION INPUT SCHEMA
    {
      "from": "running",
      "to": "completed",
      "reason": null
    }

VALID STATES
    planned, running, completed, failed, stale, blocked, needs-human

EXIT CODES
    0   valid transition
    1   invalid transition
    2   invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

// ── State Machine Loader ─────────────────────────────────────────────────────

function loadStateMachine() {
  const sm = readJson(STATE_MACHINE_PATH);
  if (!sm || !sm.states || !sm.transitions) {
    console.error('Error: Failed to load state machine from ' + STATE_MACHINE_PATH);
    process.exit(2);
  }
  return sm;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateTransition(sm, from, to, reason) {
  const violations = [];
  const warnings = [];

  // Check that both states exist in the state machine
  if (!sm.states[from]) {
    violations.push({
      code: 'UNKNOWN_SOURCE_STATE',
      message: `Source state "${from}" is not a valid worker lifecycle state.`,
    });
  }

  if (!sm.states[to]) {
    violations.push({
      code: 'UNKNOWN_TARGET_STATE',
      message: `Target state "${to}" is not a valid worker lifecycle state.`,
    });
  }

  // If either state is unknown, we can't check the transition
  if (violations.length > 0) {
    return { violations, warnings };
  }

  // Find the matching transition
  const transition = sm.transitions.find(t => t.from === from && t.to === to);

  if (!transition) {
    const validTargets = sm.transitions
      .filter(t => t.from === from)
      .map(t => t.to);

    violations.push({
      code: 'INVALID_TRANSITION',
      message: `Transition from "${from}" to "${to}" is not allowed.`,
      validTargets: validTargets.length > 0 ? validTargets : ['(terminal state — no outgoing transitions)'],
    });
    return { violations, warnings };
  }

  // Check if reason is required
  if (transition.requiresReason && (!reason || reason.trim().length === 0)) {
    violations.push({
      code: 'REASON_REQUIRED',
      message: `Transition from "${from}" to "${to}" requires a reason.`,
    });
  }

  // Warn if transitioning to a terminal state without reason (even if not required)
  if (sm.states[to].terminal && (!reason || reason.trim().length === 0)) {
    warnings.push({
      code: 'TERMINAL_WITHOUT_REASON',
      message: `Transitioning to terminal state "${to}" without a reason. Consider providing one for audit.`,
    });
  }

  return { violations, warnings };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    reason: null,
    stdin: false,
    out: DEFAULT_OUT,
    stdout: false,
    listTransitions: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--from') {
      i++;
      if (i >= argv.length) { console.error('Error: --from requires a state'); process.exit(2); }
      args.from = argv[i];
    } else if (arg === '--to') {
      i++;
      if (i >= argv.length) { console.error('Error: --to requires a state'); process.exit(2); }
      args.to = argv[i];
    } else if (arg === '--reason') {
      i++;
      if (i >= argv.length) { console.error('Error: --reason requires a string'); process.exit(2); }
      args.reason = argv[i];
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--list-transitions') {
      args.listTransitions = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Result Builder ───────────────────────────────────────────────────────────

function buildResult(from, to, reason, decision, severity, violations, warnings) {
  return {
    schemaVersion: SCHEMA_VERSION,
    checkType: 'worker-lifecycle-transition',
    decision,
    severity,
    from,
    to,
    reason: reason || null,
    capturedAt: new Date().toISOString(),
    violations,
    warnings,
  };
}

// ── List Transitions ─────────────────────────────────────────────────────────

function listTransitions(sm) {
  console.log('Valid worker lifecycle transitions:');
  console.log('');

  const byFrom = {};
  for (const t of sm.transitions) {
    if (!byFrom[t.from]) byFrom[t.from] = [];
    byFrom[t.from].push(t);
  }

  for (const [state, transitions] of Object.entries(byFrom)) {
    const isTerminal = sm.states[state]?.terminal ? ' (terminal)' : '';
    console.log(`  ${state}${isTerminal}:`);
    for (const t of transitions) {
      const reqReason = t.requiresReason ? ' [reason required]' : '';
      console.log(`    -> ${t.to}  (${t.trigger})${reqReason}`);
    }
    console.log('');
  }

  // Show terminal states with no outgoing transitions
  for (const [state, info] of Object.entries(sm.states)) {
    if (info.terminal && !byFrom[state]) {
      console.log(`  ${state} (terminal):`);
      console.log(`    (no outgoing transitions)`);
      console.log('');
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const sm = loadStateMachine();

  if (args.listTransitions) {
    listTransitions(sm);
    process.exit(0);
  }

  // Load transition input
  let from = args.from;
  let to = args.to;
  let reason = args.reason;

  if (args.stdin) {
    const raw = readStdin();
    if (!raw) {
      console.error('Error: No input from stdin.');
      process.exit(2);
    }
    try {
      const input = JSON.parse(raw);
      from = from || input.from;
      to = to || input.to;
      reason = reason || input.reason;
    } catch (err) {
      console.error(`Error: Failed to parse stdin JSON: ${err.message}`);
      process.exit(2);
    }
  }

  if (!from || !to) {
    console.error('Error: --from and --to are required (or use --stdin with from/to fields).');
    process.exit(2);
  }

  // Validate
  const { violations, warnings } = validateTransition(sm, from, to, reason);
  const decision = violations.length > 0 ? DECISIONS.INVALID : DECISIONS.VALID;
  const severity = violations.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'info');

  // Build output
  const result = buildResult(from, to, reason, decision, severity, violations, warnings);
  const json = JSON.stringify(result, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Transition validation result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  // Exit code: 0 for valid, 1 for invalid
  process.exit(decision === DECISIONS.INVALID ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  loadStateMachine,
  validateTransition,
  buildResult,
};
