#!/usr/bin/env node

/**
 * check-self-cycle-safety-gate.test.js
 *
 * Self-tests for the self-cycle safety gate checker.
 * Covers: main health blocking, risk blocking, allowlist enforcement,
 * human approval blocking, and clean plan pass-through.
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pattern from
 * check-worker-behavior-policy.test.js.
 *
 * Usage:
 *   node scripts/ai/check-self-cycle-safety-gate.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

// ── Pure function mirrors (gate evaluation logic) ────────────────────────────

const VALID_HEALTH_STATES = ['green', 'yellow', 'red', 'black'];
const BLOCKED_HEALTH_STATES = ['red', 'black'];
const HIGH_RISK_LEVELS = ['high', 'critical'];
const SIDE_EFFECT_ACTIONS = ['merge', 'close', 'launch', 'execute'];

function evaluateMainHealth(plan, action) {
  const blockers = [];
  const warnings = [];

  const mainHealth = plan.mainHealth;
  if (!mainHealth || !VALID_HEALTH_STATES.includes(mainHealth)) {
    blockers.push({
      code: 'INVALID_HEALTH_STATE',
      message: `mainHealth "${mainHealth || ''}" is not a valid state. Must be one of: ${VALID_HEALTH_STATES.join(', ')}.`,
    });
    return { blockers, warnings };
  }

  const isSideEffect = SIDE_EFFECT_ACTIONS.includes(action.actionType);
  if (isSideEffect && BLOCKED_HEALTH_STATES.includes(mainHealth)) {
    blockers.push({
      code: 'MAIN_UNHEALTHY',
      message: `Action "${action.actionType}" on issue #${action.targetIssue} blocked: main is ${mainHealth}. Only recovery actions permitted.`,
    });
  }

  if (mainHealth === 'yellow' && isSideEffect) {
    warnings.push({
      code: 'MAIN_YELLOW',
      message: `Action "${action.actionType}" on issue #${action.targetIssue} proceeds with caution: main is yellow.`,
    });
  }

  return { blockers, warnings };
}

function evaluateRisk(action) {
  const blockers = [];
  const warnings = [];

  const risk = action.risk;
  if (risk && HIGH_RISK_LEVELS.includes(risk)) {
    blockers.push({
      code: 'HIGH_RISK_ACTION',
      message: `Action on issue #${action.targetIssue} has risk "${risk}" — requires human approval before execution.`,
    });
  }

  if (risk === 'medium') {
    warnings.push({
      code: 'MEDIUM_RISK',
      message: `Action on issue #${action.targetIssue} has medium risk. Review recommended.`,
    });
  }

  return { blockers, warnings };
}

function evaluateAllowlist(action) {
  const blockers = [];
  const warnings = [];

  const allowedFiles = action.allowedFiles;
  if (!Array.isArray(allowedFiles) || allowedFiles.length === 0) {
    blockers.push({
      code: 'NO_ALLOWLIST',
      message: `Action on issue #${action.targetIssue} has no explicit allowedFiles. All actions must declare a bounded file scope.`,
    });
  }

  return { blockers, warnings };
}

function evaluateHumanGate(action) {
  const blockers = [];
  const warnings = [];

  if (action.requiresHumanApproval) {
    blockers.push({
      code: 'HUMAN_APPROVAL_REQUIRED',
      message: `Action on issue #${action.targetIssue} requires human approval. Autopilot cannot proceed.`,
    });
  }

  return { blockers, warnings };
}

function aggregateDecision(results) {
  const allBlockers = [];
  const allWarnings = [];

  for (const result of results) {
    allBlockers.push(...result.blockers);
    allWarnings.push(...result.warnings);
  }

  const decision = allBlockers.length > 0 ? 'blocked' : 'pass';
  const severity = allBlockers.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'info');

  return { decision, severity, blockers: allBlockers, warnings: allWarnings };
}

function buildResult(plan, actionResults) {
  const allBlockers = [];
  const allWarnings = [];
  const actionReports = [];

  for (const { action, decision, severity, blockers, warnings } of actionResults) {
    allBlockers.push(...blockers);
    allWarnings.push(...warnings);
    actionReports.push({
      actionType: action.actionType,
      targetIssue: action.targetIssue || null,
      conflictGroup: action.conflictGroup || null,
      risk: action.risk || 'low',
      decision,
      severity,
      blockers,
      warnings,
    });
  }

  const overallDecision = allBlockers.length > 0 ? 'blocked' : 'pass';
  const overallSeverity = allBlockers.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'info');

  return {
    schemaVersion: 1,
    checkType: 'self-cycle-safety-gate',
    decision: overallDecision,
    severity: overallSeverity,
    mainHealth: plan.mainHealth || null,
    actionCount: actionResults.length,
    capturedAt: new Date().toISOString(),
    actions: actionReports,
    blockers: allBlockers,
    warnings: allWarnings,
  };
}

function checkPlan(plan) {
  const actions = plan.actions || [];
  const actionResults = [];

  for (const action of actions) {
    const healthResult = evaluateMainHealth(plan, action);
    const riskResult = evaluateRisk(action);
    const allowlistResult = evaluateAllowlist(action);
    const humanResult = evaluateHumanGate(action);

    const allResults = [healthResult, riskResult, allowlistResult, humanResult];
    const { decision, severity, blockers, warnings } = aggregateDecision(allResults);

    actionResults.push({ action, decision, severity, blockers, warnings });
  }

  return buildResult(plan, actionResults);
}

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

console.log('check-self-cycle-safety-gate.test.js');
console.log('='.repeat(50));

// ── Suite 1: Clean plan passes ───────────────────────────────────────────────

suite('clean plan passes');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 601,
        risk: 'low',
        allowedFiles: ['docs/ai-native/**'],
        requiresHumanApproval: false,
        conflictGroup: 'autopilot-docs',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.checkType, 'self-cycle-safety-gate', 'checkType is self-cycle-safety-gate');
  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(result.mainHealth, 'green', 'mainHealth is green');
  assertEq(result.actionCount, 1, 'actionCount is 1');
  assertEq(result.blockers.length, 0, 'no blockers');
  assertEq(result.warnings.length, 0, 'no warnings');
  assertEq(result.actions[0].decision, 'pass', 'action decision is pass');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(result.capturedAt.includes('T'), 'capturedAt is ISO-8601');
}

// ── Suite 2: Block merge when main is red ────────────────────────────────────

suite('block merge when main is red');

{
  const plan = {
    mainHealth: 'red',
    actions: [
      {
        actionType: 'merge',
        targetIssue: 700,
        risk: 'low',
        allowedFiles: ['src/foo.ts'],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assertEq(result.severity, 'error', 'severity is error');
  assert(result.blockers.some(b => b.code === 'MAIN_UNHEALTHY'), 'has MAIN_UNHEALTHY blocker');
  assert(result.blockers.some(b => b.message.includes('red')), 'blocker mentions red');
}

// ── Suite 3: Block launch when main is black ─────────────────────────────────

suite('block launch when main is black');

{
  const plan = {
    mainHealth: 'black',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 701,
        risk: 'low',
        allowedFiles: ['src/bar.ts'],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'MAIN_UNHEALTHY'), 'has MAIN_UNHEALTHY blocker');
  assert(result.blockers.some(b => b.message.includes('black')), 'blocker mentions black');
}

// ── Suite 4: Block close when main is red ────────────────────────────────────

suite('block close when main is red');

{
  const plan = {
    mainHealth: 'red',
    actions: [
      {
        actionType: 'close',
        targetIssue: 702,
        risk: 'low',
        allowedFiles: ['docs/readme.md'],
        requiresHumanApproval: false,
        conflictGroup: 'docs-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'MAIN_UNHEALTHY'), 'has MAIN_UNHEALTHY blocker');
}

// ── Suite 5: Allow preview when main is red ──────────────────────────────────

suite('allow preview when main is red');

{
  const plan = {
    mainHealth: 'red',
    actions: [
      {
        actionType: 'preview',
        targetIssue: 703,
        risk: 'low',
        allowedFiles: ['src/foo.ts'],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.blockers.length, 0, 'no blockers for preview on red main');
}

// ── Suite 6: Allow read when main is black ───────────────────────────────────

suite('allow read when main is black');

{
  const plan = {
    mainHealth: 'black',
    actions: [
      {
        actionType: 'read',
        targetIssue: 704,
        risk: 'low',
        allowedFiles: ['docs/**'],
        requiresHumanApproval: false,
        conflictGroup: 'docs-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.blockers.length, 0, 'no blockers for read on black main');
}

// ── Suite 7: Block high-risk action ──────────────────────────────────────────

suite('block high-risk action');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 705,
        risk: 'high',
        allowedFiles: ['src/auth/**'],
        requiresHumanApproval: false,
        conflictGroup: 'auth-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'HIGH_RISK_ACTION'), 'has HIGH_RISK_ACTION blocker');
  assert(result.blockers.some(b => b.message.includes('high')), 'blocker mentions high risk');
}

// ── Suite 8: Block critical-risk action ──────────────────────────────────────

suite('block critical-risk action');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'merge',
        targetIssue: 706,
        risk: 'critical',
        allowedFiles: ['src/core/**'],
        requiresHumanApproval: false,
        conflictGroup: 'core-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'HIGH_RISK_ACTION'), 'has HIGH_RISK_ACTION blocker');
  assert(result.blockers.some(b => b.message.includes('critical')), 'blocker mentions critical risk');
}

// ── Suite 9: Warn on medium-risk action ──────────────────────────────────────

suite('warn on medium-risk action');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 707,
        risk: 'medium',
        allowedFiles: ['src/modules/feed/**'],
        requiresHumanApproval: false,
        conflictGroup: 'feed-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'pass', 'decision is pass (warning, not blocked)');
  assertEq(result.severity, 'warning', 'severity is warning');
  assert(result.warnings.some(w => w.code === 'MEDIUM_RISK'), 'has MEDIUM_RISK warning');
  assertEq(result.blockers.length, 0, 'no blockers for medium risk');
}

// ── Suite 10: Block action with no allowedFiles ─────────────────────────────

suite('block action with no allowedFiles');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 708,
        risk: 'low',
        allowedFiles: [],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'NO_ALLOWLIST'), 'has NO_ALLOWLIST blocker');
}

// ── Suite 11: Block action with missing allowedFiles field ───────────────────

suite('block action with missing allowedFiles field');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 709,
        risk: 'low',
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'NO_ALLOWLIST'), 'has NO_ALLOWLIST blocker');
}

// ── Suite 12: Block action requiring human approval ──────────────────────────

suite('block action requiring human approval');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'execute',
        targetIssue: 710,
        risk: 'low',
        allowedFiles: ['src/foo.ts'],
        requiresHumanApproval: true,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'HUMAN_APPROVAL_REQUIRED'), 'has HUMAN_APPROVAL_REQUIRED blocker');
}

// ── Suite 13: Multiple blockers accumulate ───────────────────────────────────

suite('multiple blockers accumulate');

{
  const plan = {
    mainHealth: 'red',
    actions: [
      {
        actionType: 'merge',
        targetIssue: 711,
        risk: 'high',
        allowedFiles: [],
        requiresHumanApproval: true,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.length >= 4, 'multiple blockers accumulated');
  assert(result.blockers.some(b => b.code === 'MAIN_UNHEALTHY'), 'has MAIN_UNHEALTHY');
  assert(result.blockers.some(b => b.code === 'HIGH_RISK_ACTION'), 'has HIGH_RISK_ACTION');
  assert(result.blockers.some(b => b.code === 'NO_ALLOWLIST'), 'has NO_ALLOWLIST');
  assert(result.blockers.some(b => b.code === 'HUMAN_APPROVAL_REQUIRED'), 'has HUMAN_APPROVAL_REQUIRED');
}

// ── Suite 14: Yellow main produces warnings for side-effect actions ──────────

suite('yellow main produces warnings for side-effect actions');

{
  const plan = {
    mainHealth: 'yellow',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 712,
        risk: 'low',
        allowedFiles: ['docs/**'],
        requiresHumanApproval: false,
        conflictGroup: 'docs-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'pass', 'decision is pass (yellow is not blocked)');
  assertEq(result.severity, 'warning', 'severity is warning');
  assert(result.warnings.some(w => w.code === 'MAIN_YELLOW'), 'has MAIN_YELLOW warning');
  assertEq(result.blockers.length, 0, 'no blockers for yellow main');
}

// ── Suite 15: Invalid health state ───────────────────────────────────────────

suite('invalid health state');

{
  const plan = {
    mainHealth: 'purple',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 713,
        risk: 'low',
        allowedFiles: ['src/foo.ts'],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'INVALID_HEALTH_STATE'), 'has INVALID_HEALTH_STATE blocker');
}

// ── Suite 16: Empty actions array passes ─────────────────────────────────────

suite('empty actions array passes');

{
  const plan = {
    mainHealth: 'green',
    actions: [],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.actionCount, 0, 'actionCount is 0');
  assertEq(result.blockers.length, 0, 'no blockers');
}

// ── Suite 17: Multiple actions — mixed pass and block ────────────────────────

suite('multiple actions — mixed pass and block');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'preview',
        targetIssue: 714,
        risk: 'low',
        allowedFiles: ['docs/**'],
        requiresHumanApproval: false,
        conflictGroup: 'docs-group',
      },
      {
        actionType: 'launch',
        targetIssue: 715,
        risk: 'high',
        allowedFiles: ['src/auth/**'],
        requiresHumanApproval: false,
        conflictGroup: 'auth-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'overall decision is blocked');
  assertEq(result.actionCount, 2, 'actionCount is 2');
  assertEq(result.actions[0].decision, 'pass', 'first action passes');
  assertEq(result.actions[1].decision, 'blocked', 'second action blocked');
  assert(result.actions[1].blockers.some(b => b.code === 'HIGH_RISK_ACTION'), 'second action has HIGH_RISK_ACTION');
}

// ── Suite 18: Result shape completeness ──────────────────────────────────────

suite('result shape completeness');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 716,
        risk: 'low',
        allowedFiles: ['src/foo.ts'],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(typeof result.schemaVersion, 'number', 'schemaVersion is number');
  assertEq(typeof result.checkType, 'string', 'checkType is string');
  assertEq(typeof result.decision, 'string', 'decision is string');
  assertEq(typeof result.severity, 'string', 'severity is string');
  assertEq(typeof result.mainHealth, 'string', 'mainHealth is string');
  assertEq(typeof result.actionCount, 'number', 'actionCount is number');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(Array.isArray(result.actions), 'actions is array');
  assert(Array.isArray(result.blockers), 'blockers is array');
  assert(Array.isArray(result.warnings), 'warnings is array');
}

// ── Suite 19: No mutation fields in result ───────────────────────────────────

suite('no mutation fields in result');

{
  const plan = {
    mainHealth: 'green',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 717,
        risk: 'low',
        allowedFiles: ['src/foo.ts'],
        requiresHumanApproval: false,
        conflictGroup: 'test-group',
      },
    ],
  };

  const result = checkPlan(plan);

  assert(!('mergeState' in result), 'no mergeState field');
  assert(!('action' in result), 'no action field');
  assert(!('command' in result), 'no command field');
  assertEq(result.checkType, 'self-cycle-safety-gate', 'checkType is checker only');
}

// ── Suite 20: Launch gate blocked on red main matches autopilot-plan fixture ─

suite('autopilot plan fixture — red main blocks launch candidates');

{
  const plan = {
    mainHealth: 'red',
    actions: [
      {
        actionType: 'launch',
        targetIssue: 601,
        risk: 'low',
        allowedFiles: ['docs/ai-native/**'],
        requiresHumanApproval: false,
        conflictGroup: 'autopilot-docs',
      },
      {
        actionType: 'launch',
        targetIssue: 602,
        risk: 'medium',
        allowedFiles: ['scripts/ai/plan-next-batch.ps1'],
        requiresHumanApproval: false,
        conflictGroup: 'autopilot-scoring',
      },
    ],
  };

  const result = checkPlan(plan);

  assertEq(result.decision, 'blocked', 'decision is blocked');
  assert(result.blockers.some(b => b.code === 'MAIN_UNHEALTHY'), 'has MAIN_UNHEALTHY blocker');
  assertEq(result.actions[0].decision, 'blocked', 'first candidate blocked');
  assertEq(result.actions[1].decision, 'blocked', 'second candidate blocked');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
