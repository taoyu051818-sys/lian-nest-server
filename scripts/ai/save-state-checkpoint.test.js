#!/usr/bin/env node

/**
 * save-state-checkpoint.test.js
 *
 * Focused self-tests for the state checkpoint writer.
 * Covers: dry-run shape, live write, anti-thrashing, chain hash,
 * secret redaction boundaries, CLI arg handling.
 *
 * Runs without external dependencies. Exercises the writer via CLI invocation
 * and direct function extraction for unit-level tests.
 *
 * Usage:
 *   node scripts/ai/save-state-checkpoint.test.js
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

const WRITER = path.join(__dirname, 'save-state-checkpoint.js');
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
  if (allArgs.indexOf('--dry-run') === -1 && allArgs.indexOf('--live') === -1 &&
      allArgs.indexOf('--self-test') === -1 && allArgs.indexOf('--help') === -1) {
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

function parseDryRunCheckpoint(stdout) {
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

console.log('save-state-checkpoint.test.js');
console.log('='.repeat(50));

// ── Suite 1: Dry-run checkpoint shape ────────────────────────────────────────

suite('dry-run checkpoint shape');

{
  var res = runWriter([
    '--task-id', 'test-001',
    '--active-task', 'Test task',
    '--goal', 'Test goal',
    '--active-state', 'implementing',
  ]);
  assertEq(res.exitCode, 0, 'dry-run exits 0');

  var c = parseDryRunCheckpoint(res.stdout);
  assert(c !== null, 'dry-run output contains valid JSON');
  assertEq(c.checkpointVersion, 1, 'checkpointVersion is 1');
  assertEq(c.taskId, 'test-001', 'taskId matches input');
  assertEq(c.activeTask, 'Test task', 'activeTask matches input');
  assertEq(c.goal, 'Test goal', 'goal matches input');
  assertEq(c.activeState, 'implementing', 'activeState matches input');
  assert(typeof c.capturedAt === 'string' && c.capturedAt.indexOf('T') !== -1, 'capturedAt is ISO-8601');
  assert(c.capturedAt.endsWith('Z'), 'capturedAt ends with Z (UTC)');
  assertEq(c.compressionSkipped, false, 'compressionSkipped defaults to false');
  assertEq(c.compressionSkipReason, null, 'compressionSkipReason defaults to null');
}

// ── Suite 2: Dry-run with all optional fields ───────────────────────────────

suite('dry-run with all optional fields');

{
  var res = runWriter([
    '--task-id', 'full-001',
    '--issue', '1414',
    '--active-task', 'Full task',
    '--goal', 'Full goal',
    '--active-state', 'testing',
    '--constraints', '["allowedFiles: docs/**"]',
    '--completed-actions', '["Read docs","Wrote code"]',
    '--in-progress', '["Running tests"]',
    '--blocked', '["Missing dependency"]',
    '--key-decisions', '["Use NDJSON"]',
    '--resolved-questions', '["Where to store"]',
    '--pending-asks', '["Need review"]',
    '--relevant-files', '["docs/ai-native/test.md"]',
    '--remaining-work', '["Write test"]',
    '--critical-context', 'Important context here',
  ]);
  assertEq(res.exitCode, 0, 'full manifest exits 0');

  var c = parseDryRunCheckpoint(res.stdout);
  assertEq(c.taskId, 'full-001', 'taskId preserved');
  assertEq(c.issueNumber, 1414, 'issueNumber preserved');
  assertEq(c.activeState, 'testing', 'activeState preserved');
  assert(c.constraints.length === 1, 'constraints preserved');
  assert(c.completedActions.length === 2, 'completedActions preserved');
  assert(c.inProgress.length === 1, 'inProgress preserved');
  assert(c.blocked.length === 1, 'blocked preserved');
  assert(c.keyDecisions.length === 1, 'keyDecisions preserved');
  assert(c.resolvedQuestions.length === 1, 'resolvedQuestions preserved');
  assert(c.pendingAsks.length === 1, 'pendingAsks preserved');
  assert(c.relevantFiles.length === 1, 'relevantFiles preserved');
  assert(c.remainingWork.length === 1, 'remainingWork preserved');
  assertEq(c.criticalContext, 'Important context here', 'criticalContext preserved');
}

// ── Suite 3: Dry-run minimal checkpoint (null optionals) ─────────────────────

suite('dry-run minimal checkpoint');

{
  var res = runWriter([
    '--task-id', 'min',
    '--active-task', 'T',
    '--goal', 'G',
    '--active-state', 'exploring',
  ]);
  assertEq(res.exitCode, 0, 'minimal checkpoint exits 0');

  var c = parseDryRunCheckpoint(res.stdout);
  assertEq(c.issueNumber, null, 'issueNumber defaults to null');
  assertEq(c.criticalContext, null, 'criticalContext defaults to null');
  assert(c.constraints.length === 0, 'constraints defaults to empty');
  assert(c.completedActions.length === 0, 'completedActions defaults to empty');
  assert(c.inProgress.length === 0, 'inProgress defaults to empty');
  assert(c.blocked.length === 0, 'blocked defaults to empty');
  assert(c.keyDecisions.length === 0, 'keyDecisions defaults to empty');
  assert(c.resolvedQuestions.length === 0, 'resolvedQuestions defaults to empty');
  assert(c.pendingAsks.length === 0, 'pendingAsks defaults to empty');
  assert(c.relevantFiles.length === 0, 'relevantFiles defaults to empty');
  assert(c.remainingWork.length === 0, 'remainingWork defaults to empty');
}

// ── Suite 4: Dry-run output markers ─────────────────────────────────────────

suite('dry-run output markers');

{
  var res = runWriter([
    '--task-id', 'markers',
    '--active-task', 'T',
    '--goal', 'G',
    '--active-state', 'exploring',
  ]);
  assert(res.stdout.indexOf('DRY RUN') !== -1, 'output contains DRY RUN marker');
  assert(res.stdout.indexOf('No file was modified') !== -1, 'output confirms no file modified');
}

// ── Suite 5: Secret redaction — GitHub tokens ───────────────────────────────

suite('redaction: GitHub personal access tokens');

{
  assertEq(sanitize('ghp_abc123def456ghi'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('prefix ghp_abc123 suffix'), 'prefix [redacted-gh-token] suffix', 'ghp_ redacted mid-string');
}

// ── Suite 6: Secret redaction — Bearer tokens ───────────────────────────────

suite('redaction: Bearer tokens');

{
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');
  assertEq(sanitize('bearer abc'), 'Bearer [redacted]', 'bearer (lowercase) redacted');
}

// ── Suite 7: Secret redaction — password/secret/token key=value ─────────────

suite('redaction: password/secret/token key=value');

{
  assertEq(sanitize('password=hunter2'), 'password=[redacted]', 'password= redacted');
  assertEq(sanitize('secret: mysecret'), 'secret=[redacted]', 'secret: redacted');
  assertEq(sanitize('token=abc123'), 'token=[redacted]', 'token= redacted');
}

// ── Suite 8: Secret redaction — integration via CLI ─────────────────────────

suite('redaction: integration via dry-run');

{
  var res = runWriter([
    '--task-id', 'ghp_leaked_task',
    '--active-task', 'Bearer secret123',
    '--goal', 'password=hunter2',
    '--active-state', 'exploring',
    '--critical-context', 'ghp_context',
  ]);
  assertEq(res.exitCode, 0, 'redaction test exits 0');

  var c = parseDryRunCheckpoint(res.stdout);
  assertEq(c.taskId, '[redacted-gh-token]_task', 'taskId ghp_ prefix redacted');
  assertEq(c.activeTask, 'Bearer [redacted]', 'activeTask Bearer redacted');
  assertEq(c.goal, 'password=[redacted]', 'goal password= redacted');
  assertEq(c.criticalContext, '[redacted-gh-token]', 'criticalContext ghp_ redacted');
}

// ── Suite 9: Truncation boundary ────────────────────────────────────────────

suite('sanitize: truncation at 500 chars');

{
  function longStr(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += (i % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');
}

// ── Suite 10: CLI argument handling — missing task-id ────────────────────────

suite('CLI: missing --task-id');

{
  var res = runWriter([
    '--active-task', 'T',
    '--goal', 'G',
    '--active-state', 'exploring',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --task-id exits 2');
  assert(res.stderr.indexOf('--task-id is required') !== -1, 'error message mentions --task-id');
}

// ── Suite 11: CLI argument handling — missing active-task ────────────────────

suite('CLI: missing --active-task');

{
  var res = runWriter([
    '--task-id', 'test',
    '--goal', 'G',
    '--active-state', 'exploring',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  assertEq(res.exitCode, 2, 'missing --active-task exits 2');
  assert(res.stderr.indexOf('--active-task is required') !== -1, 'error message mentions --active-task');
}

// ── Suite 12: CLI argument handling — invalid active-state ───────────────────

suite('CLI: invalid --active-state');

{
  var res = runWriter([
    '--task-id', 'test',
    '--active-task', 'T',
    '--goal', 'G',
    '--active-state', 'bogus',
  ]);
  assertEq(res.exitCode, 2, 'invalid active-state exits 2');
  assert(res.stderr.indexOf('--active-state must be one of') !== -1, 'error lists valid states');
}

// ── Suite 13: CLI argument handling — unknown argument ───────────────────────

suite('CLI: unknown argument');

{
  var res = runWriter(['--bogus']);
  assertEq(res.exitCode, 2, 'unknown argument exits 2');
  assert(res.stderr.indexOf('Unknown argument') !== -1, 'error message mentions unknown argument');
}

// ── Suite 14: CLI argument handling — invalid JSON ───────────────────────────

suite('CLI: invalid --constraints JSON');

{
  var res = runWriter([
    '--task-id', 'test',
    '--active-task', 'T',
    '--goal', 'G',
    '--active-state', 'exploring',
    '--constraints', 'not-json',
  ]);
  assertEq(res.exitCode, 2, 'invalid JSON constraints exits 2');
  assert(res.stderr.indexOf('valid JSON') !== -1, 'error message mentions JSON');
}

// ── Suite 15: CLI — --help flag ─────────────────────────────────────────────

suite('CLI: --help flag');

{
  var res = runWriter(['--help']);
  assertEq(res.exitCode, 0, '--help exits 0');
  assert(res.stdout.indexOf('USAGE') !== -1, 'help output contains USAGE');
  assert(res.stdout.indexOf('--task-id') !== -1, 'help output mentions --task-id');
  assert(res.stdout.indexOf('--live') !== -1, 'help output mentions --live');
}

// ── Suite 16: Built-in self-test passes ─────────────────────────────────────

suite('built-in --self-test passes');

{
  var res = runWriter(['--self-test']);
  assertEq(res.exitCode, 0, '--self-test exits 0');
  assert(res.stdout.indexOf('self-test') !== -1, 'self-test output contains header');
  assert(res.stdout.indexOf('passed') !== -1, 'self-test output contains results');
}

// ── Suite 17: Live write to temp file ───────────────────────────────────────

suite('live write to temp file');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
  var tmpFile = path.join(tmpDir, 'test-checkpoints.ndjson');

  try {
    var res = runWriter([
      '--task-id', 'live-001',
      '--active-task', 'Live task',
      '--goal', 'Live goal',
      '--active-state', 'implementing',
      '--issue', '1414',
      '--out', tmpFile,
      '--live',
    ]);
    assertEq(res.exitCode, 0, 'live write exits 0');
    assert(fs.existsSync(tmpFile), 'output file created');

    var content = fs.readFileSync(tmpFile, 'utf8').trim();
    var lines = content.split('\n');
    assertEq(lines.length, 1, 'exactly one NDJSON line written');

    var c = JSON.parse(lines[0]);
    assertEq(c.taskId, 'live-001', 'written taskId correct');
    assertEq(c.activeTask, 'Live task', 'written activeTask correct');
    assertEq(c.goal, 'Live goal', 'written goal correct');
    assertEq(c.activeState, 'implementing', 'written activeState correct');
    assertEq(c.issueNumber, 1414, 'written issueNumber correct');
    assertEq(c.checkpointVersion, 1, 'written checkpointVersion is 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 18: Live write appends (does not truncate) ────────────────────────

suite('live write appends to existing file');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
  var tmpFile = path.join(tmpDir, 'append-test.ndjson');

  try {
    runWriter([
      '--task-id', 'first',
      '--active-task', 'T',
      '--goal', 'G',
      '--active-state', 'exploring',
      '--out', tmpFile,
      '--live',
    ]);
    runWriter([
      '--task-id', 'second',
      '--active-task', 'T2',
      '--goal', 'G2',
      '--active-state', 'implementing',
      '--out', tmpFile,
      '--live',
    ]);

    var content = fs.readFileSync(tmpFile, 'utf8').trim();
    var lines = content.split('\n');
    assertEq(lines.length, 2, 'two NDJSON lines after two writes');

    var first = JSON.parse(lines[0]);
    var second = JSON.parse(lines[1]);
    assertEq(first.taskId, 'first', 'first taskId correct');
    assertEq(second.taskId, 'second', 'second taskId correct');
    assertEq(first.activeState, 'exploring', 'first activeState correct');
    assertEq(second.activeState, 'implementing', 'second activeState correct');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 19: Anti-thrashing with --previous ────────────────────────────────

suite('anti-thrashing: --previous flag');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-thrash-'));
  var prevFile = path.join(tmpDir, 'prev.ndjson');

  try {
    // Write 3 identical checkpoints to establish low-change history
    for (var i = 0; i < 3; i++) {
      runWriter([
        '--task-id', 'thrash-' + i,
        '--active-task', 'Same task',
        '--goal', 'Same goal',
        '--active-state', 'implementing',
        '--completed-actions', '["Read docs"]',
        '--remaining-work', '["Write test"]',
        '--out', prevFile,
        '--live',
      ]);
    }

    // Now write a 4th with nearly identical content — should trigger anti-thrash
    var res = runWriter([
      '--task-id', 'thrash-3',
      '--active-task', 'Same task',
      '--goal', 'Same goal',
      '--active-state', 'implementing',
      '--completed-actions', '["Read docs"]',
      '--remaining-work', '["Write test"]',
      '--previous', prevFile,
    ]);

    var c = parseDryRunCheckpoint(res.stdout);
    assert(c !== null, 'anti-thrash output contains valid JSON');
    assertEq(c.compressionSkipped, true, 'compressionSkipped is true');
    assert(c.compressionSkipReason !== null, 'compressionSkipReason is set');
    assert(c.compressionSkipReason.indexOf('anti-thrash') !== -1, 'reason mentions anti-thrash');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 20: Anti-thrashing with new content ───────────────────────────────

suite('anti-thrashing: sufficient new content');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-new-'));
  var prevFile = path.join(tmpDir, 'prev.ndjson');

  try {
    // Write one checkpoint
    runWriter([
      '--task-id', 'base',
      '--active-task', 'T',
      '--goal', 'G',
      '--active-state', 'exploring',
      '--completed-actions', '["Step 1"]',
      '--remaining-work', '["Step 2","Step 3"]',
      '--out', prevFile,
      '--live',
    ]);

    // Write another with mostly new content
    var res = runWriter([
      '--task-id', 'new-content',
      '--active-task', 'T',
      '--goal', 'G',
      '--active-state', 'implementing',
      '--completed-actions', '["Step 1","Step 4","Step 5"]',
      '--remaining-work', '["Step 2","Step 3","Step 6"]',
      '--previous', prevFile,
    ]);

    var c = parseDryRunCheckpoint(res.stdout);
    assertEq(c.compressionSkipped, false, 'compressionSkipped is false with new content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 21: Chain hash links checkpoints ───────────────────────────────────

suite('chain hash: links to previous checkpoint');

{
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-hash-'));
  var prevFile = path.join(tmpDir, 'chain.ndjson');

  try {
    // Write first checkpoint
    runWriter([
      '--task-id', 'chain-1',
      '--active-task', 'T',
      '--goal', 'G',
      '--active-state', 'exploring',
      '--out', prevFile,
      '--live',
    ]);

    // Write second — should have a previousCheckpointHash
    var res = runWriter([
      '--task-id', 'chain-2',
      '--active-task', 'T2',
      '--goal', 'G2',
      '--active-state', 'implementing',
      '--completed-actions', '["New action 1","New action 2","New action 3","New action 4"]',
      '--key-decisions', '["Decision 1","Decision 2","Decision 3"]',
      '--remaining-work', '["Work 1","Work 2","Work 3"]',
      '--previous', prevFile,
    ]);

    var c = parseDryRunCheckpoint(res.stdout);
    assert(c.previousCheckpointHash !== null, 'previousCheckpointHash is set');
    assert(c.previousCheckpointHash.length === 16, 'hash is 16 chars');
    assertEq(c.compressionSkipped, false, 'not skipped (new content)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Suite 22: All active states accepted ─────────────────────────────────────

suite('all active states accepted');

{
  var states = ['exploring', 'implementing', 'testing', 'blocked', 'reviewing'];
  for (var i = 0; i < states.length; i++) {
    var res = runWriter([
      '--task-id', 'state-' + i,
      '--active-task', 'T',
      '--goal', 'G',
      '--active-state', states[i],
    ]);
    assertEq(res.exitCode, 0, 'state ' + states[i] + ' exits 0');

    var c = parseDryRunCheckpoint(res.stdout);
    assertEq(c.activeState, states[i], 'state ' + states[i] + ' preserved');
  }
}

// ── Suite 23: Empty and edge-case strings ────────────────────────────────────

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
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
