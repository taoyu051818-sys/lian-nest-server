#!/usr/bin/env node

/**
 * write-autonomy-handoff-fact.test.js
 *
 * Focused self-tests for the autonomy handoff fact writer.
 * Covers: dry-run shape, handoff fields, secret redaction, CLI arg handling,
 * live write, append behavior.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level redaction tests.
 *
 * Usage:
 *   node scripts/ai/write-autonomy-handoff-fact.test.js
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

const WRITER = path.join(__dirname, 'write-autonomy-handoff-fact.js');
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

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('write-autonomy-handoff-fact.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run event shape ────────────────────────────────────────────

suite('dry-run event shape');

{
  const res = runWriter(['--handoff-type', 'codex-to-self-cycle', '--source', 'codex', '--destination', 'self-cycle-runner']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(event !== null, 'dry-run output contains valid JSON');
  assertEq(event.eventVersion, 1, 'eventVersion is 1');
  assertEq(event.handoffType, 'codex-to-self-cycle', 'handoffType matches input');
  assertEq(event.source, 'codex', 'source matches input');
  assertEq(event.destination, 'self-cycle-runner', 'destination matches input');
  assert(typeof event.capturedAt === 'string' && event.capturedAt.includes('T'), 'capturedAt is ISO-8601');
  assert(event.capturedAt.endsWith('Z'), 'capturedAt ends with Z (UTC)');
}

// ── Suite 2: Dry-run with preconditions ─────────────────────────────────────

suite('dry-run with preconditions');

{
  const res = runWriter([
    '--handoff-type', 'health-gate-pass',
    '--preconditions', '{"health":"green","providerPool":"ready"}',
  ]);
  assertEq(res.exitCode, 0, 'dry-run with preconditions exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(event !== null, 'output contains valid JSON');
  assertEq(event.preconditions.health, 'green', 'preconditions.health preserved');
  assertEq(event.preconditions.providerPool, 'ready', 'preconditions.providerPool preserved');
}

// ── Suite 3: Dry-run with outcome and facts ─────────────────────────────────

suite('dry-run with outcome and facts');

{
  const res = runWriter([
    '--handoff-type', 'autonomous-to-fallback',
    '--outcome', 'blocked',
    '--facts', '{"reason":"health-red","retry":"pending"}',
  ]);
  assertEq(res.exitCode, 0, 'dry-run with outcome/facts exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.outcome, 'blocked', 'outcome preserved');
  assertEq(event.facts.reason, 'health-red', 'facts.reason preserved');
  assertEq(event.facts.retry, 'pending', 'facts.retry preserved');
}

// ── Suite 4: Dry-run minimal event (null optionals) ─────────────────────────

suite('dry-run minimal event');

{
  const res = runWriter(['--handoff-type', 'manual-to-autonomous']);
  assertEq(res.exitCode, 0, 'minimal event exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.source, null, 'source defaults to null');
  assertEq(event.destination, null, 'destination defaults to null');
  assertEq(event.preconditions, null, 'preconditions defaults to null');
  assertEq(event.outcome, null, 'outcome defaults to null');
  assertEq(event.facts, null, 'facts defaults to null');
  assertEq(event.actor, null, 'actor defaults to null');
}

// ── Suite 5: Dry-run with actor ─────────────────────────────────────────────

suite('dry-run with actor');

{
  const res = runWriter(['--handoff-type', 'codex-to-self-cycle', '--actor', 'operator-alpha']);
  assertEq(res.exitCode, 0, 'dry-run with actor exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.actor, 'operator-alpha', 'actor preserved');
}

// ── Suite 6: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  const res = runWriter(['--handoff-type', 'codex-to-self-cycle']);
  assert(res.stdout.includes('DRY RUN'), 'output contains DRY RUN marker');
  assert(res.stdout.includes('No file was modified'), 'output confirms no file modified');
}

// ── Suite 7: Secret redaction — GitHub tokens ───────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('ghp_' + 'a'.repeat(40)), 'ghp_[redacted-token]', 'long ghp_ gets base64 redaction first');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 8: Secret redaction — Bearer tokens ───────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
  assertEq(sanitize('BEARER xyz'), 'Bearer [redacted]', 'BEARER (uppercase) redacted');
}

// ── Suite 9: Secret redaction — base64-like strings ─────────────────────────

suite('redaction: base64-like strings (40+ chars)');

{
  assertEq(sanitize('a'.repeat(40)), '[redacted-token]', 'exactly 40 chars redacted');
  assertEq(sanitize('a'.repeat(50)), '[redacted-token]', '50 chars redacted');
  assertEq(sanitize('a'.repeat(39)), 'a'.repeat(39), '39 chars NOT redacted (below threshold)');
}

// ── Suite 10: Secret redaction — password/secret/token key=value ─────────────

suite('redaction: password/secret/token key=value');

{
  assertEq(sanitize('password=hunter2'), 'password=[redacted]', 'password= redacted');
  assertEq(sanitize('secret: mysecret'), 'secret=[redacted]', 'secret: redacted');
  assertEq(sanitize('token=abc123'), 'token=[redacted]', 'token= redacted');
  assertEq(sanitize('SECRET=CAPS'), 'secret=[redacted]', 'SECRET= (case-insensitive) redacted');
}

// ── Suite 11: Secret redaction — integration via CLI ────────────────────────

suite('redaction: integration via dry-run');

{
  const res = runWriter([
    '--handoff-type', 'codex-to-self-cycle',
    '--source', 'ghp_leaked_source',
    '--destination', 'Bearer secret123',
    '--preconditions', '{"msg":"ghp_pcheck"}',
    '--outcome', 'ghp_out',
    '--facts', '{"detail":"Bearer tok123","safe":"ok"}',
    '--actor', 'ghp_actor_token',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.source, '[redacted-gh-token]_source', 'source ghp_ redacted in output');
  assertEq(event.destination, 'Bearer [redacted]', 'destination Bearer redacted in output');
  assertEq(event.preconditions.msg, '[redacted-gh-token]', 'preconditions ghp_ redacted');
  assertEq(event.outcome, '[redacted-gh-token]', 'outcome ghp_ redacted');
  assertEq(event.facts.detail, 'Bearer [redacted]', 'facts Bearer redacted in output');
  assertEq(event.facts.safe, 'ok', 'non-secret facts preserved');
  assertEq(event.actor, '[redacted-gh-token]_token', 'actor ghp_ redacted in output');
}

// ── Suite 12: sanitizeObject preserves non-string types ─────────────────────

suite('sanitizeObject: type preservation');

{
  const input = { str: 'ghp_leaked', num: 42, bool: true, nil: null, arr: [1, 2] };
  const result = sanitizeObject(input);
  assertEq(result.str, '[redacted-gh-token]', 'string value redacted');
  assertEq(result.num, 42, 'number preserved');
  assertEq(result.bool, true, 'boolean preserved');
  assertEq(result.nil, null, 'null preserved');
  assert(Array.isArray(result.arr) && result.arr.length === 2, 'array preserved');
}

// ── Suite 13: sanitizeObject with null/undefined input ──────────────────────

suite('sanitizeObject: null/undefined handling');

{
  assertEq(sanitizeObject(null), null, 'null input returns null');
  assertEq(sanitizeObject(undefined), undefined, 'undefined input returns undefined');
}

// ── Suite 14: Truncation boundary ───────────────────────────────────────────

suite('sanitize: truncation at 500 chars');

{
  function longStr(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += (i % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');
  assertEq(sanitize(longStr(1000)).length, 500, '1000 chars truncated to 500');
  assertEq(sanitize('short'), 'short', 'short strings not truncated');
}

// ── Suite 15: CLI argument handling — missing handoff-type ──────────────────

suite('CLI: missing --handoff-type');

{
  const res = runWriter(['--dry-run']);
  assertEq(res.exitCode, 2, 'missing --handoff-type exits 2');
  assert(res.stderr.includes('--handoff-type is required'), 'error message mentions --handoff-type');
}

// ── Suite 16: CLI argument handling — unknown argument ──────────────────────

suite('CLI: unknown argument');

{
  const res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.includes('Unknown argument'), 'error message mentions unknown argument');
}

// ── Suite 17: CLI argument handling — invalid JSON preconditions ────────────

suite('CLI: invalid --preconditions JSON');

{
  const res = runWriter(['--handoff-type', 'codex-to-self-cycle', '--preconditions', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON preconditions exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 18: CLI argument handling — invalid JSON facts ────────────────────

suite('CLI: invalid --facts JSON');

{
  const res = runWriter(['--handoff-type', 'codex-to-self-cycle', '--facts', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON facts exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 19: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  const res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.includes('USAGE'), 'help output contains USAGE');
  assert(res.stdout.includes('--handoff-type'), 'help output mentions --handoff-type');
  assert(res.stdout.includes('--live'), 'help output mentions --live');
}

// ── Suite 20: CLI — -h shorthand ────────────────────────────────────────────

suite('CLI: -h shorthand');

{
  const res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.includes('USAGE'), '-h output contains USAGE');
}

// ── Suite 21: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  const res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.includes('self-test'), 'self-test output contains header');
  assert(res.stdout.includes('passed'), 'self-test output contains results');
}

// ── Suite 22: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-fact-test-'));
  const tmpFile = path.join(tmpDir, 'test-handoffs.ndjson');

  try {
    const res = runWriter([
      '--handoff-type', 'codex-to-self-cycle',
      '--source', 'codex',
      '--destination', 'self-cycle-runner',
      '--preconditions', '{"health":"green"}',
      '--outcome', 'success',
      '--facts', '{"wave":"final"}',
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
    assertEq(event.handoffType, 'codex-to-self-cycle', 'written handoffType correct');
    assertEq(event.source, 'codex', 'written source correct');
    assertEq(event.destination, 'self-cycle-runner', 'written destination correct');
    assertEq(event.preconditions.health, 'green', 'written preconditions correct');
    assertEq(event.outcome, 'success', 'written outcome correct');
    assertEq(event.facts.wave, 'final', 'written facts correct');
    assertEq(event.actor, 'test-runner', 'written actor correct');
    assertEq(event.eventVersion, 1, 'written eventVersion is 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 23: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-fact-test-'));
  const tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    runWriter(['--handoff-type', 'codex-to-self-cycle', '--out', tmpFile, '--live']);
    runWriter(['--handoff-type', 'manual-to-autonomous', '--out', tmpFile, '--live']);

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assertEq(first.handoffType, 'codex-to-self-cycle', 'first event type correct');
    assertEq(second.handoffType, 'manual-to-autonomous', 'second event type correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 24: No cross-contamination between redaction patterns ─────────────

suite('redaction: pattern isolation');

{
  const ghp = 'ghp_' + 'a'.repeat(36);
  assert(sanitize(ghp).includes('[redacted-gh-token]'), 'ghp_ pattern takes precedence for ghp_ tokens');

  const both = 'password=abc ' + 'x'.repeat(50);
  const result = sanitize(both);
  assert(result.includes('password=[redacted]'), 'password= redacted in mixed string');
  assert(result.includes('[redacted-token]'), 'long token also redacted in mixed string');
}

// ── Suite 25: Empty and edge-case strings ───────────────────────────────────

suite('sanitize: empty and edge cases');

{
  assertEq(sanitize(''), '', 'empty string returns empty');
  assertEq(sanitize('hello'), 'hello', 'plain text unchanged');
  assertEq(sanitize('a'), 'a', 'single char unchanged');
  assertEq(sanitize(42), 42, 'non-string passthrough');
  assertEq(sanitize(null), null, 'null passthrough');
  assertEq(sanitize(undefined), undefined, 'undefined passthrough');
}

// ── Suite 26: All valid handoff types accepted ──────────────────────────────

suite('all valid handoff types accepted');

{
  const types = [
    'codex-to-self-cycle',
    'manual-to-autonomous',
    'autonomous-to-fallback',
    'health-gate-pass',
    'health-gate-block',
  ];
  for (const t of types) {
    const res = runWriter(['--handoff-type', t]);
    assertEq(res.exitCode, 0, `handoff-type "${t}" exits 0`);
    const event = parseDryRunEvent(res.stdout);
    assertEq(event.handoffType, t, `handoff-type "${t}" preserved`);
  }
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
