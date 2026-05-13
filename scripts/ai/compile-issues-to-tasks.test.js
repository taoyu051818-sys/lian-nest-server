#!/usr/bin/env node

/**
 * compile-issues-to-tasks.test.js
 *
 * Tests for the CONTROL APPENDIX parsing logic used by compile-issues-to-tasks.js.
 * Covers: extractField, extractList, parseControlAppendix with valid,
 * partial, and invalid inputs.
 *
 * Uses hand-rolled harness matching the project test pattern.
 *
 * Usage:
 *   node scripts/ai/compile-issues-to-tasks.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

// ── Parsing functions (mirrored from compile-issues-to-tasks.js) ─────────────

function extractField(body, fieldName) {
  const re = new RegExp(`${fieldName}:\\s*(.+)`, 'i');
  const match = body.match(re);
  return match ? match[1].trim() : null;
}

function extractList(body, sectionName) {
  const re = new RegExp(`${sectionName}:\\s*\\n((?:- .+\\n?)+)`, 'i');
  const match = body.match(re);
  if (!match) return [];
  return match[1].split('\n')
    .map(l => l.replace(/^- /, '').trim())
    .filter(l => l.length > 0);
}

function parseControlAppendix(body) {
  if (!body) return null;

  const taskType = extractField(body, 'Task type');
  const risk = extractField(body, 'Risk');
  const conflictGroup = extractField(body, 'Conflict group');
  const actorRole = extractField(body, 'Actor role');
  const allowedFiles = extractList(body, 'Allowed files');
  const forbiddenFiles = extractList(body, 'Forbidden files');
  const validationCommands = extractList(body, 'Validation commands');

  if (!conflictGroup || !allowedFiles || allowedFiles.length === 0) return null;

  return {
    taskType: taskType || 'execution',
    risk: risk || 'low',
    conflictGroup,
    allowedFiles,
    forbiddenFiles: forbiddenFiles.length > 0 ? forbiddenFiles : ['src/**', 'prisma/**', 'package.json'],
    validationCommands: validationCommands.length > 0 ? validationCommands : ['npm run check'],
    rolePacket: { actorRole: actorRole || 'automation-cycle-worker', description: '' },
  };
}

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) { passed++; } else { failed++; failures.push(label); console.error(`  FAIL: ${label}`); }
}

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; } else {
    failed++;
    const msg = `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

// ── extractField tests ───────────────────────────────────────────────────────

function testExtractField() {
  console.log('extractField...');

  const body = 'Task type: execution\nRisk: low\nConflict group: my-group';

  assertEq(extractField(body, 'Task type'), 'execution', 'extractField task type');
  assertEq(extractField(body, 'Risk'), 'low', 'extractField risk');
  assertEq(extractField(body, 'Conflict group'), 'my-group', 'extractField conflict group');
  assertEq(extractField(body, 'Missing field'), null, 'extractField missing returns null');
  assertEq(extractField('', 'Task type'), null, 'extractField empty body returns null');

  // trims whitespace
  assertEq(extractField('Risk:   medium  ', 'Risk'), 'medium', 'extractField trims whitespace');

  // case insensitive
  assertEq(extractField('task type: research', 'Task type'), 'research', 'extractField case insensitive');
}

// ── extractList tests ────────────────────────────────────────────────────────

function testExtractList() {
  console.log('extractList...');

  const body = `Allowed files:
- docs/ai-native/**
- scripts/ai/**
Forbidden files:
- src/**
- prisma/**
`;

  const allowed = extractList(body, 'Allowed files');
  assertEq(allowed.length, 2, 'extractList allowed files count');
  assertEq(allowed[0], 'docs/ai-native/**', 'extractList allowed first');
  assertEq(allowed[1], 'scripts/ai/**', 'extractList allowed second');

  const forbidden = extractList(body, 'Forbidden files');
  assertEq(forbidden.length, 2, 'extractList forbidden files count');
  assertEq(forbidden[0], 'src/**', 'extractList forbidden first');

  // missing section
  assertEq(extractList(body, 'Missing section'), [], 'extractList missing returns []');
  assertEq(extractList('', 'Allowed files'), [], 'extractList empty body returns []');

  // validation commands
  const bodyWithCmds = `Validation commands:
- npm run check
- git diff --check
`;
  const cmds = extractList(bodyWithCmds, 'Validation commands');
  assertEq(cmds.length, 2, 'extractList validation commands count');
  assertEq(cmds[0], 'npm run check', 'extractList first command');
  assertEq(cmds[1], 'git diff --check', 'extractList second command');
}

// ── parseControlAppendix tests ───────────────────────────────────────────────

function testParseControlAppendix() {
  console.log('parseControlAppendix...');

  // null for empty/null body
  assertEq(parseControlAppendix(''), null, 'parseControlAppendix empty returns null');
  assertEq(parseControlAppendix(null), null, 'parseControlAppendix null returns null');

  // full CONTROL APPENDIX
  const fullBody = `Task type: execution
Risk: low
Conflict group: ready-lane-deficit
Actor role: issue-production-worker
Allowed files:
- docs/ai-native/**
- scripts/ai/**
Forbidden files:
- src/**
- prisma/**
- package.json
Validation commands:
- npm run check
`;

  const result = parseControlAppendix(fullBody);
  assert(result !== null, 'parseControlAppendix full body not null');
  assertEq(result.taskType, 'execution', 'parseControlAppendix task type');
  assertEq(result.risk, 'low', 'parseControlAppendix risk');
  assertEq(result.conflictGroup, 'ready-lane-deficit', 'parseControlAppendix conflict group');
  assertEq(result.allowedFiles, ['docs/ai-native/**', 'scripts/ai/**'], 'parseControlAppendix allowed files');
  assertEq(result.forbiddenFiles, ['src/**', 'prisma/**', 'package.json'], 'parseControlAppendix forbidden files');
  assertEq(result.validationCommands, ['npm run check'], 'parseControlAppendix validation commands');
  assertEq(result.rolePacket.actorRole, 'issue-production-worker', 'parseControlAppendix actor role');

  // missing conflictGroup returns null
  const noConflict = `Task type: execution\nAllowed files:\n- docs/**\n`;
  assertEq(parseControlAppendix(noConflict), null, 'parseControlAppendix no conflict group returns null');

  // missing allowedFiles returns null
  const noAllowed = `Task type: execution\nConflict group: test\n`;
  assertEq(parseControlAppendix(noAllowed), null, 'parseControlAppendix no allowed files returns null');

  // empty allowedFiles returns null
  const emptyAllowed = `Task type: execution\nConflict group: test\nAllowed files:\n`;
  assertEq(parseControlAppendix(emptyAllowed), null, 'parseControlAppendix empty allowed files returns null');

  // defaults for missing optional fields
  const minimal = `Conflict group: test\nAllowed files:\n- docs/**\n`;
  const minimalResult = parseControlAppendix(minimal);
  assert(minimalResult !== null, 'parseControlAppendix minimal not null');
  assertEq(minimalResult.taskType, 'execution', 'parseControlAppendix default task type');
  assertEq(minimalResult.risk, 'low', 'parseControlAppendix default risk');
  assertEq(minimalResult.forbiddenFiles, ['src/**', 'prisma/**', 'package.json'], 'parseControlAppendix default forbidden files');
  assertEq(minimalResult.validationCommands, ['npm run check'], 'parseControlAppendix default validation commands');
  assertEq(minimalResult.rolePacket.actorRole, 'automation-cycle-worker', 'parseControlAppendix default actor role');

  // research task type
  const researchBody = `Task type: research\nRisk: medium\nConflict group: research-group\nAllowed files:\n- docs/**\n`;
  const researchResult = parseControlAppendix(researchBody);
  assertEq(researchResult.taskType, 'research', 'parseControlAppendix research task type');
  assertEq(researchResult.risk, 'medium', 'parseControlAppendix medium risk');
}

// ── Run all tests ────────────────────────────────────────────────────────────

function main() {
  console.log('compile-issues-to-tasks.test.js\n');

  testExtractField();
  testExtractList();
  testParseControlAppendix();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  - ${f}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
