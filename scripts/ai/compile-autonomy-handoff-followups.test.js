#!/usr/bin/env node

/**
 * compile-autonomy-handoff-followups.test.js
 *
 * Tests for compile-autonomy-handoff-followups.js.
 * Covers: output shape, proposal structure, category coverage,
 * exit criteria gaps, checklist gaps, skill registry gaps,
 * guarded autopilot gaps, steward workflow gaps, sort order,
 * CLI flags, subprocess integration, and built-in self-test.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'compile-autonomy-handoff-followups.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
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

function parseOutput(stdout) {
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `compile-followups-${name}-${Date.now()}.json`);
}

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

// ── Output shape ─────────────────────────────────────────────────────────────

test('output: schemaVersion is 1', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.schemaVersion, 1);
});

test('output: mode is preview-only', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.mode, 'preview-only');
});

test('output: generatedAt is ISO string', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  assert.ok(typeof output.generatedAt === 'string');
  assert.ok(!isNaN(Date.parse(output.generatedAt)), 'generatedAt should be valid ISO date');
});

test('output: proposalCount is positive number', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  assert.strictEqual(typeof output.proposalCount, 'number');
  assert.ok(output.proposalCount > 0, 'should have at least one proposal');
});

test('output: proposalCount matches proposals array length', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.proposalCount, output.proposals.length);
});

test('output: categoryCounts is object', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  assert.strictEqual(typeof output.categoryCounts, 'object');
  assert.ok(output.categoryCounts !== null);
});

test('output: categoryCounts sum matches proposalCount', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const sum = Object.values(output.categoryCounts).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, output.proposalCount);
});

test('output: has all 5 expected categories', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const expected = [
    'exit-criteria', 'retirement-checklist', 'skill-registry',
    'guarded-autopilot', 'steward-workflow',
  ];
  for (const cat of expected) {
    assert.ok(cat in output.categoryCounts, `missing category: ${cat}`);
    assert.ok(output.categoryCounts[cat] > 0, `category ${cat} has 0 proposals`);
  }
});

// ── Proposal structure ───────────────────────────────────────────────────────

test('structure: every proposal has required fields', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  for (const p of output.proposals) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, `id missing on ${JSON.stringify(p).slice(0, 50)}`);
    assert.ok(typeof p.category === 'string' && p.category.length > 0, `category missing on ${p.id}`);
    assert.ok(typeof p.title === 'string' && p.title.length > 0, `title missing on ${p.id}`);
    assert.ok(typeof p.description === 'string' && p.description.length > 0, `description missing on ${p.id}`);
    assert.ok(typeof p.status === 'string' && p.status.length > 0, `status missing on ${p.id}`);
    assert.ok(typeof p.priority === 'string' && p.priority.length > 0, `priority missing on ${p.id}`);
    assert.ok(typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 100, `confidence invalid on ${p.id}`);
    assert.ok(typeof p.risk === 'string' && p.risk.length > 0, `risk missing on ${p.id}`);
    assert.ok(typeof p.workerClass === 'string' && p.workerClass.length > 0, `workerClass missing on ${p.id}`);
    assert.ok(Array.isArray(p.allowedFiles), `allowedFiles not array on ${p.id}`);
    assert.ok(p.allowedFiles.length > 0, `allowedFiles empty on ${p.id}`);
    assert.ok(p.evidence && typeof p.evidence === 'object', `evidence missing on ${p.id}`);
    assert.ok(typeof p.actionHint === 'string' && p.actionHint.length > 0, `actionHint missing on ${p.id}`);
  }
});

test('structure: every proposal has valid priority', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const validPriorities = ['critical', 'high', 'medium', 'low', 'info'];
  for (const p of output.proposals) {
    assert.ok(validPriorities.includes(p.priority), `invalid priority ${p.priority} on ${p.id}`);
  }
});

test('structure: every proposal has valid risk level', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const validRisks = ['low', 'medium', 'high', 'critical', 'none'];
  for (const p of output.proposals) {
    assert.ok(validRisks.includes(p.risk), `invalid risk ${p.risk} on ${p.id}`);
  }
});

test('structure: all IDs are unique', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const ids = output.proposals.map(p => p.id);
  const unique = new Set(ids);
  assert.strictEqual(ids.length, unique.size, 'duplicate proposal IDs found');
});

// ── Exit criteria proposals ──────────────────────────────────────────────────

test('exit-criteria: has exactly 3 proposals', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const exitProposals = output.proposals.filter(p => p.category === 'exit-criteria');
  assert.strictEqual(exitProposals.length, 3);
});

test('exit-criteria: exit-3 health gate auto-trigger is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'exit-3-health-gate-auto-trigger');
  assert.ok(p, 'exit-3 proposal should exist');
  assert.strictEqual(p.status, 'partial');
  assert.strictEqual(p.priority, 'high');
  assert.strictEqual(p.criterionNumber, 3);
  assert.ok(p.evidence.source.includes('codex-retirement-runbook'));
});

test('exit-criteria: exit-4 recovery auto-dispatch is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'exit-4-recovery-auto-dispatch');
  assert.ok(p, 'exit-4 proposal should exist');
  assert.strictEqual(p.status, 'partial');
  assert.strictEqual(p.priority, 'high');
  assert.strictEqual(p.criterionNumber, 4);
});

test('exit-criteria: exit-7 legacy migration is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'exit-7-legacy-migration');
  assert.ok(p, 'exit-7 proposal should exist');
  assert.strictEqual(p.status, 'open');
  assert.strictEqual(p.criterionNumber, 7);
});

// ── Retirement checklist proposals ───────────────────────────────────────────

test('checklist: has at least 6 proposals', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const checklistProposals = output.proposals.filter(p => p.category === 'retirement-checklist');
  assert.ok(checklistProposals.length >= 6, `expected >= 6, got ${checklistProposals.length}`);
});

test('checklist: fallback-test is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'checklist-fallback-test');
  assert.ok(p, 'fallback-test proposal should exist');
  assert.strictEqual(p.status, 'unchecked');
  assert.strictEqual(p.checklistSection, 'human-process');
});

test('checklist: all legacy component PARITY proposals exist', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const expectedIds = [
    'checklist-launcher-parity',
    'checklist-monitor-parity',
    'checklist-publisher-parity',
    'checklist-merge-helper-parity',
    'checklist-health-gate-parity',
  ];
  for (const id of expectedIds) {
    const p = output.proposals.find(p => p.id === id);
    assert.ok(p, `${id} should exist`);
    assert.strictEqual(p.status, 'unchecked');
    assert.strictEqual(p.checklistSection, 'legacy-retirement');
  }
});

// ── Skill registry proposals ─────────────────────────────────────────────────

test('skill-registry: has at least 1 proposal', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const skillProposals = output.proposals.filter(p => p.category === 'skill-registry');
  assert.ok(skillProposals.length >= 1, `expected >= 1, got ${skillProposals.length}`);
});

test('skill-registry: recovery-dispatch is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'skill-recovery-dispatch');
  assert.ok(p, 'recovery-dispatch proposal should exist');
  assert.strictEqual(p.status, 'missing');
  assert.strictEqual(p.priority, 'high');
  assert.ok(Array.isArray(p.evidence.registeredSkills), 'evidence should list registered skills');
});

// ── Guarded autopilot proposals ──────────────────────────────────────────────

test('autopilot: has at least 1 proposal', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const autopilotProposals = output.proposals.filter(p => p.category === 'guarded-autopilot');
  assert.ok(autopilotProposals.length >= 1, `expected >= 1, got ${autopilotProposals.length}`);
});

test('autopilot: guarded-execute-ci is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'autopilot-guarded-execute-ci');
  assert.ok(p, 'guarded-execute-ci proposal should exist');
  assert.strictEqual(p.status, 'not-wired');
});

// ── Steward workflow proposals ───────────────────────────────────────────────

test('steward: has at least 1 proposal', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const stewardProposals = output.proposals.filter(p => p.category === 'steward-workflow');
  assert.ok(stewardProposals.length >= 1, `expected >= 1, got ${stewardProposals.length}`);
});

test('steward: merge-health-integration is present', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const p = output.proposals.find(p => p.id === 'steward-merge-health-integration');
  assert.ok(p, 'merge-health-integration proposal should exist');
  assert.strictEqual(p.status, 'blocked-by-exit-3');
  assert.strictEqual(p.evidence.blocker, 'exit-3-health-gate-auto-trigger');
});

// ── Sort order ───────────────────────────────────────────────────────────────

test('sort: high priority proposals come before medium', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const highIdx = output.proposals.findIndex(p => p.priority === 'high');
  const mediumIdx = output.proposals.findIndex(p => p.priority === 'medium');
  if (highIdx !== -1 && mediumIdx !== -1) {
    assert.ok(highIdx < mediumIdx, 'high should come before medium');
  }
});

test('sort: within same priority, higher confidence comes first', () => {
  const { stdout } = run(['--stdout']);
  const output = JSON.parse(stdout);
  const highPriority = output.proposals.filter(p => p.priority === 'high');
  for (let i = 0; i < highPriority.length - 1; i++) {
    assert.ok(
      highPriority[i].confidence >= highPriority[i + 1].confidence,
      `confidence should be descending within high priority: ${highPriority[i].confidence} < ${highPriority[i + 1].confidence}`
    );
  }
});

// ── CLI flags ────────────────────────────────────────────────────────────────

test('cli: --stdout prints JSON without extra text', () => {
  const { stdout, exitCode } = run(['--stdout']);
  assert.strictEqual(exitCode, 0);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.schemaVersion, 1);
});

test('cli: --help exits 0 and prints usage', () => {
  const { stdout, exitCode } = run(['--help']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
  assert.ok(stdout.includes('--stdout'));
  assert.ok(stdout.includes('--self-test'));
});

test('cli: -h exits 0', () => {
  const { stdout, exitCode } = run(['-h']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
});

test('cli: unknown argument exits 2', () => {
  const { exitCode, stderr } = run(['--bogus']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('Unknown argument'));
});

test('cli: --out without value exits 2', () => {
  const { exitCode, stderr } = run(['--out']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--out requires a path'));
});

// ── --self-test flag ─────────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── File write ───────────────────────────────────────────────────────────────

test('write: default mode writes file to .github/ai-state/', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('Autonomy handoff follow-ups written to'));
  assert.ok(stdout.includes('autonomy-handoff-followups.json'));

  // Verify the file was written
  const outPath = path.resolve(__dirname, '..', '..', '.github', 'ai-state', 'autonomy-handoff-followups.json');
  assert.ok(fs.existsSync(outPath), 'output file should exist');
  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(written.schemaVersion, 1);

  // Cleanup
  fs.unlinkSync(outPath);
});

test('write: --out writes to custom path', () => {
  const outPath = tmpFile('custom-write');
  try {
    const { stdout, exitCode } = run(['--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Autonomy handoff follow-ups written to'));
    assert.ok(fs.existsSync(outPath), 'custom output file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
    assert.strictEqual(written.mode, 'preview-only');
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

test('write: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `compile-followups-nested-${Date.now()}`, 'sub', 'out.json');
  try {
    const { exitCode } = run(['--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(fs.existsSync(outPath));
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    const parent = path.dirname(outPath);
    if (fs.existsSync(parent)) fs.rmdirSync(parent, { recursive: true });
  }
});

test('write: overwrites existing file', () => {
  const outPath = tmpFile('overwrite');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    const { exitCode } = run(['--out', outPath]);
    assert.strictEqual(exitCode, 0);
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
    assert.strictEqual(written.old, undefined);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  compile-autonomy-handoff-followups.test.js`);
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
