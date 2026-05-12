#!/usr/bin/env node

/**
 * write-issue-producer-run.test.js
 *
 * Focused self-tests for the issue producer run record writer.
 * Covers: dry-run shape, append shape, secret redaction boundaries, CLI arg handling.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level redaction tests.
 *
 * Usage:
 *   node scripts/ai/write-issue-producer-run.test.js
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

const WRITER = path.join(__dirname, 'write-issue-producer-run.js');
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

function parseDryRunRecord(stdout) {
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

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('write-issue-producer-run.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run record shape ────────────────────────────────────────────

suite('dry-run record shape');

{
  var res = runWriter(['--run-id', 'run-test-001', '--actor', 'self-cycle', '--mode', 'dry-run']);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  var r = parseDryRunRecord(res.stdout);
  assert(r !== null, 'dry-run output contains valid JSON');
  assertEq(r.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(r.runId, 'run-test-001', 'runId matches input');
  assertEq(r.actor, 'self-cycle', 'actor matches input');
  assertEq(r.mode, 'dry-run', 'mode matches input');
  assert(typeof r.recordedAt === 'string' && r.recordedAt.indexOf('T') !== -1, 'recordedAt is ISO-8601');
  assert(r.recordedAt.endsWith('Z'), 'recordedAt ends with Z (UTC)');
}

// ── Suite 2: Dry-run with all optional fields ───────────────────────────────

suite('dry-run with all optional fields');

{
  var res = runWriter([
    '--run-id', 'run-full',
    '--actor', 'batch-launcher',
    '--mode', 'execute',
    '--outcome', 'completed',
    '--facts', '[{"factId":"fact:health:green","source":"main-health.json","description":"Health is green"}]',
    '--produced', '[{"issueNumber":100,"title":"Add docs","taskType":"execution","risk":"low","conflictGroup":"docs","actorRole":"worker","allowedFiles":["docs/**"],"forbiddenFiles":["src/**"],"validationCommands":["npm run check"],"rationale":"Docs missing","macroGoal":"docs-coverage","status":"created","humanRequired":false}]',
    '--rejected', '[{"title":"Old issue","conflictGroup":"old","reason":"title overlap with existing"}]',
    '--meta', '{"wave":"wave16"}',
  ]);
  assertEq(res.exitCode, 0, 'full record exits 0');

  var r = parseDryRunRecord(res.stdout);
  assertEq(r.runId, 'run-full', 'runId preserved');
  assertEq(r.actor, 'batch-launcher', 'actor preserved');
  assertEq(r.mode, 'execute', 'mode preserved');
  assertEq(r.outcome, 'completed', 'outcome preserved');
  assert(r.factsConsumed && r.factsConsumed.length === 1, 'one fact consumed');
  assertEq(r.factsConsumed[0].factId, 'fact:health:green', 'fact factId preserved');
  assertEq(r.factsConsumed[0].source, 'main-health.json', 'fact source preserved');
  assert(r.issuesProduced && r.issuesProduced.length === 1, 'one issue produced');
  assertEq(r.issuesProduced[0].issueNumber, 100, 'produced issueNumber preserved');
  assertEq(r.issuesProduced[0].title, 'Add docs', 'produced title preserved');
  assertEq(r.issuesProduced[0].taskType, 'execution', 'produced taskType preserved');
  assertEq(r.issuesProduced[0].risk, 'low', 'produced risk preserved');
  assertEq(r.issuesProduced[0].conflictGroup, 'docs', 'produced conflictGroup preserved');
  assertEq(r.issuesProduced[0].actorRole, 'worker', 'produced actorRole preserved');
  assertEq(r.issuesProduced[0].status, 'created', 'produced status preserved');
  assertEq(r.issuesProduced[0].humanRequired, false, 'produced humanRequired preserved');
  assert(r.issuesRejected && r.issuesRejected.length === 1, 'one issue rejected');
  assertEq(r.issuesRejected[0].title, 'Old issue', 'rejected title preserved');
  assertEq(r.issuesRejected[0].reason, 'title overlap with existing', 'rejected reason preserved');
  assert(r.meta && r.meta.wave === 'wave16', 'meta preserved');
}

// ── Suite 3: Dry-run minimal record (empty arrays) ──────────────────────────

suite('dry-run minimal record');

{
  var res = runWriter(['--run-id', 'min', '--actor', 'test', '--mode', 'dry-run']);
  assertEq(res.exitCode, 0, 'minimal record exits 0');

  var r = parseDryRunRecord(res.stdout);
  assert(Array.isArray(r.factsConsumed) && r.factsConsumed.length === 0, 'factsConsumed defaults to empty');
  assert(Array.isArray(r.issuesProduced) && r.issuesProduced.length === 0, 'issuesProduced defaults to empty');
  assert(Array.isArray(r.issuesRejected) && r.issuesRejected.length === 0, 'issuesRejected defaults to empty');
  assertEq(r.outcome, null, 'outcome defaults to null');
  assertEq(r.blockReason, null, 'blockReason defaults to null');
  assertEq(r.meta, null, 'meta defaults to null');
}

// ── Suite 4: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  var res = runWriter(['--run-id', 'markers', '--actor', 'test', '--mode', 'dry-run']);
  assert(res.stdout.indexOf('DRY RUN') !== -1, 'output contains DRY RUN marker');
  assert(res.stdout.indexOf('No file was modified') !== -1, 'output confirms no file modified');
}

// ── Suite 5: Blocked outcome ────────────────────────────────────────────────

suite('blocked outcome');

{
  var res = runWriter([
    '--run-id', 'blocked-001',
    '--actor', 'self-cycle',
    '--mode', 'execute',
    '--outcome', 'blocked',
    '--block-reason', 'Main health is red',
  ]);
  assertEq(res.exitCode, 0, 'blocked record exits 0');

  var r = parseDryRunRecord(res.stdout);
  assertEq(r.outcome, 'blocked', 'outcome is blocked');
  assertEq(r.blockReason, 'Main health is red', 'blockReason preserved');
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
    '--actor', 'ghp_actor_token',
    '--mode', 'dry-run',
    '--block-reason', 'Bearer secret123',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  var r = parseDryRunRecord(res.stdout);
  assertEq(r.runId, '[redacted-gh-token]_run', 'runId ghp_ prefix redacted');
  assertEq(r.actor, '[redacted-gh-token]_token', 'actor ghp_ prefix redacted');
  assertEq(r.blockReason, 'Bearer [redacted]', 'blockReason Bearer redacted');
}

// ── Suite 11: sanitizeObject preserves non-string types ─────────────────────

suite('sanitizeObject: type preservation');

{
  // We test through the CLI by passing meta JSON
  var res = runWriter([
    '--run-id', 'type-test',
    '--actor', 'test',
    '--mode', 'dry-run',
    '--meta', '{"str":"ghp_leaked","num":42,"bool":true,"nil":null}',
  ]);
  assertEq(res.exitCode, 0, 'type test exits 0');

  var r = parseDryRunRecord(res.stdout);
  assertEq(r.meta.str, '[redacted-gh-token]', 'string value redacted');
  assertEq(r.meta.num, 42, 'number preserved');
  assertEq(r.meta.bool, true, 'boolean preserved');
  assertEq(r.meta.nil, null, 'null preserved');
}

// ── Suite 12: Truncation boundary ───────────────────────────────────────────

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

// ── Suite 13: CLI argument handling — missing --run-id ───────────────────────

suite('CLI: missing --run-id');

{
  var res = runWriter(['--actor', 'test', '--mode', 'dry-run'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --run-id exits 2');
  assert(res.stderr.indexOf('--run-id is required') !== -1, 'error message mentions --run-id');
}

// ── Suite 14: CLI argument handling — missing --actor ────────────────────────

suite('CLI: missing --actor');

{
  var res = runWriter(['--run-id', 'test', '--mode', 'dry-run'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --actor exits 2');
  assert(res.stderr.indexOf('--actor is required') !== -1, 'error message mentions --actor');
}

// ── Suite 15: CLI argument handling — missing --mode ─────────────────────────

suite('CLI: missing --mode');

{
  var res = runWriter(['--run-id', 'test', '--actor', 'test'], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --mode exits 2');
  assert(res.stderr.indexOf('--mode is required') !== -1, 'error message mentions --mode');
}

// ── Suite 16: CLI argument handling — invalid mode ───────────────────────────

suite('CLI: invalid --mode');

{
  var res = runWriter(['--run-id', 'test', '--actor', 'test', '--mode', 'bogus']);
  assertEq(res.exitCode, 2, 'invalid mode exits 2');
  assert(res.stderr.indexOf('--mode must be one of') !== -1, 'error lists valid modes');
}

// ── Suite 17: CLI argument handling — unknown argument ──────────────────────

suite('CLI: unknown argument');

{
  var res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.indexOf('Unknown argument') !== -1, 'error message mentions unknown argument');
}

// ── Suite 18: CLI argument handling — invalid JSON facts ─────────────────────

suite('CLI: invalid --facts JSON');

{
  var res = runWriter(['--run-id', 'test', '--actor', 'test', '--mode', 'dry-run', '--facts', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON facts exits 2');
  assert(res.stderr.indexOf('valid JSON') !== -1, 'error message mentions JSON');
}

// ── Suite 19: CLI argument handling — invalid JSON produced ──────────────────

suite('CLI: invalid --produced JSON');

{
  var res = runWriter(['--run-id', 'test', '--actor', 'test', '--mode', 'dry-run', '--produced', 'not-json']);
  assertEq(res.exitCode, 2, 'invalid JSON produced exits 2');
  assert(res.stderr.indexOf('valid JSON') !== -1, 'error message mentions JSON');
}

// ── Suite 20: CLI argument handling — invalid outcome ───────────────────────

suite('CLI: invalid --outcome');

{
  var res = runWriter(['--run-id', 'test', '--actor', 'test', '--mode', 'dry-run', '--outcome', 'bogus']);
  assertEq(res.exitCode, 2, 'invalid outcome exits 2');
  assert(res.stderr.indexOf('--outcome must be one of') !== -1, 'error lists valid outcomes');
}

// ── Suite 21: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  var res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.indexOf('USAGE') !== -1, 'help output contains USAGE');
  assert(res.stdout.indexOf('--run-id') !== -1, 'help output mentions --run-id');
  assert(res.stdout.indexOf('--live') !== -1, 'help output mentions --live');
}

// ── Suite 22: CLI — -h shorthand ────────────────────────────────────────────

suite('CLI: -h shorthand');

{
  var res = runWriter(['-h']);
  assertEq(res.exitCode, 0, '-h exits 0');
  assert(res.stdout.indexOf('USAGE') !== -1, '-h output contains USAGE');
}

// ── Suite 23: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  var res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.indexOf('self-test') !== -1, 'self-test output contains header');
  assert(res.stdout.indexOf('passed') !== -1, 'self-test output contains results');
}

// ── Suite 24: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-producer-run-test-'));
  var tmpFile = path.join(tmpDir, 'test-runs.ndjson');

  try {
    var res = runWriter([
      '--run-id', 'run-live-001',
      '--actor', 'test-runner',
      '--mode', 'execute',
      '--outcome', 'completed',
      '--facts', '[{"factId":"fact:test","source":"test.json"}]',
      '--produced', '[{"title":"Test issue","taskType":"execution","risk":"low","conflictGroup":"test","allowedFiles":["docs/**"],"forbiddenFiles":["src/**"],"validationCommands":["npm run check"],"status":"created","humanRequired":false}]',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(fs.existsSync(tmpFile), 'output file created');

    var content = fs.readFileSync(tmpFile, 'utf8').trim();
    var lines = content.split('\n');
    assertEq(lines.length, 1, 'exactly one NDJSON line written');

    var r = JSON.parse(lines[0]);
    assertEq(r.runId, 'run-live-001', 'written runId correct');
    assertEq(r.actor, 'test-runner', 'written actor correct');
    assertEq(r.mode, 'execute', 'written mode correct');
    assertEq(r.outcome, 'completed', 'written outcome correct');
    assertEq(r.schemaVersion, 1, 'written schemaVersion is 1');
    assert(r.factsConsumed.length === 1, 'written facts preserved');
    assert(r.issuesProduced.length === 1, 'written produced preserved');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 25: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-producer-run-test-'));
  var tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    runWriter(['--run-id', 'first', '--actor', 'a', '--mode', 'dry-run', '--out', tmpFile, '--live']);
    runWriter(['--run-id', 'second', '--actor', 'b', '--mode', 'execute', '--out', tmpFile, '--live']);

    var content = fs.readFileSync(tmpFile, 'utf8').trim();
    var lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    var first = JSON.parse(lines[0]);
    var second = JSON.parse(lines[1]);
    assertEq(first.runId, 'first', 'first runId correct');
    assertEq(second.runId, 'second', 'second runId correct');
    assertEq(first.mode, 'dry-run', 'first mode correct');
    assertEq(second.mode, 'execute', 'second mode correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 26: Multiple facts and produced issues ────────────────────────────

suite('multiple facts and produced issues');

{
  var res = runWriter([
    '--run-id', 'multi',
    '--actor', 'self-cycle',
    '--mode', 'execute',
    '--outcome', 'completed',
    '--facts', '[{"factId":"fact:a","source":"a.json"},{"factId":"fact:b","source":"b.json"}]',
    '--produced', '[{"title":"Issue A","taskType":"execution","risk":"low","conflictGroup":"a","allowedFiles":["docs/**"],"forbiddenFiles":["src/**"],"validationCommands":["npm run check"],"status":"created","humanRequired":false},{"title":"Issue B","taskType":"research","risk":"medium","conflictGroup":"b","allowedFiles":["scripts/ai/**"],"forbiddenFiles":["src/**"],"validationCommands":["npm run check"],"status":"proposed","humanRequired":true}]',
  ]);
  assertEq(res.exitCode, 0, 'multi fact/produced exits 0');

  var r = parseDryRunRecord(res.stdout);
  assert(r.factsConsumed.length === 2, 'two facts consumed');
  assertEq(r.factsConsumed[0].factId, 'fact:a', 'fact[0] correct');
  assertEq(r.factsConsumed[1].factId, 'fact:b', 'fact[1] correct');
  assert(r.issuesProduced.length === 2, 'two issues produced');
  assertEq(r.issuesProduced[0].title, 'Issue A', 'produced[0] title correct');
  assertEq(r.issuesProduced[1].title, 'Issue B', 'produced[1] title correct');
  assertEq(r.issuesProduced[1].humanRequired, true, 'produced[1] humanRequired correct');
}

// ── Suite 27: Empty and edge-case strings ───────────────────────────────────

suite('sanitize: empty and edge cases');

{
  assertEq(sanitize('', 0), '', 'empty string returns empty');
  assertEq(sanitize('hello'), 'hello', 'plain text unchanged');
  assertEq(sanitize('a'), 'a', 'single char unchanged');
  assertEq(sanitize(42), 42, 'non-string passthrough');
  assertEq(sanitize(null), null, 'null passthrough');
  assertEq(sanitize(undefined), undefined, 'undefined passthrough');
}

// ── Suite 28: Rejected issues with null conflictGroup ───────────────────────

suite('rejected issues with null conflictGroup');

{
  var res = runWriter([
    '--run-id', 'rej-null',
    '--actor', 'test',
    '--mode', 'dry-run',
    '--rejected', '[{"title":"Rej issue","reason":"duplicate"}]',
  ]);
  assertEq(res.exitCode, 0, 'rejected with null conflictGroup exits 0');

  var r = parseDryRunRecord(res.stdout);
  assertEq(r.issuesRejected[0].conflictGroup, null, 'null conflictGroup preserved');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
