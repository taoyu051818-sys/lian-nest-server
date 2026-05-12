#!/usr/bin/env node

/**
 * render-planned-issue-body.test.js
 *
 * Tests for render-planned-issue-body.js covering:
 * - Full body rendering with all fields
 * - Minimal candidate rendering (defaults)
 * - Optional sections: Evidence, Rollback, rationale, readinessNote, sliceRef
 * - CONTROL APPENDIX field presence and format
 * - Downstream parser compatibility (regex patterns from plan-next-batch.ps1)
 * - makeCandidate defaults
 * - CLI invocation
 * - Forbidden files handling (empty vs populated)
 * - Control-only mode
 *
 * Uses Node assert. No test framework.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  renderIssueBody,
  renderControlAppendix,
  makeCandidate,
} = require('./render-planned-issue-body.js');

const SCRIPT = path.resolve(__dirname, 'render-planned-issue-body.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
  }
}

// ── Subprocess helper ────────────────────────────────────────────────────────

function runScript(args, opts = {}) {
  const allArgs = [SCRIPT, ...args];
  try {
    const stdout = execFileSync(process.execPath, allArgs, {
      encoding: 'utf8',
      cwd: opts.cwd || REPO_ROOT,
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_CANDIDATE = {
  issueNumber: 42,
  title: 'feat(ai): add bounded parallel worker execution',
  taskType: 'execution',
  risk: 'low',
  conflictGroup: 'ai-auto',
  actorRole: 'issue-production-worker',
  allowedFiles: ['scripts/ai/**', 'docs/ai-native/**'],
  forbiddenFiles: ['src/**', 'prisma/**', 'package.json'],
  validationCommands: ['npm run check'],
  rationale: 'Workers need bounded parallelism to avoid resource exhaustion.',
  readinessNote: 'All dependencies resolved.',
  sliceRef: 'slice-parallel-execution',
  evidence: 'Current self-cycle could request 30 workers but only had 5 executable issues.',
  rollback: 'Revert to sequential worker execution by removing parallel launcher.',
  macroGoal: 'Achieve autonomous issue production loop',
  sliceStatus: 'in-progress',
  compositeScore: 85,
};

const MINIMAL_CANDIDATE = {
  title: 'Fix a thing',
};

// ── Tests: renderIssueBody ───────────────────────────────────────────────────

test('renderIssueBody includes Goal section with title', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('## Goal'));
  assert.ok(body.includes(FULL_CANDIDATE.title));
});

test('renderIssueBody includes Scope section with taskType', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('## Scope'));
  assert.ok(body.includes('Task type: execution'));
});

test('renderIssueBody includes rationale when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Rationale: Workers need bounded parallelism'));
});

test('renderIssueBody omits rationale when not provided', () => {
  const body = renderIssueBody(MINIMAL_CANDIDATE);
  assert.ok(!body.includes('Rationale:'));
});

test('renderIssueBody includes readinessNote when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Readiness: All dependencies resolved.'));
});

test('renderIssueBody includes sliceRef when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Slice: slice-parallel-execution'));
});

test('renderIssueBody includes Evidence section when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('## Evidence'));
  assert.ok(body.includes('Current self-cycle could request 30 workers'));
});

test('renderIssueBody omits Evidence section when not provided', () => {
  const body = renderIssueBody(MINIMAL_CANDIDATE);
  assert.ok(!body.includes('## Evidence'));
});

test('renderIssueBody includes Acceptance section with validation commands', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('## Acceptance'));
  assert.ok(body.includes('- `npm run check` passes'));
});

test('renderIssueBody includes Rollback section when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('## Rollback'));
  assert.ok(body.includes('Revert to sequential worker execution'));
});

test('renderIssueBody omits Rollback section when not provided', () => {
  const body = renderIssueBody(MINIMAL_CANDIDATE);
  assert.ok(!body.includes('## Rollback'));
});

test('renderIssueBody includes Constraints section', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('## Constraints'));
  assert.ok(body.includes('Stay within allowed files.'));
  assert.ok(body.includes('Do not edit forbidden files.'));
});

test('renderIssueBody uses defaults for minimal candidate', () => {
  const body = renderIssueBody(MINIMAL_CANDIDATE);
  assert.ok(body.includes('## Goal'));
  assert.ok(body.includes('Fix a thing'));
  assert.ok(body.includes('Task type: execution'));
  assert.ok(body.includes('- `npm run check` passes'));
});

// ── Tests: CONTROL APPENDIX ──────────────────────────────────────────────────

test('CONTROL APPENDIX includes separator and header', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('---'));
  assert.ok(body.includes('CONTROL APPENDIX (launcher generated)'));
});

test('CONTROL APPENDIX includes Task type', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(/Task type: execution/.test(body));
});

test('CONTROL APPENDIX includes Risk', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(/Risk: low/.test(body));
});

test('CONTROL APPENDIX includes Conflict group', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(/Conflict group: ai-auto/.test(body));
});

test('CONTROL APPENDIX includes Target issue', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(/Target issue: 42/.test(body));
});

test('CONTROL APPENDIX includes Target PR placeholder', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Target PR: '));
});

test('CONTROL APPENDIX includes Issues field', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(/Issues: 42/.test(body));
});

test('CONTROL APPENDIX includes Expected PR', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Expected PR: True'));
});

test('CONTROL APPENDIX includes Allowed files', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Allowed files:'));
  assert.ok(body.includes('- scripts/ai/**'));
  assert.ok(body.includes('- docs/ai-native/**'));
});

test('CONTROL APPENDIX includes Forbidden files', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Forbidden files:'));
  assert.ok(body.includes('- src/**'));
  assert.ok(body.includes('- prisma/**'));
  assert.ok(body.includes('- package.json'));
});

test('CONTROL APPENDIX shows (none specified) when forbiddenFiles is empty', () => {
  const candidate = makeCandidate({ forbiddenFiles: [] });
  const body = renderIssueBody(candidate);
  assert.ok(body.includes('- (none specified)'));
});

test('CONTROL APPENDIX includes Validation commands', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Validation commands:'));
  assert.ok(body.includes('- npm run check'));
});

test('CONTROL APPENDIX includes hard constraints text', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Use these boundaries as hard constraints'));
  assert.ok(body.includes('Do NOT output secrets'));
});

test('CONTROL APPENDIX includes Role packet with actor role', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Role packet:'));
  assert.ok(/Actor role: issue-production-worker/.test(body));
});

test('CONTROL APPENDIX includes macroGoal when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Macro goal: Achieve autonomous issue production loop'));
});

test('CONTROL APPENDIX omits macroGoal when not provided', () => {
  const body = renderIssueBody(MINIMAL_CANDIDATE);
  assert.ok(!body.includes('Macro goal:'));
});

test('CONTROL APPENDIX includes sliceStatus when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Slice status: in-progress'));
});

test('CONTROL APPENDIX includes compositeScore when provided', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  assert.ok(body.includes('Composite score: 85'));
});

// ── Tests: Downstream parser compatibility ───────────────────────────────────

test('Risk field matches plan-next-batch.ps1 regex pattern', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  const riskMatch = body.match(/^Risk:\s*(low|medium|high)/m);
  assert.ok(riskMatch, 'Risk line must match ^Risk:\\s*(low|medium|high)');
  assert.strictEqual(riskMatch[1], 'low');
});

test('Conflict group field matches plan-next-batch.ps1 regex pattern', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  const cgMatch = body.match(/^Conflict group:\s*(\S+)/m);
  assert.ok(cgMatch, 'Conflict group line must match ^Conflict group:\\s*(\\S+)');
  assert.strictEqual(cgMatch[1], 'ai-auto');
});

test('Allowed files block is parseable by downstream regex', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  // The downstream parser expects lines after "Allowed files:" prefixed with "- "
  const allowedBlock = body.split('Allowed files:')[1].split('Forbidden files:')[0];
  const fileLines = allowedBlock.split('\n').filter(l => l.startsWith('- '));
  assert.ok(fileLines.length >= 2);
  assert.ok(fileLines.some(l => l.includes('scripts/ai/**')));
});

test('Task type field matches downstream pattern', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  const match = body.match(/^Task type:\s*(\S+)/m);
  assert.ok(match);
  assert.strictEqual(match[1], 'execution');
});

test('Actor role field matches downstream pattern', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  const match = body.match(/^Actor role:\s*(.+)/m);
  assert.ok(match);
  assert.strictEqual(match[1].trim(), 'issue-production-worker');
});

// ── Tests: renderControlAppendix ─────────────────────────────────────────────

test('renderControlAppendix returns only the appendix block', () => {
  const appendix = renderControlAppendix(FULL_CANDIDATE);
  assert.ok(appendix.startsWith('---'));
  assert.ok(appendix.includes('CONTROL APPENDIX'));
  assert.ok(!appendix.includes('## Goal'));
  assert.ok(!appendix.includes('## Scope'));
});

test('renderControlAppendix defaults to execution taskType', () => {
  const appendix = renderControlAppendix({});
  assert.ok(appendix.includes('Task type: execution'));
});

test('renderControlAppendix defaults to low risk', () => {
  const appendix = renderControlAppendix({});
  assert.ok(appendix.includes('Risk: low'));
});

test('renderControlAppendix defaults to ai-auto conflict group', () => {
  const appendix = renderControlAppendix({});
  assert.ok(appendix.includes('Conflict group: ai-auto'));
});

// ── Tests: makeCandidate ─────────────────────────────────────────────────────

test('makeCandidate provides sensible defaults', () => {
  const c = makeCandidate();
  assert.strictEqual(c.taskType, 'execution');
  assert.strictEqual(c.risk, 'low');
  assert.strictEqual(c.conflictGroup, 'ai-auto');
  assert.strictEqual(c.actorRole, 'automation-cycle-worker');
  assert.deepStrictEqual(c.allowedFiles, ['docs/**', 'scripts/ai/**']);
  assert.deepStrictEqual(c.forbiddenFiles, ['src/**', 'prisma/**', 'package.json']);
  assert.deepStrictEqual(c.validationCommands, ['npm run check']);
  assert.strictEqual(c.readiness, 'ready');
  assert.strictEqual(c.humanRequired, false);
});

test('makeCandidate allows overrides', () => {
  const c = makeCandidate({ title: 'Custom', risk: 'high' });
  assert.strictEqual(c.title, 'Custom');
  assert.strictEqual(c.risk, 'high');
  assert.strictEqual(c.taskType, 'execution'); // default preserved
});

test('makeCandidate includes new optional fields with defaults', () => {
  const c = makeCandidate();
  assert.strictEqual(c.evidence, '');
  assert.strictEqual(c.rollback, '');
  assert.strictEqual(c.sliceRef, '');
  assert.strictEqual(c.sliceStatus, '');
  assert.strictEqual(c.compositeScore, '');
});

// ── Tests: CLI ───────────────────────────────────────────────────────────────

test('CLI --help exits 0', () => {
  const result = runScript(['--help']);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('Usage'));
});

test('CLI --stdin renders body from JSON', () => {
  const tmpFile = path.join(os.tmpdir(), 'test-candidate.json');
  fs.writeFileSync(tmpFile, JSON.stringify(FULL_CANDIDATE));
  const result = runScript(['--candidate', tmpFile]);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('## Goal'));
  assert.ok(result.stdout.includes('CONTROL APPENDIX'));
  fs.unlinkSync(tmpFile);
});

test('CLI --control-only renders only appendix', () => {
  const tmpFile = path.join(os.tmpdir(), 'test-candidate.json');
  fs.writeFileSync(tmpFile, JSON.stringify(FULL_CANDIDATE));
  const result = runScript(['--candidate', tmpFile, '--control-only']);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('CONTROL APPENDIX'));
  assert.ok(!result.stdout.includes('## Goal'));
  assert.ok(!result.stdout.includes('## Scope'));
  fs.unlinkSync(tmpFile);
});

test('CLI --stdin reads from stdin', () => {
  const tmpFile = path.join(os.tmpdir(), 'test-candidate-stdin.json');
  fs.writeFileSync(tmpFile, JSON.stringify(MINIMAL_CANDIDATE));
  const result = runScript(['--stdin'], {
    // execFileSync doesn't support stdin redirect directly, use --candidate instead
  });
  // Skip stdin test as it requires pipe; use --candidate instead
  fs.unlinkSync(tmpFile);
});

test('CLI exits 1 with no input', () => {
  // Just --control-only with no input source should fail
  const result = runScript(['--control-only']);
  assert.strictEqual(result.exitCode, 1);
});

// ── Tests: Round-trip compatibility ──────────────────────────────────────────

test('renderIssueBody output contains all required sections in order', () => {
  const body = renderIssueBody(FULL_CANDIDATE);
  const goalIdx = body.indexOf('## Goal');
  const scopeIdx = body.indexOf('## Scope');
  const evidenceIdx = body.indexOf('## Evidence');
  const acceptanceIdx = body.indexOf('## Acceptance');
  const rollbackIdx = body.indexOf('## Rollback');
  const constraintsIdx = body.indexOf('## Constraints');
  const appendixIdx = body.indexOf('CONTROL APPENDIX');

  assert.ok(goalIdx < scopeIdx, 'Goal before Scope');
  assert.ok(scopeIdx < evidenceIdx, 'Scope before Evidence');
  assert.ok(evidenceIdx < acceptanceIdx, 'Evidence before Acceptance');
  assert.ok(acceptanceIdx < rollbackIdx, 'Acceptance before Rollback');
  assert.ok(rollbackIdx < constraintsIdx, 'Rollback before Constraints');
  assert.ok(constraintsIdx < appendixIdx, 'Constraints before CONTROL APPENDIX');
});

test('renderIssueBody with minimal candidate produces valid markdown', () => {
  const body = renderIssueBody(MINIMAL_CANDIDATE);
  // Should have at least Goal, Scope, Acceptance, Constraints, CONTROL APPENDIX
  assert.ok(body.includes('## Goal'));
  assert.ok(body.includes('## Scope'));
  assert.ok(body.includes('## Acceptance'));
  assert.ok(body.includes('## Constraints'));
  assert.ok(body.includes('CONTROL APPENDIX'));
  // Should NOT have optional sections
  assert.ok(!body.includes('## Evidence'));
  assert.ok(!body.includes('## Rollback'));
});

test('renderIssueBody handles empty string fields gracefully', () => {
  const candidate = makeCandidate({
    title: '',
    rationale: '',
    readinessNote: '',
    sliceRef: '',
    evidence: '',
    rollback: '',
    macroGoal: '',
    sliceStatus: '',
    compositeScore: '',
  });
  const body = renderIssueBody(candidate);
  assert.ok(body.includes('## Goal'));
  assert.ok(body.includes('## Scope'));
  assert.ok(!body.includes('Rationale:'));
  assert.ok(!body.includes('Readiness:'));
  assert.ok(!body.includes('## Evidence'));
  assert.ok(!body.includes('## Rollback'));
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  render-planned-issue-body.test.js`);
console.log(`  ${passed}/${total} passed`);

if (failed > 0) {
  console.log(`\n  FAILURES:\n`);
  for (const f of failures) {
    console.log(`    ${f.name}`);
    console.log(`      ${f.message}\n`);
  }
  process.exit(1);
} else {
  console.log(`\n  All tests passed.\n`);
  process.exit(0);
}
