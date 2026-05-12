#!/usr/bin/env node

/**
 * emit-command-steward-brief.test.js
 *
 * Tests for emit-command-steward-brief.js.
 * Covers: dry-run shape, live write, missing inputs produce safe defaults,
 * section structure, blockers, recommended actions, human-required items,
 * CLI error handling, help flag, built-in self-test.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const EMITTER = path.resolve(__dirname, 'emit-command-steward-brief.js');

// Isolate tests from local .github/ai-state files
const CLEAN_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-steward-brief-'));
const CHILD_ENV = { ...process.env, COMMAND_STEWARD_STATE_DIR: CLEAN_STATE_DIR };

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [EMITTER, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: CHILD_ENV,
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
  // Strip DRY RUN banner if present — find first '{'
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `emit-steward-${name}-${Date.now()}.json`);
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

test('dry-run: prints DRY RUN banner with valid JSON and all top-level keys', () => {
  const { stdout, exitCode } = run([]);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('DRY RUN'), 'should include DRY RUN banner');
  assert.ok(stdout.includes('command-steward-brief.json'), 'should mention output path');
  const snapshot = parseSnapshot(stdout);
  assert.strictEqual(snapshot.schemaVersion, 1);
  assert.ok(typeof snapshot.capturedAt === 'string');
  const keys = ['schemaVersion', 'capturedAt', 'systemStatus', 'providerSummary',
    'workerSummary', 'trustSummary', 'lockSummary', 'metaSignalsSummary',
    'riskSignalsSummary', 'opportunitySignalsSummary', 'budgetSummary', 'parallelSummary',
    'issueProductionSummary', 'blockers',
    'recommendedNextActions', 'humanRequiredItems', 'inputSources'];
  for (const key of keys) { assert.ok(key in snapshot, `missing key: ${key}`); }
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

// ── System status shape ──────────────────────────────────────────────────────

test('systemStatus: has overall, health, resources', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(typeof snapshot.systemStatus.overall === 'string', 'overall is string');
  assert.ok(typeof snapshot.systemStatus.health === 'object', 'health is object');
  assert.ok(typeof snapshot.systemStatus.resources === 'object', 'resources is object');
});

test('systemStatus: overall is one of known values', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const valid = ['operational', 'degraded', 'critical', 'unrecoverable', 'unknown'];
  assert.ok(valid.includes(snapshot.systemStatus.overall),
    `overall should be one of ${valid.join('/')}, got: ${snapshot.systemStatus.overall}`);
});

test('systemStatus: health has state field', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(typeof snapshot.systemStatus.health.state === 'string', 'health.state is string');
});

// ── Section shapes ───────────────────────────────────────────────────────────

test('all summary sections have loaded boolean', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const section of ['providerSummary', 'workerSummary', 'trustSummary',
    'lockSummary', 'metaSignalsSummary', 'riskSignalsSummary', 'opportunitySignalsSummary']) {
    assert.strictEqual(typeof snapshot[section].loaded, 'boolean', `${section}.loaded`);
  }
});

test('count sections have count or activeLocks field', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(typeof snapshot.workerSummary.count, 'number', 'workerSummary.count');
  assert.strictEqual(typeof snapshot.lockSummary.activeLocks, 'number', 'lockSummary.activeLocks');
  assert.strictEqual(typeof snapshot.riskSignalsSummary.count, 'number', 'riskSignalsSummary.count');
  assert.strictEqual(typeof snapshot.opportunitySignalsSummary.count, 'number', 'opportunitySignalsSummary.count');
});

test('budgetSummary: has expected shape when telemetry absent', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.budgetSummary.loaded, false, 'budgetSummary.loaded');
  assert.strictEqual(snapshot.budgetSummary.recentWorkerCount, 0, 'recentWorkerCount');
  assert.strictEqual(snapshot.budgetSummary.avgWallClockMs, null, 'avgWallClockMs');
  assert.strictEqual(snapshot.budgetSummary.slowestWallClockMs, null, 'slowestWallClockMs');
  assert.ok(typeof snapshot.budgetSummary.tokenSummary === 'object', 'tokenSummary is object');
  assert.ok(typeof snapshot.budgetSummary.costEstimate === 'object', 'costEstimate is object');
  assert.ok(Array.isArray(snapshot.budgetSummary.budgetBlockers), 'budgetBlockers is array');
  // Token summary has all confidence buckets
  for (const bucket of ['high', 'medium', 'low', 'unknown']) {
    assert.ok(bucket in snapshot.budgetSummary.tokenSummary, `tokenSummary.${bucket}`);
    assert.strictEqual(typeof snapshot.budgetSummary.tokenSummary[bucket].inputTokens, 'number', `${bucket}.inputTokens`);
    assert.strictEqual(typeof snapshot.budgetSummary.tokenSummary[bucket].outputTokens, 'number', `${bucket}.outputTokens`);
  }
  assert.strictEqual(typeof snapshot.budgetSummary.costEstimate.totalCents, 'number', 'costEstimate.totalCents');
  assert.strictEqual(typeof snapshot.budgetSummary.costEstimate.pricingBasis, 'string', 'costEstimate.pricingBasis');
});

// ── Issue production summary shape ───────────────────────────────────────────

test('issueProductionSummary: has expected shape when launchCandidates absent', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.issueProductionSummary.loaded, false, 'issueProductionSummary.loaded');
  assert.strictEqual(snapshot.issueProductionSummary.readyIssueCount, 0, 'readyIssueCount');
  assert.strictEqual(snapshot.issueProductionSummary.totalOpen, 0, 'totalOpen');
  assert.strictEqual(snapshot.issueProductionSummary.topUpNeeded, false, 'topUpNeeded');
  assert.strictEqual(snapshot.issueProductionSummary.topUpGap, null, 'topUpGap');
  assert.ok(typeof snapshot.issueProductionSummary.riskBreakdown === 'object', 'riskBreakdown is object');
  assert.ok(typeof snapshot.issueProductionSummary.classBreakdown === 'object', 'classBreakdown is object');
  assert.strictEqual(snapshot.issueProductionSummary.lastCycle, null, 'lastCycle is null');
  assert.ok(typeof snapshot.issueProductionSummary.recommendation === 'string', 'recommendation is string');
});

test('issueProductionSummary: riskBreakdown has low/medium/high buckets', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  for (const bucket of ['low', 'medium', 'high']) {
    assert.strictEqual(typeof snapshot.issueProductionSummary.riskBreakdown[bucket], 'number', `riskBreakdown.${bucket}`);
  }
});

test('operatorBrief: has issueProduction string field', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(typeof snapshot.operatorBrief.issueProduction === 'string', 'operatorBrief.issueProduction is string');
});

// ── Blockers shape ───────────────────────────────────────────────────────────

test('blockers: array with source, severity, message on each entry', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(Array.isArray(snapshot.blockers), 'blockers should be array');
  for (const b of snapshot.blockers) {
    assert.strictEqual(typeof b.source, 'string', 'blocker.source');
    assert.strictEqual(typeof b.severity, 'string', 'blocker.severity');
    assert.strictEqual(typeof b.message, 'string', 'blocker.message');
  }
  assert.ok(snapshot.blockers.some(b => b.source === 'health'), 'should have health blocker');
});

// ── Recommended actions shape ────────────────────────────────────────────────

test('recommendedNextActions: array with required fields', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(Array.isArray(snapshot.recommendedNextActions), 'should be array');
  for (const a of snapshot.recommendedNextActions) {
    assert.strictEqual(typeof a.priority, 'string', 'action.priority');
    assert.strictEqual(typeof a.action, 'string', 'action.action');
    assert.strictEqual(typeof a.description, 'string', 'action.description');
    assert.strictEqual(typeof a.humanRequired, 'boolean', 'action.humanRequired');
  }
});

// ── Human-required items shape ───────────────────────────────────────────────

test('humanRequiredItems: array with required fields and always has next-wave-scoping', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  assert.ok(Array.isArray(snapshot.humanRequiredItems), 'should be array');
  for (const item of snapshot.humanRequiredItems) {
    assert.strictEqual(typeof item.category, 'string', 'item.category');
    assert.strictEqual(typeof item.item, 'string', 'item.item');
    assert.strictEqual(typeof item.description, 'string', 'item.description');
  }
  assert.ok(snapshot.humanRequiredItems.some(i => i.item === 'next-wave-scoping'),
    'should always have next-wave-scoping');
});

// ── Input sources ────────────────────────────────────────────────────────────

test('inputSources: has all boolean flags', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const expected = [
    'healthLoaded', 'providerPoolLoaded', 'localResourceLoaded',
    'activeWorkersLoaded', 'workerTrustLoaded', 'metaSignalsLoaded',
    'riskSignalsLoaded', 'opportunitySignalsLoaded', 'launchLocksLoaded',
    'workerTelemetryLoaded', 'lastCycleLoaded', 'launchCandidatesLoaded',
  ];
  for (const key of expected) {
    assert.strictEqual(typeof snapshot.inputSources[key], 'boolean', `inputSources.${key}`);
  }
});

// ── Live write tests ─────────────────────────────────────────────────────────

test('live: writes file and overwrites existing', () => {
  const outPath = tmpFile('live-write');
  try {
    // Write new file
    const { stdout, exitCode } = run(['--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Command Steward brief written to'), 'should print written message');
    assert.ok(fs.existsSync(outPath), 'file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);

    // Overwrite existing
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    run(['--live', '--out', outPath]);
    const overwritten = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(overwritten.schemaVersion, 1);
    assert.strictEqual(overwritten.old, undefined);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

// ── --stdout flag ────────────────────────────────────────────────────────────

test('stdout: prints JSON without banner, works with --live', () => {
  const { stdout, exitCode } = run(['--stdout']);
  assert.strictEqual(exitCode, 0);
  assert.ok(!stdout.includes('DRY RUN'), 'no banner');
  assert.strictEqual(JSON.parse(stdout).schemaVersion, 1);

  const outPath = tmpFile('stdout-live');
  try {
    const { stdout: liveStdout } = run(['--stdout', '--live', '--out', outPath]);
    assert.strictEqual(JSON.parse(liveStdout).schemaVersion, 1);
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

test('cli: --help and -h exit 0 with usage', () => {
  for (const flag of ['--help', '-h']) {
    const { stdout, exitCode } = run([flag]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('USAGE'));
  }
});

// ── Built-in self-test ───────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── Consistency ──────────────────────────────────────────────────────────────

test('consistency: blockers have valid sources; human actions appear in humanRequiredItems', () => {
  const { stdout } = run(['--stdout']);
  const snapshot = JSON.parse(stdout);
  const validSources = ['health', 'resources', 'providers', 'trust', 'meta-signals', 'budget', 'issue-production'];
  for (const b of snapshot.blockers) {
    assert.ok(validSources.includes(b.source), `valid source: ${b.source}`);
  }
  for (const a of snapshot.recommendedNextActions.filter(a => a.humanRequired)) {
    assert.ok(snapshot.humanRequiredItems.some(i => i.item === a.action),
      `human action ${a.action} in humanRequiredItems`);
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `emit-steward-nested-${Date.now()}`, 'sub', 'out.json');
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

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  emit-command-steward-brief.test.js`);
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
