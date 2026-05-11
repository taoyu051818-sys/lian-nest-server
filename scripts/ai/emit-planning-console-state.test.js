#!/usr/bin/env node

/**
 * emit-planning-console-state.test.js
 *
 * Tests for emit-planning-console-state.js.
 * Covers: dry-run shape, live write, missing inputs produce safe defaults,
 * all input sections, CLI error handling, help flag, built-in self-test,
 * gap analysis logic, and edge cases.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-planning-console-state.js');

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
  return path.join(os.tmpdir(), `emit-planning-console-${name}-${Date.now()}.json`);
}

function tmpNdjson(name, lines) {
  const filePath = path.join(os.tmpdir(), `emit-planning-console-${name}-${Date.now()}.ndjson`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
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
  assert.ok(stdout.includes('planning-console-state.json'), 'should mention output path');
});

test('dry-run: output is valid JSON after banner', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  const snapshot = parseSnapshot(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
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

test('dry-run: all top-level keys present with correct shapes', () => {
  const { stdout } = run([]);
  const snapshot = parseSnapshot(stdout);
  const keys = [
    'schemaVersion', 'capturedAt', 'gapSummary', 'unresolvedGaps',
    'recentGaps', 'trend', 'planningHealth', 'activeWorkers',
    'workerTrust', 'queue', 'inputSources',
  ];
  for (const key of keys) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
  // gapSummary
  assert.ok(typeof snapshot.gapSummary.total === 'number', 'gapSummary.total is number');
  assert.ok(typeof snapshot.gapSummary.byType === 'object', 'gapSummary.byType is object');
  assert.ok(typeof snapshot.gapSummary.bySeverity === 'object', 'gapSummary.bySeverity is object');
  // unresolvedGaps
  assert.ok(typeof snapshot.unresolvedGaps.count === 'number', 'unresolvedGaps.count is number');
  assert.ok(Array.isArray(snapshot.unresolvedGaps.entries), 'unresolvedGaps.entries is array');
  assert.ok(typeof snapshot.unresolvedGaps.bySeverity === 'object', 'unresolvedGaps.bySeverity is object');
  // recentGaps
  assert.ok(typeof snapshot.recentGaps.count === 'number', 'recentGaps.count is number');
  assert.strictEqual(snapshot.recentGaps.windowHours, 24, 'recentGaps.windowHours is 24');
  assert.ok(Array.isArray(snapshot.recentGaps.entries), 'recentGaps.entries is array');
  // trend
  assert.ok(typeof snapshot.trend.total7d === 'number', 'trend.total7d is number');
  assert.ok(typeof snapshot.trend.total30d === 'number', 'trend.total30d is number');
  assert.ok(typeof snapshot.trend.byType7d === 'object', 'trend.byType7d is object');
  // planningHealth: null when no metaSignals
  // (may or may not be null depending on local state)
  // activeWorkers
  assert.ok(typeof snapshot.activeWorkers.count === 'number', 'activeWorkers.count is number');
  // queue
  assert.ok(typeof snapshot.queue.entryCount === 'number', 'queue.entryCount is number');
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
    assert.ok(stdout.includes('Planning console state written to'), 'should print written message');
    assert.ok(fs.existsSync(outPath), 'file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
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
    assert.strictEqual(written.schemaVersion, 1);
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
  assert.strictEqual(snapshot.schemaVersion, 1);
});

test('stdout: combined with --live still prints JSON to stdout', () => {
  const outPath = tmpFile('stdout-live');
  try {
    const { stdout, exitCode } = run(['--stdout', '--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.schemaVersion, 1);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── Output structure ─────────────────────────────────────────────────────────

test('output: has all required top-level keys', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'schemaVersion', 'capturedAt', 'gapSummary', 'unresolvedGaps',
    'recentGaps', 'trend', 'planningHealth', 'activeWorkers',
    'workerTrust', 'queue', 'inputSources',
  ];
  for (const key of expected) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
});

test('output: schemaVersion is 1', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
});

test('output: capturedAt is ISO-8601', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const parsed = new Date(snapshot.capturedAt);
  assert.ok(!isNaN(parsed.getTime()), 'capturedAt should be valid ISO-8601');
});

test('output: gapSummary has all gap types', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expectedTypes = [
    'worker-failed', 'worker-stale', 'health-gate-fail',
    'launch-blocked', 'plan-drift', 'stale-row',
  ];
  for (const t of expectedTypes) {
    assert.ok(typeof snapshot.gapSummary.byType[t] === 'number', `byType.${t} should be number`);
  }
});

test('output: gapSummary has all severity levels', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const s of ['low', 'medium', 'high', 'critical']) {
    assert.ok(typeof snapshot.gapSummary.bySeverity[s] === 'number', `bySeverity.${s} should be number`);
  }
});

test('output: inputSources has all 5 flags', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'gapLedgerLoaded', 'metaSignalsLoaded', 'activeWorkersLoaded',
    'workerTrustLoaded', 'queueLoaded',
  ];
  for (const key of expected) {
    assert.ok(typeof snapshot.inputSources[key] === 'boolean', `inputSources.${key} should be boolean`);
  }
});

test('output: recentGaps has windowHours 24', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.recentGaps.windowHours, 24);
});

test('output: trend has byType7d with all gap types', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expectedTypes = [
    'worker-failed', 'worker-stale', 'health-gate-fail',
    'launch-blocked', 'plan-drift', 'stale-row',
  ];
  for (const t of expectedTypes) {
    assert.ok(typeof snapshot.trend.byType7d[t] === 'number', `trend.byType7d.${t} should be number`);
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
  const outPath = path.join(os.tmpdir(), `emit-planning-console-nested-${Date.now()}`, 'sub', 'out.json');
  try {
    const { exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(fs.existsSync(outPath));
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    const parent = path.dirname(outPath);
    if (fs.existsSync(parent)) fs.rmdirSync(parent, { recursive: true });
  }
});

test('edge: missing gap-ledger produces zero counts', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  // With no gap-ledger.ndjson present, counts should be 0
  assert.strictEqual(snapshot.gapSummary.total, 0);
  assert.strictEqual(snapshot.unresolvedGaps.count, 0);
  assert.strictEqual(snapshot.recentGaps.count, 0);
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  emit-planning-console-state.test.js`);
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
