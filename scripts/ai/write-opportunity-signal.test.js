#!/usr/bin/env node

/**
 * write-opportunity-signal.test.js
 *
 * Focused self-tests for the opportunity signal writer.
 * Covers: dry-run shape, append shape, secret redaction boundaries, CLI arg handling.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level redaction tests.
 *
 * Usage:
 *   node scripts/ai/write-opportunity-signal.test.js
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

const WRITER = path.join(__dirname, 'write-opportunity-signal.js');
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

function parseDryRunSignal(stdout) {
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
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((v) => (typeof v === 'string' ? sanitize(v) : v));
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('write-opportunity-signal.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run signal shape ───────────────────────────────────────────

suite('dry-run signal shape');

{
  const res = runWriter(['--signalId', 'opp-test123', '--status', 'draft']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assert(sig !== null, 'dry-run output contains valid JSON');
  assertEq(sig.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(sig.signalId, 'opp-test123', 'signalId matches input');
  assertEq(sig.status, 'draft', 'status matches input');
  assert(typeof sig.createdAt === 'string' && sig.createdAt.includes('T'), 'createdAt is ISO-8601');
  assert(sig.createdAt.endsWith('Z'), 'createdAt ends with Z (UTC)');
  assertEq(sig.promotedTaskId, null, 'promotedTaskId is null');
  assertEq(sig.rejectionReason, null, 'rejectionReason is null');
}

// ── Suite 2: Dry-run with hypothesis ────────────────────────────────────────

suite('dry-run with hypothesis');

{
  const hypothesis = JSON.stringify({ claim: 'test claim', reasoning: 'evidence suggests' });
  const res = runWriter(['--signalId', 'opp-hyp', '--hypothesis', hypothesis]);
  assertEq(res.exitCode, 0, 'dry-run with hypothesis exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assert(sig !== null, 'output contains valid JSON');
  assertEq(sig.hypothesis.claim, 'test claim', 'hypothesis.claim preserved');
  assertEq(sig.hypothesis.reasoning, 'evidence suggests', 'hypothesis.reasoning preserved');
}

// ── Suite 3: Dry-run minimal signal (null optionals) ────────────────────────

suite('dry-run minimal signal');

{
  const res = runWriter(['--signalId', 'opp-min']);
  assertEq(res.exitCode, 0, 'minimal signal exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.status, 'draft', 'status defaults to draft');
  assert(Array.isArray(sig.sourceFacts) && sig.sourceFacts.length === 0, 'sourceFacts defaults to empty');
  assertEq(sig.hypothesis, null, 'hypothesis defaults to null');
  assertEq(sig.experiment, null, 'experiment defaults to null');
  assertEq(sig.risk, null, 'risk defaults to null');
  assert(Array.isArray(sig.tags) && sig.tags.length === 0, 'tags defaults to empty');
}

// ── Suite 4: Dry-run with tags ──────────────────────────────────────────────

suite('dry-run with tags');

{
  const res = runWriter(['--signalId', 'opp-tags', '--tags', '["performance","api"]']);
  assertEq(res.exitCode, 0, 'dry-run with tags exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.tags[0], 'performance', 'first tag preserved');
  assertEq(sig.tags[1], 'api', 'second tag preserved');
}

// ── Suite 5: Dry-run with sourceFacts ───────────────────────────────────────

suite('dry-run with sourceFacts');

{
  const facts = JSON.stringify([{ factId: 'fact:test:one', description: 'test', source: 'test-src' }]);
  const res = runWriter(['--signalId', 'opp-facts', '--sourceFacts', facts]);
  assertEq(res.exitCode, 0, 'dry-run with sourceFacts exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.sourceFacts[0].factId, 'fact:test:one', 'factId preserved');
  assertEq(sig.sourceFacts[0].description, 'test', 'description preserved');
  assertEq(sig.sourceFacts[0].source, 'test-src', 'source preserved');
}

// ── Suite 6: Dry-run with experiment ────────────────────────────────────────

suite('dry-run with experiment');

{
  const experiment = JSON.stringify({
    type: 'code-change',
    description: 'add caching',
    scope: 'single endpoint',
    successCriteria: ['latency drops'],
  });
  const res = runWriter(['--signalId', 'opp-exp', '--experiment', experiment]);
  assertEq(res.exitCode, 0, 'dry-run with experiment exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.experiment.type, 'code-change', 'experiment.type preserved');
  assertEq(sig.experiment.scope, 'single endpoint', 'experiment.scope preserved');
  assertEq(sig.experiment.successCriteria[0], 'latency drops', 'successCriteria preserved');
}

// ── Suite 7: Dry-run with risk ──────────────────────────────────────────────

suite('dry-run with risk');

{
  const risk = JSON.stringify({ level: 'medium', concerns: ['cache staleness'] });
  const res = runWriter(['--signalId', 'opp-risk', '--risk', risk]);
  assertEq(res.exitCode, 0, 'dry-run with risk exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.risk.level, 'medium', 'risk.level preserved');
  assertEq(sig.risk.concerns[0], 'cache staleness', 'risk.concerns preserved');
}

// ── Suite 8: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  const res = runWriter(['--signalId', 'opp-markers']);
  assert(res.stdout.includes('DRY RUN'), 'output contains DRY RUN marker');
  assert(res.stdout.includes('No file was modified'), 'output confirms no file modified');
}

// ── Suite 9: Secret redaction — GitHub tokens ───────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('ghp_' + 'a'.repeat(40)), 'ghp_[redacted-token]', 'long ghp_ gets base64 redaction first');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 10: Secret redaction — Bearer tokens ──────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
  assertEq(sanitize('BEARER xyz'), 'Bearer [redacted]', 'BEARER (uppercase) redacted');
  assertEq(sanitize('prefix Bearer tok123 end'), 'prefix Bearer [redacted] end', 'Bearer redacted mid-string');
}

// ── Suite 11: Secret redaction — base64-like strings ────────────────────────

suite('redaction: base64-like strings (40+ chars)');

{
  assertEq(sanitize('a'.repeat(40)), '[redacted-token]', 'exactly 40 chars redacted');
  assertEq(sanitize('a'.repeat(50)), '[redacted-token]', '50 chars redacted');
  assertEq(sanitize('a'.repeat(39)), 'a'.repeat(39), '39 chars NOT redacted (below threshold)');
}

// ── Suite 12: Secret redaction — password/secret/token key=value ────────────

suite('redaction: password/secret/token key=value');

{
  assertEq(sanitize('password=hunter2'), 'password=[redacted]', 'password= redacted');
  assertEq(sanitize('secret: mysecret'), 'secret=[redacted]', 'secret: redacted');
  assertEq(sanitize('token=abc123'), 'token=[redacted]', 'token= redacted');
  assertEq(sanitize('SECRET=CAPS'), 'secret=[redacted]', 'SECRET= (case-insensitive) redacted');
}

// ── Suite 13: Secret redaction — integration via CLI ────────────────────────

suite('redaction: integration via dry-run');

{
  const hypothesis = JSON.stringify({ claim: 'ghp_leaked_here', reasoning: 'Bearer secret123' });
  const res = runWriter(['--signalId', 'opp-redact', '--hypothesis', hypothesis]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.hypothesis.claim, '[redacted-gh-token]_here', 'hypothesis claim ghp_ redacted');
  assertEq(sig.hypothesis.reasoning, 'Bearer [redacted]', 'hypothesis reasoning Bearer redacted');
}

// ── Suite 14: sanitizeObject handles nested structures ──────────────────────

suite('sanitizeObject: nested structures');

{
  const input = {
    claim: 'ghp_leaked',
    nested: { inner: 'Bearer secret' },
    arr: ['ghp_arr', 'safe'],
    num: 42,
    bool: true,
    nil: null,
  };
  const result = sanitizeObject(input);
  assertEq(result.claim, '[redacted-gh-token]', 'top-level string redacted');
  assertEq(result.nested.inner, 'Bearer [redacted]', 'nested string redacted');
  assertEq(result.arr[0], '[redacted-gh-token]', 'array string redacted');
  assertEq(result.arr[1], 'safe', 'array clean string preserved');
  assertEq(result.num, 42, 'number preserved');
  assertEq(result.bool, true, 'boolean preserved');
  assertEq(result.nil, null, 'null preserved');
}

// ── Suite 15: sanitizeObject with null/undefined ────────────────────────────

suite('sanitizeObject: null/undefined handling');

{
  assertEq(sanitizeObject(null), null, 'null input returns null');
  assertEq(sanitizeObject(undefined), undefined, 'undefined input returns undefined');
}

// ── Suite 16: Truncation boundary ───────────────────────────────────────────

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

// ── Suite 17: CLI — missing signalId ────────────────────────────────────────

suite('CLI: missing --signalId');

{
  const res = runWriter(['--dry-run']);
  assertEq(res.exitCode, 2, 'missing --signalId exits 2');
  assert(res.stderr.includes('--signalId is required'), 'error message mentions --signalId');
}

// ── Suite 18: CLI — unknown argument ────────────────────────────────────────

suite('CLI: unknown argument');

{
  const res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.includes('Unknown argument'), 'error message mentions unknown argument');
}

// ── Suite 19: CLI — invalid JSON hypothesis ─────────────────────────────────

suite('CLI: invalid --hypothesis JSON');

{
  const res = runWriter(['--signalId', 'opp-x', '--hypothesis', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON hypothesis exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 20: CLI — invalid signalId format ─────────────────────────────────

suite('CLI: invalid --signalId format');

{
  const res = runWriter(['--signalId', 'bad-format']);
  assertEq(res.exitCode, 2, 'invalid signalId format exits 2');
  assert(res.stderr.includes('opp-<identifier>'), 'error message mentions opp- format');
}

// ── Suite 21: CLI — invalid status ──────────────────────────────────────────

suite('CLI: invalid --status');

{
  const res = runWriter(['--signalId', 'opp-x', '--status', 'bogus']);
  assertEq(res.exitCode, 2, 'invalid status exits 2');
  assert(res.stderr.includes('draft'), 'error message mentions valid statuses');
}

// ── Suite 22: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  const res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.includes('USAGE'), 'help output contains USAGE');
  assert(res.stdout.includes('--signalId'), 'help output mentions --signalId');
  assert(res.stdout.includes('--live'), 'help output mentions --live');
}

// ── Suite 23: CLI — -h shorthand ────────────────────────────────────────────

suite('CLI: -h shorthand');

{
  const res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.includes('USAGE'), '-h output contains USAGE');
}

// ── Suite 24: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  const res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.includes('self-test'), 'self-test output contains header');
  assert(res.stdout.includes('passed'), 'self-test output contains results');
}

// ── Suite 25: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-signal-test-'));
  const tmpFile = path.join(tmpDir, 'test-signals.ndjson');

  try {
    const hypothesis = JSON.stringify({ claim: 'test', reasoning: 'because' });
    const res = runWriter([
      '--signalId', 'opp-live1',
      '--status', 'draft',
      '--hypothesis', hypothesis,
      '--tags', '["test"]',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(fs.existsSync(tmpFile), 'output file created');

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 1, 'exactly one NDJSON line written');

    const sig = JSON.parse(lines[0]);
    assertEq(sig.signalId, 'opp-live1', 'written signalId correct');
    assertEq(sig.status, 'draft', 'written status correct');
    assertEq(sig.hypothesis.claim, 'test', 'written hypothesis correct');
    assertEq(sig.schemaVersion, 1, 'written schemaVersion is 1');
    assertEq(sig.tags[0], 'test', 'written tags correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 26: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-signal-test-'));
  const tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    runWriter(['--signalId', 'opp-first', '--out', tmpFile, '--live']);
    runWriter(['--signalId', 'opp-second', '--out', tmpFile, '--live']);

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assertEq(first.signalId, 'opp-first', 'first signalId correct');
    assertEq(second.signalId, 'opp-second', 'second signalId correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 27: All valid statuses ────────────────────────────────────────────

suite('all valid statuses accepted');

{
  const statuses = ['draft', 'validated', 'accepted', 'scheduled', 'rejected'];
  for (const status of statuses) {
    const res = runWriter(['--signalId', 'opp-st', '--status', status]);
    assertEq(res.exitCode, 0, `status "${status}" exits 0`);

    const sig = parseDryRunSignal(res.stdout);
    assertEq(sig.status, status, `status "${status}" preserved`);
  }
}

// ── Suite 28: Full signal with all fields ───────────────────────────────────

suite('full signal with all fields');

{
  const res = runWriter([
    '--signalId', 'opp-full',
    '--status', 'validated',
    '--tags', '["perf","db"]',
    '--sourceFacts', JSON.stringify([{ factId: 'fact:perf:spike', description: 'latency spike', source: 'grafana' }]),
    '--hypothesis', JSON.stringify({ claim: 'N+1 query', reasoning: 'query plan shows seq scan' }),
    '--expectedImpact', JSON.stringify({ metric: 'p95', currentValue: '450ms', targetValue: '150ms' }),
    '--experiment', JSON.stringify({ type: 'code-change', description: 'add DataLoader', scope: 'GET /api/users', successCriteria: ['p95 < 200ms'] }),
    '--risk', JSON.stringify({ level: 'medium', concerns: ['stale cache'] }),
    '--acceptanceGate', JSON.stringify({ acceptanceOwner: 'architect', criteria: ['facts verified'] }),
  ]);
  assertEq(res.exitCode, 0, 'full signal exits 0');

  const sig = parseDryRunSignal(res.stdout);
  assertEq(sig.signalId, 'opp-full', 'signalId correct');
  assertEq(sig.status, 'validated', 'status correct');
  assertEq(sig.tags[0], 'perf', 'tags correct');
  assertEq(sig.sourceFacts[0].factId, 'fact:perf:spike', 'sourceFacts correct');
  assertEq(sig.hypothesis.claim, 'N+1 query', 'hypothesis correct');
  assertEq(sig.expectedImpact.metric, 'p95', 'expectedImpact correct');
  assertEq(sig.experiment.type, 'code-change', 'experiment correct');
  assertEq(sig.risk.level, 'medium', 'risk correct');
  assertEq(sig.acceptanceGate.acceptanceOwner, 'architect', 'acceptanceGate correct');
}

// ── Suite 29: Invalid experiment type ───────────────────────────────────────

suite('CLI: invalid experiment type');

{
  const experiment = JSON.stringify({ type: 'bogus', description: 'test', scope: 'test', successCriteria: ['ok'] });
  const res = runWriter(['--signalId', 'opp-exp', '--experiment', experiment]);
  assertEq(res.exitCode, 2, 'invalid experiment type exits 2');
  assert(res.stderr.includes('code-change'), 'error message mentions valid experiment types');
}

// ── Suite 30: Invalid risk level ────────────────────────────────────────────

suite('CLI: invalid risk level');

{
  const risk = JSON.stringify({ level: 'extreme', concerns: ['test'] });
  const res = runWriter(['--signalId', 'opp-rk', '--risk', risk]);
  assertEq(res.exitCode, 2, 'invalid risk level exits 2');
  assert(res.stderr.includes('low'), 'error message mentions valid risk levels');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
