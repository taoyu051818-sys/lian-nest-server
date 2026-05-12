#!/usr/bin/env node

/**
 * emit-command-steward-status-bundle.test.js
 *
 * Tests for emit-command-steward-status-bundle.js.
 * Covers: dry-run shape, live write, missing inputs produce safe defaults,
 * section structure, blockers, CLI error handling, help flag, built-in self-test,
 * sanitization, GitHub data handling.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-command-steward-status-bundle.js');

// Isolate tests from local .github/ai-state files
const CLEAN_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-steward-status-'));
const CHILD_ENV = { ...process.env, COMMAND_STEWARD_STATE_DIR: CLEAN_STATE_DIR };

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [EMITTER, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: CHILD_ENV,
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
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `emit-status-bundle-${name}-${Date.now()}.json`);
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

test('dry-run: prints DRY RUN banner with valid JSON and all top-level keys', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('DRY RUN'), 'should include DRY RUN banner');
  assert.ok(stdout.includes('command-steward-status-bundle.json'), 'should mention output path');
  const snapshot = parseSnapshot(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
  assert.ok(typeof snapshot.capturedAt === 'string');
  const keys = ['schemaVersion', 'capturedAt', 'health', 'openPullRequests',
    'openIssues', 'activeWorkers', 'recentTelemetry', 'blockers', 'inputSources'];
  for (const key of keys) { assert.ok(key in snapshot, `missing key: ${key}`); }
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

// ── Health section shape ─────────────────────────────────────────────────────

test('health: has required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.health.loaded, 'boolean', 'health.loaded');
  assert.strictEqual(typeof snapshot.health.state, 'string', 'health.state');
  assert.ok(Array.isArray(snapshot.health.checks), 'health.checks');
  assert.ok(Array.isArray(snapshot.health.failedChecks), 'health.failedChecks');
});

test('health: state is one of known values', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const valid = ['green', 'yellow', 'red', 'black', 'unknown'];
  assert.ok(valid.includes(snapshot.health.state),
    `state should be one of ${valid.join('/')}, got: ${snapshot.health.state}`);
});

// ── Open PRs section shape ───────────────────────────────────────────────────

test('openPullRequests: has required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.openPullRequests.loaded, 'boolean', 'loaded');
  assert.strictEqual(typeof snapshot.openPullRequests.count, 'number', 'count');
  assert.ok(Array.isArray(snapshot.openPullRequests.pullRequests), 'pullRequests array');
});

test('openPullRequests: each PR has required fields when loaded', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  if (snapshot.openPullRequests.loaded) {
    for (const pr of snapshot.openPullRequests.pullRequests) {
      assert.strictEqual(typeof pr.number, 'number', 'pr.number');
      assert.strictEqual(typeof pr.title, 'string', 'pr.title');
      assert.strictEqual(typeof pr.author, 'string', 'pr.author');
    }
  }
});

// ── Open issues section shape ────────────────────────────────────────────────

test('openIssues: has required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.openIssues.loaded, 'boolean', 'loaded');
  assert.strictEqual(typeof snapshot.openIssues.count, 'number', 'count');
  assert.ok(Array.isArray(snapshot.openIssues.issues), 'issues array');
});

test('openIssues: each issue has required fields when loaded', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  if (snapshot.openIssues.loaded) {
    for (const issue of snapshot.openIssues.issues) {
      assert.strictEqual(typeof issue.number, 'number', 'issue.number');
      assert.strictEqual(typeof issue.title, 'string', 'issue.title');
      assert.strictEqual(typeof issue.state, 'string', 'issue.state');
      assert.ok(Array.isArray(issue.labels), 'issue.labels');
    }
  }
});

// ── Active workers section shape ─────────────────────────────────────────────

test('activeWorkers: has required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.activeWorkers.loaded, 'boolean', 'loaded');
  assert.strictEqual(typeof snapshot.activeWorkers.count, 'number', 'count');
  assert.ok(Array.isArray(snapshot.activeWorkers.workers), 'workers array');
});

// ── Telemetry section shape ──────────────────────────────────────────────────

test('recentTelemetry: has loaded boolean', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.recentTelemetry.loaded, 'boolean', 'loaded');
});

// ── Blockers shape ───────────────────────────────────────────────────────────

test('blockers: array with source, severity, message on each entry', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(Array.isArray(snapshot.blockers), 'blockers should be array');
  for (const b of snapshot.blockers) {
    assert.strictEqual(typeof b.source, 'string', 'blocker.source');
    assert.strictEqual(typeof b.severity, 'string', 'blocker.severity');
    assert.strictEqual(typeof b.message, 'string', 'blocker.message');
  }
});

test('blockers: health blocker present when health missing', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(snapshot.blockers.some(b => b.source === 'health'), 'should have health blocker');
});

// ── Input sources ────────────────────────────────────────────────────────────

test('inputSources: has all expected boolean flags', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'healthLoaded', 'activeWorkersLoaded', 'metaSignalsLoaded',
    'riskSignalsLoaded', 'prDataLoaded', 'issueDataLoaded',
  ];
  for (const key of expected) {
    assert.strictEqual(typeof snapshot.inputSources[key], 'boolean', `inputSources.${key}`);
  }
});

// ── Live write tests ─────────────────────────────────────────────────────────

test('live: writes file and overwrites existing', () => {
  const outPath = tmpFile('live-write');
  try {
    const { stdout, exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Command Steward status bundle written to'), 'should print written message');
    assert.ok(fs.existsSync(outPath), 'file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);

    // Overwrite existing
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    run(['--live', '--out', outPath]);
    const overwritten = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(overwritten.schemaVersion, 1);
    assert.strictEqual(overwritten.old, undefined);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── --stdout flag ────────────────────────────────────────────────────────────

test('stdout: prints JSON without banner', () => {
  const { stdout, exitCode } = run(['--stdout']);
  assert.strictEqual(exitCode, 0);
  assert.ok(!stdout.includes('DRY RUN'), 'no banner');
  assert.strictEqual(JSON.parse(stdout).schemaVersion, 1);
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

test('cli: --help and -h exit 0 with usage', () => {
  for (const flag of ['--help', '-h']) {
    const { stdout, exitCode } = run([flag]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('USAGE'));
  }
});

// ── Built-in self-test ───────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── Sanitization ─────────────────────────────────────────────────────────────

test('sanitization: output does not contain secret-shaped keys', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const json = JSON.stringify(snapshot);
  // Should not contain common secret patterns as keys
  assert.ok(!json.includes('"token"'), 'should not have token key');
  assert.ok(!json.includes('"secret"'), 'should not have secret key');
  assert.ok(!json.includes('"password"'), 'should not have password key');
});

// ── Consistency ──────────────────────────────────────────────────────────────

test('consistency: blockers have valid sources', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const validSources = ['health', 'workers', 'telemetry'];
  for (const b of snapshot.blockers) {
    assert.ok(validSources.includes(b.source), `valid source: ${b.source}`);
  }
});

test('consistency: blockers have valid severities', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const validSeverities = ['info', 'warning', 'medium', 'high', 'critical'];
  for (const b of snapshot.blockers) {
    assert.ok(validSeverities.includes(b.severity), `valid severity: ${b.severity}`);
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `emit-status-bundle-nested-${Date.now()}`, 'sub', 'out.json');
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
console.log(`\n  emit-command-steward-status-bundle.test.js`);
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
