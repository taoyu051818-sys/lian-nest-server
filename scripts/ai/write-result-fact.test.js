#!/usr/bin/env node

/**
 * write-result-fact.test.js
 *
 * Focused self-tests for the result fact writer.
 * Covers: dry-run shape, result kinds/statuses, subject derivation,
 * secret redaction, changedFiles parsing, CLI arg handling.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level tests.
 *
 * Usage:
 *   node scripts/ai/write-result-fact.test.js
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

const WRITER = path.join(__dirname, 'write-result-fact.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function runWriter(args, opts = {}) {
  const allArgs = [...args];
  if (!allArgs.includes('--dry-run') && !allArgs.includes('--live') && !allArgs.includes('--self-test') && !allArgs.includes('--help')) {
    allArgs.push('--dry-run');
  }
  try {
    const stdout = execFileSync(process.execPath, [WRITER, ...allArgs], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 10000,
      ...opts,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

function parseDryRunEvent(stdout) {
  const lines = stdout.split('\n');
  const jsonLine = lines.find((l) => l.startsWith('{'));
  if (!jsonLine) return null;
  return JSON.parse(jsonLine);
}

// ── Extract sanitize for unit tests ─────────────────────────────────────────

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

function sanitizeFacts(facts) {
  if (!facts || typeof facts !== 'object') return facts;
  const sanitized = {};
  for (const [key, value] of Object.entries(facts)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('write-result-fact.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run event shape ────────────────────────────────────────────

suite('dry-run event shape');

{
  const res = runWriter(['--kind', 'worker.complete', '--status', 'pass', '--issue', '397']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(event !== null, 'dry-run output contains valid JSON');
  assertEq(event.eventVersion, 1, 'eventVersion is 1');
  assertEq(event.eventType, 'worker.complete', 'eventType matches kind');
  assertEq(event.facts.status, 'pass', 'facts.status matches');
  assertEq(event.facts.issue, 397, 'facts.issue matches');
  assert(typeof event.capturedAt === 'string' && event.capturedAt.includes('T'), 'capturedAt is ISO-8601');
  assert(event.capturedAt.endsWith('Z'), 'capturedAt ends with Z (UTC)');
}

// ── Suite 2: Dry-run with PR and commit ─────────────────────────────────────

suite('dry-run with PR and commit');

{
  const res = runWriter(['--kind', 'merge.complete', '--status', 'pass', '--pr', '401', '--commit', 'abc1234']);
  assertEq(res.exitCode, 0, 'dry-run with PR exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(event !== null, 'output contains valid JSON');
  assertEq(event.subject, 'pr #401', 'subject derived from PR');
  assertEq(event.facts.pr, 401, 'facts.pr preserved');
  assertEq(event.facts.commit, 'abc1234', 'facts.commit preserved');
}

// ── Suite 3: Dry-run minimal event (null optionals) ─────────────────────────

suite('dry-run minimal event');

{
  const res = runWriter(['--kind', 'health.green', '--status', 'pass']);
  assertEq(res.exitCode, 0, 'minimal event exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.subject, null, 'subject defaults to null');
  assert(event.facts !== null, 'facts is not null (has status)');
  assertEq(event.actor, null, 'actor defaults to null');
}

// ── Suite 4: Subject derivation priority ────────────────────────────────────

suite('subject derivation priority');

{
  // Issue takes precedence
  const res1 = runWriter(['--kind', 'worker.fail', '--status', 'fail', '--issue', '100', '--pr', '200']);
  const ev1 = parseDryRunEvent(res1.stdout);
  assertEq(ev1.subject, 'issue #100', 'issue takes precedence over PR');

  // PR when no issue
  const res2 = runWriter(['--kind', 'merge.complete', '--status', 'pass', '--pr', '200']);
  const ev2 = parseDryRunEvent(res2.stdout);
  assertEq(ev2.subject, 'pr #200', 'PR used when no issue');

  // Branch when no issue/PR
  const res3 = runWriter(['--kind', 'worker.complete', '--status', 'pass', '--branch', 'claude/wave16-abc']);
  const ev3 = parseDryRunEvent(res3.stdout);
  assertEq(ev3.subject, 'branch claude/wave16-abc', 'branch used when no issue/PR');

  // Null when nothing provided
  const res4 = runWriter(['--kind', 'health.red', '--status', 'fail']);
  const ev4 = parseDryRunEvent(res4.stdout);
  assertEq(ev4.subject, null, 'subject null when no identifiers');
}

// ── Suite 5: changedFiles parsing ───────────────────────────────────────────

suite('changedFiles parsing');

{
  const res = runWriter(['--kind', 'merge.complete', '--status', 'pass', '--changed', 'src/a.ts,src/b.ts,src/c.ts']);
  assertEq(res.exitCode, 0, 'changedFiles exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(Array.isArray(event.facts.changedFiles), 'changedFiles is array');
  assertEq(event.facts.changedFiles.length, 3, 'changedFiles has 3 entries');
  assertEq(event.facts.changedFiles[0], 'src/a.ts', 'first file preserved');
  assertEq(event.facts.changedFiles[2], 'src/c.ts', 'last file preserved');
}

// ── Suite 6: Optional numeric fields ───────────────────────────────────────

suite('optional numeric fields');

{
  const res = runWriter(['--kind', 'worker.complete', '--status', 'pass', '--elapsed', '12000', '--exitCode', '0']);
  assertEq(res.exitCode, 0, 'numeric fields exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.facts.elapsedMs, 12000, 'elapsedMs preserved');
  assertEq(event.facts.exitCode, 0, 'exitCode preserved');
}

// ── Suite 7: Validation field ───────────────────────────────────────────────

suite('validation field');

{
  const res = runWriter(['--kind', 'health.red', '--status', 'fail', '--validation', 'tsc FAIL, build PASS']);
  assertEq(res.exitCode, 0, 'validation exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.facts.validation, 'tsc FAIL, build PASS', 'validation preserved');
}

// ── Suite 8: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  const res = runWriter(['--kind', 'worker.complete', '--status', 'pass']);
  assert(res.stdout.includes('DRY RUN'), 'output contains DRY RUN marker');
  assert(res.stdout.includes('No file was modified'), 'output confirms no file modified');
  assert(res.stdout.includes('RESULT FACT WRITER'), 'output contains script name');
}

// ── Suite 9: All result kinds accepted ──────────────────────────────────────

suite('all result kinds accepted');

{
  const kinds = [
    'worker.complete',
    'worker.fail',
    'merge.complete',
    'merge.conflict',
    'merge.batch',
    'health.green',
    'health.red',
  ];

  for (const kind of kinds) {
    const res = runWriter(['--kind', kind, '--status', 'pass']);
    assertEq(res.exitCode, 0, `kind "${kind}" exits 0`);
    const event = parseDryRunEvent(res.stdout);
    assertEq(event.eventType, kind, `kind "${kind}" preserved as eventType`);
  }
}

// ── Suite 10: All result statuses accepted ──────────────────────────────────

suite('all result statuses accepted');

{
  const statuses = ['pass', 'fail', 'skip', 'error', 'timeout', 'conflict'];

  for (const status of statuses) {
    const res = runWriter(['--kind', 'worker.complete', '--status', status]);
    assertEq(res.exitCode, 0, `status "${status}" exits 0`);
    const event = parseDryRunEvent(res.stdout);
    assertEq(event.facts.status, status, `status "${status}" preserved`);
  }
}

// ── Suite 11: Actor field ───────────────────────────────────────────────────

suite('actor field');

{
  const res = runWriter(['--kind', 'worker.complete', '--status', 'pass', '--actor', 'batch-launcher']);
  assertEq(res.exitCode, 0, 'actor exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.actor, 'batch-launcher', 'actor preserved');
}

// ── Suite 12: Secret redaction — GitHub tokens ──────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 13: Secret redaction — Bearer tokens ──────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
}

// ── Suite 14: Secret redaction — integration via CLI ────────────────────────

suite('redaction: integration via dry-run');

{
  const res = runWriter([
    '--kind', 'worker.fail',
    '--status', 'fail',
    '--validation', 'Bearer secret123',
    '--actor', 'ghp_leaked',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.facts.validation, 'Bearer [redacted]', 'validation Bearer redacted in output');
  assertEq(event.actor, '[redacted-gh-token]', 'actor ghp_ redacted in output');
}

// ── Suite 15: sanitizeFacts preserves non-string types ──────────────────────

suite('sanitizeFacts: type preservation');

{
  const input = { str: 'ghp_leaked', num: 42, bool: true, nil: null, arr: [1, 2] };
  const result = sanitizeFacts(input);
  assertEq(result.str, '[redacted-gh-token]', 'string value redacted');
  assertEq(result.num, 42, 'number preserved');
  assertEq(result.bool, true, 'boolean preserved');
  assertEq(result.nil, null, 'null preserved');
  assert(Array.isArray(result.arr) && result.arr.length === 2, 'array preserved');
}

// ── Suite 16: sanitizeFacts with null/undefined input ───────────────────────

suite('sanitizeFacts: null/undefined handling');

{
  assertEq(sanitizeFacts(null), null, 'null input returns null');
  assertEq(sanitizeFacts(undefined), undefined, 'undefined input returns undefined');
}

// ── Suite 17: CLI argument handling — missing kind ──────────────────────────

suite('CLI: missing --kind');

{
  const res = runWriter(['--status', 'pass']);
  assertEq(res.exitCode, 2, 'missing --kind exits 2');
  assert(res.stderr.includes('--kind is required'), 'error message mentions --kind');
}

// ── Suite 18: CLI argument handling — missing status ────────────────────────

suite('CLI: missing --status');

{
  const res = runWriter(['--kind', 'worker.complete']);
  assertEq(res.exitCode, 2, 'missing --status exits 2');
  assert(res.stderr.includes('--status is required'), 'error message mentions --status');
}

// ── Suite 19: CLI argument handling — unknown argument ──────────────────────

suite('CLI: unknown argument');

{
  const res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.includes('Unknown argument'), 'error message mentions unknown argument');
}

// ── Suite 20: CLI argument handling — invalid kind ──────────────────────────

suite('CLI: invalid --kind');

{
  const res = runWriter(['--kind', 'not-a-kind', '--status', 'pass']);
  assertEq(res.exitCode, 2, 'invalid kind exits 2');
  assert(res.stderr.includes('--kind must be one of'), 'error message lists valid kinds');
}

// ── Suite 21: CLI argument handling — invalid status ────────────────────────

suite('CLI: invalid --status');

{
  const res = runWriter(['--kind', 'worker.complete', '--status', 'bogus']);
  assertEq(res.exitCode, 2, 'invalid status exits 2');
  assert(res.stderr.includes('--status must be one of'), 'error message lists valid statuses');
}

// ── Suite 22: CLI argument handling — invalid commit ────────────────────────

suite('CLI: invalid --commit');

{
  const res = runWriter(['--kind', 'merge.complete', '--status', 'pass', '--commit', 'zzzzzzz']);
  assertEq(res.exitCode, 2, 'invalid commit exits 2');
  assert(res.stderr.includes('7-40 hex'), 'error message mentions hex format');
}

// ── Suite 23: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  const res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.includes('USAGE'), 'help output contains USAGE');
  assert(res.stdout.includes('--kind'), 'help output mentions --kind');
  assert(res.stdout.includes('--live'), 'help output mentions --live');
}

// ── Suite 24: CLI — -h shorthand ────────────────────────────────────────────

suite('CLI: -h shorthand');

{
  const res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.includes('USAGE'), '-h output contains USAGE');
}

// ── Suite 25: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  const res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.includes('self-test'), 'self-test output contains header');
  assert(res.stdout.includes('passed'), 'self-test output contains results');
}

// ── Suite 26: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-fact-test-'));
  const tmpFile = path.join(tmpDir, 'test-results.ndjson');

  try {
    const res = runWriter([
      '--kind', 'worker.complete',
      '--status', 'pass',
      '--issue', '397',
      '--pr', '401',
      '--commit', 'abc1234',
      '--changed', 'src/a.ts,src/b.ts',
      '--validation', 'check PASS, build PASS',
      '--elapsed', '12000',
      '--exitCode', '0',
      '--actor', 'test-runner',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(fs.existsSync(tmpFile), 'output file created');

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 1, 'exactly one NDJSON line written');

    const event = JSON.parse(lines[0]);
    assertEq(event.eventType, 'worker.complete', 'written eventType correct');
    assertEq(event.subject, 'issue #397', 'written subject correct');
    assertEq(event.facts.status, 'pass', 'written status correct');
    assertEq(event.facts.pr, 401, 'written pr correct');
    assertEq(event.facts.commit, 'abc1234', 'written commit correct');
    assert(Array.isArray(event.facts.changedFiles), 'written changedFiles is array');
    assertEq(event.facts.changedFiles.length, 2, 'written changedFiles count');
    assertEq(event.facts.validation, 'check PASS, build PASS', 'written validation correct');
    assertEq(event.facts.elapsedMs, 12000, 'written elapsedMs correct');
    assertEq(event.facts.exitCode, 0, 'written exitCode correct');
    assertEq(event.actor, 'test-runner', 'written actor correct');
    assertEq(event.eventVersion, 1, 'written eventVersion is 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 27: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-fact-test-'));
  const tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    // Write first event
    runWriter(['--kind', 'worker.complete', '--status', 'pass', '--out', tmpFile, '--live']);
    // Write second event
    runWriter(['--kind', 'health.red', '--status', 'fail', '--out', tmpFile, '--live']);

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assertEq(first.eventType, 'worker.complete', 'first event type correct');
    assertEq(second.eventType, 'health.red', 'second event type correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 28: Live write output confirmation ────────────────────────────────

suite('live write output confirmation');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-fact-test-'));
  const tmpFile = path.join(tmpDir, 'confirm-test.ndjson');

  try {
    const res = runWriter(['--kind', 'merge.complete', '--status', 'pass', '--out', tmpFile, '--live']);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(res.stdout.includes('Result fact appended'), 'confirmation message present');
    assert(res.stdout.includes('merge.complete'), 'confirmation includes kind');
    assert(res.stdout.includes('pass'), 'confirmation includes status');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 29: Truncation boundary ───────────────────────────────────────────

suite('sanitize: truncation at 500 chars');

{
  function longStr(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += (i % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');
  assertEq(sanitize('short'), 'short', 'short strings not truncated');
}

// ── Suite 30: Empty and edge-case strings ───────────────────────────────────

suite('sanitize: empty and edge cases');

{
  assertEq(sanitize(''), '', 'empty string returns empty');
  assertEq(sanitize('hello'), 'hello', 'plain text unchanged');
  assertEq(sanitize(42), 42, 'non-string passthrough');
  assertEq(sanitize(null), null, 'null passthrough');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
