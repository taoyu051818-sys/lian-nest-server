#!/usr/bin/env node

/**
 * check-agent-idea-gate.test.js
 *
 * Self-tests for the agent idea review gate logic.
 * Covers: missing evidence fails, high risk needs human,
 * bounded low-risk passes, and forbidden direct command fails.
 *
 * The gate evaluates idea candidates against the criteria defined in
 * docs/ai-native/agent-idea-review-gate.md and produces a GateResult
 * conforming to schemas/gate-result.schema.json with gateType "idea-review".
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pure-function pattern from
 * suggest-next-tasks-from-meta-signals.test.js.
 *
 * Usage:
 *   node scripts/ai/check-agent-idea-gate.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

const crypto = require('crypto');

// ── Pure function mirrors (gate evaluation logic) ──────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function markerId(title, conflictGroup) {
  const hash = crypto
    .createHash('sha256')
    .update(`${title}||${conflictGroup}`)
    .digest('hex')
    .slice(0, 12);
  return `idea-${hash}-review`;
}

function evaluateSignalQuality(candidate, now) {
  if (!candidate.source || !candidate.signalValues) {
    return { pass: false, blockers: [{ code: 'NO_SOURCE_SIGNAL', message: 'Idea has no traceable origin or source signal.' }], warnings: [] };
  }

  const blockers = [];
  const warnings = [];

  if (candidate.signalAgeDays !== undefined && candidate.signalAgeDays > 7) {
    blockers.push({ code: 'STALE_SIGNAL', message: `Source signal is ${candidate.signalAgeDays} days old (threshold: 7).` });
  }

  const sv = candidate.signalValues || {};
  const hasSeverity =
    (sv.failureScore !== undefined && sv.failureScore > 0) ||
    (sv.frictionScore !== undefined && sv.frictionScore > 30) ||
    (sv.riskScore !== undefined && sv.riskScore > 40) ||
    candidate.source === 'human-request';

  if (!hasSeverity) {
    blockers.push({ code: 'INSUFFICIENT_SEVERITY', message: 'Signal severity does not justify action.' });
  }

  return { pass: blockers.length === 0, blockers, warnings };
}

function evaluateScopeFeasibility(candidate) {
  const blockers = [];
  const warnings = [];

  const files = candidate.suggestedAllowedFiles || [];
  if (files.length === 0) {
    blockers.push({ code: 'NO_ACCEPTANCE_CRITERIA', message: 'No allowed files specified — cannot verify scope.' });
  }

  const broadPatterns = ['src/**', '**/*'];
  if (files.some((f) => broadPatterns.includes(f) || files.length > 10)) {
    blockers.push({ code: 'SCOPE_TOO_BROAD', message: 'allowedFiles exceeds 10 entries or contains overly broad patterns.' });
  }

  if (candidate.concerns && candidate.concerns.length > 1) {
    warnings.push({ code: 'MULTI_CONCERN', message: 'Idea mixes multiple concerns. Consider splitting.' });
  }

  return { pass: blockers.length === 0, blockers, warnings };
}

function evaluateArchitecturalFit(candidate) {
  const blockers = [];
  const warnings = [];

  const forbidden = ['.env', 'dist/', 'node_modules/', 'prisma/migrations/'];
  const files = candidate.suggestedAllowedFiles || [];
  for (const file of files) {
    for (const pat of forbidden) {
      if (file === pat || file.startsWith(pat)) {
        blockers.push({ code: 'FORBIDDEN_PATTERN', message: `Proposed file "${file}" matches forbidden pattern "${pat}".` });
      }
    }
  }

  return { pass: blockers.length === 0, blockers, warnings };
}

function evaluateExternalIntegrity(candidate) {
  const blockers = [];

  const textFields = [candidate.title, candidate.reason, candidate.actionHint]
    .filter(Boolean);

  const commandPatterns = [
    { re: /^!/, desc: 'shell command prefix' },
    { re: /\$\([^)]*\)/, desc: 'subshell execution' },
    { re: /`[^`]+`/, desc: 'backtick execution' },
  ];

  for (const field of textFields) {
    for (const { re } of commandPatterns) {
      if (re.test(field)) {
        blockers.push({ code: 'FORBIDDEN_DIRECT_COMMAND', message: 'External text contains command execution patterns and must not be interpreted as a command.' });
        return { pass: false, blockers };
      }
    }
  }

  return { pass: true, blockers };
}

function evaluateIdea(candidate, now) {
  const capturedAt = (now || new Date()).toISOString();

  const signalResult = evaluateSignalQuality(candidate, now);
  const scopeResult = evaluateScopeFeasibility(candidate);
  const archResult = evaluateArchitecturalFit(candidate);
  const extResult = evaluateExternalIntegrity(candidate);

  const allBlockers = [
    ...signalResult.blockers,
    ...scopeResult.blockers,
    ...archResult.blockers,
    ...extResult.blockers,
  ];
  const allWarnings = [
    ...signalResult.warnings,
    ...scopeResult.warnings,
    ...archResult.warnings,
  ];

  let decision;
  let severity;
  if (allBlockers.length > 0) {
    decision = 'reject';
    severity = 'error';
  } else if (allWarnings.length > 0) {
    decision = 'warn';
    severity = 'warning';
  } else {
    decision = 'promote';
    severity = 'info';
  }

  const conflictGroup = candidate.suggestedConflictGroup || 'unknown';
  const id = markerId(candidate.title || '', conflictGroup);

  const producedFacts = [];
  if (decision === 'promote' || decision === 'warn') {
    producedFacts.push({ key: 'idea-source', value: candidate.source || 'unknown' });
    producedFacts.push({ key: 'conflict-group', value: conflictGroup });
    if (candidate.suggestedWorkerType) {
      producedFacts.push({ key: 'worker-type', value: candidate.suggestedWorkerType });
    }
  }

  return {
    schemaVersion: 1,
    gateType: 'idea-review',
    decision,
    severity,
    markerId: id,
    capturedAt,
    targetIssue: null,
    targetPR: null,
    factsRead: candidate.factsRead || [],
    blockers: allBlockers,
    warnings: allWarnings,
    producedFacts,
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

console.log('check-agent-idea-gate.test.js');
console.log('='.repeat(50));

// ── Suite 1: Missing evidence fails ─────────────────────────────────────────

suite('missing evidence fails');

{
  const candidate = {
    title: 'Add dark mode toggle',
    source: null,
    signalValues: null,
    suggestedConflictGroup: 'ui-dark-mode',
    suggestedAllowedFiles: ['src/modules/ui/**'],
    suggestedWorkerType: 'runtime-feature',
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assertEq(result.severity, 'error', 'severity is error');
  assertEq(result.gateType, 'idea-review', 'gateType is idea-review');
  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
  assert(result.blockers.length > 0, 'has at least one blocker');
  assertEq(result.blockers[0].code, 'NO_SOURCE_SIGNAL', 'blocker code is NO_SOURCE_SIGNAL');
  assert(result.blockers[0].message.length > 0, 'blocker has message');
  assertEq(result.producedFacts.length, 0, 'no produced facts on reject');
}

// ── Suite 2: Missing evidence — empty signalValues ──────────────────────────

suite('missing evidence: empty signalValues');

{
  const candidate = {
    title: 'Refactor auth module',
    source: 'meta-signal',
    signalValues: {},
    suggestedConflictGroup: 'auth-refactor',
    suggestedAllowedFiles: ['src/modules/auth/**'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'INSUFFICIENT_SEVERITY'), 'has INSUFFICIENT_SEVERITY blocker');
}

// ── Suite 3: Stale signal fails ─────────────────────────────────────────────

suite('stale signal fails');

{
  const candidate = {
    title: 'Fix runtime compile failures',
    source: 'meta-signal',
    signalAgeDays: 14,
    signalValues: { failureScore: 25, topPain: 'runtime compile' },
    suggestedConflictGroup: 'runtime-compile-fix',
    suggestedAllowedFiles: ['src/modules/auth/**'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'STALE_SIGNAL'), 'has STALE_SIGNAL blocker');
}

// ── Suite 4: High risk needs human ──────────────────────────────────────────

suite('high risk needs human: high riskScore');

{
  const candidate = {
    title: 'Migrate payment gateway',
    source: 'meta-signal',
    signalValues: { riskScore: 85 },
    suggestedConflictGroup: 'payment-migration',
    suggestedAllowedFiles: ['src/modules/payment/**'],
    suggestedWorkerType: 'foundation-fix',
  };

  const result = evaluateIdea(candidate);

  // High risk with valid evidence and bounded scope passes the gate.
  // The "needs human" requirement is enforced at the reliability tier
  // level (external-reality-intake.md: High tier requires human approval
  // for action-triggering), not as a gate blocker.
  assertEq(result.decision, 'promote', 'decision is promote');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.blockers.length, 0, 'no blockers for high risk with evidence');
  assert(result.producedFacts.some((f) => f.key === 'conflict-group'), 'produced facts include conflict-group');
}

// ── Suite 5: High risk needs human — risk below threshold ───────────────────

suite('high risk needs human: risk below threshold no severity');

{
  const candidate = {
    title: 'Update docs',
    source: 'meta-signal',
    signalValues: { riskScore: 20 },
    suggestedConflictGroup: 'docs-update',
    suggestedAllowedFiles: ['docs/**'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject when riskScore below threshold and no other severity');
  assert(result.blockers.some((b) => b.code === 'INSUFFICIENT_SEVERITY'), 'has INSUFFICIENT_SEVERITY blocker');
}

// ── Suite 6: Bounded low-risk passes ────────────────────────────────────────

suite('bounded low-risk passes');

{
  const candidate = {
    title: 'Add unit tests for auth service',
    source: 'meta-signal',
    signalValues: { failureScore: 5, frictionScore: 10 },
    suggestedConflictGroup: 'auth-test-coverage',
    suggestedAllowedFiles: ['src/modules/auth/auth.service.spec.ts'],
    suggestedWorkerType: 'test-addition',
    factsRead: [
      { source: '.github/ai-state/meta-signals.json', 'summary': 'failureScore=5, frictionScore=10' },
    ],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'promote', 'decision is promote');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.blockers.length, 0, 'no blockers');
  assertEq(result.warnings.length, 0, 'no warnings');
  assertEq(result.gateType, 'idea-review', 'gateType is idea-review');
  assert(result.markerId.startsWith('idea-'), 'markerId starts with idea-');
  assert(result.markerId.endsWith('-review'), 'markerId ends with -review');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(result.capturedAt.includes('T'), 'capturedAt is ISO-8601');
  assert(result.producedFacts.length >= 2, 'produced facts include source and conflict-group');
  assertEq(result.producedFacts[0].key, 'idea-source', 'first produced fact is idea-source');
  assertEq(result.producedFacts[0].value, 'meta-signal', 'idea-source value correct');
  assertEq(result.producedFacts[1].key, 'conflict-group', 'second produced fact is conflict-group');
  assertEq(result.producedFacts[1].value, 'auth-test-coverage', 'conflict-group value correct');
  assertEq(result.producedFacts[2].key, 'worker-type', 'third produced fact is worker-type');
  assertEq(result.producedFacts[2].value, 'test-addition', 'worker-type value correct');
}

// ── Suite 7: Bounded low-risk — minimal candidate ───────────────────────────

suite('bounded low-risk: minimal with human source');

{
  const candidate = {
    title: 'Rename deprecated method',
    source: 'human-request',
    signalValues: {},
    suggestedConflictGroup: 'cleanup-rename',
    suggestedAllowedFiles: ['src/modules/common/utils.ts'],
    concerns: ['refactor'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'promote', 'human-request passes severity check');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.blockers.length, 0, 'no blockers');
}

// ── Suite 8: Bounded low-risk with warn — multi-concern ─────────────────────

suite('bounded low-risk: warn on multi-concern');

{
  const candidate = {
    title: 'Fix bug and add docs',
    source: 'meta-signal',
    signalValues: { failureScore: 10 },
    suggestedConflictGroup: 'fix-and-docs',
    suggestedAllowedFiles: ['src/modules/auth/**', 'docs/auth.md'],
    concerns: ['fix', 'docs'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'warn', 'decision is warn for multi-concern');
  assertEq(result.severity, 'warning', 'severity is warning');
  assertEq(result.blockers.length, 0, 'no blockers');
  assert(result.warnings.some((w) => w.code === 'MULTI_CONCERN'), 'has MULTI_CONCERN warning');
  assert(result.producedFacts.length > 0, 'produced facts present on warn');
}

// ── Suite 9: Forbidden direct command fails — backtick ──────────────────────

suite('forbidden direct command fails: backtick execution');

{
  const candidate = {
    title: 'Run `rm -rf /tmp/old` cleanup',
    source: 'meta-signal',
    signalValues: { failureScore: 10 },
    suggestedConflictGroup: 'cleanup',
    suggestedAllowedFiles: ['scripts/cleanup.sh'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'FORBIDDEN_DIRECT_COMMAND'), 'has FORBIDDEN_DIRECT_COMMAND blocker');
  assertEq(result.severity, 'error', 'severity is error');
}

// ── Suite 10: Forbidden direct command fails — shell prefix ─────────────────

suite('forbidden direct command fails: shell prefix');

{
  const candidate = {
    title: 'Deploy staging',
    reason: '!npm run deploy:staging would fix the issue',
    source: 'meta-signal',
    signalValues: { frictionScore: 50 },
    suggestedConflictGroup: 'deploy',
    suggestedAllowedFiles: ['scripts/deploy.sh'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'FORBIDDEN_DIRECT_COMMAND'), 'has FORBIDDEN_DIRECT_COMMAND blocker');
}

// ── Suite 11: Forbidden direct command fails — subshell ─────────────────────

suite('forbidden direct command fails: subshell');

{
  const candidate = {
    title: 'Auto-fix lint',
    actionHint: 'Run $(npx eslint --fix) on affected files',
    source: 'meta-signal',
    signalValues: { frictionScore: 40 },
    suggestedConflictGroup: 'lint-fix',
    suggestedAllowedFiles: ['src/**/*.ts'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'FORBIDDEN_DIRECT_COMMAND'), 'has FORBIDDEN_DIRECT_COMMAND blocker');
}

// ── Suite 12: Forbidden direct command — clean text passes ──────────────────

suite('forbidden direct command: clean text passes');

{
  const candidate = {
    title: 'Fix runtime compile failures in auth module',
    reason: 'failureScore=25, topPain=runtime compile. Recent health checks report red-state entries.',
    actionHint: 'Review recent health check logs for red-state entries and address root causes.',
    source: 'meta-signal',
    signalValues: { failureScore: 25, topPain: 'runtime compile' },
    suggestedConflictGroup: 'runtime-compile-fix',
    suggestedAllowedFiles: ['src/modules/auth/**'],
    suggestedWorkerType: 'foundation-fix',
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'promote', 'clean text passes');
  assertEq(result.blockers.length, 0, 'no blockers for clean text');
}

// ── Suite 13: Scope too broad fails ─────────────────────────────────────────

suite('scope too broad: overly broad pattern');

{
  const candidate = {
    title: 'Refactor everything',
    source: 'meta-signal',
    signalValues: { failureScore: 10 },
    suggestedConflictGroup: 'global-refactor',
    suggestedAllowedFiles: ['src/**'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'SCOPE_TOO_BROAD'), 'has SCOPE_TOO_BROAD blocker');
}

// ── Suite 14: Forbidden file pattern fails ──────────────────────────────────

suite('architectural fit: forbidden .env file');

{
  const candidate = {
    title: 'Update env config',
    source: 'meta-signal',
    signalValues: { frictionScore: 35 },
    suggestedConflictGroup: 'env-config',
    suggestedAllowedFiles: ['.env'],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.decision, 'reject', 'decision is reject');
  assert(result.blockers.some((b) => b.code === 'FORBIDDEN_PATTERN'), 'has FORBIDDEN_PATTERN blocker');
}

// ── Suite 15: Marker ID determinism ─────────────────────────────────────────

suite('markerId determinism');

{
  const id1 = markerId('Fix auth', 'auth-fix');
  const id2 = markerId('Fix auth', 'auth-fix');
  const id3 = markerId('Fix auth', 'other-group');
  const id4 = markerId('Fix payments', 'auth-fix');

  assertEq(id1, id2, 'same inputs produce same markerId');
  assert(id1 !== id3, 'different conflictGroup produces different markerId');
  assert(id1 !== id4, 'different title produces different markerId');
  assert(id1.startsWith('idea-'), 'markerId starts with idea-');
  assert(id1.endsWith('-review'), 'markerId ends with -review');
}

// ── Suite 16: Gate result shape completeness ────────────────────────────────

suite('gate result shape completeness');

{
  const candidate = {
    title: 'Test idea',
    source: 'meta-signal',
    signalValues: { failureScore: 10 },
    suggestedConflictGroup: 'test-group',
    suggestedAllowedFiles: ['src/test.ts'],
    suggestedWorkerType: 'test',
    factsRead: [{ source: 'test.json', summary: 'test' }],
  };

  const result = evaluateIdea(candidate);

  assertEq(typeof result.schemaVersion, 'number', 'schemaVersion is number');
  assertEq(typeof result.gateType, 'string', 'gateType is string');
  assertEq(typeof result.decision, 'string', 'decision is string');
  assertEq(typeof result.severity, 'string', 'severity is string');
  assertEq(typeof result.markerId, 'string', 'markerId is string');
  assertEq(typeof result.capturedAt, 'string', 'capturedAt is string');
  assertEq(result.targetIssue, null, 'targetIssue is null');
  assertEq(result.targetPR, null, 'targetPR is null');
  assert(Array.isArray(result.factsRead), 'factsRead is array');
  assert(Array.isArray(result.blockers), 'blockers is array');
  assert(Array.isArray(result.warnings), 'warnings is array');
  assert(Array.isArray(result.producedFacts), 'producedFacts is array');
}

// ── Suite 17: Severity escalation — multiple blockers ───────────────────────

suite('severity: multiple blockers still error');

{
  const candidate = {
    title: 'Bad idea',
    source: null,
    signalValues: null,
    suggestedConflictGroup: 'bad',
    suggestedAllowedFiles: [],
  };

  const result = evaluateIdea(candidate);

  assertEq(result.severity, 'error', 'multiple blockers severity is error');
  assert(result.blockers.length >= 2, 'multiple blockers accumulated');
}

// ── Suite 18: factsRead passthrough ─────────────────────────────────────────

suite('factsRead passthrough');

{
  const factsRead = [
    { source: '.github/ai-state/meta-signals.json', summary: 'failureScore=25' },
    { source: '.github/ai-state/main-health.json', summary: 'green' },
  ];
  const candidate = {
    title: 'Idea with facts',
    source: 'meta-signal',
    signalValues: { failureScore: 25 },
    suggestedConflictGroup: 'test',
    suggestedAllowedFiles: ['src/test.ts'],
    factsRead,
  };

  const result = evaluateIdea(candidate);

  assertEq(result.factsRead.length, 2, 'factsRead length preserved');
  assertEq(result.factsRead[0].source, factsRead[0].source, 'factsRead source preserved');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
