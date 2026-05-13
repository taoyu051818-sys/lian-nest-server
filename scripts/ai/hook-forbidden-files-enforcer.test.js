#!/usr/bin/env node

/**
 * hook-forbidden-files-enforcer.test.js
 *
 * Self-tests for the PreToolUse hook that enforces forbiddenFiles.
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pattern from
 * check-worker-behavior-policy.test.js.
 *
 * Usage:
 *   node scripts/ai/hook-forbidden-files-enforcer.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK_SCRIPT = path.join(__dirname, 'hook-forbidden-files-enforcer.js');

// ── Test helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertEq(actual, expected, label) {
  assert(actual === expected, `${label} (expected ${expected}, got ${actual})`);
}

// ── Hook runner ───────────────────────────────────────────────────────────

function runHook(input, envOverrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  const inputJson = JSON.stringify(input);

  const taskFile = path.join(tmpDir, 'task.json');
  const defaultTask = {
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', 'schemas/**'],
    forbiddenFiles: ['src/**', 'prisma/**', 'package.json', 'package-lock.json', '.github/ai-policy/seed-constitution.md'],
    sharedLocks: [],
  };
  fs.writeFileSync(taskFile, JSON.stringify(defaultTask));

  const env = { ...process.env, LIAN_WORKER_TASK_FILE: taskFile, ...envOverrides };
  if (envOverrides.taskFile !== undefined) {
    env.LIAN_WORKER_TASK_FILE = envOverrides.taskFile;
  }

  try {
    const stdout = execSync(`node "${HOOK_SCRIPT}"`, {
      input: inputJson,
      env,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

console.log('hook-forbidden-files-enforcer tests');
console.log('');

// Forbidden file blocking
console.log('Forbidden file blocking:');

(() => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'src/app.module.ts', content: 'x' } });
  assertEq(r.exitCode, 2, 'blocks Write to src/**');
  const block = JSON.parse(r.stderr);
  assert(block.status === 'blocked', '  status is blocked');
  assert(block.matchedPatterns.includes('src/**'), '  matched src/**');
})();

(() => {
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: 'prisma/schema.prisma', old_string: 'a', new_string: 'b' } });
  assertEq(r.exitCode, 2, 'blocks Edit to prisma/**');
  const block = JSON.parse(r.stderr);
  assert(block.matchedPatterns.includes('prisma/**'), '  matched prisma/**');
})();

(() => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'package.json', content: '{}' } });
  assertEq(r.exitCode, 2, 'blocks Write to package.json');
})();

(() => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: '.github/ai-policy/seed-constitution.md', content: 'x' } });
  assertEq(r.exitCode, 2, 'blocks Write to seed-constitution.md');
})();

(() => {
  const r = runHook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'src/notebook.ipynb', new_source: 'x' } });
  assertEq(r.exitCode, 2, 'blocks NotebookEdit to src/**');
  const block = JSON.parse(r.stderr);
  assert(block.file === 'src/notebook.ipynb', '  file path extracted from notebook_path');
})();

// Allowed file pass-through
console.log('');
console.log('Allowed file pass-through:');

(() => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'scripts/ai/example.js', content: 'x' } });
  assertEq(r.exitCode, 0, 'allows Write to scripts/ai/**');
})();

(() => {
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: 'docs/ai-native/example.md', old_string: 'a', new_string: 'b' } });
  assertEq(r.exitCode, 0, 'allows Edit to docs/ai-native/**');
})();

(() => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'schemas/example.schema.json', content: '{}' } });
  assertEq(r.exitCode, 0, 'allows Write to schemas/**');
})();

// Outside allowedFiles blocking
console.log('');
console.log('Outside allowedFiles blocking:');

(() => {
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'random/file.txt', content: 'x' } });
  assertEq(r.exitCode, 2, 'blocks file outside allowedFiles');
  const block = JSON.parse(r.stderr);
  assert(block.reason.includes('outside allowedFiles'), '  reason mentions outside allowedFiles');
})();

// Edge cases
console.log('');
console.log('Edge cases:');

(() => {
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  assertEq(r.exitCode, 0, 'allows non-file tools (Bash)');
})();

(() => {
  const r = runHook(
    { tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' } },
    { taskFile: '' },
  );
  assertEq(r.exitCode, 0, 'allows when no task file env var set');
})();

(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  const taskFile = path.join(tmpDir, 'task.json');
  fs.writeFileSync(taskFile, JSON.stringify({ allowedFiles: ['**'] }));
  try {
    const r = runHook(
      { tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' } },
      { taskFile },
    );
    assertEq(r.exitCode, 0, 'allows when task has no forbiddenFiles');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();

(() => {
  try {
    execSync(`echo "" | node "${HOOK_SCRIPT}"`, {
      env: { ...process.env, LIAN_WORKER_TASK_FILE: '/nonexistent' },
      encoding: 'utf-8',
      timeout: 5000,
    });
    assert(true, 'allows when stdin is empty (exit 0)');
  } catch (err) {
    assert(err.status !== 2, `allows when stdin is empty (exit ${err.status}, not 2)`);
  }
})();

// Shared locks
console.log('');
console.log('Shared locks:');

(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  const taskFile = path.join(tmpDir, 'task.json');
  fs.writeFileSync(taskFile, JSON.stringify({
    allowedFiles: ['scripts/ai/**'],
    forbiddenFiles: ['package.json', 'package-lock.json'],
    sharedLocks: ['package'],
  }));
  try {
    const r = runHook(
      { tool_name: 'Write', tool_input: { file_path: 'package.json', content: '{}' } },
      { taskFile },
    );
    // Hook blocks forbidden files regardless of sharedLocks (runtime enforcement is stricter)
    assertEq(r.exitCode, 2, 'blocks forbidden file even with sharedLock');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
