#!/usr/bin/env node

/**
 * validate-worker-transition.test.js
 *
 * Tests for validate-worker-transition.js.
 * Uses only built-in Node.js modules (no test framework).
 *
 * Usage:
 *   node scripts/ai/validate-worker-transition.test.js
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const VALIDATOR = path.resolve(__dirname, 'validate-worker-transition.js');

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

function assertIncludes(str, substr, label) {
  assert(typeof str === 'string' && str.includes(substr), label);
}

function runValidator(extraArgs, opts = {}) {
  const args = [VALIDATOR, ...extraArgs];
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      timeout: 10000,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

function testSelfTest() {
  console.log('Test: --self-test passes');
  const result = runValidator(['--self-test']);
  assert(result.exitCode === 0, 'self-test exits 0');
  assertIncludes(result.stdout, 'passed', 'self-test reports passed');
}

function testHelp() {
  console.log('Test: --help');
  const result = runValidator(['--help']);
  assert(result.exitCode === 0, '--help exits 0');
  assertIncludes(result.stdout, 'validate-worker-transition.js', 'help shows script name');
  assertIncludes(result.stdout, '--from', 'help shows --from flag');
  assertIncludes(result.stdout, '--to', 'help shows --to flag');
}

function testValidTransitionPlannedToRunning() {
  console.log('Test: valid planned->running');
  const result = runValidator(['--from', 'planned', '--to', 'running']);
  assert(result.exitCode === 0, 'exits 0');
  assertIncludes(result.stdout, 'VALID', 'reports VALID');
  assertIncludes(result.stdout, 'batch-launcher', 'shows actor');
}

function testValidTransitionRunningToCompleted() {
  console.log('Test: valid running->completed');
  const result = runValidator(['--from', 'running', '--to', 'completed']);
  assert(result.exitCode === 0, 'exits 0');
  assertIncludes(result.stdout, 'VALID', 'reports VALID');
  assertIncludes(result.stdout, 'Worker exits with code 0', 'shows trigger');
}

function testValidTransitionRunningToStale() {
  console.log('Test: valid running->stale');
  const result = runValidator(['--from', 'running', '--to', 'stale']);
  assert(result.exitCode === 0, 'exits 0');
  assertIncludes(result.stdout, 'heartbeat-monitor', 'shows actor');
}

function testValidTransitionStaleToRunning() {
  console.log('Test: valid stale->running');
  const result = runValidator(['--from', 'stale', '--to', 'running']);
  assert(result.exitCode === 0, 'exits 0');
  assertIncludes(result.stdout, 'VALID', 'reports VALID');
}

function testInvalidTransitionCompletedToRunning() {
  console.log('Test: invalid completed->running');
  const result = runValidator(['--from', 'completed', '--to', 'running']);
  assert(result.exitCode === 1, 'exits 1');
  assertIncludes(result.stderr, 'INVALID', 'reports INVALID');
  assertIncludes(result.stderr, 'terminal', 'mentions terminal state');
}

function testInvalidTransitionFailedToCompleted() {
  console.log('Test: invalid failed->completed');
  const result = runValidator(['--from', 'failed', '--to', 'completed']);
  assert(result.exitCode === 1, 'exits 1');
  assertIncludes(result.stderr, 'INVALID', 'reports INVALID');
}

function testInvalidTransitionPlannedToCompleted() {
  console.log('Test: invalid planned->completed');
  const result = runValidator(['--from', 'planned', '--to', 'completed']);
  assert(result.exitCode === 1, 'exits 1');
  assertIncludes(result.stderr, 'INVALID', 'reports INVALID');
}

function testInvalidTransitionBlockedToStale() {
  console.log('Test: invalid blocked->stale');
  const result = runValidator(['--from', 'blocked', '--to', 'stale']);
  assert(result.exitCode === 1, 'exits 1');
  assertIncludes(result.stderr, 'INVALID', 'reports INVALID');
}

function testInvalidStateFrom() {
  console.log('Test: invalid --from state');
  const result = runValidator(['--from', 'bogus', '--to', 'running']);
  assert(result.exitCode === 2, 'exits 2');
  assertIncludes(result.stderr, 'Invalid --from', 'error about invalid from');
}

function testInvalidStateTo() {
  console.log('Test: invalid --to state');
  const result = runValidator(['--from', 'running', '--to', 'bogus']);
  assert(result.exitCode === 2, 'exits 2');
  assertIncludes(result.stderr, 'Invalid --to', 'error about invalid to');
}

function testMissingArgs() {
  console.log('Test: missing --from and --to');
  const result = runValidator([]);
  assert(result.exitCode === 2, 'exits 2');
  assertIncludes(result.stderr, 'required', 'error about missing args');
}

function testStdoutJsonValid() {
  console.log('Test: --stdout JSON for valid transition');
  const result = runValidator(['--from', 'running', '--to', 'completed', '--stdout']);
  assert(result.exitCode === 0, 'exits 0');
  const data = JSON.parse(result.stdout);
  assert(data.valid === true, 'valid is true');
  assert(data.from === 'running', 'from is running');
  assert(data.to === 'completed', 'to is completed');
  assert(typeof data.trigger === 'string', 'trigger is string');
  assert(typeof data.guard === 'string', 'guard is string');
  assert(typeof data.actor === 'string', 'actor is string');
  assert(typeof data.auditRequired === 'boolean', 'auditRequired is boolean');
}

function testStdoutJsonInvalid() {
  console.log('Test: --stdout JSON for invalid transition');
  const result = runValidator(['--from', 'completed', '--to', 'running', '--stdout']);
  assert(result.exitCode === 1, 'exits 1');
  const data = JSON.parse(result.stdout);
  assert(data.valid === false, 'valid is false');
  assert(data.from === 'completed', 'from is completed');
  assert(data.to === 'running', 'to is running');
  assert(typeof data.reason === 'string', 'reason is string');
}

function testModuleExports() {
  console.log('Test: module exports');
  const mod = require(VALIDATOR);
  assert(typeof mod.isValidTransition === 'function', 'exports isValidTransition');
  assert(typeof mod.getTransitionDetails === 'function', 'exports getTransitionDetails');
  assert(typeof mod.loadTransitions === 'function', 'exports loadTransitions');
  assert(Array.isArray(mod.VALID_STATES), 'exports VALID_STATES');
  assert(Array.isArray(mod.TERMINAL_STATES), 'exports TERMINAL_STATES');
  assert(mod.VALID_STATES.length === 7, '7 valid states');
  assert(mod.TERMINAL_STATES.length === 2, '2 terminal states');
}

// ── Run all tests ────────────────────────────────────────────────────────────

console.log('validate-worker-transition.test.js');
console.log('='.repeat(50));
console.log();

testSelfTest();
testHelp();
testValidTransitionPlannedToRunning();
testValidTransitionRunningToCompleted();
testValidTransitionRunningToStale();
testValidTransitionStaleToRunning();
testInvalidTransitionCompletedToRunning();
testInvalidTransitionFailedToCompleted();
testInvalidTransitionPlannedToCompleted();
testInvalidTransitionBlockedToStale();
testInvalidStateFrom();
testInvalidStateTo();
testMissingArgs();
testStdoutJsonValid();
testStdoutJsonInvalid();
testModuleExports();

console.log();
console.log('='.repeat(50));
console.log(`Total: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
