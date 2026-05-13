#!/usr/bin/env node

/**
 * validate-worker-transition.test.js
 *
 * Self-tests for the worker lifecycle transition validator.
 * Covers: valid transitions, invalid transitions, reason requirements,
 * terminal states, and unknown states.
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

const path = require('path');
const { loadStateMachine, validateTransition, buildResult } = require('./validate-worker-transition.js');

// ── Test Harness ─────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function assertEq(actual, expected, name) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  assert(match, name + (match ? '' : ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`));
}

// ── Load State Machine ───────────────────────────────────────────────────────

const sm = loadStateMachine();

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('validate-worker-transition.test.js');
console.log('===================================');
console.log('');

// 1. Valid transitions
console.log('Valid transitions:');

{
  const r = validateTransition(sm, 'planned', 'running');
  assert(r.violations.length === 0, 'planned -> running is valid');
}

{
  const r = validateTransition(sm, 'running', 'completed');
  assert(r.violations.length === 0, 'running -> completed is valid');
}

{
  const r = validateTransition(sm, 'running', 'failed', 'exit code 1');
  assert(r.violations.length === 0, 'running -> failed with reason is valid');
}

{
  const r = validateTransition(sm, 'running', 'stale');
  assert(r.violations.length === 0, 'running -> stale is valid');
}

{
  const r = validateTransition(sm, 'running', 'blocked', 'waiting for API key');
  assert(r.violations.length === 0, 'running -> blocked with reason is valid');
}

{
  const r = validateTransition(sm, 'running', 'needs-human', 'ambiguous requirement');
  assert(r.violations.length === 0, 'running -> needs-human with reason is valid');
}

{
  const r = validateTransition(sm, 'stale', 'running');
  assert(r.violations.length === 0, 'stale -> running is valid (resumed output)');
}

{
  const r = validateTransition(sm, 'stale', 'failed', 'process died');
  assert(r.violations.length === 0, 'stale -> failed with reason is valid');
}

{
  const r = validateTransition(sm, 'blocked', 'running');
  assert(r.violations.length === 0, 'blocked -> running is valid (blocker resolved)');
}

{
  const r = validateTransition(sm, 'blocked', 'failed', 'abandoned');
  assert(r.violations.length === 0, 'blocked -> failed with reason is valid');
}

{
  const r = validateTransition(sm, 'needs-human', 'running');
  assert(r.violations.length === 0, 'needs-human -> running is valid (human resolved)');
}

{
  const r = validateTransition(sm, 'needs-human', 'failed', 'abandoned');
  assert(r.violations.length === 0, 'needs-human -> failed with reason is valid');
}

{
  const r = validateTransition(sm, 'stale', 'blocked', 'identified blocker');
  assert(r.violations.length === 0, 'stale -> blocked with reason is valid');
}

// 2. Invalid transitions
console.log('Invalid transitions:');

{
  const r = validateTransition(sm, 'completed', 'running');
  assert(r.violations.length === 1, 'completed -> running is invalid (terminal state)');
  assertEq(r.violations[0].code, 'INVALID_TRANSITION', 'completed -> running violation code');
}

{
  const r = validateTransition(sm, 'failed', 'running');
  assert(r.violations.length === 1, 'failed -> running is invalid (terminal state)');
}

{
  const r = validateTransition(sm, 'completed', 'failed');
  assert(r.violations.length === 1, 'completed -> failed is invalid (terminal -> terminal)');
}

{
  const r = validateTransition(sm, 'planned', 'completed');
  assert(r.violations.length === 1, 'planned -> completed is invalid (must go through running)');
}

{
  const r = validateTransition(sm, 'planned', 'failed');
  assert(r.violations.length === 1, 'planned -> failed is invalid');
}

{
  const r = validateTransition(sm, 'planned', 'stale');
  assert(r.violations.length === 1, 'planned -> stale is invalid');
}

{
  const r = validateTransition(sm, 'blocked', 'completed');
  assert(r.violations.length === 1, 'blocked -> completed is invalid');
}

{
  const r = validateTransition(sm, 'needs-human', 'completed');
  assert(r.violations.length === 1, 'needs-human -> completed is invalid');
}

// 3. Reason requirements
console.log('Reason requirements:');

{
  const r = validateTransition(sm, 'running', 'failed');
  assert(r.violations.length === 1, 'running -> failed without reason is rejected');
  assertEq(r.violations[0].code, 'REASON_REQUIRED', 'running -> failed reason required');
}

{
  const r = validateTransition(sm, 'running', 'failed', 'exit code 1');
  assert(r.violations.length === 0, 'running -> failed with reason passes');
}

{
  const r = validateTransition(sm, 'running', 'blocked');
  assert(r.violations.length === 1, 'running -> blocked without reason is rejected');
}

{
  const r = validateTransition(sm, 'running', 'needs-human');
  assert(r.violations.length === 1, 'running -> needs-human without reason is rejected');
}

{
  const r = validateTransition(sm, 'stale', 'failed');
  assert(r.violations.length === 1, 'stale -> failed without reason is rejected');
}

// 4. Unknown states
console.log('Unknown states:');

{
  const r = validateTransition(sm, 'invalid-state', 'running');
  assert(r.violations.length === 1, 'unknown source state is rejected');
  assertEq(r.violations[0].code, 'UNKNOWN_SOURCE_STATE', 'unknown source violation code');
}

{
  const r = validateTransition(sm, 'running', 'invalid-state');
  assert(r.violations.length === 1, 'unknown target state is rejected');
  assertEq(r.violations[0].code, 'UNKNOWN_TARGET_STATE', 'unknown target violation code');
}

// 5. Terminal state warnings
console.log('Terminal state warnings:');

{
  const r = validateTransition(sm, 'running', 'completed');
  assert(r.violations.length === 0, 'running -> completed is valid');
  assert(r.warnings.length === 1, 'running -> completed without reason produces warning');
  assertEq(r.warnings[0].code, 'TERMINAL_WITHOUT_REASON', 'terminal warning code');
}

{
  const r = validateTransition(sm, 'running', 'completed', 'success');
  assert(r.warnings.length === 0, 'running -> completed with reason has no warning');
}

// 6. State machine completeness
console.log('State machine completeness:');

{
  const stateNames = Object.keys(sm.states);
  assertEq(stateNames.length, 7, 'state machine has 7 states');
  assert(stateNames.includes('planned'), 'has planned state');
  assert(stateNames.includes('running'), 'has running state');
  assert(stateNames.includes('completed'), 'has completed state');
  assert(stateNames.includes('failed'), 'has failed state');
  assert(stateNames.includes('stale'), 'has stale state');
  assert(stateNames.includes('blocked'), 'has blocked state');
  assert(stateNames.includes('needs-human'), 'has needs-human state');
}

{
  const terminalStates = Object.entries(sm.states)
    .filter(([, v]) => v.terminal)
    .map(([k]) => k);
  assertEq(terminalStates.length, 2, 'has 2 terminal states');
  assert(terminalStates.includes('completed'), 'completed is terminal');
  assert(terminalStates.includes('failed'), 'failed is terminal');
}

{
  // Every non-terminal state should have at least one outgoing transition
  const nonTerminal = Object.entries(sm.states)
    .filter(([, v]) => !v.terminal)
    .map(([k]) => k);
  for (const state of nonTerminal) {
    const outgoing = sm.transitions.filter(t => t.from === state);
    assert(outgoing.length > 0, `non-terminal state "${state}" has outgoing transitions`);
  }
}

// 7. buildResult
console.log('Result builder:');

{
  const r = buildResult('running', 'completed', null, 'valid', 'info', [], []);
  assertEq(r.schemaVersion, 1, 'result schema version');
  assertEq(r.checkType, 'worker-lifecycle-transition', 'result check type');
  assertEq(r.from, 'running', 'result from');
  assertEq(r.to, 'completed', 'result to');
  assertEq(r.decision, 'valid', 'result decision');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  console.log('');
  console.log('Failures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}

process.exit(failCount > 0 ? 1 : 0);
