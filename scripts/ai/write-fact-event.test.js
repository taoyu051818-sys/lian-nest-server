#!/usr/bin/env node

/**
 * write-fact-event.test.js
 *
 * Focused self-tests for the fact event writer.
 * Covers: dry-run shape, append shape, secret redaction boundaries, CLI arg handling.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level redaction tests.
 *
 * Usage:
 *   node scripts/ai/write-fact-event.test.js
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

const WRITER = path.join(__dirname, 'write-fact-event.js');
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
  // The dry-run output includes a line that is the raw JSON event
  const lines = stdout.split('\n');
  const jsonLine = lines.find((l) => l.startsWith('{'));
  if (!jsonLine) return null;
  return JSON.parse(jsonLine);
}

// ── Extract sanitize for unit tests ─────────────────────────────────────────
// We re-implement the exact sanitize logic from write-fact-event.js to test
// redaction boundaries in isolation without spawning processes.

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

console.log('write-fact-event.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run event shape ────────────────────────────────────────────

suite('dry-run event shape');

{
  const res = runWriter(['--type', 'test.dryrun', '--subject', 'shape-check']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(event !== null, 'dry-run output contains valid JSON');
  assertEq(event.eventVersion, 1, 'eventVersion is 1');
  assertEq(event.eventType, 'test.dryrun', 'eventType matches input');
  assertEq(event.subject, 'shape-check', 'subject matches input');
  assert(typeof event.capturedAt === 'string' && event.capturedAt.includes('T'), 'capturedAt is ISO-8601');
  assert(event.capturedAt.endsWith('Z'), 'capturedAt ends with Z (UTC)');
}

// ── Suite 2: Dry-run with facts ─────────────────────────────────────────────

suite('dry-run with facts');

{
  const res = runWriter(['--type', 'test.facts', '--facts', '{"check":"tsc","severity":"red"}']);
  assertEq(res.exitCode, 0, 'dry-run with facts exits 0');

  const event = parseDryRunEvent(res.stdout);
  assert(event !== null, 'output contains valid JSON');
  assertEq(event.facts.check, 'tsc', 'facts.check preserved');
  assertEq(event.facts.severity, 'red', 'facts.severity preserved');
}

// ── Suite 3: Dry-run minimal event (null optionals) ─────────────────────────

suite('dry-run minimal event');

{
  const res = runWriter(['--type', 'minimal.event']);
  assertEq(res.exitCode, 0, 'minimal event exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.subject, null, 'subject defaults to null');
  assertEq(event.facts, null, 'facts defaults to null');
  assertEq(event.actor, null, 'actor defaults to null');
}

// ── Suite 4: Dry-run with actor ─────────────────────────────────────────────

suite('dry-run with actor');

{
  const res = runWriter(['--type', 'test.actor', '--actor', 'batch-launcher']);
  assertEq(res.exitCode, 0, 'dry-run with actor exits 0');

  const event = parseDryRunEvent(res.stdout);
  assertEq(event.actor, 'batch-launcher', 'actor preserved');
}

// ── Suite 5: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  const res = runWriter(['--type', 'test.markers']);
  assert(res.stdout.includes('DRY RUN'), 'output contains DRY RUN marker');
  assert(res.stdout.includes('No file was modified'), 'output confirms no file modified');
}

// ── Suite 6: Secret redaction — GitHub tokens ───────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  // ghp_ + 40 alphanum chars: base64 regex (40+ alphanum) runs first on the trailing chars
  assertEq(sanitize('ghp_' + 'a'.repeat(40)), 'ghp_[redacted-token]', 'long ghp_ gets base64 redaction first');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 7: Secret redaction — Bearer tokens ───────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
  assertEq(sanitize('BEARER xyz'), 'Bearer [redacted]', 'BEARER (uppercase) redacted');
  assertEq(sanitize('prefix Bearer tok123 end'), 'prefix Bearer [redacted] end', 'Bearer redacted mid-string');
}

// ── Suite 8: Secret redaction — base64-like strings ─────────────────────────

suite('redaction: base64-like strings (40+ chars)');

{
  assertEq(sanitize('a'.repeat(40)), '[redacted-token]', 'exactly 40 chars redacted');
  assertEq(sanitize('a'.repeat(50)), '[redacted-token]', '50 chars redacted');
  assertEq(sanitize('a'.repeat(39)), 'a'.repeat(39), '39 chars NOT redacted (below threshold)');
  assertEq(sanitize('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop'), '[redacted-token]', 'mixed-case base64 redacted (42 chars)');
  assertEq(sanitize('abc+/==defghiABCDEFGHIJKLmnopqrst0123456789xyz'), '[redacted-token]', 'base64 with special chars redacted');
}

// ── Suite 9: Secret redaction — password/secret/token key=value ─────────────

suite('redaction: password/secret/token key=value');

{
  assertEq(sanitize('password=hunter2'), 'password=[redacted]', 'password= redacted');
  assertEq(sanitize('secret: mysecret'), 'secret=[redacted]', 'secret: redacted');
  assertEq(sanitize('token=abc123'), 'token=[redacted]', 'token= redacted');
  assertEq(sanitize('password: xyz'), 'password=[redacted]', 'password: redacted');
  assertEq(sanitize('SECRET=CAPS'), 'secret=[redacted]', 'SECRET= (case-insensitive) redacted');
}

// ── Suite 10: Secret redaction — integration via CLI ────────────────────────

suite('redaction: integration via dry-run');

{
  const res = runWriter([
    '--type', 'test.redact',
    '--subject', 'ghp_leaked_token_here',
    '--facts', '{"msg":"Bearer secret123","safe":"ok"}',
    '--actor', 'ghp_actor_token',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  const event = parseDryRunEvent(res.stdout);
  // ghp_ regex matches ghp_ + alphanum; stops at underscores
  assertEq(event.subject, '[redacted-gh-token]_token_here', 'subject ghp_ prefix redacted in output');
  assertEq(event.facts.msg, 'Bearer [redacted]', 'facts Bearer redacted in output');
  assertEq(event.facts.safe, 'ok', 'non-secret facts preserved');
  assertEq(event.actor, '[redacted-gh-token]_token', 'actor ghp_ prefix redacted in output');
}

// ── Suite 11: sanitizeFacts preserves non-string types ──────────────────────

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

// ── Suite 12: sanitizeFacts with null/undefined input ───────────────────────

suite('sanitizeFacts: null/undefined handling');

{
  assertEq(sanitizeFacts(null), null, 'null input returns null');
  assertEq(sanitizeFacts(undefined), undefined, 'undefined input returns undefined');
}

// ── Suite 13: Truncation boundary ───────────────────────────────────────────

suite('sanitize: truncation at 500 chars');

{
  // Use hyphens every 30 chars to prevent base64 pattern from matching
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

// ── Suite 14: CLI argument handling — missing type ──────────────────────────

suite('CLI: missing --type');

{
  const res = runWriter([], { stdio: ['pipe', 'pipe', 'pipe'] });
  // Without --type, the script should exit 2 (but we pass --dry-run implicitly)
  // Actually the script prints help for --self-test and then falls through.
  // Let's test explicitly without type and without self-test/help.
  const res2 = runWriter(['--dry-run']);
  assertEq(res2.exitCode, 2, 'missing --type exits 2');
  assert(res2.stderr.includes('--type is required'), 'error message mentions --type');
}

// ── Suite 15: CLI argument handling — unknown argument ──────────────────────

suite('CLI: unknown argument');

{
  const res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.includes('Unknown argument'), 'error message mentions unknown argument');
}

// ── Suite 16: CLI argument handling — invalid JSON facts ────────────────────

suite('CLI: invalid --facts JSON');

{
  const res = runWriter(['--type', 'test', '--facts', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON facts exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 17: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  const res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.includes('USAGE'), 'help output contains USAGE');
  assert(res.stdout.includes('--type'), 'help output mentions --type');
  assert(res.stdout.includes('--live'), 'help output mentions --live');
}

// ── Suite 18: CLI — -h shorthand ────────────────────────────────────────────

suite('CLI: -h shorthand');

{
  const res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.includes('USAGE'), '-h output contains USAGE');
}

// ── Suite 19: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  const res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.includes('self-test'), 'self-test output contains header');
  assert(res.stdout.includes('passed'), 'self-test output contains results');
}

// ── Suite 20: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-event-test-'));
  const tmpFile = path.join(tmpDir, 'test-events.ndjson');

  try {
    const res = runWriter([
      '--type', 'test.live',
      '--subject', 'temp-write',
      '--facts', '{"env":"test"}',
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
    assertEq(event.eventType, 'test.live', 'written eventType correct');
    assertEq(event.subject, 'temp-write', 'written subject correct');
    assertEq(event.facts.env, 'test', 'written facts correct');
    assertEq(event.actor, 'test-runner', 'written actor correct');
    assertEq(event.eventVersion, 1, 'written eventVersion is 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 21: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-event-test-'));
  const tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    // Write first event
    runWriter(['--type', 'first', '--out', tmpFile, '--live']);
    // Write second event
    runWriter(['--type', 'second', '--out', tmpFile, '--live']);

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assertEq(first.eventType, 'first', 'first event type correct');
    assertEq(second.eventType, 'second', 'second event type correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 22: No cross-contamination between redaction patterns ─────────────

suite('redaction: pattern isolation');

{
  // A string that looks like base64 but also contains ghp_ should get ghp_ first
  const ghp = 'ghp_' + 'a'.repeat(36);
  assert(sanitize(ghp).includes('[redacted-gh-token]'), 'ghp_ pattern takes precedence for ghp_ tokens');

  // A string with both password= and a long token
  const both = 'password=abc ' + 'x'.repeat(50);
  const result = sanitize(both);
  assert(result.includes('password=[redacted]'), 'password= redacted in mixed string');
  assert(result.includes('[redacted-token]'), 'long token also redacted in mixed string');
}

// ── Suite 23: Empty and edge-case strings ───────────────────────────────────

suite('sanitize: empty and edge cases');

{
  assertEq(sanitize(''), '', 'empty string returns empty');
  assertEq(sanitize('hello'), 'hello', 'plain text unchanged');
  assertEq(sanitize('a'), 'a', 'single char unchanged');
  assertEq(sanitize(42), 42, 'non-string passthrough');
  assertEq(sanitize(null), null, 'null passthrough');
  assertEq(sanitize(undefined), undefined, 'undefined passthrough');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
