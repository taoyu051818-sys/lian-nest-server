#!/usr/bin/env node

/**
 * write-worker-telemetry-event.test.js
 *
 * Focused tests for write-worker-telemetry-event.js.
 * Uses only built-in Node.js modules (no test framework).
 *
 * Usage:
 *   node scripts/ai/write-worker-telemetry-event.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const WRITER = path.resolve(__dirname, 'write-worker-telemetry-event.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function assertIncludes(str, substr, label) {
  assert(typeof str === 'string' && str.includes(substr), label);
}

// ── Helper: run writer and capture output ────────────────────────────────────

function runWriter(extraArgs, opts = {}) {
  const args = [WRITER, ...extraArgs];
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      timeout: 10000,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

function testSelfTest() {
  console.log('Test: --self-test passes');
  const result = runWriter(['--self-test']);
  assert(result.exitCode === 0, 'self-test exits 0');
  assertIncludes(result.stdout, 'passed', 'self-test reports passed');
}

function testHelp() {
  console.log('Test: --help');
  const result = runWriter(['--help']);
  assert(result.exitCode === 0, '--help exits 0');
  assertIncludes(result.stdout, 'write-worker-telemetry-event.js', 'help shows script name');
  assertIncludes(result.stdout, '--event', 'help shows --event flag');
  assertIncludes(result.stdout, '--task-id', 'help shows --task-id flag');
  assertIncludes(result.stdout, '--token-source', 'help shows --token-source flag');
  assertIncludes(result.stdout, 'start', 'help lists start event');
  assertIncludes(result.stdout, 'heartbeat', 'help lists heartbeat event');
  assertIncludes(result.stdout, 'complete', 'help lists complete event');
}

function testDryRunStartEvent() {
  console.log('Test: dry-run start event');
  const result = runWriter(['--event', 'start', '--task-id', 'test-001']);
  assert(result.exitCode === 0, 'start dry-run exits 0');
  assertIncludes(result.stdout, 'DRY RUN', 'shows dry-run banner');
  assertIncludes(result.stdout, '"eventType":"start"', 'event has start type');
  assertIncludes(result.stdout, '"taskId":"test-001"', 'event has taskId');
  assertIncludes(result.stdout, 'No file was modified', 'confirms no write');
}

function testDryRunHeartbeatWithTokens() {
  console.log('Test: dry-run heartbeat with token usage');
  const result = runWriter([
    '--event', 'heartbeat',
    '--task-id', 'hb-002',
    '--elapsed-ms', '60000',
    '--input-tokens', '1500',
    '--output-tokens', '400',
    '--token-source', 'actual',
    '--token-confidence', 'actual',
  ]);
  assert(result.exitCode === 0, 'heartbeat dry-run exits 0');
  const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
  assert(jsonMatch !== null, 'output contains JSON');
  const event = JSON.parse(jsonMatch[0]);
  assert(event.eventType === 'heartbeat', 'eventType is heartbeat');
  assert(event.elapsedMs === 60000, 'elapsedMs is 60000');
  assert(event.tokenUsage.inputTokens === 1500, 'inputTokens is 1500');
  assert(event.tokenUsage.outputTokens === 400, 'outputTokens is 400');
  assert(event.tokenUsage.source === 'actual', 'source is actual');
  assert(event.tokenUsage.confidence === 'actual', 'confidence is actual');
}

function testDryRunCompleteWithCost() {
  console.log('Test: dry-run complete with cost');
  const result = runWriter([
    '--event', 'complete',
    '--task-id', 'done-003',
    '--issue-number', '1173',
    '--pr-number', '1180',
    '--elapsed-ms', '300000',
    '--input-tokens', '5000',
    '--output-tokens', '2000',
    '--token-source', 'actual',
    '--cost-cents', '12',
    '--cost-model', 'claude-sonnet-4-6',
  ]);
  assert(result.exitCode === 0, 'complete dry-run exits 0');
  const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
  const event = JSON.parse(jsonMatch[0]);
  assert(event.eventType === 'complete', 'eventType is complete');
  assert(event.issueNumber === 1173, 'issueNumber is 1173');
  assert(event.prNumber === 1180, 'prNumber is 1180');
  assert(event.estimatedCost.amountCents === 12, 'cost amountCents');
  assert(event.estimatedCost.currency === 'USD', 'cost currency');
  assert(event.estimatedCost.model === 'claude-sonnet-4-6', 'cost model');
}

function testLiveMode() {
  console.log('Test: live mode writes to file');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  const outFile = path.join(tmpDir, 'test-events.ndjson');
  try {
    const result = runWriter([
      '--event', 'start',
      '--task-id', 'live-001',
      '--actor-role', 'tooling-worker',
      '--live',
      '--out', outFile,
    ]);
    assert(result.exitCode === 0, 'live write exits 0');
    assertIncludes(result.stdout, 'appended', 'confirms append');

    const content = fs.readFileSync(outFile, 'utf8');
    const lines = content.trim().split('\n');
    assert(lines.length === 1, 'one line written');

    const event = JSON.parse(lines[0]);
    assert(event.eventVersion === 1, 'eventVersion is 1');
    assert(event.eventType === 'start', 'eventType is start');
    assert(event.taskId === 'live-001', 'taskId preserved');
    assert(event.actorRole === 'tooling-worker', 'actorRole preserved');
    assert(typeof event.capturedAt === 'string', 'capturedAt is string');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testLiveModeAppendMultiple() {
  console.log('Test: live mode appends multiple events');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  const outFile = path.join(tmpDir, 'multi-events.ndjson');
  try {
    runWriter(['--event', 'start', '--task-id', 'multi-001', '--live', '--out', outFile]);
    runWriter(['--event', 'heartbeat', '--task-id', 'multi-001', '--elapsed-ms', '5000', '--live', '--out', outFile]);
    runWriter(['--event', 'complete', '--task-id', 'multi-001', '--elapsed-ms', '10000', '--live', '--out', outFile]);

    const content = fs.readFileSync(outFile, 'utf8');
    const lines = content.trim().split('\n');
    assert(lines.length === 3, 'three lines written');

    const events = lines.map(l => JSON.parse(l));
    assert(events[0].eventType === 'start', 'first event is start');
    assert(events[1].eventType === 'heartbeat', 'second event is heartbeat');
    assert(events[2].eventType === 'complete', 'third event is complete');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testMissingEventType() {
  console.log('Test: missing --event fails');
  const result = runWriter(['--task-id', 't1']);
  assert(result.exitCode === 2, 'exits 2');
  assertIncludes(result.stderr, '--event is required', 'error about missing event');
}

function testMissingTaskId() {
  console.log('Test: missing --task-id fails');
  const result = runWriter(['--event', 'start']);
  assert(result.exitCode === 2, 'exits 2');
  assertIncludes(result.stderr, '--task-id is required', 'error about missing task-id');
}

function testInvalidEventType() {
  console.log('Test: invalid --event fails');
  const result = runWriter(['--event', 'invalid', '--task-id', 't1']);
  assert(result.exitCode === 2, 'exits 2');
  assertIncludes(result.stderr, 'start, heartbeat, complete', 'error lists valid events');
}

function testSecretSanitization() {
  console.log('Test: secrets are sanitized in live output');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  const outFile = path.join(tmpDir, 'sanitize-test.ndjson');
  try {
    const result = runWriter([
      '--event', 'start',
      '--task-id', 'ghp_abc123secret',
      '--actor-role', 'Bearer mytoken123',
      '--live',
      '--out', outFile,
    ]);
    assert(result.exitCode === 0, 'write succeeds');

    const content = fs.readFileSync(outFile, 'utf8');
    assert(!content.includes('ghp_abc123secret'), 'ghp token not in output');
    assert(!content.includes('Bearer mytoken123'), 'Bearer token not in output');
    assert(content.includes('[redacted-gh-token]'), 'ghp redacted');
    assert(content.includes('Bearer [redacted]'), 'Bearer redacted');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testUnknownTokenSource() {
  console.log('Test: default token source/confidence is unknown');
  const result = runWriter([
    '--event', 'heartbeat',
    '--task-id', 'unk-001',
    '--input-tokens', '100',
    '--output-tokens', '50',
  ]);
  assert(result.exitCode === 0, 'exits 0');
  const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
  const event = JSON.parse(jsonMatch[0]);
  assert(event.tokenUsage.source === 'unknown', 'default source is unknown');
  assert(event.tokenUsage.confidence === 'unknown', 'default confidence is unknown');
}

// ── Run all tests ────────────────────────────────────────────────────────────

console.log('write-worker-telemetry-event.test.js');
console.log('='.repeat(50));
console.log();

testSelfTest();
testHelp();
testDryRunStartEvent();
testDryRunHeartbeatWithTokens();
testDryRunCompleteWithCost();
testLiveMode();
testLiveModeAppendMultiple();
testMissingEventType();
testMissingTaskId();
testInvalidEventType();
testSecretSanitization();
testUnknownTokenSource();

console.log();
console.log('='.repeat(50));
console.log(`Total: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
