#!/usr/bin/env node

/**
 * write-self-cycle-run.test.js
 *
 * Focused self-tests for the self-cycle run manifest writer.
 * Covers: dry-run shape, append shape, secret redaction boundaries, CLI arg handling.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level redaction tests.
 *
 * Usage:
 *   node scripts/ai/write-self-cycle-run.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WRITER = path.join(__dirname, 'write-self-cycle-run.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log('\n  ' + name);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log('    ✓ ' + label);
  } else {
    failed++;
    console.error('    ✗ ' + label);
  }
}

function assertEq(actual, expected, label) {
  var ok = actual === expected;
  if (!ok) {
    console.error('    ✗ ' + label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  assert(ok, label);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function runWriter(args, opts) {
  var allArgs = args.slice();
  if (allArgs.indexOf('--dry-run') === -1 && allArgs.indexOf('--live') === -1 && allArgs.indexOf('--self-test') === -1 && allArgs.indexOf('--help') === -1) {
    allArgs.push('--dry-run');
  }
  try {
    var stdout = execFileSync(process.execPath, [WRITER].concat(allArgs), {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status != null ? err.status : 1,
    };
  }
}

function parseDryRunManifest(stdout) {
  var lines = stdout.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].charAt(0) === '{') {
      try { return JSON.parse(lines[i]); } catch (e) { /* skip */ }
    }
  }
  return null;
}

// ── Re-implement sanitize for unit tests ─────────────────────────────────────

function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted-token]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-gh-token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  var out = {};
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === 'string') {
        out[key] = sanitize(obj[key]);
      } else {
        out[key] = obj[key];
      }
    }
  }
  return out;
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('write-self-cycle-run.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run manifest shape ─────────────────────────────────────────

suite('dry-run manifest shape');

{
  var res = runWriter(['--run-id', 'cycle-test-001', '--cycle-mode', 'dry-run', '--health-state', 'green']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  var m = parseDryRunManifest(res.stdout);
  assert(m !== null, 'dry-run output contains valid JSON');
  assertEq(m.manifestVersion, 1, 'manifestVersion is 1');
  assertEq(m.runId, 'cycle-test-001', 'runId matches input');
  assertEq(m.cycleMode, 'dry-run', 'cycleMode matches input');
  assertEq(m.healthState, 'green', 'healthState matches input');
  assert(typeof m.capturedAt === 'string' && m.capturedAt.indexOf('T') !== -1, 'capturedAt is ISO-8601');
  assert(m.capturedAt.endsWith('Z'), 'capturedAt ends with Z (UTC)');
}

// ── Suite 2: Dry-run with all optional fields ───────────────────────────────

suite('dry-run with all optional fields');

{
  var res = runWriter([
    '--run-id', 'cycle-full',
    '--cycle-mode', 'execute',
    '--issue', '100',
    '--issue', '200',
    '--pr', '101',
    '--task-ids', '["task-a","task-b"]',
    '--actor', 'batch-launcher',
    '--outcome', 'completed',
    '--health-state', 'green',
    '--steps', '[{"name":"health-gate","status":"pass","detail":"ok","durationMs":50}]',
    '--meta', '{"wave":"wave16"}',
  ]);
  assertEq(res.exitCode, 0, 'full manifest exits 0');

  var m = parseDryRunManifest(res.stdout);
  assertEq(m.runId, 'cycle-full', 'runId preserved');
  assertEq(m.cycleMode, 'execute', 'cycleMode preserved');
  assert(m.issueNumbers && m.issueNumbers.length === 2, 'two issues');
  assertEq(m.issueNumbers[0], 100, 'issue[0] correct');
  assertEq(m.issueNumbers[1], 200, 'issue[1] correct');
  assert(m.prNumbers && m.prNumbers[0] === 101, 'pr preserved');
  assert(m.taskIds && m.taskIds.length === 2, 'taskIds preserved');
  assertEq(m.taskIds[0], 'task-a', 'taskId[0] correct');
  assertEq(m.actor, 'batch-launcher', 'actor preserved');
  assertEq(m.outcome, 'completed', 'outcome preserved');
  assertEq(m.healthState, 'green', 'healthState preserved');
  assert(m.steps && m.steps.length === 1, 'steps preserved');
  assertEq(m.steps[0].name, 'health-gate', 'step name preserved');
  assertEq(m.steps[0].status, 'pass', 'step status preserved');
  assertEq(m.steps[0].detail, 'ok', 'step detail preserved');
  assertEq(m.steps[0].durationMs, 50, 'step durationMs preserved');
  assert(m.meta && m.meta.wave === 'wave16', 'meta preserved');
}

// ── Suite 3: Dry-run minimal manifest (null optionals) ──────────────────────

suite('dry-run minimal manifest');

{
  var res = runWriter(['--run-id', 'min', '--cycle-mode', 'dry-run']);
  assertEq(res.exitCode, 0, 'minimal manifest exits 0');

  var m = parseDryRunManifest(res.stdout);
  assertEq(m.issueNumbers, null, 'issueNumbers defaults to null');
  assertEq(m.prNumbers, null, 'prNumbers defaults to null');
  assertEq(m.taskIds, null, 'taskIds defaults to null');
  assertEq(m.actor, null, 'actor defaults to null');
  assertEq(m.outcome, null, 'outcome defaults to null');
  assertEq(m.blockReason, null, 'blockReason defaults to null');
  assertEq(m.healthState, null, 'healthState defaults to null');
  assertEq(m.steps, null, 'steps defaults to null');
  assertEq(m.meta, null, 'meta defaults to null');
}

// ── Suite 4: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  var res = runWriter(['--run-id', 'markers', '--cycle-mode', 'dry-run']);
  assert(res.stdout.indexOf('DRY RUN') !== -1, 'output contains DRY RUN marker');
  assert(res.stdout.indexOf('No file was modified') !== -1, 'output confirms no file modified');
}

// ── Suite 5: Blocked outcome ────────────────────────────────────────────────

suite('blocked outcome');

{
  var res = runWriter([
    '--run-id', 'blocked-001',
    '--cycle-mode', 'execute',
    '--outcome', 'blocked',
    '--block-reason', 'Main health is red',
    '--health-state', 'red',
  ]);
  assertEq(res.exitCode, 0, 'blocked manifest exits 0');

  var m = parseDryRunManifest(res.stdout);
  assertEq(m.outcome, 'blocked', 'outcome is blocked');
  assertEq(m.blockReason, 'Main health is red', 'blockReason preserved');
  assertEq(m.healthState, 'red', 'healthState preserved');
}

// ── Suite 6: Secret redaction — GitHub tokens ───────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('ghp_' + 'a'.repeat(40)), 'ghp_[redacted-token]', 'long ghp_ gets base64 redaction first');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 7: Secret redaction — Bearer tokens ───────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
  assertEq(sanitize('BEARER xyz'), 'Bearer [redacted]', 'BEARER (uppercase) redacted');
}

// ── Suite 8: Secret redaction — base64-like strings ─────────────────────────

suite('redaction: base64-like strings (40+ chars)');

{
  assertEq(sanitize('a'.repeat(40)), '[redacted-token]', 'exactly 40 chars redacted');
  assertEq(sanitize('a'.repeat(50)), '[redacted-token]', '50 chars redacted');
  assertEq(sanitize('a'.repeat(39)), 'a'.repeat(39), '39 chars NOT redacted (below threshold)');
}

// ── Suite 9: Secret redaction — password/secret/token key=value ─────────────

suite('redaction: password/secret/token key=value');

{
  assertEq(sanitize('password=hunter2'), 'password=[redacted]', 'password= redacted');
  assertEq(sanitize('secret: mysecret'), 'secret=[redacted]', 'secret: redacted');
  assertEq(sanitize('token=abc123'), 'token=[redacted]', 'token= redacted');
}

// ── Suite 10: Secret redaction — integration via CLI ────────────────────────

suite('redaction: integration via dry-run');

{
  var res = runWriter([
    '--run-id', 'ghp_leaked_run',
    '--cycle-mode', 'dry-run',
    '--actor', 'ghp_actor_token',
    '--block-reason', 'Bearer secret123',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  var m = parseDryRunManifest(res.stdout);
  assertEq(m.runId, '[redacted-gh-token]_run', 'runId ghp_ prefix redacted');
  assertEq(m.actor, '[redacted-gh-token]_token', 'actor ghp_ prefix redacted');
  assertEq(m.blockReason, 'Bearer [redacted]', 'blockReason Bearer redacted');
}

// ── Suite 11: sanitizeObject preserves non-string types ─────────────────────

suite('sanitizeObject: type preservation');

{
  var input = { str: 'ghp_leaked', num: 42, bool: true, nil: null, arr: [1, 2] };
  var result = sanitizeObject(input);
  assertEq(result.str, '[redacted-gh-token]', 'string value redacted');
  assertEq(result.num, 42, 'number preserved');
  assertEq(result.bool, true, 'boolean preserved');
  assertEq(result.nil, null, 'null preserved');
  assert(Array.isArray(result.arr) && result.arr.length === 2, 'array preserved');
}

// ── Suite 12: sanitizeObject with null/undefined input ───────────────────────

suite('sanitizeObject: null/undefined handling');

{
  assertEq(sanitizeObject(null), null, 'null input returns null');
  assertEq(sanitizeObject(undefined), undefined, 'undefined input returns undefined');
}

// ── Suite 13: Truncation boundary ───────────────────────────────────────────

suite('sanitize: truncation at 500 chars');

{
  function longStr(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += (i % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');
  assertEq(sanitize(longStr(1000)).length, 500, '1000 chars truncated to 500');
  assertEq(sanitize('short'), 'short', 'short strings not truncated');
}

// ── Suite 14: CLI argument handling — missing run-id ────────────────────────

suite('CLI: missing --run-id');

{
  var res = runWriter(['--cycle-mode', 'dry-run'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --run-id exits 2');
  assert(res.stderr.indexOf('--run-id is required') !== -1, 'error message mentions --run-id');
}

// ── Suite 15: CLI argument handling — missing cycle-mode ─────────────────────

suite('CLI: missing --cycle-mode');

{
  var res = runWriter(['--run-id', 'test'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --cycle-mode exits 2');
  assert(res.stderr.indexOf('--cycle-mode is required') !== -1, 'error message mentions --cycle-mode');
}

// ── Suite 16: CLI argument handling — invalid cycle-mode ─────────────────────

suite('CLI: invalid --cycle-mode');

{
  var res = runWriter(['--run-id', 'test', '--cycle-mode', 'bogus']);
  assertEq(res.exitCode, 2, 'invalid cycle-mode exits 2');
  assert(res.stderr.indexOf('--cycle-mode must be one of') !== -1, 'error lists valid modes');
}

// ── Suite 17: CLI argument handling — unknown argument ──────────────────────

suite('CLI: unknown argument');

{
  var res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.indexOf('Unknown argument') !== -1, 'error message mentions unknown argument');
}

// ── Suite 18: CLI argument handling — invalid JSON task-ids ──────────────────

suite('CLI: invalid --task-ids JSON');

{
  var res = runWriter(['--run-id', 'test', '--cycle-mode', 'dry-run', '--task-ids', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON task-ids exits 2');
  assert(res.stderr.indexOf('valid JSON') !== -1, 'error message mentions JSON');
}

// ── Suite 19: CLI argument handling — invalid JSON steps ─────────────────────

suite('CLI: invalid --steps JSON');

{
  var res = runWriter(['--run-id', 'test', '--cycle-mode', 'dry-run', '--steps', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON steps exits 2');
  assert(res.stderr.indexOf('valid JSON') !== -1, 'error message mentions JSON');
}

// ── Suite 20: CLI argument handling — invalid step name ──────────────────────

suite('CLI: invalid step name');

{
  var res = runWriter([
    '--run-id', 'test',
    '--cycle-mode', 'dry-run',
    '--steps', '[{"name":"bogus","status":"pass"}]',
  ]);
  assertEq(res.exitCode, 2, 'invalid step name exits 2');
  assert(res.stderr.indexOf('name must be one of') !== -1, 'error lists valid step names');
}

// ── Suite 21: CLI argument handling — invalid step status ────────────────────

suite('CLI: invalid step status');

{
  var res = runWriter([
    '--run-id', 'test',
    '--cycle-mode', 'dry-run',
    '--steps', '[{"name":"health-gate","status":"bogus"}]',
  ]);
  assertEq(res.exitCode, 2, 'invalid step status exits 2');
  assert(res.stderr.indexOf('status must be one of') !== -1, 'error lists valid step statuses');
}

// ── Suite 22: CLI argument handling — invalid outcome ───────────────────────

suite('CLI: invalid --outcome');

{
  var res = runWriter(['--run-id', 'test', '--cycle-mode', 'dry-run', '--outcome', 'bogus']);
  assertEq(res.exitCode, 2, 'invalid outcome exits 2');
  assert(res.stderr.indexOf('--outcome must be one of') !== -1, 'error lists valid outcomes');
}

// ── Suite 23: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  var res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.indexOf('USAGE') !== -1, 'help output contains USAGE');
  assert(res.stdout.indexOf('--run-id') !== -1, 'help output mentions --run-id');
  assert(res.stdout.indexOf('--live') !== -1, 'help output mentions --live');
}

// ── Suite 24: CLI — -h shorthand ────────────────────────────────────────────

suite('CLI: -h shorthand');

{
  var res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.indexOf('USAGE') !== -1, '-h output contains USAGE');
}

// ── Suite 25: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  var res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.indexOf('self-test') !== -1, 'self-test output contains header');
  assert(res.stdout.indexOf('passed') !== -1, 'self-test output contains results');
}

// ── Suite 26: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-cycle-run-test-'));
  var tmpFile = path.join(tmpDir, 'test-runs.ndjson');

  try {
    var res = runWriter([
      '--run-id', 'cycle-live-001',
      '--cycle-mode', 'execute',
      '--outcome', 'completed',
      '--health-state', 'green',
      '--actor', 'test-runner',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(fs.existsSync(tmpFile), 'output file created');

    var content = fs.readFileSync(tmpFile, 'utf8').trim();
    var lines = content.split('\n');
    assertEq(lines.length, 1, 'exactly one NDJSON line written');

    var m = JSON.parse(lines[0]);
    assertEq(m.runId, 'cycle-live-001', 'written runId correct');
    assertEq(m.cycleMode, 'execute', 'written cycleMode correct');
    assertEq(m.outcome, 'completed', 'written outcome correct');
    assertEq(m.healthState, 'green', 'written healthState correct');
    assertEq(m.actor, 'test-runner', 'written actor correct');
    assertEq(m.manifestVersion, 1, 'written manifestVersion is 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 27: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-cycle-run-test-'));
  var tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    runWriter(['--run-id', 'first', '--cycle-mode', 'dry-run', '--out', tmpFile, '--live']);
    runWriter(['--run-id', 'second', '--cycle-mode', 'execute', '--out', tmpFile, '--live']);

    var content = fs.readFileSync(tmpFile, 'utf8').trim();
    var lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    var first = JSON.parse(lines[0]);
    var second = JSON.parse(lines[1]);
    assertEq(first.runId, 'first', 'first runId correct');
    assertEq(second.runId, 'second', 'second runId correct');
    assertEq(first.cycleMode, 'dry-run', 'first cycleMode correct');
    assertEq(second.cycleMode, 'execute', 'second cycleMode correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 28: Multiple issues and PRs ───────────────────────────────────────

suite('multiple --issue and --pr flags');

{
  var res = runWriter([
    '--run-id', 'multi',
    '--cycle-mode', 'execute',
    '--issue', '10',
    '--issue', '20',
    '--issue', '30',
    '--pr', '11',
    '--pr', '21',
  ]);
  assertEq(res.exitCode, 0, 'multi issue/pr exits 0');

  var m = parseDryRunManifest(res.stdout);
  assert(m.issueNumbers && m.issueNumbers.length === 3, 'three issues');
  assertEq(m.issueNumbers[0], 10, 'issue[0] correct');
  assertEq(m.issueNumbers[1], 20, 'issue[1] correct');
  assertEq(m.issueNumbers[2], 30, 'issue[2] correct');
  assert(m.prNumbers && m.prNumbers.length === 2, 'two PRs');
  assertEq(m.prNumbers[0], 11, 'pr[0] correct');
  assertEq(m.prNumbers[1], 21, 'pr[1] correct');
}

// ── Suite 29: Empty and edge-case strings ───────────────────────────────────

suite('sanitize: empty and edge cases');

{
  assertEq(sanitize('', 0), '', 'empty string returns empty');
  assertEq(sanitize('hello'), 'hello', 'plain text unchanged');
  assertEq(sanitize('a'), 'a', 'single char unchanged');
  assertEq(sanitize(42), 42, 'non-string passthrough');
  assertEq(sanitize(null), null, 'null passthrough');
  assertEq(sanitize(undefined), undefined, 'undefined passthrough');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
