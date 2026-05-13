#!/usr/bin/env node

/**
 * validate-worker-transition.js
 *
 * Validates worker status transitions against the explicit lifecycle
 * state machine defined in docs/ai-native/worker-lifecycle-state-machine.md.
 *
 * Reads active-workers.json (current state) and a transition event
 * (from/to pair), then checks whether the transition is legal.
 *
 * Usage:
 *   node scripts/ai/validate-worker-transition.js --help
 *   node scripts/ai/validate-worker-transition.js --from running --to completed
 *   node scripts/ai/validate-worker-transition.js --file .github/ai-state/active-workers.json --transition '{"conflictGroup":"auth-core","from":"running","to":"completed"}'
 *   node scripts/ai/validate-worker-transition.js --self-test
 *
 * Exit codes:
 *   0 — Transition is valid
 *   1 — Transition is invalid
 *   2 — Invalid arguments / usage error
 *
 * Closes: #1363
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_STATUSES = [
  'planned',
  'running',
  'completed',
  'failed',
  'stale',
  'blocked',
  'needs-human',
  'cancelled',
];

const TERMINAL_STATUSES = ['completed', 'cancelled'];

/**
 * Explicit transition table.
 * Key: source status. Value: array of { to, guard } objects.
 * Guard is a human-readable description of the condition required.
 */
const TRANSITIONS = {
  planned: [
    { to: 'running', guard: 'Launch gate passes, PID assigned' },
    { to: 'blocked', guard: 'Launch gate blocks (conflict or health)' },
    { to: 'cancelled', guard: 'Explicit cancel command' },
  ],
  blocked: [
    { to: 'planned', guard: 'Conflict cleared, re-queued' },
    { to: 'cancelled', guard: 'Explicit cancel command' },
  ],
  running: [
    { to: 'completed', guard: 'Exit code 0, result file written' },
    { to: 'failed', guard: 'Exit code non-zero or timeout' },
    { to: 'needs-human', guard: 'Human gate boundary triggered' },
    { to: 'stale', guard: 'Heartbeat timeout exceeded' },
  ],
  'needs-human': [
    { to: 'running', guard: 'Human input recorded in fact event' },
    { to: 'cancelled', guard: 'Explicit cancel after human review' },
  ],
  stale: [
    { to: 'failed', guard: 'Confirmed failure after grace period' },
    { to: 'cancelled', guard: 'Explicit cancel after stale timeout' },
  ],
  failed: [
    { to: 'planned', guard: 'Explicit retry approval (human gate)' },
  ],
};

// ── Validation ───────────────────────────────────────────────────────────────

function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Check whether a transition from `fromStatus` to `toStatus` is valid.
 * Returns { valid, guard?, reason? }
 */
function validateTransition(fromStatus, toStatus) {
  if (!isValidStatus(fromStatus)) {
    return { valid: false, reason: `Unknown source status: "${fromStatus}"` };
  }

  if (!isValidStatus(toStatus)) {
    return { valid: false, reason: `Unknown target status: "${toStatus}"` };
  }

  if (fromStatus === toStatus) {
    return { valid: false, reason: `Self-transition not allowed: "${fromStatus}"` };
  }

  if (isTerminal(fromStatus)) {
    return { valid: false, reason: `Cannot transition from terminal status "${fromStatus}"` };
  }

  const allowed = TRANSITIONS[fromStatus];
  if (!allowed) {
    return { valid: false, reason: `No transitions defined from "${fromStatus}"` };
  }

  const match = allowed.find(t => t.to === toStatus);
  if (!match) {
    const allowedTargets = allowed.map(t => t.to).join(', ');
    return {
      valid: false,
      reason: `Invalid transition: "${fromStatus}" → "${toStatus}". Allowed targets: ${allowedTargets}`,
    };
  }

  return { valid: true, guard: match.guard };
}

/**
 * Validate a transition event object.
 * Expected shape: { conflictGroup, from, to }
 */
function validateTransitionEvent(event, index) {
  const errors = [];

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { valid: false, errors: [`Event ${index}: must be a JSON object`] };
  }

  if (!event.conflictGroup || typeof event.conflictGroup !== 'string') {
    errors.push(`Event ${index}: missing or invalid "conflictGroup"`);
  }

  if (!event.from || typeof event.from !== 'string') {
    errors.push(`Event ${index}: missing or invalid "from" status`);
  }

  if (!event.to || typeof event.to !== 'string') {
    errors.push(`Event ${index}: missing or invalid "to" status`);
  }

  if (event.from && event.to && errors.length === 0) {
    const result = validateTransition(event.from, event.to);
    if (!result.valid) {
      errors.push(`Event ${index}: ${result.reason}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a batch of transition events.
 */
function validateTransitions(events) {
  const results = events.map((e, i) => validateTransitionEvent(e, i));
  const allErrors = results.flatMap(r => r.errors);
  const allValid = results.every(r => r.valid);
  return { valid: allValid, total: events.length, errors: allErrors };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${label}`);
    }
  }

  console.log('validate-worker-transition.js — self-test');
  console.log('='.repeat(45));

  // Valid transitions
  assert(validateTransition('planned', 'running').valid === true, 'planned → running');
  assert(validateTransition('planned', 'blocked').valid === true, 'planned → blocked');
  assert(validateTransition('planned', 'cancelled').valid === true, 'planned → cancelled');
  assert(validateTransition('blocked', 'planned').valid === true, 'blocked → planned');
  assert(validateTransition('blocked', 'cancelled').valid === true, 'blocked → cancelled');
  assert(validateTransition('running', 'completed').valid === true, 'running → completed');
  assert(validateTransition('running', 'failed').valid === true, 'running → failed');
  assert(validateTransition('running', 'needs-human').valid === true, 'running → needs-human');
  assert(validateTransition('running', 'stale').valid === true, 'running → stale');
  assert(validateTransition('needs-human', 'running').valid === true, 'needs-human → running');
  assert(validateTransition('needs-human', 'cancelled').valid === true, 'needs-human → cancelled');
  assert(validateTransition('stale', 'failed').valid === true, 'stale → failed');
  assert(validateTransition('stale', 'cancelled').valid === true, 'stale → cancelled');
  assert(validateTransition('failed', 'planned').valid === true, 'failed → planned (retry)');

  // Invalid transitions
  assert(validateTransition('completed', 'running').valid === false, 'completed → running blocked');
  assert(validateTransition('cancelled', 'planned').valid === false, 'cancelled → planned blocked');
  assert(validateTransition('planned', 'completed').valid === false, 'planned → completed blocked');
  assert(validateTransition('running', 'planned').valid === false, 'running → planned blocked');
  assert(validateTransition('blocked', 'running').valid === false, 'blocked → running blocked');
  assert(validateTransition('completed', 'failed').valid === false, 'completed → failed blocked');
  assert(validateTransition('failed', 'running').valid === false, 'failed → running blocked');

  // Self-transition blocked
  assert(validateTransition('running', 'running').valid === false, 'self-transition blocked');
  assert(validateTransition('planned', 'planned').valid === false, 'self-transition blocked (planned)');

  // Unknown status
  assert(validateTransition('unknown', 'running').valid === false, 'unknown source status');
  assert(validateTransition('running', 'unknown').valid === false, 'unknown target status');

  // Terminal status cannot transition
  assert(validateTransition('completed', 'planned').valid === false, 'terminal cannot leave');
  assert(validateTransition('cancelled', 'running').valid === false, 'terminal cannot leave');

  // Event validation
  const validEvent = validateTransitionEvent({
    conflictGroup: 'auth-core',
    from: 'running',
    to: 'completed',
  }, 0);
  assert(validEvent.valid === true, 'valid event passes');

  const missingGroup = validateTransitionEvent({ from: 'running', to: 'completed' }, 1);
  assert(missingGroup.valid === false, 'missing conflictGroup fails');

  const invalidTransition = validateTransitionEvent({
    conflictGroup: 'auth-core',
    from: 'completed',
    to: 'running',
  }, 2);
  assert(invalidTransition.valid === false, 'invalid transition in event fails');

  // Batch validation
  const batch = validateTransitions([
    { conflictGroup: 'auth-core', from: 'running', to: 'completed' },
    { conflictGroup: 'messages', from: 'running', to: 'failed' },
  ]);
  assert(batch.valid === true, 'valid batch passes');
  assert(batch.total === 2, 'batch total is 2');

  const mixedBatch = validateTransitions([
    { conflictGroup: 'auth-core', from: 'running', to: 'completed' },
    { conflictGroup: 'messages', from: 'completed', to: 'running' },
  ]);
  assert(mixedBatch.valid === false, 'mixed batch with invalid transition fails');

  // Guards are returned
  const withGuard = validateTransition('needs-human', 'running');
  assert(withGuard.guard !== undefined, 'guard description returned');
  assert(withGuard.guard.includes('Human input'), 'guard mentions human input');

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
validate-worker-transition.js — Worker lifecycle state machine validator

USAGE
    node scripts/ai/validate-worker-transition.js [OPTIONS]

OPTIONS
    --from <status>       Source status for a single transition check
    --to <status>         Target status for a single transition check
    --file <path>         Path to active-workers.json (for context)
    --transition <json>   Validate a single transition event JSON
    --transitions <json>  Validate a JSON array of transition events
    --self-test           Run built-in validation tests
    --help, -h            Show this help message

VALID STATUSES
    ${VALID_STATUSES.join(', ')}

TERMINAL STATUSES (no outgoing transitions)
    ${TERMINAL_STATUSES.join(', ')}

EXIT CODES
    0   Transition is valid
    1   Transition is invalid
    2   Invalid arguments / usage error

EXAMPLES
    # Check a single transition
    node scripts/ai/validate-worker-transition.js --from running --to completed

    # Validate a transition event
    node scripts/ai/validate-worker-transition.js --transition '{"conflictGroup":"auth-core","from":"running","to":"completed"}'

    # Run self-test
    node scripts/ai/validate-worker-transition.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    file: null,
    transition: null,
    transitions: null,
    selfTest: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--from') {
      i++;
      if (i >= argv.length) { console.error('Error: --from requires a status argument'); process.exit(2); }
      args.from = argv[i];
    } else if (arg === '--to') {
      i++;
      if (i >= argv.length) { console.error('Error: --to requires a status argument'); process.exit(2); }
      args.to = argv[i];
    } else if (arg === '--file') {
      i++;
      if (i >= argv.length) { console.error('Error: --file requires a path argument'); process.exit(2); }
      args.file = argv[i];
    } else if (arg === '--transition') {
      i++;
      if (i >= argv.length) { console.error('Error: --transition requires a JSON string'); process.exit(2); }
      args.transition = argv[i];
    } else if (arg === '--transitions') {
      i++;
      if (i >= argv.length) { console.error('Error: --transitions requires a JSON string'); process.exit(2); }
      args.transitions = argv[i];
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  // Single from/to check
  if (args.from && args.to) {
    const result = validateTransition(args.from, args.to);
    console.log(JSON.stringify({
      valid: result.valid,
      from: args.from,
      to: args.to,
      guard: result.guard || null,
      reason: result.reason || null,
    }, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  // Single transition event
  if (args.transition) {
    let event;
    try {
      event = JSON.parse(args.transition);
    } catch {
      console.error('Error: --transition value is not valid JSON');
      process.exit(2);
    }
    const result = validateTransitionEvent(event, 0);
    console.log(JSON.stringify({
      valid: result.valid,
      errors: result.errors,
    }, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  // Batch transition events
  if (args.transitions) {
    let events;
    try {
      events = JSON.parse(args.transitions);
      if (!Array.isArray(events)) {
        console.error('Error: --transitions must be a JSON array');
        process.exit(2);
      }
    } catch {
      console.error('Error: --transitions value is not valid JSON');
      process.exit(2);
    }
    const result = validateTransitions(events);
    console.log(JSON.stringify({
      valid: result.valid,
      total: result.total,
      errors: result.errors,
    }, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  // No input provided
  console.error('Error: provide --from/--to, --transition, --transitions, or --self-test');
  console.error('Run with --help for usage information');
  process.exit(2);
}

main();
