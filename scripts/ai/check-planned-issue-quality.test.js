#!/usr/bin/env node

/**
 * check-planned-issue-quality.test.js
 *
 * Self-tests for the planned issue quality gate logic.
 * Covers: missing sections, missing boundaries, missing validation,
 * missing conflict group, missing risk, missing rollback, missing
 * CONTROL APPENDIX, and passing high-quality issues.
 *
 * The gate evaluates planned issue bodies against the criteria defined in
 * docs/ai-native/planned-issue-quality-gate.md and produces a GateResult
 * conforming to the gate-result-schema with gateType "planned-issue-quality".
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pure-function pattern from
 * check-agent-idea-gate.test.js.
 *
 * Usage:
 *   node scripts/ai/check-planned-issue-quality.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

// ── Pure function mirrors (gate evaluation logic) ──────────────────────────

const VALID_RISKS = ['low', 'medium', 'high'];

function parseControlAppendix(body) {
  const appendix = {};
  const marker = 'CONTROL APPENDIX';
  const idx = body.indexOf(marker);
  if (idx === -1) return null;

  const block = body.slice(idx + marker.length);
  const lines = block.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key && value) {
      appendix[key] = value;
    }
  }

  return Object.keys(appendix).length > 0 ? appendix : null;
}

function hasSection(body, sectionName) {
  const patterns = [
    new RegExp(`^##\\s+${sectionName}\\b`, 'im'),
    new RegExp(`^###\\s+${sectionName}\\b`, 'im'),
  ];
  return patterns.some(re => re.test(body));
}

function evaluateEvidence(body) {
  const blockers = [];
  const warnings = [];

  const requiredSections = ['Goal', 'Scope', 'Acceptance', 'Constraints'];
  const missing = [];

  for (const section of requiredSections) {
    if (!hasSection(body, section)) {
      missing.push(section);
    }
  }

  if (missing.length > 0) {
    blockers.push({
      code: 'MISSING_SECTIONS',
      message: `Issue body missing required sections: ${missing.join(', ')}.`,
    });
  }

  return { blockers, warnings };
}

function evaluateFileBoundaries(body, appendix) {
  const blockers = [];
  const warnings = [];

  const hasAllowed = /allowed\s*files/i.test(body) || (appendix && /allowed\s*files/i.test(Object.keys(appendix).join(' ')));
  const hasForbidden = /forbidden\s*files/i.test(body) || (appendix && /forbidden\s*files/i.test(Object.keys(appendix).join(' ')));

  const appendixAllowed = appendix && (appendix['Allowed files'] || appendix['allowedFiles']);
  const appendixForbidden = appendix && (appendix['Forbidden files'] || appendix['forbiddenFiles']);

  if (!hasAllowed && !appendixAllowed) {
    blockers.push({
      code: 'NO_ALLOWED_FILES',
      message: 'No allowedFiles boundary declared.',
    });
  }

  if (!hasForbidden && !appendixForbidden) {
    warnings.push({
      code: 'NO_FORBIDDEN_FILES',
      message: 'No forbiddenFiles declared.',
    });
  }

  return { blockers, warnings };
}

function evaluateValidation(body, appendix) {
  const blockers = [];

  const hasValidationSection = /validation\s*commands?/i.test(body);
  const hasAcceptanceValidation = hasSection(body, 'Acceptance') && /validation|command|pass|npm\s+run|test/i.test(body);

  const appendixValidation = appendix && (appendix['Validation commands'] || appendix['validationCommands']);
  const appendixHasValidation = appendixValidation && appendixValidation.trim().length > 0;

  const hasValidation = hasValidationSection || hasAcceptanceValidation || appendixHasValidation;

  if (!hasValidation) {
    blockers.push({
      code: 'NO_VALIDATION',
      message: 'No validation commands found.',
    });
  }

  return { blockers, warnings: [] };
}

function evaluateConflictGroup(body, appendix) {
  const blockers = [];

  const appendixGroup = appendix && (appendix['Conflict group'] || appendix['conflictGroup']);

  if (!appendixGroup) {
    blockers.push({
      code: 'NO_CONFLICT_GROUP',
      message: 'No conflictGroup in CONTROL APPENDIX.',
    });
  } else if (appendixGroup.trim().length === 0) {
    blockers.push({
      code: 'EMPTY_CONFLICT_GROUP',
      message: 'conflictGroup is empty.',
    });
  }

  return { blockers, warnings: [] };
}

function evaluateRisk(body, appendix) {
  const blockers = [];
  const warnings = [];

  const appendixRisk = appendix && (appendix['Risk'] || appendix['risk']);

  if (!appendixRisk) {
    blockers.push({
      code: 'NO_RISK_DECLARED',
      message: 'No risk field in CONTROL APPENDIX.',
    });
  } else {
    const riskLower = appendixRisk.toLowerCase();
    if (!VALID_RISKS.includes(riskLower)) {
      blockers.push({
        code: 'INVALID_RISK',
        message: `Risk "${appendixRisk}" is not valid.`,
      });
    }

    if (riskLower === 'high') {
      warnings.push({
        code: 'HIGH_RISK_ISSUE',
        message: 'High-risk issue detected.',
      });
    }
  }

  return { blockers, warnings };
}

function evaluateRollback(body, appendix) {
  const blockers = [];

  const hasRollbackInBody = /rollback|revert|follow[- ]up|mitigation/i.test(body);
  const hasRollbackInAppendix = appendix && /rollback|revert|follow[- ]up/i.test(JSON.stringify(appendix));

  if (!hasRollbackInBody && !hasRollbackInAppendix) {
    blockers.push({
      code: 'NO_ROLLBACK_PLAN',
      message: 'No rollback or follow-up strategy found.',
    });
  }

  return { blockers, warnings: [] };
}

function evaluateControlAppendix(body, appendix) {
  const blockers = [];
  const warnings = [];

  if (!appendix) {
    blockers.push({
      code: 'NO_CONTROL_APPENDIX',
      message: 'No CONTROL APPENDIX block found.',
    });
    return { blockers, warnings };
  }

  const requiredFields = ['Task type', 'Risk', 'Conflict group'];
  const missingFields = [];

  for (const field of requiredFields) {
    const found = Object.keys(appendix).some(k =>
      k.toLowerCase().replace(/\s+/g, ' ') === field.toLowerCase()
    );
    if (!found) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    blockers.push({
      code: 'INCOMPLETE_APPENDIX',
      message: `CONTROL APPENDIX missing required fields: ${missingFields.join(', ')}.`,
    });
  }

  return { blockers, warnings };
}

function evaluateIssue(body) {
  const appendix = parseControlAppendix(body);

  const evidenceResult = evaluateEvidence(body);
  const boundaryResult = evaluateFileBoundaries(body, appendix);
  const validationResult = evaluateValidation(body, appendix);
  const conflictResult = evaluateConflictGroup(body, appendix);
  const riskResult = evaluateRisk(body, appendix);
  const rollbackResult = evaluateRollback(body, appendix);
  const appendixResult = evaluateControlAppendix(body, appendix);

  const allBlockers = [
    ...evidenceResult.blockers,
    ...boundaryResult.blockers,
    ...validationResult.blockers,
    ...conflictResult.blockers,
    ...riskResult.blockers,
    ...rollbackResult.blockers,
    ...appendixResult.blockers,
  ];
  const allWarnings = [
    ...evidenceResult.warnings,
    ...boundaryResult.warnings,
    ...validationResult.warnings,
    ...conflictResult.warnings,
    ...riskResult.warnings,
    ...rollbackResult.warnings,
    ...appendixResult.warnings,
  ];

  let decision;
  let severity;
  if (allBlockers.length > 0) {
    decision = 'block';
    severity = 'error';
  } else if (allWarnings.length > 0) {
    decision = 'warn';
    severity = 'warning';
  } else {
    decision = 'pass';
    severity = 'info';
  }

  return {
    schemaVersion: 1,
    gateType: 'planned-issue-quality',
    decision,
    severity,
    blockers: allBlockers,
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

// ── Test fixtures ───────────────────────────────────────────────────────────

const FULL_ISSUE = `
## Goal
Add planned issue quality gate to reject shallow issues.

## Scope
Build one bounded slice: a gate script, tests, and docs.

## Acceptance
- \`npm run check\` passes
- Relevant focused test for the changed script passes
- Gate rejects issues missing evidence, boundaries, validation, rollback, or conflict groups

## Constraints
- Do not modify runtime backend code
- Do not modify Prisma

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: medium
Conflict group: issue-quality-gate
Target issue: 1325
Target PR: none
Issues: 1325
Expected PR: True
Allowed files:
- scripts/ai/check-planned-issue-quality.js
- scripts/ai/check-planned-issue-quality.test.js
- docs/ai-native/planned-issue-quality-gate.md
Forbidden files:
- src/**
- prisma/**
Validation commands:
- npm run check
`;

const MINIMAL_ISSUE = `
## Goal
Fix a typo.

## Scope
Single file.

## Acceptance
- \`npm run check\` passes

## Constraints
- None.

Revert with git-revert if needed.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
Conflict group: typo-fix
Allowed files:
- docs/typo.md
Forbidden files:
- src/**
`;

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('check-planned-issue-quality.test.js');
console.log('='.repeat(50));

// ── Suite 1: Full high-quality issue passes ─────────────────────────────────

suite('full high-quality issue passes');

{
  const result = evaluateIssue(FULL_ISSUE);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.blockers.length, 0, 'no blockers');
  assertEq(result.warnings.length, 0, 'no warnings');
  assertEq(result.gateType, 'planned-issue-quality', 'gateType is planned-issue-quality');
  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
}

// ── Suite 2: Missing Goal section blocks ────────────────────────────────────

suite('missing Goal section blocks');

{
  const body = `
## Scope
Something.

## Acceptance
- npm run check passes

## Constraints
- None.
`;
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'MISSING_SECTIONS'), 'has MISSING_SECTIONS blocker');
  assert(result.blockers.some(b => b.message.includes('Goal')), 'mentions missing Goal');
}

// ── Suite 3: Missing all sections blocks ────────────────────────────────────

suite('missing all sections blocks');

{
  const body = 'Just a title with no structure.';
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'MISSING_SECTIONS'), 'has MISSING_SECTIONS blocker');
  assert(result.blockers.some(b => b.message.includes('Goal')), 'mentions Goal');
  assert(result.blockers.some(b => b.message.includes('Scope')), 'mentions Scope');
  assert(result.blockers.some(b => b.message.includes('Acceptance')), 'mentions Acceptance');
  assert(result.blockers.some(b => b.message.includes('Constraints')), 'mentions Constraints');
}

// ── Suite 4: No CONTROL APPENDIX blocks ────────────────────────────────────

suite('no CONTROL APPENDIX blocks');

{
  const body = `
## Goal
Something.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.
`;
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_CONTROL_APPENDIX'), 'has NO_CONTROL_APPENDIX blocker');
}

// ── Suite 5: No conflict group blocks ───────────────────────────────────────

suite('no conflict group blocks');

{
  const body = `
## Goal
Something.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
`;
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_CONFLICT_GROUP'), 'has NO_CONFLICT_GROUP blocker');
}

// ── Suite 6: No risk declared blocks ────────────────────────────────────────

suite('no risk declared blocks');

{
  const body = `
## Goal
Something.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Conflict group: my-group
`;
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_RISK_DECLARED'), 'has NO_RISK_DECLARED blocker');
}

// ── Suite 7: No validation blocks ───────────────────────────────────────────

suite('no validation commands blocks');

{
  const body = `
## Goal
Something.

## Scope
Bounded.

## Acceptance
- It works.

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
Conflict group: my-group
`;
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_VALIDATION'), 'has NO_VALIDATION blocker');
}

// ── Suite 8: No rollback blocks ─────────────────────────────────────────────

suite('no rollback plan blocks');

{
  const body = `
## Goal
Something.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
Conflict group: my-group
`;
  const result = evaluateIssue(body);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_ROLLBACK_PLAN'), 'has NO_ROLLBACK_PLAN blocker');
}

// ── Suite 9: No allowed files warns ─────────────────────────────────────────

suite('no forbidden files warns');

{
  const body = `
## Goal
Something.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
Conflict group: my-group
Allowed files:
- src/test.ts
`;
  const result = evaluateIssue(body);

  assert(result.warnings.some(w => w.code === 'NO_FORBIDDEN_FILES'), 'has NO_FORBIDDEN_FILES warning');
}

// ── Suite 10: High risk warns ───────────────────────────────────────────────

suite('high risk warns');

{
  const result = evaluateIssue(FULL_ISSUE.replace('Risk: medium', 'Risk: high'));

  assert(result.warnings.some(w => w.code === 'HIGH_RISK_ISSUE'), 'has HIGH_RISK_ISSUE warning');
}

// ── Suite 11: Invalid risk blocks ───────────────────────────────────────────

suite('invalid risk blocks');

{
  const result = evaluateIssue(FULL_ISSUE.replace('Risk: medium', 'Risk: extreme'));

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'INVALID_RISK'), 'has INVALID_RISK blocker');
}

// ── Suite 12: Minimal valid issue passes ────────────────────────────────────

suite('minimal valid issue passes');

{
  const result = evaluateIssue(MINIMAL_ISSUE);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.blockers.length, 0, 'no blockers');
}

// ── Suite 13: parseControlAppendix extracts fields ──────────────────────────

suite('parseControlAppendix extracts fields');

{
  const appendix = parseControlAppendix(FULL_ISSUE);

  assert(appendix !== null, 'appendix is not null');
  assertEq(appendix['Task type'], 'execution', 'Task type is execution');
  assertEq(appendix['Risk'], 'medium', 'Risk is medium');
  assertEq(appendix['Conflict group'], 'issue-quality-gate', 'Conflict group correct');
  assertEq(appendix['Target issue'], '1325', 'Target issue is 1325');
}

// ── Suite 14: parseControlAppendix returns null for missing ─────────────────

suite('parseControlAppendix returns null for missing appendix');

{
  const appendix = parseControlAppendix('No appendix here.');

  assertEq(appendix, null, 'returns null when no appendix');
}

// ── Suite 15: Gate result shape completeness ────────────────────────────────

suite('gate result shape completeness');

{
  const result = evaluateIssue(FULL_ISSUE);

  assertEq(typeof result.schemaVersion, 'number', 'schemaVersion is number');
  assertEq(typeof result.gateType, 'string', 'gateType is string');
  assertEq(typeof result.decision, 'string', 'decision is string');
  assertEq(typeof result.severity, 'string', 'severity is string');
  assert(Array.isArray(result.blockers), 'blockers is array');
  assert(Array.isArray(result.warnings), 'warnings is array');
}

// ── Suite 16: Multiple blockers accumulate ──────────────────────────────────

suite('multiple blockers accumulate');

{
  const body = 'No structure at all.';
  const result = evaluateIssue(body);

  assert(result.blockers.length >= 3, 'multiple blockers accumulated');
  assertEq(result.severity, 'error', 'severity is error');
}

// ── Suite 17: Rollback in body passes ───────────────────────────────────────

suite('rollback keyword in body passes rollback check');

{
  const body = `
## Goal
Something with rollback strategy: git-revert.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
Conflict group: my-group
`;
  const result = evaluateIssue(body);

  assert(!result.blockers.some(b => b.code === 'NO_ROLLBACK_PLAN'), 'no NO_ROLLBACK_PLAN blocker');
}

// ── Suite 18: Follow-up in body passes rollback check ───────────────────────

suite('follow-up keyword in body passes rollback check');

{
  const body = `
## Goal
Something. Follow-up: monitor after deploy.

## Scope
Bounded.

## Acceptance
- npm run check passes

## Constraints
- None.

---
CONTROL APPENDIX (launcher generated)
Task type: execution
Risk: low
Conflict group: my-group
`;
  const result = evaluateIssue(body);

  assert(!result.blockers.some(b => b.code === 'NO_ROLLBACK_PLAN'), 'no NO_ROLLBACK_PLAN blocker');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
