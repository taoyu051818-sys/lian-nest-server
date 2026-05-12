#!/usr/bin/env node

/**
 * emit-command-steward-autonomy-readiness.test.js
 *
 * Tests for emit-command-steward-autonomy-readiness.js.
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-command-steward-autonomy-readiness.js');
const CLEAN_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-steward-readiness-'));
const CHILD_ENV = { ...process.env, COMMAND_STEWARD_STATE_DIR: CLEAN_STATE_DIR };

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [EMITTER, ...args], { encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'], env: CHILD_ENV });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) { return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 }; }
}

function parseSnapshot(stdout) {
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) { return path.join(os.tmpdir(), `emit-readiness-${name}-${Date.now()}.json`); }

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) { try { fn(); passed++; } catch (err) { failed++; failures.push({ name, message: err.message }); } }

// ── Dry-run ──────────────────────────────────────────────────────────────────

test('dry-run: prints DRY RUN banner with valid JSON and all top-level keys', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('DRY RUN'), 'should include DRY RUN banner');
  const snap = parseSnapshot(stdout);
  assert.strictEqual(snap.schemaVersion, 1);
  for (const k of ['schemaVersion', 'capturedAt', 'verdict', 'codexDuties', 'health', 'taskBoard', 'controlSkills', 'blockers', 'inputSources'])
    assert.ok(k in snap, `missing key: ${k}`);
});

test('dry-run: does not create output file', () => {
  const outPath = tmpFile('dry-run-no-create');
  try { const { exitCode } = run(['--out', outPath]); assert.strictEqual(exitCode, 0); assert.ok(!fs.existsSync(outPath)); }
  finally { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); }
});

// ── Verdict ──────────────────────────────────────────────────────────────────

test('verdict: partial when all inputs null (structural duties always met)', () => {
  const { stdout } = run(['--stdout']);
  assert.strictEqual(JSON.parse(stdout).verdict, 'partial');
});

// ── Codex duties ─────────────────────────────────────────────────────────────

test('codexDuties: has 8 duties with required fields', () => {
  const { stdout } = run(['--stdout']);
  const snap = JSON.parse(stdout);
  assert.strictEqual(typeof snap.codexDuties.totalBlocking, 'number');
  assert.strictEqual(typeof snap.codexDuties.metBlocking, 'number');
  assert.ok(Array.isArray(snap.codexDuties.duties));
  assert.strictEqual(snap.codexDuties.duties.length, 8);
  for (const d of snap.codexDuties.duties) {
    assert.strictEqual(typeof d.id, 'string');
    assert.strictEqual(typeof d.name, 'string');
    assert.strictEqual(typeof d.blocking, 'boolean');
    assert.ok(['met', 'partial', 'blocked'].includes(d.status));
    assert.strictEqual(typeof d.evidence, 'string');
  }
});

test('codexDuties: duty-5 and duty-6 always met (structural)', () => {
  const { stdout } = run(['--stdout']);
  const duties = JSON.parse(stdout).codexDuties.duties;
  assert.strictEqual(duties.find(d => d.id === 'duty-5').status, 'met');
  assert.strictEqual(duties.find(d => d.id === 'duty-6').status, 'met');
});

// ── Health section ───────────────────────────────────────────────────────────

test('health: has required fields and valid state', () => {
  const { stdout } = run(['--stdout']);
  const h = JSON.parse(stdout).health;
  assert.strictEqual(typeof h.loaded, 'boolean');
  assert.strictEqual(typeof h.state, 'string');
  assert.ok(Array.isArray(h.checks));
  assert.ok(Array.isArray(h.failedChecks));
  assert.ok(['green', 'yellow', 'red', 'black', 'unknown'].includes(h.state));
});

// ── Task board ───────────────────────────────────────────────────────────────

test('taskBoard: has required fields', () => {
  const { stdout } = run(['--stdout']);
  const tb = JSON.parse(stdout).taskBoard;
  assert.strictEqual(typeof tb.loaded, 'boolean');
  assert.strictEqual(typeof tb.activeWorkerCount, 'number');
  assert.ok(Array.isArray(tb.workers));
  assert.strictEqual(typeof tb.queueDepth, 'number');
});

// ── Control skills ───────────────────────────────────────────────────────────

test('controlSkills: has required fields and all expected categories', () => {
  const { stdout } = run(['--stdout']);
  const cs = JSON.parse(stdout).controlSkills;
  assert.strictEqual(typeof cs.totalSkills, 'number');
  assert.ok(cs.totalSkills > 0);
  assert.strictEqual(typeof cs.dangerousCount, 'number');
  assert.strictEqual(typeof cs.humanRequiredCount, 'number');
  assert.strictEqual(typeof cs.coverageComplete, 'boolean');
  assert.ok(Array.isArray(cs.coverage));
  for (const cat of ['view', 'merge', 'launch', 'health', 'planning'])
    assert.ok(cs.coverage.some(c => c.category === cat), `category ${cat} present`);
});

// ── Blockers ─────────────────────────────────────────────────────────────────

test('blockers: health and codex-duty blockers present when inputs missing', () => {
  const { stdout } = run(['--stdout']);
  const b = JSON.parse(stdout).blockers;
  assert.ok(Array.isArray(b));
  assert.ok(b.some(x => x.source === 'health'));
  assert.ok(b.some(x => x.source === 'codex-duty'));
  for (const x of b) {
    assert.strictEqual(typeof x.source, 'string');
    assert.strictEqual(typeof x.severity, 'string');
    assert.strictEqual(typeof x.message, 'string');
  }
});

// ── Input sources ────────────────────────────────────────────────────────────

test('inputSources: all expected boolean flags present', () => {
  const { stdout } = run(['--stdout']);
  const is = JSON.parse(stdout).inputSources;
  for (const k of ['healthLoaded', 'activeWorkersLoaded', 'metaSignalsLoaded', 'providerPoolLoaded', 'workerTrustLoaded', 'queueLoaded'])
    assert.strictEqual(typeof is[k], 'boolean');
});

// ── Live write ───────────────────────────────────────────────────────────────

test('live: writes file and overwrites existing', () => {
  const outPath = tmpFile('live-write');
  try {
    const { stdout, exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('autonomy readiness report written to'));
    assert.ok(fs.existsSync(outPath));
    assert.strictEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')).schemaVersion, 1);
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    run(['--live', '--out', outPath]);
    assert.strictEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')).schemaVersion, 1);
  } finally { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); }
});

// ── stdout flag ──────────────────────────────────────────────────────────────

test('stdout: prints JSON without banner', () => {
  const { stdout, exitCode } = run(['--stdout']);
  assert.strictEqual(exitCode, 0);
  assert.ok(!stdout.includes('DRY RUN'));
  assert.strictEqual(JSON.parse(stdout).schemaVersion, 1);
});

// ── CLI errors ───────────────────────────────────────────────────────────────

test('cli: unknown argument exits 2', () => { const { exitCode, stderr } = run(['--bogus']); assert.strictEqual(exitCode, 2); assert.ok(stderr.includes('Unknown argument')); });
test('cli: --out without value exits 2', () => { const { exitCode, stderr } = run(['--out']); assert.strictEqual(exitCode, 2); assert.ok(stderr.includes('--out requires a path')); });
test('cli: --help and -h exit 0 with usage', () => { for (const f of ['--help', '-h']) { const { stdout, exitCode } = run([f]); assert.strictEqual(exitCode, 0); assert.ok(stdout.includes('USAGE')); } });

// ── Self-test ────────────────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => { const { stdout, exitCode } = run(['--self-test']); assert.strictEqual(exitCode, 0); assert.ok(stdout.includes('All self-tests passed')); });

// ── Sanitization ─────────────────────────────────────────────────────────────

test('sanitization: no secret-shaped keys in output', () => {
  const json = JSON.stringify(JSON.parse(run(['--stdout']).stdout));
  for (const w of ['token', 'secret', 'password']) assert.ok(!json.includes(`"${w}"`), `should not have ${w} key`);
});

// ── Consistency ──────────────────────────────────────────────────────────────

test('consistency: blockers have valid sources and severities', () => {
  const { stdout } = run(['--stdout']);
  const b = JSON.parse(stdout).blockers;
  const validSources = ['health', 'codex-duty', 'control-skills', 'task-board'];
  const validSev = ['info', 'warning', 'medium', 'high', 'critical'];
  for (const x of b) { assert.ok(validSources.includes(x.source), `valid source: ${x.source}`); assert.ok(validSev.includes(x.severity), `valid severity: ${x.severity}`); }
});

test('consistency: metBlocking <= totalBlocking', () => {
  const { stdout } = run(['--stdout']);
  const d = JSON.parse(stdout).codexDuties;
  assert.ok(d.metBlocking <= d.totalBlocking);
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `emit-readiness-nested-${Date.now()}`, 'sub', 'out.json');
  try { const { exitCode } = run(['--live', '--out', outPath]); assert.strictEqual(exitCode, 0); assert.ok(fs.existsSync(outPath)); }
  finally { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); const p = path.dirname(outPath); if (fs.existsSync(p)) fs.rmdirSync(p, { recursive: true }); }
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  emit-command-steward-autonomy-readiness.test.js`);
console.log(`  ${passed}/${total} passed`);
if (failed > 0) { console.log(`\n  FAILURES:\n`); for (const f of failures) { console.log(`    ${f.name}\n      ${f.message}\n`); } process.exit(1); }
else { console.log(`\n  All tests passed.\n`); process.exit(0); }
