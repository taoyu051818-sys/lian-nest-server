#!/usr/bin/env node

/**
 * check-worker-behavior-policy.test.js
 *
 * Self-tests for the worker behavior policy checker.
 * Covers: broad diffs flagged, forbidden drive-by files detected,
 * missing validation evidence caught, and clean PRs pass.
 *
 * The checker evaluates PR facts against the worker behavior policy
 * defined in docs/ai-native/worker-behavior-policy.md.
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pattern from
 * check-agent-idea-gate.test.js.
 *
 * Usage:
 *   node scripts/ai/check-worker-behavior-policy.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

// ── Pure function mirrors (policy evaluation logic) ──────────────────────────

const BROAD_DIFF_THRESHOLD = 500;
const BROAD_FILE_COUNT = 10;
const BROAD_PATTERNS = ['src/**', '**/*', '**', 'src/**/**'];

const FORBIDDEN_PREFIXES = [
  '.env',
  'dist/',
  'node_modules/',
  'prisma/migrations/',
  '.github/ai-policy/seed-constitution.md',
  '.github/ai-state/',
];

function evaluateSimplestViableChange(facts) {
  const violations = [];
  const warnings = [];

  const maxFiles = facts.maxFiles || BROAD_FILE_COUNT;
  const maxLines = facts.maxLinesChanged || BROAD_DIFF_THRESHOLD;

  const filesChanged = facts.filesChanged || [];
  const linesAdded = facts.linesAdded || 0;
  const linesRemoved = facts.linesRemoved || 0;
  const totalLines = linesAdded + linesRemoved;

  if (filesChanged.length > maxFiles) {
    violations.push({
      code: 'TOO_MANY_FILES',
      message: `PR changes ${filesChanged.length} files (max ${maxFiles}). Diff is broader than necessary.`,
    });
  }

  if (totalLines > maxLines) {
    violations.push({
      code: 'DIFF_TOO_LARGE',
      message: `PR changes ${totalLines} lines (max ${maxLines}). Consider a smaller, more focused change.`,
    });
  }

  for (const file of filesChanged) {
    if (BROAD_PATTERNS.includes(file)) {
      violations.push({
        code: 'BROAD_DIFF_PATTERN',
        message: `File pattern "${file}" is overly broad. Use specific module-level paths.`,
      });
    }
  }

  return { violations, warnings };
}

function evaluateSurgicalScope(facts) {
  const violations = [];
  const warnings = [];

  const filesChanged = facts.filesChanged || [];
  const allowedFiles = facts.allowedFiles || [];
  const forbiddenFiles = facts.forbiddenFiles || [];

  if (allowedFiles.length > 0) {
    for (const file of filesChanged) {
      const normalized = file.replace(/\\/g, '/');
      const isAllowed = allowedFiles.some(pattern => {
        const normalizedPattern = pattern.replace(/\\/g, '/');
        if (normalizedPattern.includes('*')) {
          const regex = new RegExp(
            '^' + normalizedPattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
          );
          return regex.test(normalized);
        }
        return normalized === normalizedPattern || normalized.startsWith(normalizedPattern);
      });

      if (!isAllowed) {
        violations.push({
          code: 'DRIVE_BY_FILE',
          message: `File "${file}" is not in allowedFiles. Workers must stay within surgical scope.`,
        });
      }
    }
  }

  for (const file of filesChanged) {
    const normalized = file.replace(/\\/g, '/');
    for (const forbidden of forbiddenFiles) {
      const normalizedForbidden = forbidden.replace(/\\/g, '/');
      if (normalizedForbidden.includes('*')) {
        const regex = new RegExp(
          '^' + normalizedForbidden.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
        );
        if (regex.test(normalized)) {
          violations.push({
            code: 'FORBIDDEN_FILE_TOUCHED',
            message: `File "${file}" matches forbidden pattern "${forbidden}". Never touch forbidden files.`,
          });
        }
      } else if (normalized === normalizedForbidden || normalized.startsWith(normalizedForbidden)) {
        violations.push({
          code: 'FORBIDDEN_FILE_TOUCHED',
          message: `File "${file}" is forbidden. Never touch forbidden files.`,
        });
      }
    }
  }

  for (const file of filesChanged) {
    const normalized = file.replace(/\\/g, '/');
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (normalized === prefix || normalized.startsWith(prefix)) {
        violations.push({
          code: 'FORBIDDEN_FILE_TOUCHED',
          message: `File "${file}" matches forbidden prefix "${prefix}".`,
        });
      }
    }
  }

  return { violations, warnings };
}

function evaluateVerifiableEvidence(facts) {
  const violations = [];
  const warnings = [];

  const validationCommands = facts.validationCommands || [];
  const validationOutput = facts.validationOutput;

  if (validationCommands.length === 0) {
    violations.push({
      code: 'NO_VALIDATION_COMMANDS',
      message: 'No validationCommands defined. Every PR must declare how it was verified.',
    });
  }

  if (!validationOutput || (typeof validationOutput === 'string' && validationOutput.trim().length === 0)) {
    violations.push({
      code: 'NO_VALIDATION_EVIDENCE',
      message: 'No validationOutput present. PR body must include validation evidence.',
    });
  }

  return { violations, warnings };
}

function evaluatePr(facts) {
  const simplestResult = evaluateSimplestViableChange(facts);
  const scopeResult = evaluateSurgicalScope(facts);
  const evidenceResult = evaluateVerifiableEvidence(facts);

  const allViolations = [
    ...simplestResult.violations,
    ...scopeResult.violations,
    ...evidenceResult.violations,
  ];
  const allWarnings = [
    ...simplestResult.warnings,
    ...scopeResult.warnings,
    ...evidenceResult.warnings,
  ];

  const decision = allViolations.length > 0 ? 'violation' : 'pass';
  const severity = allViolations.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'info');

  return {
    schemaVersion: 1,
    checkType: 'worker-behavior-policy',
    decision,
    severity,
    prNumber: facts.prNumber || null,
    branch: facts.branch || null,
    capturedAt: new Date().toISOString(),
    violations: allViolations,
    warnings: allWarnings,
  };
}

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

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('check-worker-behavior-policy.test.js');
console.log('='.repeat(50));

// ── Suite 1: Clean PR passes ────────────────────────────────────────────────

suite('clean PR passes');

{
  const facts = {
    prNumber: 100,
    branch: 'claude/wave6-issue-100',
    filesChanged: ['src/modules/auth/auth.service.ts'],
    linesAdded: 30,
    linesRemoved: 10,
    allowedFiles: ['src/modules/auth/**'],
    forbiddenFiles: ['.env'],
    maxFiles: 5,
    maxLinesChanged: 200,
    validationCommands: ['npm test'],
    validationOutput: 'all tests passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.checkType, 'worker-behavior-policy', 'checkType is worker-behavior-policy');
  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(result.violations.length, 0, 'no violations');
  assertEq(result.warnings.length, 0, 'no warnings');
  assertEq(result.prNumber, 100, 'prNumber preserved');
  assertEq(result.branch, 'claude/wave6-issue-100', 'branch preserved');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(result.capturedAt.includes('T'), 'capturedAt is ISO-8601');
}

// ── Suite 2: Broad diff — too many files ────────────────────────────────────

suite('broad diff: too many files');

{
  const facts = {
    prNumber: 101,
    branch: 'claude/wave6-issue-101',
    filesChanged: [
      'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts',
      'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts', 'src/j.ts',
      'src/k.ts',
    ],
    linesAdded: 100,
    linesRemoved: 50,
    allowedFiles: ['src/**'],
    maxFiles: 5,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assertEq(result.severity, 'error', 'severity is error');
  assert(result.violations.some(v => v.code === 'TOO_MANY_FILES'), 'has TOO_MANY_FILES violation');
}

// ── Suite 3: Broad diff — too many lines ────────────────────────────────────

suite('broad diff: too many lines');

{
  const facts = {
    prNumber: 102,
    branch: 'claude/wave6-issue-102',
    filesChanged: ['src/big-change.ts'],
    linesAdded: 400,
    linesRemoved: 200,
    allowedFiles: ['src/**'],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'DIFF_TOO_LARGE'), 'has DIFF_TOO_LARGE violation');
}

// ── Suite 4: Forbidden drive-by file ────────────────────────────────────────

suite('forbidden drive-by file');

{
  const facts = {
    prNumber: 103,
    branch: 'claude/wave6-issue-103',
    filesChanged: ['src/modules/auth/auth.service.ts', 'src/modules/payments/payments.service.ts'],
    linesAdded: 20,
    linesRemoved: 5,
    allowedFiles: ['src/modules/auth/**'],
    forbiddenFiles: [],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'DRIVE_BY_FILE'), 'has DRIVE_BY_FILE violation');
  assert(
    result.violations.some(v => v.message.includes('payments.service.ts')),
    'drive-by file name in message'
  );
}

// ── Suite 5: Forbidden file touched — .env ──────────────────────────────────

suite('forbidden file touched: .env');

{
  const facts = {
    prNumber: 104,
    branch: 'claude/wave6-issue-104',
    filesChanged: ['src/app.ts', '.env'],
    linesAdded: 5,
    linesRemoved: 2,
    allowedFiles: ['src/**', '.env'],
    forbiddenFiles: ['.env'],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'FORBIDDEN_FILE_TOUCHED'), 'has FORBIDDEN_FILE_TOUCHED violation');
}

// ── Suite 6: Forbidden file touched — prisma migrations ─────────────────────

suite('forbidden file touched: prisma migrations');

{
  const facts = {
    prNumber: 105,
    branch: 'claude/wave6-issue-105',
    filesChanged: ['prisma/migrations/20260101_init/migration.sql'],
    linesAdded: 50,
    linesRemoved: 0,
    allowedFiles: ['prisma/migrations/**'],
    forbiddenFiles: [],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'FORBIDDEN_FILE_TOUCHED'), 'has FORBIDDEN_FILE_TOUCHED');
}

// ── Suite 7: Missing validation commands ─────────────────────────────────────

suite('missing validation commands');

{
  const facts = {
    prNumber: 106,
    branch: 'claude/wave6-issue-106',
    filesChanged: ['src/foo.ts'],
    linesAdded: 10,
    linesRemoved: 5,
    allowedFiles: ['src/**'],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: [],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'NO_VALIDATION_COMMANDS'), 'has NO_VALIDATION_COMMANDS');
}

// ── Suite 8: Missing validation evidence ─────────────────────────────────────

suite('missing validation evidence');

{
  const facts = {
    prNumber: 107,
    branch: 'claude/wave6-issue-107',
    filesChanged: ['src/foo.ts'],
    linesAdded: 10,
    linesRemoved: 5,
    allowedFiles: ['src/**'],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: '',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'NO_VALIDATION_EVIDENCE'), 'has NO_VALIDATION_EVIDENCE');
}

// ── Suite 9: Missing validation evidence — null ─────────────────────────────

suite('missing validation evidence: null output');

{
  const facts = {
    prNumber: 108,
    branch: 'claude/wave6-issue-108',
    filesChanged: ['src/foo.ts'],
    linesAdded: 10,
    linesRemoved: 5,
    allowedFiles: ['src/**'],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: null,
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'NO_VALIDATION_EVIDENCE'), 'has NO_VALIDATION_EVIDENCE');
}

// ── Suite 10: Multiple violations accumulate ────────────────────────────────

suite('multiple violations accumulate');

{
  const facts = {
    prNumber: 109,
    branch: 'claude/wave6-issue-109',
    filesChanged: [
      'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts',
      'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts', 'src/j.ts',
      'src/k.ts', '.env',
    ],
    linesAdded: 600,
    linesRemoved: 100,
    allowedFiles: ['src/**'],
    forbiddenFiles: ['.env'],
    maxFiles: 5,
    maxLinesChanged: 500,
    validationCommands: [],
    validationOutput: null,
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.length >= 4, 'multiple violations accumulated');
  assert(result.violations.some(v => v.code === 'TOO_MANY_FILES'), 'has TOO_MANY_FILES');
  assert(result.violations.some(v => v.code === 'DIFF_TOO_LARGE'), 'has DIFF_TOO_LARGE');
  assert(result.violations.some(v => v.code === 'NO_VALIDATION_COMMANDS'), 'has NO_VALIDATION_COMMANDS');
  assert(result.violations.some(v => v.code === 'NO_VALIDATION_EVIDENCE'), 'has NO_VALIDATION_EVIDENCE');
}

// ── Suite 11: Allowed files with glob patterns ──────────────────────────────

suite('allowed files with glob patterns');

{
  const facts = {
    prNumber: 110,
    branch: 'claude/wave6-issue-110',
    filesChanged: ['src/modules/auth/auth.controller.ts', 'src/modules/auth/auth.service.ts'],
    linesAdded: 40,
    linesRemoved: 10,
    allowedFiles: ['src/modules/auth/**'],
    forbiddenFiles: [],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.violations.length, 0, 'no violations for files matching glob');
}

// ── Suite 12: Drive-by with no allowedFiles specified ───────────────────────

suite('no allowedFiles skips drive-by check');

{
  const facts = {
    prNumber: 111,
    branch: 'claude/wave6-issue-111',
    filesChanged: ['src/a.ts', 'src/b.ts', 'docs/readme.md'],
    linesAdded: 20,
    linesRemoved: 5,
    allowedFiles: [],
    forbiddenFiles: [],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'pass', 'decision is pass when no allowedFiles');
  assert(!result.violations.some(v => v.code === 'DRIVE_BY_FILE'), 'no drive-by check without allowedFiles');
}

// ── Suite 13: Result shape completeness ─────────────────────────────────────

suite('result shape completeness');

{
  const facts = {
    prNumber: 112,
    branch: 'claude/wave6-issue-112',
    filesChanged: ['src/test.ts'],
    linesAdded: 10,
    linesRemoved: 5,
    allowedFiles: ['src/**'],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(typeof result.schemaVersion, 'number', 'schemaVersion is number');
  assertEq(typeof result.checkType, 'string', 'checkType is string');
  assertEq(typeof result.decision, 'string', 'decision is string');
  assertEq(typeof result.severity, 'string', 'severity is string');
  assertEq(typeof result.prNumber, 'number', 'prNumber is number');
  assertEq(typeof result.branch, 'string', 'branch is string');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(Array.isArray(result.violations), 'violations is array');
  assert(Array.isArray(result.warnings), 'warnings is array');
}

// ── Suite 14: No PR mutations — read-only check ─────────────────────────────

suite('no PR mutations: result contains no mutation fields');

{
  const facts = {
    prNumber: 113,
    branch: 'claude/wave6-issue-113',
    filesChanged: ['src/foo.ts'],
    linesAdded: 100,
    linesRemoved: 50,
    allowedFiles: ['src/**'],
    maxFiles: 5,
    maxLinesChanged: 200,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  // The result should not contain any mutation-related fields
  assert(!('mergeState' in result), 'no mergeState field');
  assert(!('action' in result), 'no action field');
  assert(!('command' in result), 'no command field');
  assertEq(result.checkType, 'worker-behavior-policy', 'checkType is checker only');
}

// ── Suite 15: Forbidden .github/ai-state files ──────────────────────────────

suite('forbidden .github/ai-state files');

{
  const facts = {
    prNumber: 114,
    branch: 'claude/wave6-issue-114',
    filesChanged: ['src/foo.ts', '.github/ai-state/main-health.json'],
    linesAdded: 10,
    linesRemoved: 5,
    allowedFiles: ['src/**', '.github/ai-state/**'],
    forbiddenFiles: [],
    maxFiles: 10,
    maxLinesChanged: 500,
    validationCommands: ['npm test'],
    validationOutput: 'passed',
  };

  const result = evaluatePr(facts);

  assertEq(result.decision, 'violation', 'decision is violation');
  assert(result.violations.some(v => v.code === 'FORBIDDEN_FILE_TOUCHED'), 'has FORBIDDEN_FILE_TOUCHED for ai-state');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
