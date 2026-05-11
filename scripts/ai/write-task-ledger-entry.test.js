#!/usr/bin/env node

/**
 * write-task-ledger-entry.test.js
 *
 * Focused self-tests for the task ledger entry writer.
 * Covers: dry-run shape, append shape, validation, CLI arg handling,
 * structured objects (facts, validation, gate), sanitization, and all event types.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation.
 *
 * Usage:
 *   node scripts/ai/write-task-ledger-entry.test.js
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

const WRITER = path.join(__dirname, 'write-task-ledger-entry.js');
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
  if (!allArgs.includes('--dry-run') && !allArgs.includes('--live') && !allArgs.includes('--self-test') && !allArgs.includes('--help') && !allArgs.includes('-h')) {
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

function parseDryRunEntry(stdout) {
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

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('write-task-ledger-entry.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run entry shape ────────────────────────────────────────────

suite('dry-run entry shape');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.launch', '--desc', 'shape-check']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assert(entry !== null, 'dry-run output contains valid JSON');
  assertEq(entry.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(entry.taskId, 'test-001', 'taskId matches input');
  assertEq(entry.eventType, 'task.launch', 'eventType matches input');
  assert(typeof entry.recordedAt === 'string' && entry.recordedAt.includes('T'), 'recordedAt is ISO-8601');
  assert(entry.recordedAt.endsWith('Z'), 'recordedAt ends with Z (UTC)');
  assertEq(entry.description, 'shape-check', 'description matches input');
}

// ── Suite 2: Dry-run with all optional fields ──────────────────────────────

suite('dry-run with all optional fields');

{
  const res = runWriter([
    '--task-id', 'full-001',
    '--event-type', 'task.complete',
    '--issue', '588',
    '--pr', '590',
    '--branch', 'claude/wave16-test',
    '--task-type', 'execution',
    '--actor-role', 'worker',
    '--pm-phase', 'wave16',
    '--severity', 'info',
    '--desc', 'Completed',
    '--meta', '{"key":"value"}',
  ]);
  assertEq(res.exitCode, 0, 'full entry exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assertEq(entry.issueNumber, 588, 'issueNumber preserved');
  assertEq(entry.prNumber, 590, 'prNumber preserved');
  assertEq(entry.branch, 'claude/wave16-test', 'branch preserved');
  assertEq(entry.taskType, 'execution', 'taskType preserved');
  assertEq(entry.actorRole, 'worker', 'actorRole preserved');
  assertEq(entry.pmPhase, 'wave16', 'pmPhase preserved');
  assertEq(entry.severity, 'info', 'severity preserved');
  assertEq(entry.description, 'Completed', 'description preserved');
  assertEq(entry.meta.key, 'value', 'meta preserved');
}

// ── Suite 3: Dry-run minimal entry (null optionals) ─────────────────────────

suite('dry-run minimal entry');

{
  const res = runWriter(['--task-id', 'min-001', '--event-type', 'task.complete']);
  assertEq(res.exitCode, 0, 'minimal entry exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assertEq(entry.issueNumber, null, 'issueNumber defaults to null');
  assertEq(entry.prNumber, null, 'prNumber defaults to null');
  assertEq(entry.branch, null, 'branch defaults to null');
  assertEq(entry.taskType, null, 'taskType defaults to null');
  assertEq(entry.actorRole, null, 'actorRole defaults to null');
  assertEq(entry.pmPhase, null, 'pmPhase defaults to null');
  assertEq(entry.severity, null, 'severity defaults to null');
  assertEq(entry.description, null, 'description defaults to null');
  assertEq(entry.facts, null, 'facts defaults to null');
  assertEq(entry.validation, null, 'validation defaults to null');
  assertEq(entry.gate, null, 'gate defaults to null');
  assertEq(entry.meta, null, 'meta defaults to null');
}

// ── Suite 4: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  const res = runWriter(['--task-id', 'marker-001', '--event-type', 'task.launch']);
  assert(res.stdout.includes('DRY RUN'), 'output contains DRY RUN marker');
  assert(res.stdout.includes('No file was modified'), 'output confirms no file modified');
}

// ── Suite 5: Facts object — produced ────────────────────────────────────────

suite('facts object: produced');

{
  const res = runWriter([
    '--task-id', 'fact-001',
    '--event-type', 'fact.produced',
    '--facts', '{"produced":[{"factId":"fact:schema:task-ledger","description":"Schema created","confidence":"definite"}]}',
  ]);
  assertEq(res.exitCode, 0, 'fact.produced exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assert(entry.facts !== null, 'facts present');
  assert(entry.facts.produced !== undefined, 'facts.produced present');
  assertEq(entry.facts.produced.length, 1, 'one produced fact');
  assertEq(entry.facts.produced[0].factId, 'fact:schema:task-ledger', 'produced factId preserved');
  assertEq(entry.facts.produced[0].description, 'Schema created', 'produced description preserved');
  assertEq(entry.facts.produced[0].confidence, 'definite', 'produced confidence preserved');
}

// ── Suite 6: Facts object — consumed ────────────────────────────────────────

suite('facts object: consumed');

{
  const res = runWriter([
    '--task-id', 'fact-002',
    '--event-type', 'fact.consumed',
    '--facts', '{"consumed":[{"factId":"fact:prisma:BaseModels","source":"issue #400"}]}',
  ]);
  assertEq(res.exitCode, 0, 'fact.consumed exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assert(entry.facts !== null, 'facts present');
  assert(entry.facts.consumed !== undefined, 'facts.consumed present');
  assertEq(entry.facts.consumed.length, 1, 'one consumed fact');
  assertEq(entry.facts.consumed[0].factId, 'fact:prisma:BaseModels', 'consumed factId preserved');
  assertEq(entry.facts.consumed[0].source, 'issue #400', 'consumed source preserved');
}

// ── Suite 7: Validation object ───────────────────────────────────────────────

suite('validation object');

{
  const res = runWriter([
    '--task-id', 'val-001',
    '--event-type', 'validation.pass',
    '--validation', '{"command":"npm run check","exitCode":0,"durationMs":12000}',
  ]);
  assertEq(res.exitCode, 0, 'validation.pass exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assert(entry.validation !== null, 'validation present');
  assertEq(entry.validation.command, 'npm run check', 'validation command preserved');
  assertEq(entry.validation.exitCode, 0, 'validation exitCode preserved');
  assertEq(entry.validation.durationMs, 12000, 'validation durationMs preserved');
}

// ── Suite 8: Gate object ─────────────────────────────────────────────────────

suite('gate object');

{
  const res = runWriter([
    '--task-id', 'gate-001',
    '--event-type', 'gate.pass',
    '--gate', '{"gateType":"merge","decision":"pass","markerId":"pr-590-merge"}',
  ]);
  assertEq(res.exitCode, 0, 'gate.pass exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assert(entry.gate !== null, 'gate present');
  assertEq(entry.gate.gateType, 'merge', 'gate gateType preserved');
  assertEq(entry.gate.decision, 'pass', 'gate decision preserved');
  assertEq(entry.gate.markerId, 'pr-590-merge', 'gate markerId preserved');
}

// ── Suite 9: All event types accepted ────────────────────────────────────────

suite('all event types accepted');

{
  const types = [
    'task.launch',
    'task.complete',
    'task.fail',
    'task.timeout',
    'task.progress',
    'fact.produced',
    'fact.consumed',
    'validation.pass',
    'validation.fail',
    'gate.pass',
    'gate.block',
  ];

  for (const eventType of types) {
    const res = runWriter(['--task-id', 'evt-001', '--event-type', eventType]);
    assertEq(res.exitCode, 0, `accepts event type "${eventType}"`);

    const entry = parseDryRunEntry(res.stdout);
    assertEq(entry.eventType, eventType, `eventType "${eventType}" preserved`);
  }
}

// ── Suite 10: All task types accepted ────────────────────────────────────────

suite('all task types accepted');

{
  const taskTypes = ['execution', 'research', 'review'];
  for (const taskType of taskTypes) {
    const res = runWriter(['--task-id', 'tt-001', '--event-type', 'task.launch', '--task-type', taskType]);
    assertEq(res.exitCode, 0, `accepts task type "${taskType}"`);

    const entry = parseDryRunEntry(res.stdout);
    assertEq(entry.taskType, taskType, `taskType "${taskType}" preserved`);
  }
}

// ── Suite 11: All severities accepted ────────────────────────────────────────

suite('all severities accepted');

{
  const severities = ['info', 'warning', 'error', 'critical'];
  for (const severity of severities) {
    const res = runWriter(['--task-id', 'sev-001', '--event-type', 'task.fail', '--severity', severity]);
    assertEq(res.exitCode, 0, `accepts severity "${severity}"`);

    const entry = parseDryRunEntry(res.stdout);
    assertEq(entry.severity, severity, `severity "${severity}" preserved`);
  }
}

// ── Suite 12: All gate types accepted ────────────────────────────────────────

suite('all gate types accepted');

{
  const gateTypes = ['launch', 'pr-review', 'merge', 'post-merge-health'];
  for (const gateType of gateTypes) {
    const res = runWriter([
      '--task-id', 'gt-001',
      '--event-type', 'gate.pass',
      '--gate', `{"gateType":"${gateType}","decision":"pass","markerId":"test-marker"}`,
    ]);
    assertEq(res.exitCode, 0, `accepts gate type "${gateType}"`);
  }
}

// ── Suite 13: All gate decisions accepted ────────────────────────────────────

suite('all gate decisions accepted');

{
  const decisions = ['pass', 'block', 'warn', 'override'];
  for (const decision of decisions) {
    const res = runWriter([
      '--task-id', 'gd-001',
      '--event-type', 'gate.block',
      '--gate', `{"gateType":"launch","decision":"${decision}","markerId":"test-marker"}`,
    ]);
    assertEq(res.exitCode, 0, `accepts gate decision "${decision}"`);
  }
}

// ── Suite 14: Validation — missing --task-id ────────────────────────────────

suite('validation: missing --task-id');

{
  const res = runWriter(['--event-type', 'task.launch', '--dry-run']);
  assertEq(res.exitCode, 2, 'missing --task-id exits 2');
  assert(res.stderr.includes('--task-id is required'), 'error message mentions --task-id');
}

// ── Suite 15: Validation — missing --event-type ─────────────────────────────

suite('validation: missing --event-type');

{
  const res = runWriter(['--task-id', 'test-001', '--dry-run']);
  assertEq(res.exitCode, 2, 'missing --event-type exits 2');
  assert(res.stderr.includes('--event-type is required'), 'error message mentions --event-type');
}

// ── Suite 16: Validation — invalid event type ───────────────────────────────

suite('validation: invalid event type');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'not-a-type']);
  assertEq(res.exitCode, 2, 'invalid event type exits 2');
  assert(res.stderr.includes('--event-type must be one of'), 'error message lists valid types');
}

// ── Suite 17: Validation — invalid task type ────────────────────────────────

suite('validation: invalid task type');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.launch', '--task-type', 'invalid']);
  assertEq(res.exitCode, 2, 'invalid task type exits 2');
  assert(res.stderr.includes('--task-type must be one of'), 'error message lists valid task types');
}

// ── Suite 18: Validation — invalid severity ──────────────────────────────────

suite('validation: invalid severity');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.fail', '--severity', 'extreme']);
  assertEq(res.exitCode, 2, 'invalid severity exits 2');
  assert(res.stderr.includes('--severity must be one of'), 'error message lists valid severities');
}

// ── Suite 19: Validation — invalid gate type ────────────────────────────────

suite('validation: invalid gate type');

{
  const res = runWriter([
    '--task-id', 'test-001',
    '--event-type', 'gate.pass',
    '--gate', '{"gateType":"invalid","decision":"pass","markerId":"test"}',
  ]);
  assertEq(res.exitCode, 2, 'invalid gate type exits 2');
  assert(res.stderr.includes('gate.gateType must be one of'), 'error message lists valid gate types');
}

// ── Suite 20: Validation — invalid gate decision ────────────────────────────

suite('validation: invalid gate decision');

{
  const res = runWriter([
    '--task-id', 'test-001',
    '--event-type', 'gate.pass',
    '--gate', '{"gateType":"launch","decision":"invalid","markerId":"test"}',
  ]);
  assertEq(res.exitCode, 2, 'invalid gate decision exits 2');
  assert(res.stderr.includes('gate.decision must be one of'), 'error message lists valid gate decisions');
}

// ── Suite 21: Validation — invalid JSON facts ───────────────────────────────

suite('validation: invalid JSON facts');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'fact.produced', '--facts', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON facts exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 22: Validation — invalid JSON validation ──────────────────────────

suite('validation: invalid JSON validation');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'validation.pass', '--validation', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON validation exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 23: Validation — invalid JSON gate ────────────────────────────────

suite('validation: invalid JSON gate');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'gate.pass', '--gate', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON gate exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 24: Validation — invalid JSON meta ────────────────────────────────

suite('validation: invalid JSON meta');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.launch', '--meta', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON meta exits 2');
  assert(res.stderr.includes('valid JSON'), 'error message mentions JSON');
}

// ── Suite 25: Validation — non-numeric --issue ──────────────────────────────

suite('validation: non-numeric --issue');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.launch', '--issue', 'abc']);
  assertEq(res.exitCode, 2, 'non-numeric --issue exits 2');
  assert(res.stderr.includes('--issue must be a number'), 'error message mentions number');
}

// ── Suite 26: Validation — non-numeric --pr ─────────────────────────────────

suite('validation: non-numeric --pr');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.launch', '--pr', 'xyz']);
  assertEq(res.exitCode, 2, 'non-numeric --pr exits 2');
  assert(res.stderr.includes('--pr must be a number'), 'error message mentions number');
}

// ── Suite 27: Validation — produced not array ───────────────────────────────

suite('validation: facts.produced not array');

{
  const res = runWriter([
    '--task-id', 'test-001',
    '--event-type', 'fact.produced',
    '--facts', '{"produced":"not-array"}',
  ]);
  assertEq(res.exitCode, 2, 'produced not array exits 2');
  assert(res.stderr.includes('produced must be an array'), 'error message mentions array');
}

// ── Suite 28: Validation — consumed not array ───────────────────────────────

suite('validation: facts.consumed not array');

{
  const res = runWriter([
    '--task-id', 'test-001',
    '--event-type', 'fact.consumed',
    '--facts', '{"consumed":"not-array"}',
  ]);
  assertEq(res.exitCode, 2, 'consumed not array exits 2');
  assert(res.stderr.includes('consumed must be an array'), 'error message mentions array');
}

// ── Suite 29: Unknown argument ───────────────────────────────────────────────

suite('unknown argument');

{
  const res = runWriter(['--task-id', 'test-001', '--event-type', 'task.launch', '--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.includes('Unknown argument'), 'error message mentions unknown argument');
}

// ── Suite 30: --help flag ────────────────────────────────────────────────────

suite('--help flag');

{
  const res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.includes('USAGE'), 'help output contains USAGE');
  assert(res.stdout.includes('--task-id'), 'help output mentions --task-id');
  assert(res.stdout.includes('--event-type'), 'help output mentions --event-type');
  assert(res.stdout.includes('--live'), 'help output mentions --live');
}

// ── Suite 31: -h shorthand ──────────────────────────────────────────────────

suite('-h shorthand');

{
  const res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.includes('USAGE'), '-h output contains USAGE');
}

// ── Suite 32: Built-in --self-test passes ───────────────────────────────────

suite('built-in --self-test passes');

{
  const res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.includes('self-test'), 'self-test output contains header');
  assert(res.stdout.includes('passed'), 'self-test output contains results');
}

// ── Suite 33: Secret redaction — GitHub tokens ──────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('ghp_' + 'a'.repeat(40)), 'ghp_[redacted-token]', 'long ghp_ gets base64 redaction first');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 34: Secret redaction — Bearer tokens ──────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
  assertEq(sanitize('BEARER xyz'), 'Bearer [redacted]', 'BEARER (uppercase) redacted');
}

// ── Suite 35: Secret redaction — base64-like strings ────────────────────────

suite('redaction: base64-like strings (40+ chars)');

{
  assertEq(sanitize('a'.repeat(40)), '[redacted-token]', 'exactly 40 chars redacted');
  assertEq(sanitize('a'.repeat(50)), '[redacted-token]', '50 chars redacted');
  assertEq(sanitize('a'.repeat(39)), 'a'.repeat(39), '39 chars NOT redacted (below threshold)');
}

// ── Suite 36: Secret redaction — password/secret/token key=value ────────────

suite('redaction: password/secret/token key=value');

{
  assertEq(sanitize('password=hunter2'), 'password=[redacted]', 'password= redacted');
  assertEq(sanitize('secret: mysecret'), 'secret=[redacted]', 'secret: redacted');
  assertEq(sanitize('token=abc123'), 'token=[redacted]', 'token= redacted');
}

// ── Suite 37: Redaction — integration via dry-run ───────────────────────────

suite('redaction: integration via dry-run');

{
  const res = runWriter([
    '--task-id', 'ghp_leaked_task',
    '--event-type', 'task.launch',
    '--desc', 'Bearer secret123',
    '--branch', 'ghp_branch_token',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assertEq(entry.taskId, '[redacted-gh-token]_task', 'taskId ghp_ prefix redacted');
  assertEq(entry.description, 'Bearer [redacted]', 'description Bearer redacted');
  assertEq(entry.branch, '[redacted-gh-token]_token', 'branch ghp_ prefix redacted');
}

// ── Suite 38: Sanitization in facts via CLI ─────────────────────────────────

suite('redaction: facts via CLI');

{
  const res = runWriter([
    '--task-id', 'fact-redact-001',
    '--event-type', 'fact.produced',
    '--facts', '{"produced":[{"factId":"ghp_fact","description":"Bearer tok123","confidence":"definite"}],"consumed":[{"factId":"fact:ok","source":"ghp_src"}]}',
  ]);
  assertEq(res.exitCode, 0, 'fact redaction exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assertEq(entry.facts.produced[0].factId, '[redacted-gh-token]', 'produced factId redacted');
  assertEq(entry.facts.produced[0].description, 'Bearer [redacted]', 'produced description redacted');
  assertEq(entry.facts.consumed[0].factId, 'fact:ok', 'consumed factId preserved');
  assertEq(entry.facts.consumed[0].source, '[redacted-gh-token]', 'consumed source redacted');
}

// ── Suite 39: Sanitization in validation via CLI ────────────────────────────

suite('redaction: validation via CLI');

{
  const res = runWriter([
    '--task-id', 'val-redact-001',
    '--event-type', 'validation.pass',
    '--validation', '{"command":"Bearer secret-token","exitCode":0}',
  ]);
  assertEq(res.exitCode, 0, 'validation redaction exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assertEq(entry.validation.command, 'Bearer [redacted]', 'validation command redacted');
  assertEq(entry.validation.exitCode, 0, 'validation exitCode preserved');
}

// ── Suite 40: Sanitization in gate via CLI ──────────────────────────────────

suite('redaction: gate markerId via CLI');

{
  const res = runWriter([
    '--task-id', 'gate-redact-001',
    '--event-type', 'gate.pass',
    '--gate', '{"gateType":"launch","decision":"pass","markerId":"ghp_marker123"}',
  ]);
  assertEq(res.exitCode, 0, 'gate redaction exits 0');

  const entry = parseDryRunEntry(res.stdout);
  assertEq(entry.gate.markerId, '[redacted-gh-token]', 'gate markerId redacted');
  assertEq(entry.gate.gateType, 'launch', 'gate gateType preserved');
  assertEq(entry.gate.decision, 'pass', 'gate decision preserved');
}

// ── Suite 41: Truncation boundary ───────────────────────────────────────────

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

// ── Suite 42: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ledger-test-'));
  const tmpFile = path.join(tmpDir, 'test-ledger.ndjson');

  try {
    const res = runWriter([
      '--task-id', 'live-001',
      '--event-type', 'task.launch',
      '--desc', 'temp-write',
      '--issue', '588',
      '--task-type', 'execution',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(fs.existsSync(tmpFile), 'output file created');

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 1, 'exactly one NDJSON line written');

    const entry = JSON.parse(lines[0]);
    assertEq(entry.schemaVersion, 1, 'written schemaVersion is 1');
    assertEq(entry.taskId, 'live-001', 'written taskId correct');
    assertEq(entry.eventType, 'task.launch', 'written eventType correct');
    assertEq(entry.description, 'temp-write', 'written description correct');
    assertEq(entry.issueNumber, 588, 'written issueNumber correct');
    assertEq(entry.taskType, 'execution', 'written taskType correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 43: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ledger-test-'));
  const tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    runWriter(['--task-id', 'first', '--event-type', 'task.launch', '--out', tmpFile, '--live']);
    runWriter(['--task-id', 'second', '--event-type', 'task.complete', '--out', tmpFile, '--live']);

    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assertEq(first.taskId, 'first', 'first entry taskId correct');
    assertEq(first.eventType, 'task.launch', 'first entry eventType correct');
    assertEq(second.taskId, 'second', 'second entry taskId correct');
    assertEq(second.eventType, 'task.complete', 'second entry eventType correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 44: Live write with structured objects ────────────────────────────

suite('live write with structured objects');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ledger-test-'));
  const tmpFile = path.join(tmpDir, 'structured-test.ndjson');

  try {
    const res = runWriter([
      '--task-id', 'struct-001',
      '--event-type', 'task.complete',
      '--facts', '{"produced":[{"factId":"fact:test","description":"test fact","confidence":"definite"}],"consumed":[{"factId":"fact:dep","source":"issue #1"}]}',
      '--validation', '{"command":"npm test","exitCode":0,"durationMs":5000}',
      '--gate', '{"gateType":"pr-review","decision":"pass","markerId":"pr-590-review"}',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'structured write exits 0');

    const entry = JSON.parse(fs.readFileSync(tmpFile, 'utf8').trim());
    assertEq(entry.facts.produced[0].factId, 'fact:test', 'written factId correct');
    assertEq(entry.facts.consumed[0].source, 'issue #1', 'written consumed source correct');
    assertEq(entry.validation.command, 'npm test', 'written validation command correct');
    assertEq(entry.gate.gateType, 'pr-review', 'written gate type correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 45: Empty and edge-case strings ───────────────────────────────────

suite('sanitize: empty and edge cases');

{
  assertEq(sanitize(''), '', 'empty string returns empty');
  assertEq(sanitize('hello'), 'hello', 'plain text unchanged');
  assertEq(sanitize('a'), 'a', 'single char unchanged');
  assertEq(sanitize(42), 42, 'non-string passthrough');
  assertEq(sanitize(null), null, 'null passthrough');
  assertEq(sanitize(undefined), undefined, 'undefined passthrough');
}

// ── Suite 46: Missing --task-id value ───────────────────────────────────────

suite('CLI: --task-id without value');

{
  const res = runWriter(['--task-id'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, '--task-id without value exits 2');
}

// ── Suite 47: Missing --event-type value ────────────────────────────────────

suite('CLI: --event-type without value');

{
  const res = runWriter(['--task-id', 'test', '--event-type'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, '--event-type without value exits 2');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
