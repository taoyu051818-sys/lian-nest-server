#!/usr/bin/env node

/**
 * generate-self-cycle-execute-plan.test.js
 *
 * Tests for generate-self-cycle-execute-plan.js.
 * Covers: health gate evaluation, provider pool evaluation, queue
 * evaluation, plan generation, CLI handling, fixture mode, sanitization.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'generate-self-cycle-execute-plan.js');

// Import module functions directly
const {
  evaluateHealthGate,
  evaluateProviderPool,
  evaluateQueue,
  generatePlan,
  SELF_CYCLE_ACTIONS,
} = require(SCRIPT);

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `self-cycle-plan-${name}-${Date.now()}.json`);
}

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
  }
}

// ── Health gate tests ────────────────────────────────────────────────────────

test('healthGate: null input → gate failed, state unknown', () => {
  const result = evaluateHealthGate(null);
  assert.strictEqual(result.gatePassed, false);
  assert.strictEqual(result.state, 'unknown');
});

test('healthGate: empty object → gate failed', () => {
  const result = evaluateHealthGate({});
  assert.strictEqual(result.gatePassed, false);
  assert.strictEqual(result.state, 'unknown');
});

test('healthGate: green → gate passed', () => {
  const result = evaluateHealthGate({ state: 'green' });
  assert.strictEqual(result.gatePassed, true);
  assert.strictEqual(result.state, 'green');
});

test('healthGate: yellow → gate passed', () => {
  const result = evaluateHealthGate({ state: 'yellow' });
  assert.strictEqual(result.gatePassed, true);
  assert.strictEqual(result.state, 'yellow');
});

test('healthGate: red → gate failed', () => {
  const result = evaluateHealthGate({ state: 'red', failedChecks: ['tsc'] });
  assert.strictEqual(result.gatePassed, false);
  assert.strictEqual(result.state, 'red');
  assert.ok(result.reason.includes('red'));
});

test('healthGate: black → gate failed, critical', () => {
  const result = evaluateHealthGate({ state: 'black' });
  assert.strictEqual(result.gatePassed, false);
  assert.strictEqual(result.state, 'black');
});

test('healthGate: unknown state → gate failed', () => {
  const result = evaluateHealthGate({ state: 'purple' });
  assert.strictEqual(result.gatePassed, false);
  assert.ok(result.reason.includes('purple'));
});

test('healthGate: green includes allowedWorkerClasses', () => {
  const result = evaluateHealthGate({ state: 'green', allowedWorkerClasses: ['all'] });
  assert.deepStrictEqual(result.allowedWorkerClasses, ['all']);
});

test('healthGate: red includes failedChecks', () => {
  const result = evaluateHealthGate({ state: 'red', failedChecks: ['tsc', 'lint'] });
  assert.deepStrictEqual(result.failedChecks, ['tsc', 'lint']);
});

// ── Provider pool tests ─────────────────────────────────────────────────────

test('providerPool: null → not ready', () => {
  const result = evaluateProviderPool(null);
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.available, 0);
  assert.strictEqual(result.total, 0);
});

test('providerPool: empty providers → not ready', () => {
  const result = evaluateProviderPool({ providers: [] });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.total, 0);
});

test('providerPool: one available → ready', () => {
  const result = evaluateProviderPool({
    providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }],
  });
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.available, 1);
  assert.strictEqual(result.total, 1);
});

test('providerPool: all exhausted → not ready', () => {
  const result = evaluateProviderPool({
    providers: [
      { id: 'p1', status: 'exhausted' },
      { id: 'p2', status: 'exhausted' },
    ],
  });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.exhausted, 2);
});

test('providerPool: at capacity → not ready', () => {
  const result = evaluateProviderPool({
    providers: [{ id: 'p1', status: 'available', currentConcurrency: 1, maxConcurrency: 1 }],
  });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.atCapacity, 1);
});

test('providerPool: mixed states', () => {
  const result = evaluateProviderPool({
    providers: [
      { id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 },
      { id: 'p2', status: 'exhausted' },
      { id: 'p3', status: 'disabled' },
      { id: 'p4', status: 'available', currentConcurrency: 2, maxConcurrency: 2 },
    ],
  });
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.available, 1);
  assert.strictEqual(result.exhausted, 1);
  assert.strictEqual(result.disabled, 1);
  assert.strictEqual(result.atCapacity, 1);
  assert.strictEqual(result.total, 4);
});

// ── Queue tests ─────────────────────────────────────────────────────────────

test('queue: null → no work', () => {
  const result = evaluateQueue(null);
  assert.strictEqual(result.hasWork, false);
  assert.strictEqual(result.queued, 0);
  assert.strictEqual(result.total, 0);
});

test('queue: empty entries → no work', () => {
  const result = evaluateQueue({ entries: [] });
  assert.strictEqual(result.hasWork, false);
  assert.strictEqual(result.queued, 0);
});

test('queue: with queued entries → has work', () => {
  const result = evaluateQueue({
    entries: [
      { issueNumber: 100, state: 'queued' },
      { issueNumber: 101, state: 'processed' },
      { issueNumber: 102, state: 'queued' },
    ],
  });
  assert.strictEqual(result.hasWork, true);
  assert.strictEqual(result.queued, 2);
  assert.strictEqual(result.total, 3);
});

test('queue: all processed → no work', () => {
  const result = evaluateQueue({
    entries: [
      { issueNumber: 100, state: 'processed' },
      { issueNumber: 101, state: 'processed' },
    ],
  });
  assert.strictEqual(result.hasWork, false);
  assert.strictEqual(result.queued, 0);
  assert.strictEqual(result.total, 2);
});

test('queue: entries are sanitized', () => {
  const result = evaluateQueue({
    entries: [
      { issueNumber: 100, state: 'queued', token: 'secret123' },
    ],
  });
  const json = JSON.stringify(result);
  assert.ok(!json.includes('secret123'), 'should not contain secret values');
});

// ── Plan generation tests ────────────────────────────────────────────────────

test('plan: all green → pipeline ready', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert.strictEqual(plan.schemaVersion, 1);
  assert.strictEqual(typeof plan.capturedAt, 'string');
  assert.strictEqual(plan.mode, 'plan-only');
  assert.strictEqual(plan.dryRun, true);
  assert.strictEqual(plan.pipelineReady, true);
  assert.strictEqual(plan.healthGate.gatePassed, true);
  assert.strictEqual(plan.providerPool.ready, true);
  assert.strictEqual(plan.queue.hasWork, true);
  assert.strictEqual(plan.blockers.length, 0);
  assert.strictEqual(plan.summary.pipelineReady, true);
});

test('plan: red health → pipeline blocked', () => {
  const plan = generatePlan({
    health: { state: 'red', failedChecks: ['tsc'] },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert.strictEqual(plan.pipelineReady, false);
  assert.strictEqual(plan.healthGate.gatePassed, false);
  assert.ok(plan.blockers.some(b => b.source === 'health-gate'));
  assert.strictEqual(plan.actionAllowlist.length, 0);
  assert.ok(plan.allowedActions.every(a => a.enabled === false));
});

test('plan: no providers → pipeline blocked', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'exhausted' }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert.strictEqual(plan.pipelineReady, false);
  assert.ok(plan.blockers.some(b => b.source === 'provider-pool'));
});

test('plan: empty queue → pipeline not ready', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [] },
  });
  assert.strictEqual(plan.pipelineReady, false);
  assert.ok(plan.blockers.some(b => b.source === 'queue'));
});

test('plan: all null → multiple blockers', () => {
  const plan = generatePlan({ health: null, providerPool: null, queue: null });
  assert.strictEqual(plan.pipelineReady, false);
  assert.ok(plan.blockers.length >= 2);
});

test('plan: contains all required keys', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  const requiredKeys = [
    'schemaVersion', 'capturedAt', 'mode', 'dryRun', 'pipelineReady',
    'healthGate', 'providerPool', 'queue', 'allowedActions',
    'actionAllowlist', 'blockers', 'summary',
  ];
  for (const key of requiredKeys) {
    assert.ok(key in plan, `key ${key} present`);
  }
});

test('plan: allowedActions matches SELF_CYCLE_ACTIONS count', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert.strictEqual(plan.allowedActions.length, SELF_CYCLE_ACTIONS.length);
});

test('plan: action allowlist items are strings', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert.ok(plan.actionAllowlist.every(a => typeof a === 'string'), 'allowlist items are strings');
});

test('plan: each action has required fields', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  for (const action of plan.allowedActions) {
    assert.strictEqual(typeof action.actionId, 'string', 'actionId is string');
    assert.strictEqual(typeof action.label, 'string', 'label is string');
    assert.strictEqual(typeof action.description, 'string', 'description is string');
    assert.strictEqual(typeof action.risk, 'string', 'risk is string');
    assert.strictEqual(typeof action.humanRequired, 'boolean', 'humanRequired is boolean');
    assert.strictEqual(typeof action.mutation, 'boolean', 'mutation is boolean');
    assert.ok(Array.isArray(action.allowlist), 'allowlist is array');
    assert.strictEqual(typeof action.enabled, 'boolean', 'enabled is boolean');
  }
});

test('plan: no secret-shaped keys in output', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  const json = JSON.stringify(plan);
  assert.ok(!json.includes('"token"'), 'no token key');
  assert.ok(!json.includes('"secret"'), 'no secret key');
  assert.ok(!json.includes('"apiKey"'), 'no apiKey key');
});

test('plan: summary has correct counts', () => {
  const plan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert.strictEqual(plan.summary.totalActions, SELF_CYCLE_ACTIONS.length);
  assert.strictEqual(plan.summary.enabledActions, SELF_CYCLE_ACTIONS.length);
  assert.strictEqual(plan.summary.disabledActions, 0);
  assert.strictEqual(plan.summary.healthGatePassed, true);
  assert.strictEqual(plan.summary.providersAvailable, 1);
  assert.strictEqual(plan.summary.queuedIssues, 1);
});

test('plan: all actions are low-risk and non-mutation', () => {
  for (const action of SELF_CYCLE_ACTIONS) {
    assert.strictEqual(action.risk, 'low', `${action.actionId} is low risk`);
    assert.strictEqual(action.mutation, false, `${action.actionId} is non-mutation`);
    assert.strictEqual(action.humanRequired, false, `${action.actionId} does not require human`);
  }
});

// ── CLI self-test flag ───────────────────────────────────────────────────────

test('cli: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── CLI help ─────────────────────────────────────────────────────────────────

test('cli: --help exits 0 with usage', () => {
  const { stdout, exitCode } = run(['--help']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
  assert.ok(stdout.includes('generate-self-cycle-execute-plan'));
});

test('cli: -h exits 0', () => {
  const { exitCode } = run(['-h']);
  assert.strictEqual(exitCode, 0);
});

// ── CLI error handling ───────────────────────────────────────────────────────

test('cli: unknown argument exits 2', () => {
  const { exitCode, stderr } = run(['--bogus']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('Unknown argument'));
});

test('cli: --out without value exits 2', () => {
  const { exitCode, stderr } = run(['--out']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--out requires a path'));
});

test('cli: --fixture without value exits 2', () => {
  const { exitCode, stderr } = run(['--fixture']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--fixture requires a path'));
});

// ── Fixture mode tests ───────────────────────────────────────────────────────

test('fixture: reads from fixture file', () => {
  const fixturePath = tmpFile('fixture');
  const fixture = {
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.pipelineReady, true);
    assert.strictEqual(output.healthGate.state, 'green');
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

test('fixture: red health fixture → blocked plan', () => {
  const fixturePath = tmpFile('red-fixture');
  const fixture = {
    health: { state: 'red', failedChecks: ['tsc'] },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.pipelineReady, false);
    assert.strictEqual(output.actionAllowlist.length, 0);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

test('fixture: bad fixture exits 2', () => {
  const fixturePath = tmpFile('bad');
  fs.writeFileSync(fixturePath, 'not json', 'utf8');
  try {
    const { exitCode } = run(['--fixture', fixturePath]);
    assert.strictEqual(exitCode, 2);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

test('fixture: missing fixture exits 2', () => {
  const { exitCode } = run(['--fixture', '/nonexistent/path.json']);
  assert.strictEqual(exitCode, 2);
});

// ── stdout output ────────────────────────────────────────────────────────────

test('fixture + stdout: prints valid JSON', () => {
  const fixturePath = tmpFile('stdout');
  const fixture = {
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.schemaVersion, 1);
    assert.strictEqual(output.mode, 'plan-only');
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: queue entries with null state are skipped', () => {
  const result = evaluateQueue({
    entries: [
      { issueNumber: 100, state: 'queued' },
      { issueNumber: 101, state: null },
      null,
    ],
  });
  assert.strictEqual(result.queued, 1);
});

test('edge: provider with missing concurrency fields', () => {
  const result = evaluateProviderPool({
    providers: [{ id: 'p1', status: 'available' }],
  });
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.available, 1);
});

test('edge: provider with unknown status', () => {
  const result = evaluateProviderPool({
    providers: [{ id: 'p1', status: 'unknown-state' }],
  });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.available, 0);
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  generate-self-cycle-execute-plan.test.js`);
console.log(`  ${passed}/${total} passed`);

if (failed > 0) {
  console.log(`\n  FAILURES:\n`);
  for (const f of failures) {
    console.log(`    ${f.name}`);
    console.log(`      ${f.message}\n`);
  }
  process.exit(1);
} else {
  console.log(`\n  All tests passed.\n`);
  process.exit(0);
}
