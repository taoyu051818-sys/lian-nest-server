#!/usr/bin/env node

/**
 * validate-worker-transition.js
 *
 * Validates whether a worker status transition is allowed by the
 * explicit state machine defined in schemas/worker-lifecycle-transitions.json.
 *
 * Inspired by LangGraph DAG model for auditable, deterministic state changes.
 *
 * Usage:
 *   node scripts/ai/validate-worker-transition.js --from <state> --to <state>
 *   node scripts/ai/validate-worker-transition.js --self-test
 *   node scripts/ai/validate-worker-transition.js --help
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.resolve(__dirname, '..', '..', 'schemas');
const TRANSITIONS_FILE = path.join(SCHEMA_DIR, 'worker-lifecycle-transitions.json');

const VALID_STATES = ['planned', 'running', 'completed', 'failed', 'stale', 'blocked', 'needs-human'];
const TERMINAL_STATES = ['completed', 'failed'];

function loadTransitions() {
  const raw = fs.readFileSync(TRANSITIONS_FILE, 'utf8');
  return JSON.parse(raw);
}

function isValidTransition(from, to, transitions) {
  return transitions.some(t => t.from === from && t.to === to);
}

function getTransitionDetails(from, to, transitions) {
  return transitions.find(t => t.from === from && t.to === to) || null;
}

function parseArgs(argv) {
  const args = { from: null, to: null, selfTest: false, help: false, stdout: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--self-test') { args.selfTest = true; }
    else if (arg === '--stdout') { args.stdout = true; }
    else if (arg === '--from') { i++; args.from = argv[i]; }
    else if (arg === '--to') { i++; args.to = argv[i]; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

function printHelp() {
  console.log('validate-worker-transition.js — Validate worker lifecycle state transitions');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/ai/validate-worker-transition.js --from <state> --to <state>');
  console.log('  node scripts/ai/validate-worker-transition.js --self-test');
  console.log('  node scripts/ai/validate-worker-transition.js --help');
  console.log('');
  console.log('States:', VALID_STATES.join(', '));
  console.log('Terminal states:', TERMINAL_STATES.join(', '));
  console.log('');
  console.log('Exit codes:');
  console.log('  0 — Valid transition');
  console.log('  1 — Invalid transition');
  console.log('  2 — Invalid arguments');
}

function runSelfTest() {
  const data = loadTransitions();
  let passed = 0;
  let failed = 0;

  function assert(cond, label) {
    if (cond) { passed++; }
    else { failed++; console.error(`  FAIL: ${label}`); }
  }

  console.log('Self-test: validate-worker-transition.js');

  // Valid transitions
  assert(isValidTransition('planned', 'running', data.transitions), 'planned->running is valid');
  assert(isValidTransition('planned', 'blocked', data.transitions), 'planned->blocked is valid');
  assert(isValidTransition('planned', 'failed', data.transitions), 'planned->failed is valid');
  assert(isValidTransition('running', 'completed', data.transitions), 'running->completed is valid');
  assert(isValidTransition('running', 'failed', data.transitions), 'running->failed is valid');
  assert(isValidTransition('running', 'stale', data.transitions), 'running->stale is valid');
  assert(isValidTransition('running', 'blocked', data.transitions), 'running->blocked is valid');
  assert(isValidTransition('running', 'needs-human', data.transitions), 'running->needs-human is valid');
  assert(isValidTransition('stale', 'running', data.transitions), 'stale->running is valid');
  assert(isValidTransition('stale', 'failed', data.transitions), 'stale->failed is valid');
  assert(isValidTransition('stale', 'completed', data.transitions), 'stale->completed is valid');
  assert(isValidTransition('blocked', 'running', data.transitions), 'blocked->running is valid');
  assert(isValidTransition('blocked', 'failed', data.transitions), 'blocked->failed is valid');
  assert(isValidTransition('needs-human', 'running', data.transitions), 'needs-human->running is valid');
  assert(isValidTransition('needs-human', 'failed', data.transitions), 'needs-human->failed is valid');

  // Invalid transitions
  assert(!isValidTransition('completed', 'running', data.transitions), 'completed->running is invalid');
  assert(!isValidTransition('completed', 'failed', data.transitions), 'completed->failed is invalid');
  assert(!isValidTransition('failed', 'running', data.transitions), 'failed->running is invalid');
  assert(!isValidTransition('failed', 'completed', data.transitions), 'failed->completed is invalid');
  assert(!isValidTransition('planned', 'completed', data.transitions), 'planned->completed is invalid');
  assert(!isValidTransition('planned', 'stale', data.transitions), 'planned->stale is invalid');
  assert(!isValidTransition('blocked', 'stale', data.transitions), 'blocked->stale is invalid');
  assert(!isValidTransition('stale', 'blocked', data.transitions), 'stale->blocked is invalid');
  assert(!isValidTransition('needs-human', 'stale', data.transitions), 'needs-human->stale is invalid');
  assert(!isValidTransition('needs-human', 'completed', data.transitions), 'needs-human->completed is invalid');

  // Transition details
  const t = getTransitionDetails('running', 'completed', data.transitions);
  assert(t !== null, 'getTransitionDetails returns result');
  assert(t.trigger === 'Worker exits with code 0', 'trigger matches');
  assert(t.actor === 'wait-parallel-workers', 'actor matches');
  assert(t.auditRequired === true, 'auditRequired is true');

  // Terminal states
  assert(data.terminalStates.includes('completed'), 'completed is terminal');
  assert(data.terminalStates.includes('failed'), 'failed is terminal');
  assert(!data.terminalStates.includes('running'), 'running is not terminal');

  console.log(`Self-test: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    const ok = runSelfTest();
    process.exit(ok ? 0 : 1);
  }

  if (!args.from || !args.to) {
    console.error('Both --from and --to are required.');
    console.error('Usage: node scripts/ai/validate-worker-transition.js --from <state> --to <state>');
    process.exit(2);
  }

  if (!VALID_STATES.includes(args.from)) {
    console.error(`Invalid --from state: ${args.from}`);
    console.error('Valid states:', VALID_STATES.join(', '));
    process.exit(2);
  }

  if (!VALID_STATES.includes(args.to)) {
    console.error(`Invalid --to state: ${args.to}`);
    console.error('Valid states:', VALID_STATES.join(', '));
    process.exit(2);
  }

  const data = loadTransitions();
  const valid = isValidTransition(args.from, args.to, data.transitions);

  if (valid) {
    const details = getTransitionDetails(args.from, args.to, data.transitions);
    if (args.stdout) {
      console.log(JSON.stringify({
        valid: true,
        from: args.from,
        to: args.to,
        trigger: details.trigger,
        guard: details.guard,
        actor: details.actor,
        auditRequired: details.auditRequired,
      }, null, 2));
    } else {
      console.log(`VALID: ${args.from} -> ${args.to}`);
      console.log(`  Trigger: ${details.trigger}`);
      console.log(`  Guard: ${details.guard}`);
      console.log(`  Actor: ${details.actor}`);
      console.log(`  Audit required: ${details.auditRequired}`);
    }
    process.exit(0);
  } else {
    if (args.stdout) {
      console.log(JSON.stringify({
        valid: false,
        from: args.from,
        to: args.to,
        reason: 'Transition not allowed by state machine',
      }, null, 2));
    } else {
      console.error(`INVALID: ${args.from} -> ${args.to}`);
      console.error('This transition is not allowed by the worker lifecycle state machine.');
      if (TERMINAL_STATES.includes(args.from)) {
        console.error(`State "${args.from}" is terminal — no transitions allowed.`);
      }
    }
    process.exit(1);
  }
}

module.exports = { isValidTransition, getTransitionDetails, loadTransitions, VALID_STATES, TERMINAL_STATES };

if (require.main === module) {
  main();
}
