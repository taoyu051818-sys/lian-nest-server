#!/usr/bin/env node

/**
 * classify-self-cycle-failure.test.js
 *
 * Tests for classify-self-cycle-failure.js: classification, reflection
 * generation, and reflectionLog persistence.
 *
 * Uses Node assert — no test framework required.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'classify-self-cycle-failure.js');

function run(args, stdin) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    input: stdin || '',
    timeout: 10000,
  });
}

// ── Classification tests ────────────────────────────────────────────────────

{
  // 1. Empty text produces UNKNOWN_CONTROL_PLANE_FAILURE
  const out = JSON.parse(run(['--text', '']));
  assert.strictEqual(out.errorClass, 'UNKNOWN_CONTROL_PLANE_FAILURE');
  assert.strictEqual(out.confidence, 'none');
  console.log('PASS: empty text -> UNKNOWN_CONTROL_PLANE_FAILURE');
}

{
  // 2. Pattern matching for TASK_CONTRACT_INVALID
  const out = JSON.parse(run(['--text', 'missing required field in task JSON']));
  assert.strictEqual(out.errorClass, 'TASK_CONTRACT_INVALID');
  assert.strictEqual(out.safeToRetry, false);
  console.log('PASS: missing required field -> TASK_CONTRACT_INVALID');
}

{
  // 3. Step hints boost alignment
  const out = JSON.parse(run(['--step', 'compile', '--text', 'missing required field and schema validation failed']));
  assert.strictEqual(out.errorClass, 'TASK_CONTRACT_INVALID');
  assert.strictEqual(out.failedStep, 'compile');
  console.log('PASS: step hint boost for compile + TASK_CONTRACT_INVALID');
}

{
  // 4. PROVIDER_UNAVAILABLE pattern
  const out = JSON.parse(run(['--text', 'All providers exhausted, no capacity for new workers']));
  assert.strictEqual(out.errorClass, 'PROVIDER_UNAVAILABLE');
  assert.strictEqual(out.safeToRetry, true);
  console.log('PASS: All providers exhausted -> PROVIDER_UNAVAILABLE');
}

{
  // 5. DISK_PRESSURE pattern
  const out = JSON.parse(run(['--text', 'ENOSPC: no space left on device']));
  assert.strictEqual(out.errorClass, 'DISK_PRESSURE');
  console.log('PASS: ENOSPC -> DISK_PRESSURE');
}

{
  // 6. WORKTREE_STALE pattern
  const out = JSON.parse(run(['--text', 'worktree is stale and locked']));
  assert.strictEqual(out.errorClass, 'WORKTREE_STALE');
  console.log('PASS: worktree stale -> WORKTREE_STALE');
}

{
  // 7. HUMAN_REQUIRED pattern
  const out = JSON.parse(run(['--text', 'HUMAN DECISION REQUIRED — blocked by health']));
  assert.strictEqual(out.errorClass, 'HUMAN_REQUIRED');
  console.log('PASS: HUMAN DECISION REQUIRED -> HUMAN_REQUIRED');
}

{
  // 8. RUNNER_STRICT_MODE_VARIABLE pattern
  const out = JSON.parse(run(['--text', "The variable '$targetPrText' cannot be retrieved because it has not been set"]));
  assert.strictEqual(out.errorClass, 'RUNNER_STRICT_MODE_VARIABLE');
  console.log('PASS: strict mode variable -> RUNNER_STRICT_MODE_VARIABLE');
}

{
  // 9. BATCH_SINGLE_TASK_MISMATCH pattern
  const out = JSON.parse(run(['--text', 'Cannot select task from batch: expects a single task']));
  assert.strictEqual(out.errorClass, 'BATCH_SINGLE_TASK_MISMATCH');
  console.log('PASS: batch mismatch -> BATCH_SINGLE_TASK_MISMATCH');
}

{
  // 10. ISSUE_BODY_PARSE_BLEED pattern
  const out = JSON.parse(run(['--text', 'parse bleed detected in CONTROL APPENDIX extraction']));
  assert.strictEqual(out.errorClass, 'ISSUE_BODY_PARSE_BLEED');
  console.log('PASS: parse bleed -> ISSUE_BODY_PARSE_BLEED');
}

// ── Reflection tests ────────────────────────────────────────────────────────

{
  // 11. Reflection is present in output for every classification
  const out = JSON.parse(run(['--text', 'All providers exhausted']));
  assert.ok(out.reflection, 'reflection field must be present');
  assert.strictEqual(out.reflection.errorClass, out.errorClass);
  assert.ok(out.reflection.lesson.length > 0, 'lesson must be non-empty');
  assert.ok(out.reflection.actionableGuidance.length > 0, 'actionableGuidance must be non-empty');
  assert.ok(out.reflection.repeatPreventionSignal.length > 0, 'repeatPreventionSignal must be non-empty');
  assert.ok(['low', 'medium', 'high'].includes(out.reflection.severity), 'severity must be low/medium/high');
  assert.ok(out.reflection.capturedAt, 'capturedAt must be present');
  console.log('PASS: reflection fields present for PROVIDER_UNAVAILABLE');
}

{
  // 12. Reflection for unknown failure
  const out = JSON.parse(run(['--text', 'xyzzy completely unrecognized error']));
  assert.strictEqual(out.reflection.errorClass, 'UNKNOWN_CONTROL_PLANE_FAILURE');
  assert.strictEqual(out.reflection.severity, 'high');
  console.log('PASS: unknown failure reflection has high severity');
}

{
  // 13. Reflection includes failure snippet (truncated)
  const longText = 'error '.repeat(100);
  const out = JSON.parse(run(['--text', longText]));
  assert.ok(out.reflection.failureSnippet.length <= 200, 'snippet truncated to 200 chars');
  console.log('PASS: failureSnippet is truncated');
}

{
  // 14. Empty text reflection has null snippet
  const out = JSON.parse(run(['--text', '']));
  assert.strictEqual(out.reflection.failureSnippet, null);
  console.log('PASS: empty text -> null failureSnippet');
}

{
  // 15. Reflection severity matches expected values
  const cases = [
    { text: 'missing required field', expectedSeverity: 'high' },
    { text: 'parse bleed in CONTROL APPENDIX', expectedSeverity: 'medium' },
    { text: 'strict mode variable', expectedSeverity: 'medium' },
    { text: 'All providers exhausted', expectedSeverity: 'low' },
    { text: 'ENOSPC disk full', expectedSeverity: 'low' },
    { text: 'worktree stale', expectedSeverity: 'medium' },
    { text: 'HUMAN DECISION REQUIRED', expectedSeverity: 'low' },
  ];
  for (const tc of cases) {
    const out = JSON.parse(run(['--text', tc.text]));
    assert.strictEqual(out.reflection.severity, tc.expectedSeverity,
      `${tc.text}: expected ${tc.expectedSeverity}, got ${out.reflection.severity}`);
  }
  console.log('PASS: reflection severities match expected values');
}

{
  // 16. Repeat prevention signals are unique per error class
  const texts = [
    { text: 'missing required field', cls: 'TASK_CONTRACT_INVALID' },
    { text: 'parse bleed', cls: 'ISSUE_BODY_PARSE_BLEED' },
    { text: 'strict mode', cls: 'RUNNER_STRICT_MODE_VARIABLE' },
    { text: 'batch single task mismatch', cls: 'BATCH_SINGLE_TASK_MISMATCH' },
    { text: 'All providers exhausted', cls: 'PROVIDER_UNAVAILABLE' },
    { text: 'ENOSPC', cls: 'DISK_PRESSURE' },
    { text: 'worktree stale', cls: 'WORKTREE_STALE' },
    { text: 'HUMAN DECISION REQUIRED', cls: 'HUMAN_REQUIRED' },
    { text: 'xyzzy unrecognized', cls: 'UNKNOWN_CONTROL_PLANE_FAILURE' },
  ];
  const signals = new Set();
  for (const tc of texts) {
    const out = JSON.parse(run(['--text', tc.text]));
    assert.strictEqual(out.reflection.errorClass, tc.cls);
    assert.ok(!signals.has(out.reflection.repeatPreventionSignal),
      `duplicate signal: ${out.reflection.repeatPreventionSignal}`);
    signals.add(out.reflection.repeatPreventionSignal);
  }
  console.log('PASS: repeat prevention signals are unique per error class');
}

// ── reflectionLog persistence tests ─────────────────────────────────────────

{
  // 17. --reflectionLog writes NDJSON entry
  const tmpFile = path.join(os.tmpdir(), `reflect-test-${Date.now()}.ndjson`);
  try {
    run(['--text', 'worktree locked', '--reflectionLog', tmpFile]);
    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const entry = JSON.parse(content);
    assert.strictEqual(entry.errorClass, 'WORKTREE_STALE');
    assert.ok(entry.lesson);
    assert.ok(entry.capturedAt);
    console.log('PASS: --reflectionLog writes valid NDJSON entry');
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

{
  // 18. --reflectionLog appends multiple entries
  const tmpFile = path.join(os.tmpdir(), `reflect-append-${Date.now()}.ndjson`);
  try {
    run(['--text', 'All providers exhausted', '--reflectionLog', tmpFile]);
    run(['--text', 'ENOSPC disk full', '--reflectionLog', tmpFile]);
    const lines = fs.readFileSync(tmpFile, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.strictEqual(first.errorClass, 'PROVIDER_UNAVAILABLE');
    assert.strictEqual(second.errorClass, 'DISK_PRESSURE');
    console.log('PASS: --reflectionLog appends multiple entries');
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

{
  // 19. --reflectionLog creates directory if needed
  const tmpDir = path.join(os.tmpdir(), `reflect-dir-${Date.now()}`);
  const tmpFile = path.join(tmpDir, 'sub', 'reflections.ndjson');
  try {
    run(['--text', 'missing required field', '--reflectionLog', tmpFile]);
    assert.ok(fs.existsSync(tmpFile));
    const entry = JSON.parse(fs.readFileSync(tmpFile, 'utf8').trim());
    assert.strictEqual(entry.errorClass, 'TASK_CONTRACT_INVALID');
    console.log('PASS: --reflectionLog creates nested directories');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── stdin input test ────────────────────────────────────────────────────────

{
  // 20. stdin input produces correct classification with reflection
  const out = JSON.parse(run([], 'All providers exhausted, cooldown active'));
  assert.strictEqual(out.errorClass, 'PROVIDER_UNAVAILABLE');
  assert.ok(out.reflection);
  console.log('PASS: stdin input works with reflection');
}

console.log('\nAll 20 tests passed.');
