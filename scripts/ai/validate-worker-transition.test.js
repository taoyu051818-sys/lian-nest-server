#!/usr/bin/env node

/**
 * validate-worker-transition.test.js
 *
 * Self-tests for the worker lifecycle transition validator.
 * Covers: all valid transitions, all invalid transitions, terminal states,
 * recoverable states, boundary cases, and result shape.
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pattern from
 * check-worker-behavior-policy.test.js.
 *
 * Usage:
 *   node scripts/ai/validate-worker-transition.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

// ── Import validator ─────────────────────────────────────────────────────────

const { validateTransition, TRANSITIONS, VALID_STATUSES } = require('./validate-worker-transition.js');

// ── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`    ✓ ${label}`);
  } else {
    failed++;
    console.error(`    ✗ ${label}`);
  }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`    ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  assert(ok, label);
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('validate-worker-transition.test.js');
console.log('='.repeat(50));

// ── Suite 1: Valid transitions from null ─────────────────────────────────────

suite('valid transitions from null');

{
  const r1 = validateTransition('null', 'planned', 'launch');
  assertEq(r1.valid, true, 'null → planned is valid');
  assertEq(r1.from, 'null', 'from is null');
  assertEq(r1.to, 'planned', 'to is planned');
  assertEq(r1.trigger, 'launch', 'trigger preserved');

  const r2 = validateTransition('null', 'running', 'execute');
  assertEq(r2.valid, true, 'null → running is valid');
}

// ── Suite 2: Valid transitions from planned ──────────────────────────────────

suite('valid transitions from planned');

{
  const r1 = validateTransition('planned', 'running', 'execute');
  assertEq(r1.valid, true, 'planned → running is valid');

  const r2 = validateTransition('planned', 'failed', 'exit-failure');
  assertEq(r2.valid, true, 'planned → failed is valid (launch failure)');
}

// ── Suite 3: Valid transitions from running ──────────────────────────────────

suite('valid transitions from running');

{
  const r1 = validateTransition('running', 'completed', 'exit-success');
  assertEq(r1.valid, true, 'running → completed is valid');

  const r2 = validateTransition('running', 'failed', 'exit-failure');
  assertEq(r2.valid, true, 'running → failed is valid');

  const r3 = validateTransition('running', 'stale', 'stale-timeout');
  assertEq(r3.valid, true, 'running → stale is valid');

  const r4 = validateTransition('running', 'blocked', 'block');
  assertEq(r4.valid, true, 'running → blocked is valid');

  const r5 = validateTransition('running', 'needs-human', 'human-flag');
  assertEq(r5.valid, true, 'running → needs-human is valid');
}

// ── Suite 4: Terminal states have no outbound transitions ────────────────────

suite('terminal states: no outbound transitions');

{
  const terminalStates = ['completed', 'failed', 'stale'];
  const allTargets = ['planned', 'running', 'completed', 'failed', 'stale', 'blocked', 'needs-human'];

  for (const from of terminalStates) {
    for (const to of allTargets) {
      const r = validateTransition(from, to);
      assertEq(r.valid, false, `${from} → ${to} is invalid (terminal state)`);
    }
    const r = validateTransition(from, 'running');
    assertEq(r.allowedTargets.length, 0, `${from} has empty allowedTargets`);
  }
}

// ── Suite 5: Recoverable states can transition to running/failed ─────────────

suite('recoverable states: blocked and needs-human');

{
  const r1 = validateTransition('blocked', 'running', 'relaunch');
  assertEq(r1.valid, true, 'blocked → running is valid');

  const r2 = validateTransition('blocked', 'failed', 'exit-failure');
  assertEq(r2.valid, true, 'blocked → failed is valid');

  const r3 = validateTransition('needs-human', 'running', 'manual-override');
  assertEq(r3.valid, true, 'needs-human → running is valid');

  const r4 = validateTransition('needs-human', 'failed', 'exit-failure');
  assertEq(r4.valid, true, 'needs-human → failed is valid');
}

// ── Suite 6: Recoverable states cannot jump to terminal states directly ──────

suite('recoverable states: cannot jump to other terminal states');

{
  const r1 = validateTransition('blocked', 'completed');
  assertEq(r1.valid, false, 'blocked → completed is invalid');

  const r2 = validateTransition('blocked', 'stale');
  assertEq(r2.valid, false, 'blocked → stale is invalid');

  const r3 = validateTransition('needs-human', 'completed');
  assertEq(r3.valid, false, 'needs-human → completed is invalid');

  const r4 = validateTransition('needs-human', 'stale');
  assertEq(r4.valid, false, 'needs-human → stale is invalid');
}

// ── Suite 7: Running cannot go back to planned or null ───────────────────────

suite('running: cannot regress to planned');

{
  const r1 = validateTransition('running', 'planned');
  assertEq(r1.valid, false, 'running → planned is invalid (no regression)');
}

// ── Suite 8: Invalid from-status ─────────────────────────────────────────────

suite('invalid from-status');

{
  const r = validateTransition('unknown-status', 'running');
  assertEq(r.valid, false, 'invalid from-status is rejected');
  assert(r.reason.includes('Invalid from-status'), 'reason mentions invalid from-status');
}

// ── Suite 9: Invalid to-status ───────────────────────────────────────────────

suite('invalid to-status');

{
  const r = validateTransition('running', 'unknown-target');
  assertEq(r.valid, false, 'invalid to-status is rejected');
  assert(r.reason.includes('Invalid to-status'), 'reason mentions invalid to-status');
}

// ── Suite 10: Self-transitions are invalid ───────────────────────────────────

suite('self-transitions are invalid');

{
  const states = ['planned', 'running', 'completed', 'failed', 'stale', 'blocked', 'needs-human'];
  for (const s of states) {
    const r = validateTransition(s, s);
    assertEq(r.valid, false, `${s} → ${s} is invalid (self-transition)`);
  }
}

// ── Suite 11: Trigger field is optional ──────────────────────────────────────

suite('trigger field is optional');

{
  const r = validateTransition('running', 'completed', null);
  assertEq(r.valid, true, 'transition valid without trigger');
  assertEq(r.trigger, null, 'trigger is null');
}

// ── Suite 12: Result shape completeness ──────────────────────────────────────

suite('result shape completeness');

{
  const r = validateTransition('running', 'completed', 'exit-success');

  assertEq(typeof r.valid, 'boolean', 'valid is boolean');
  assertEq(typeof r.from, 'string', 'from is string');
  assertEq(typeof r.to, 'string', 'to is string');
  assertEq(typeof r.reason, 'string', 'reason is string');
  assert(Array.isArray(r.allowedTargets), 'allowedTargets is array');
  assert(typeof r.capturedAt === 'string', 'capturedAt is string');
  assert(r.capturedAt.includes('T'), 'capturedAt is ISO-8601');
}

// ── Suite 13: All valid statuses are in the transition table ─────────────────

suite('all valid statuses are in the transition table');

{
  for (const status of VALID_STATUSES) {
    assert(status in TRANSITIONS, `"${status}" has an entry in TRANSITIONS`);
  }
}

// ── Suite 14: Reason message for invalid transitions ─────────────────────────

suite('reason message for invalid transitions');

{
  const r = validateTransition('completed', 'running');
  assertEq(r.valid, false, 'completed → running is invalid');
  assert(r.reason.includes('terminal state'), 'reason mentions terminal state');
  assert(r.reason.includes('completed'), 'reason mentions from-status');
  assert(r.reason.includes('running'), 'reason mentions to-status');
}

// ── Suite 15: Consistency with wait-parallel-workers.ps1 implicit transitions ─

suite('consistency with wait-parallel-workers.ps1');

{
  // wait-parallel-workers.ps1 skips terminal states (line 77)
  // and transitions running → completed/failed/stale
  const r1 = validateTransition('running', 'completed');
  assertEq(r1.valid, true, 'running → completed matches ps1 behavior');

  const r2 = validateTransition('running', 'failed');
  assertEq(r2.valid, true, 'running → failed matches ps1 behavior');

  const r3 = validateTransition('running', 'stale');
  assertEq(r3.valid, true, 'running → stale matches ps1 behavior');

  // ps1: planned → failed when no process found (line 135-139)
  const r4 = validateTransition('planned', 'failed');
  assertEq(r4.valid, true, 'planned → failed matches ps1 behavior');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
