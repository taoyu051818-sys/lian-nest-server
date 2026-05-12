#!/usr/bin/env node

/**
 * emit-control-skill-registry.test.js
 *
 * Tests for emit-control-skill-registry.js.
 * Covers: dry-run shape, live write, CLI error handling, help flag,
 * built-in self-test, output structure, required skills, sanitization.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-control-skill-registry.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [EMITTER, ...args], {
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

function parseSnapshot(stdout) {
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `emit-csr-${name}-${Date.now()}.json`);
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

// ── Dry-run tests ────────────────────────────────────────────────────────────

test('dry-run: default mode prints DRY RUN banner', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('DRY RUN'), 'should include DRY RUN banner');
  assert.ok(stdout.includes('control-skill-registry.json'), 'should mention output path');
});

test('dry-run: output is valid JSON after banner', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  const snapshot = parseSnapshot(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
  assert.ok(typeof snapshot.capturedAt === 'string');
});

test('dry-run: does not create output file', () => {
  const outPath = tmpFile('dry-run-no-create');
  try {
    const { exitCode } = run(['--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(!fs.existsSync(outPath), 'dry-run should not create file');
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

test('dry-run: all top-level keys present', () => {
  const { stdout } = run([]);
  const snapshot = parseSnapshot(stdout);
  const keys = ['schemaVersion', 'capturedAt', 'totalSkills', 'summary', 'skills'];
  for (const key of keys) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
});

// ── Output structure ─────────────────────────────────────────────────────────

test('output: schemaVersion is 1', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
});

test('output: capturedAt is ISO-8601', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const parsed = new Date(snapshot.capturedAt);
  assert.ok(!isNaN(parsed.getTime()), 'capturedAt should be valid ISO-8601');
});

test('output: totalSkills matches skills array length', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.totalSkills, snapshot.skills.length);
});

test('output: summary has all required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const { summary } = snapshot;
  assert.ok(typeof summary === 'object', 'summary is object');
  assert.ok(typeof summary.byRisk === 'object', 'byRisk is object');
  assert.ok(typeof summary.bySource === 'object', 'bySource is object');
  assert.ok(typeof summary.dangerousCount === 'number', 'dangerousCount is number');
  assert.ok(typeof summary.readOnlyCount === 'number', 'readOnlyCount is number');
  assert.ok(typeof summary.humanRequiredCount === 'number', 'humanRequiredCount is number');
});

test('output: summary byRisk sums to totalSkills', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const { byRisk } = snapshot.summary;
  const sum = (byRisk.low || 0) + (byRisk.medium || 0) + (byRisk.high || 0) + (byRisk.critical || 0);
  assert.strictEqual(sum, snapshot.totalSkills, 'byRisk sums to totalSkills');
});

test('output: summary bySource sums to totalSkills', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const { bySource } = snapshot.summary;
  const sum = (bySource['action-module'] || 0) + (bySource['action-registry'] || 0);
  assert.strictEqual(sum, snapshot.totalSkills, 'bySource sums to totalSkills');
});

// ── Skill entry shape ────────────────────────────────────────────────────────

test('skills: each entry has all required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const required = ['skillId', 'label', 'description', 'source', 'risk', 'humanRequired', 'dangerous', 'readOnly', 'defaultPreview', 'requiredFields', 'category'];
  for (const skill of snapshot.skills) {
    for (const field of required) {
      assert.ok(field in skill, `skill ${skill.skillId} missing field ${field}`);
    }
  }
});

test('skills: each entry has correct types', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const skill of snapshot.skills) {
    assert.strictEqual(typeof skill.skillId, 'string', `${skill.skillId}.skillId`);
    assert.strictEqual(typeof skill.label, 'string', `${skill.skillId}.label`);
    assert.strictEqual(typeof skill.description, 'string', `${skill.skillId}.description`);
    assert.strictEqual(typeof skill.source, 'string', `${skill.skillId}.source`);
    assert.strictEqual(typeof skill.risk, 'string', `${skill.skillId}.risk`);
    assert.strictEqual(typeof skill.humanRequired, 'boolean', `${skill.skillId}.humanRequired`);
    assert.strictEqual(typeof skill.dangerous, 'boolean', `${skill.skillId}.dangerous`);
    assert.strictEqual(typeof skill.readOnly, 'boolean', `${skill.skillId}.readOnly`);
    assert.strictEqual(typeof skill.defaultPreview, 'boolean', `${skill.skillId}.defaultPreview`);
    assert.ok(Array.isArray(skill.requiredFields), `${skill.skillId}.requiredFields`);
    assert.strictEqual(typeof skill.category, 'string', `${skill.skillId}.category`);
  }
});

test('skills: risk values are valid', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const validRisks = ['low', 'medium', 'high', 'critical'];
  for (const skill of snapshot.skills) {
    assert.ok(validRisks.includes(skill.risk), `skill ${skill.skillId} has invalid risk: ${skill.risk}`);
  }
});

test('skills: source values are valid', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const validSources = ['action-module', 'action-registry'];
  for (const skill of snapshot.skills) {
    assert.ok(validSources.includes(skill.source), `skill ${skill.skillId} has invalid source: ${skill.source}`);
  }
});

test('skills: all skillIds are unique', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const ids = snapshot.skills.map(s => s.skillId);
  const unique = new Set(ids);
  assert.strictEqual(unique.size, ids.length, 'skillIds should be unique');
});

// ── Required skills (acceptance criteria) ────────────────────────────────────

test('skills: includes merge-prs', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'merge-prs');
  assert.ok(skill, 'merge-prs should be present');
  assert.strictEqual(skill.risk, 'high');
  assert.strictEqual(skill.humanRequired, true);
  assert.strictEqual(skill.dangerous, true);
});

test('skills: includes launch-batch', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'launch-batch');
  assert.ok(skill, 'launch-batch should be present');
  assert.strictEqual(skill.risk, 'high');
  assert.strictEqual(skill.humanRequired, true);
});

test('skills: includes issue-state', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'issue-state');
  assert.ok(skill, 'issue-state should be present');
  assert.strictEqual(skill.risk, 'medium');
});

test('skills: includes health-state', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'health-state');
  assert.ok(skill, 'health-state should be present');
});

test('skills: includes status-bundle', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'status-bundle');
  assert.ok(skill, 'status-bundle should be present');
  assert.strictEqual(skill.readOnly, true);
});

test('skills: includes self-cycle', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'self-cycle');
  assert.ok(skill, 'self-cycle should be present');
  assert.strictEqual(skill.readOnly, true);
});

test('skills: includes autopilot-preview', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'autopilot-preview');
  assert.ok(skill, 'autopilot-preview should be present');
  assert.strictEqual(skill.risk, 'low');
  assert.strictEqual(skill.readOnly, true);
  assert.strictEqual(skill.dangerous, false);
  assert.strictEqual(skill.category, 'self-cycle');
});

test('skills: includes autonomy-handoff', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'autonomy-handoff');
  assert.ok(skill, 'autonomy-handoff should be present');
  assert.strictEqual(skill.risk, 'low');
  assert.strictEqual(skill.readOnly, true);
  assert.strictEqual(skill.dangerous, false);
  assert.strictEqual(skill.category, 'self-cycle');
});

test('skills: includes autonomy-readiness', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const skill = snapshot.skills.find(s => s.skillId === 'autonomy-readiness');
  assert.ok(skill, 'autonomy-readiness should be present');
  assert.strictEqual(skill.risk, 'low');
  assert.strictEqual(skill.readOnly, true);
  assert.strictEqual(skill.dangerous, false);
  assert.strictEqual(skill.category, 'self-cycle');
});

test('skills: has both action-module and action-registry sources', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const sources = new Set(snapshot.skills.map(s => s.source));
  assert.ok(sources.has('action-module'), 'should have action-module source');
  assert.ok(sources.has('action-registry'), 'should have action-registry source');
});

// ── Sanitization ─────────────────────────────────────────────────────────────

test('sanitization: no script paths in output', () => {
  const { stdout } = run(['--stdout']);
  assert.ok(!stdout.includes('.ps1'), 'should not contain .ps1 paths');
  assert.ok(!stdout.includes('.sh'), 'should not contain .sh paths');
});

test('sanitization: no secrets or credentials', () => {
  const { stdout } = run(['--stdout']);
  const lower = stdout.toLowerCase();
  assert.ok(!lower.includes('password'), 'should not contain password');
  assert.ok(!lower.includes('api_key'), 'should not contain api_key');
  assert.ok(!lower.includes('api-key'), 'should not contain api-key');
});

// ── Live write tests ─────────────────────────────────────────────────────────

test('live: writes file with --live flag', () => {
  const outPath = tmpFile('live-write');
  try {
    const { stdout, exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Control skill registry written to'), 'should print written message');
    assert.ok(fs.existsSync(outPath), 'file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
    assert.ok(typeof written.capturedAt === 'string');
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

test('live: overwrites existing file', () => {
  const outPath = tmpFile('live-overwrite');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    const { exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
    assert.strictEqual(written.old, undefined);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── --stdout flag ────────────────────────────────────────────────────────────

test('stdout: prints JSON to stdout without banner', () => {
  const { stdout, exitCode } = run(['--stdout']);
  assert.strictEqual(exitCode, 0);
  assert.ok(!stdout.includes('DRY RUN'), 'stdout mode should not have banner');
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
});

test('stdout: combined with --live still prints JSON to stdout', () => {
  const outPath = tmpFile('stdout-live');
  try {
    const { stdout, exitCode } = run(['--stdout', '--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.schemaVersion, 1);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── CLI error handling ───────────────────────────────────────────────────────

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

test('cli: --help exits 0 and prints usage', () => {
  const { stdout, exitCode } = run(['--help']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
  assert.ok(stdout.includes('--live'));
  assert.ok(stdout.includes('--stdout'));
});

test('cli: -h exits 0', () => {
  const { stdout, exitCode } = run(['-h']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
});

// ── Built-in self-test ───────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `emit-csr-nested-${Date.now()}`, 'sub', 'out.json');
  try {
    const { exitCode } = run(['--live', '--out', outPath]);
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

test('edge: totalSkills is positive', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(snapshot.totalSkills > 0, 'should have at least one skill');
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  emit-control-skill-registry.test.js`);
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
