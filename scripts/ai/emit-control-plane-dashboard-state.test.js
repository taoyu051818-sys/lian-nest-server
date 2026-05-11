#!/usr/bin/env node

/**
 * emit-control-plane-dashboard-state.test.js
 *
 * Tests for emit-control-plane-dashboard-state.js.
 * Covers: dry-run shape, live write, missing inputs produce safe defaults,
 * all input sections, CLI error handling, help flag, built-in self-test.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-control-plane-dashboard-state.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [EMITTER, ...args], {
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

function parseSnapshot(stdout) {
  // Strip DRY RUN banner if present — find first '{'
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `emit-dash-${name}-${Date.now()}.json`);
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

// ── Dry-run tests ────────────────────────────────────────────────────────────

test('dry-run: default mode prints DRY RUN banner', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('DRY RUN'), 'should include DRY RUN banner');
  assert.ok(stdout.includes('dashboard-state.json'), 'should mention output path');
});

test('dry-run: output is valid JSON after banner', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  const snapshot = parseSnapshot(stdout);
  assert.strictEqual(snapshot.schemaVersion, 2);
  assert.ok(typeof snapshot.capturedAt === 'string');
});

test('dry-run: does not create output file', () => {
  const outPath = tmpFile('dry-run-no-create');
  try {
    const { exitCode } = run(['--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(!fs.existsSync(outPath), 'dry-run should not create file');
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

test('dry-run: all input sections present with correct shapes', () => {
  const { stdout } = run([]);
  const snapshot = parseSnapshot(stdout);
  // Verify top-level keys exist
  const keys = ['schemaVersion', 'capturedAt', 'health', 'providerPool',
    'resources', 'activeWorkers', 'workerTrust', 'metaSignals', 'queue',
    'actionReadiness', 'auditSummary', 'inputSources'];
  for (const key of keys) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
  // health: null or object with state
  if (snapshot.health !== null) {
    assert.ok(typeof snapshot.health.state === 'string');
  }
  // providerPool: null or object with numeric fields
  if (snapshot.providerPool !== null) {
    assert.ok(typeof snapshot.providerPool.availableProviders === 'number');
    assert.ok(typeof snapshot.providerPool.totalActiveWorkers === 'number');
  }
  // resources: null or object with counts
  if (snapshot.resources !== null) {
    assert.ok(typeof snapshot.resources.totalFiles === 'number');
  }
  // activeWorkers always has count
  assert.ok(typeof snapshot.activeWorkers.count === 'number');
  // workerTrust: null or object
  if (snapshot.workerTrust !== null) {
    assert.ok(typeof snapshot.workerTrust.minTrustToLaunch === 'number');
  }
  // metaSignals: null or object
  if (snapshot.metaSignals !== null) {
    assert.ok(typeof snapshot.metaSignals.failureScore === 'number');
  }
  // queue always has entryCount
  assert.ok(typeof snapshot.queue.entryCount === 'number');
  // queue.summary: null or object
  if (snapshot.queue.summary !== null) {
    assert.ok(typeof snapshot.queue.summary.queued === 'number');
  }
  // actionReadiness: always has actions array and counts
  assert.ok(Array.isArray(snapshot.actionReadiness.actions), 'actionReadiness.actions is array');
  assert.strictEqual(snapshot.actionReadiness.actions.length, 4, 'actionReadiness has 4 actions');
  assert.ok(typeof snapshot.actionReadiness.readyCount === 'number', 'readyCount is number');
  assert.ok(typeof snapshot.actionReadiness.totalActions === 'number', 'totalActions is number');
  assert.ok(typeof snapshot.actionReadiness.allReady === 'boolean', 'allReady is boolean');
  for (const action of snapshot.actionReadiness.actions) {
    assert.ok(typeof action.id === 'string', 'action.id is string');
    assert.ok(typeof action.ready === 'boolean', 'action.ready is boolean');
    assert.ok(Array.isArray(action.blockedReasons), 'action.blockedReasons is array');
  }
  // auditSummary: always has totalEntries and byState
  assert.ok(typeof snapshot.auditSummary.totalEntries === 'number', 'totalEntries is number');
  assert.ok(typeof snapshot.auditSummary.byState === 'object', 'byState is object');
  assert.ok(Array.isArray(snapshot.auditSummary.blockedReasons), 'auditSummary.blockedReasons is array');
  // inputSources: all boolean
  for (const key of Object.keys(snapshot.inputSources)) {
    assert.strictEqual(typeof snapshot.inputSources[key], 'boolean', `${key} should be boolean`);
  }
});

// ── Live write tests ─────────────────────────────────────────────────────────

test('live: writes file with --live flag', () => {
  const outPath = tmpFile('live-write');
  try {
    const { stdout, exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Dashboard state written to'), 'should print written message');
    assert.ok(fs.existsSync(outPath), 'file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 2);
    assert.ok(typeof written.capturedAt === 'string');
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

test('live: overwrites existing file', () => {
  const outPath = tmpFile('live-overwrite');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    const { exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 2);
    assert.strictEqual(written.old, undefined);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── --stdout flag ────────────────────────────────────────────────────────────

test('stdout: prints JSON to stdout without banner', () => {
  const { stdout, exitCode } = run(['--stdout']);
  assert.strictEqual(exitCode, 0);
  assert.ok(!stdout.includes('DRY RUN'), 'stdout mode should not have banner');
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.schemaVersion, 2);
});

test('stdout: combined with --live still prints JSON to stdout', () => {
  const outPath = tmpFile('stdout-live');
  try {
    const { stdout, exitCode } = run(['--stdout', '--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.schemaVersion, 2);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── Output structure ─────────────────────────────────────────────────────────

test('output: has all required top-level keys', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'schemaVersion', 'capturedAt', 'health', 'providerPool',
    'resources', 'activeWorkers', 'workerTrust', 'metaSignals',
    'queue', 'actionReadiness', 'auditSummary', 'inputSources',
  ];
  for (const key of expected) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
});

test('output: schemaVersion is 2', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.schemaVersion, 2);
});

test('output: capturedAt is ISO-8601', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const parsed = new Date(snapshot.capturedAt);
  assert.ok(!isNaN(parsed.getTime()), 'capturedAt should be valid ISO-8601');
});

test('output: queue has entryCount and summary fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(typeof snapshot.queue.entryCount === 'number');
  if (snapshot.queue.summary !== null) {
    for (const key of ['queued', 'launching', 'running', 'prCreated', 'blocked', 'done']) {
      assert.ok(typeof snapshot.queue.summary[key] === 'number', `queue.summary.${key} should be a number`);
    }
  }
});

test('output: inputSources has all 7 flags', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'healthLoaded', 'providerPoolLoaded', 'resourcesLoaded',
    'activeWorkersLoaded', 'workerTrustLoaded', 'metaSignalsLoaded', 'queueLoaded',
  ];
  for (const key of expected) {
    assert.ok(typeof snapshot.inputSources[key] === 'boolean', `inputSources.${key} should be boolean`);
  }
});

test('output: activeWorkers has count', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(typeof snapshot.activeWorkers.count === 'number');
});

// ── Action readiness ─────────────────────────────────────────────────────────

test('actionReadiness: has 4 actions with ids', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const ids = snapshot.actionReadiness.actions.map(a => a.id);
  assert.deepStrictEqual(ids, ['launch-worker', 'merge-pr', 'retry-failed', 'drain-queue']);
});

test('actionReadiness: each action has ready boolean and blockedReasons array', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const action of snapshot.actionReadiness.actions) {
    assert.strictEqual(typeof action.ready, 'boolean', `${action.id}.ready should be boolean`);
    assert.ok(Array.isArray(action.blockedReasons), `${action.id}.blockedReasons should be array`);
  }
});

test('actionReadiness: readyCount + totalActions consistent', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const { actions, readyCount, totalActions } = snapshot.actionReadiness;
  assert.strictEqual(totalActions, 4);
  assert.strictEqual(readyCount, actions.filter(a => a.ready).length);
});

test('actionReadiness: allReady matches readyCount', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const { readyCount, totalActions, allReady } = snapshot.actionReadiness;
  assert.strictEqual(allReady, readyCount === totalActions);
});

// ── Audit summary ────────────────────────────────────────────────────────────

test('auditSummary: has required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(typeof snapshot.auditSummary.totalEntries === 'number');
  assert.ok(typeof snapshot.auditSummary.byState === 'object');
  assert.ok(Array.isArray(snapshot.auditSummary.blockedReasons));
});

test('auditSummary: byState has all expected keys', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expectedStates = ['queued', 'launching', 'running', 'prCreated', 'blocked', 'done'];
  for (const key of expectedStates) {
    assert.ok(typeof snapshot.auditSummary.byState[key] === 'number', `byState.${key} should be number`);
  }
});

test('auditSummary: lastActivityAt is null or valid ISO string', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  if (snapshot.auditSummary.lastActivityAt !== null) {
    const parsed = new Date(snapshot.auditSummary.lastActivityAt);
    assert.ok(!isNaN(parsed.getTime()), 'lastActivityAt should be valid ISO-8601');
  }
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

test('cli: --help exits 0 and prints usage', () => {
  const { stdout, exitCode } = run(['--help']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
  assert.ok(stdout.includes('--live'));
  assert.ok(stdout.includes('--stdout'));
});

test('cli: -h exits 0', () => {
  const { stdout, exitCode } = run(['-h']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
});

// ── Built-in self-test ───────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `emit-dash-nested-${Date.now()}`, 'sub', 'out.json');
  try {
    const { exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(fs.existsSync(outPath));
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 2);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    const parent = path.dirname(outPath);
    if (fs.existsSync(parent)) fs.rmdirSync(parent, { recursive: true });
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  emit-control-plane-dashboard-state.test.js`);
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
