#!/usr/bin/env node

/**
 * emit-codex-exit-readiness.test.js
 *
 * Tests for emit-codex-exit-readiness.js.
 * Covers: dry-run shape, live write, missing inputs produce safe defaults,
 * gate evaluation, CLI error handling, help flag, built-in self-test.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-codex-exit-readiness.js');

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
  return path.join(os.tmpdir(), `emit-readiness-${name}-${Date.now()}.json`);
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
  assert.ok(stdout.includes('codex-exit-readiness.json'), 'should mention output path');
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

test('dry-run: all top-level keys present', () => {
  const { stdout } = run([]);
  const snapshot = parseSnapshot(stdout);
  const keys = ['schemaVersion', 'capturedAt', 'verdict', 'passedBlocking',
    'totalBlocking', 'gates', 'blockers', 'inputSources'];
  for (const key of keys) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
});

// ── Verdict shape ────────────────────────────────────────────────────────────

test('verdict: is one of ready/partial/not_ready', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(['ready', 'partial', 'not_ready'].includes(snapshot.verdict),
    `verdict should be ready/partial/not_ready, got: ${snapshot.verdict}`);
});

test('verdict: passedBlocking is number', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.passedBlocking, 'number');
});

test('verdict: totalBlocking is 7', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.totalBlocking, 7);
});

test('verdict: blockers is array', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(Array.isArray(snapshot.blockers), 'blockers should be array');
});

// ── Gate shape ───────────────────────────────────────────────────────────────

test('gates: has 7 entries', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.gates.length, 7);
});

test('gates: each has id, name, pass, blocking, checks, blockers', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const gate of snapshot.gates) {
    assert.strictEqual(typeof gate.id, 'string', `${gate.id}.id should be string`);
    assert.strictEqual(typeof gate.name, 'string', `${gate.id}.name should be string`);
    assert.strictEqual(typeof gate.pass, 'boolean', `${gate.id}.pass should be boolean`);
    assert.strictEqual(typeof gate.blocking, 'boolean', `${gate.id}.blocking should be boolean`);
    assert.ok(Array.isArray(gate.checks), `${gate.id}.checks should be array`);
    assert.ok(Array.isArray(gate.blockers), `${gate.id}.blockers should be array`);
  }
});

test('gates: gate IDs match expected', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const ids = snapshot.gates.map(g => g.id);
  assert.deepStrictEqual(ids, [
    'gate-1', 'gate-2', 'gate-3', 'gate-4', 'gate-5', 'gate-6', 'gate-7',
  ]);
});

test('gates: all are blocking except note gates', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const gate of snapshot.gates) {
    assert.strictEqual(gate.blocking, true, `${gate.id} should be blocking`);
  }
});

test('gates: each check has id, name, pass', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const gate of snapshot.gates) {
    for (const check of gate.checks) {
      assert.strictEqual(typeof check.id, 'string', `check.id should be string`);
      assert.strictEqual(typeof check.name, 'string', `check.name should be string`);
      assert.strictEqual(typeof check.pass, 'boolean', `check.pass should be boolean`);
    }
  }
});

// ── Gate-6 always passes (structural) ────────────────────────────────────────

test('gate-6: always passes (structural boundaries)', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const gate6 = snapshot.gates.find(g => g.id === 'gate-6');
  assert.strictEqual(gate6.pass, true, 'gate-6 should always pass');
  assert.strictEqual(gate6.blockers.length, 0, 'gate-6 should have no blockers');
});

// ── Live write tests ─────────────────────────────────────────────────────────

test('live: writes file with --live flag', () => {
  const outPath = tmpFile('live-write');
  try {
    const { stdout, exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Exit readiness verdict written to'), 'should print written message');
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

// ── Input sources ────────────────────────────────────────────────────────────

test('inputSources: has all 6 flags', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'healthLoaded', 'providerPoolLoaded', 'activeWorkersLoaded',
    'workerTrustLoaded', 'metaSignalsLoaded', 'queueLoaded',
  ];
  for (const key of expected) {
    assert.ok(typeof snapshot.inputSources[key] === 'boolean', `inputSources.${key} should be boolean`);
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
  assert.ok(stdout.includes('VERDICT'));
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

// ── Consistency ──────────────────────────────────────────────────────────────

test('consistency: passedBlocking <= totalBlocking', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(snapshot.passedBlocking <= snapshot.totalBlocking,
    'passedBlocking should not exceed totalBlocking');
});

test('consistency: blockers count matches gate blockers', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  let gateBlockerCount = 0;
  for (const gate of snapshot.gates) {
    gateBlockerCount += gate.blockers.length;
  }
  assert.strictEqual(snapshot.blockers.length, gateBlockerCount,
    'top-level blockers should match sum of gate blockers');
});

test('consistency: verdict matches passedBlocking', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  if (snapshot.passedBlocking === snapshot.totalBlocking) {
    assert.strictEqual(snapshot.verdict, 'ready');
  } else if (snapshot.passedBlocking > 0) {
    assert.strictEqual(snapshot.verdict, 'partial');
  } else {
    assert.strictEqual(snapshot.verdict, 'not_ready');
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `emit-readiness-nested-${Date.now()}`, 'sub', 'out.json');
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

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  emit-codex-exit-readiness.test.js`);
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
