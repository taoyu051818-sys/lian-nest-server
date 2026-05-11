#!/usr/bin/env node

/**
 * calculate-meta-signals.test.js
 *
 * Focused self-tests for calculate-meta-signals.js metric functions.
 * Covers: missing inputs, empty ledgers, basic score output, edge cases.
 *
 * Runs without any test framework — uses Node assert and direct function calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import the calculator module's internal helpers via the source file.
// We re-implement the pure functions here by reading the source and evaluating
// the module pattern, since the calculator is a CLI script without exports.
// Instead, we test via subprocess (node script --stdout) for integration,
// and copy the pure function logic here for unit-level coverage.

// ── Pure function mirrors (copied from calculate-meta-signals.js) ─────────

const FAILURE_WEIGHTS = {
  'dependency/generate': 30,
  'runtime compile': 25,
  'boundary guard': 15,
  'docs guard': 10,
  unknown: 20,
};

const FRICTION_THRESHOLD_SILENT_MS = 60_000;
const FRICTION_THRESHOLD_STALE_MS = 300_000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateFailureScore(healthEntries) {
  if (healthEntries.length === 0) return { score: 0, categoryCounts: {} };
  let total = 0;
  const categoryCounts = {};
  for (const entry of healthEntries) {
    if (entry.state && entry.state !== 'red') continue;
    const cat = entry.category || 'unknown';
    const weight = FAILURE_WEIGHTS[cat] || FAILURE_WEIGHTS.unknown;
    total += weight;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }
  const raw = Math.min(total, 100);
  return { score: raw, categoryCounts };
}

function calculateFrictionScore(heartbeatEntries) {
  if (heartbeatEntries.length === 0) return 0;
  let frictionPoints = 0;
  for (const entry of heartbeatEntries) {
    if (entry.state === 'stale') {
      frictionPoints += 30;
    } else if (entry.state === 'running:no-output') {
      frictionPoints += 10;
    }
    if (entry.noOutputMs && entry.noOutputMs > FRICTION_THRESHOLD_STALE_MS) {
      frictionPoints += 20;
    } else if (entry.noOutputMs && entry.noOutputMs > FRICTION_THRESHOLD_SILENT_MS) {
      frictionPoints += 5;
    }
  }
  return clamp(frictionPoints, 0, 100);
}

function calculateRiskScore(healthEntries) {
  if (healthEntries.length === 0) return 0;
  let risk = 0;
  for (const entry of healthEntries) {
    if (entry.severity === 'high' || entry.severity === 'Red') {
      risk += 20;
    } else if (entry.severity === 'medium' || entry.severity === 'Yellow') {
      risk += 10;
    }
  }
  return clamp(risk, 0, 100);
}

function calculateCost(heartbeatEntries) {
  if (heartbeatEntries.length === 0) return 0;
  let totalMs = 0;
  for (const entry of heartbeatEntries) {
    if (entry.elapsedMs && entry.elapsedMs > 0) {
      totalMs += entry.elapsedMs;
    }
  }
  return Math.round(totalMs / 60_000);
}

function calculateTrust(failureScore, frictionScore) {
  const combined = (failureScore * 0.6) + (frictionScore * 0.4);
  return clamp(Math.round(100 - combined), 0, 100);
}

function findTopPain(categoryCounts) {
  if (!categoryCounts || Object.keys(categoryCounts).length === 0) return 'none';
  let topCat = 'none';
  let topCount = 0;
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > topCount) {
      topCat = cat;
      topCount = count;
    }
  }
  return topCat;
}

// ── Test runner ───────────────────────────────────────────────────────────

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

// ── Empty / missing input tests ──────────────────────────────────────────

test('failureScore: empty health entries returns 0', () => {
  const result = calculateFailureScore([]);
  assert.strictEqual(result.score, 0);
  assert.deepStrictEqual(result.categoryCounts, {});
});

test('failureScore: no red-state entries returns 0', () => {
  const entries = [
    { state: 'green', category: 'runtime compile' },
    { state: 'yellow', category: 'boundary guard' },
  ];
  const result = calculateFailureScore(entries);
  assert.strictEqual(result.score, 0);
});

test('frictionScore: empty heartbeat entries returns 0', () => {
  assert.strictEqual(calculateFrictionScore([]), 0);
});

test('riskScore: empty health entries returns 0', () => {
  assert.strictEqual(calculateRiskScore([]), 0);
});

test('cost: empty heartbeat entries returns 0', () => {
  assert.strictEqual(calculateCost([]), 0);
});

test('trust: zero failure and friction returns 100', () => {
  assert.strictEqual(calculateTrust(0, 0), 100);
});

test('topPain: empty categoryCounts returns "none"', () => {
  assert.strictEqual(findTopPain({}), 'none');
});

test('topPain: null categoryCounts returns "none"', () => {
  assert.strictEqual(findTopPain(null), 'none');
});

// ── Basic scoring tests ──────────────────────────────────────────────────

test('failureScore: single red entry with known category', () => {
  const entries = [{ state: 'red', category: 'runtime compile' }];
  const result = calculateFailureScore(entries);
  assert.strictEqual(result.score, 25);
  assert.deepStrictEqual(result.categoryCounts, { 'runtime compile': 1 });
});

test('failureScore: single red entry with unknown category uses unknown weight', () => {
  const entries = [{ state: 'red', category: 'unrecognized' }];
  const result = calculateFailureScore(entries);
  assert.strictEqual(result.score, 20);
  assert.deepStrictEqual(result.categoryCounts, { unrecognized: 1 });
});

test('failureScore: red entry with no category defaults to "unknown"', () => {
  const entries = [{ state: 'red' }];
  const result = calculateFailureScore(entries);
  assert.strictEqual(result.score, 20);
  assert.deepStrictEqual(result.categoryCounts, { unknown: 1 });
});

test('failureScore: caps at 100', () => {
  // 5 * dependency/generate (30 each) = 150, should cap at 100
  const entries = Array.from({ length: 5 }, () => ({
    state: 'red',
    category: 'dependency/generate',
  }));
  const result = calculateFailureScore(entries);
  assert.strictEqual(result.score, 100);
});

test('failureScore: accumulates multiple categories', () => {
  const entries = [
    { state: 'red', category: 'runtime compile' },
    { state: 'red', category: 'boundary guard' },
    { state: 'red', category: 'docs guard' },
  ];
  const result = calculateFailureScore(entries);
  assert.strictEqual(result.score, 50); // 25 + 15 + 10
});

// ── Friction scoring tests ───────────────────────────────────────────────

test('frictionScore: stale heartbeat adds 30', () => {
  const entries = [{ state: 'stale' }];
  assert.strictEqual(calculateFrictionScore(entries), 30);
});

test('frictionScore: running:no-output heartbeat adds 10', () => {
  const entries = [{ state: 'running:no-output' }];
  assert.strictEqual(calculateFrictionScore(entries), 10);
});

test('frictionScore: noOutputMs > 300000 adds 20', () => {
  const entries = [{ state: 'running', noOutputMs: 400_000 }];
  assert.strictEqual(calculateFrictionScore(entries), 20);
});

test('frictionScore: noOutputMs > 60000 (but < 300000) adds 5', () => {
  const entries = [{ state: 'running', noOutputMs: 120_000 }];
  assert.strictEqual(calculateFrictionScore(entries), 5);
});

test('frictionScore: stale + noOutputMs > 300000 combines (30+20=50)', () => {
  const entries = [{ state: 'stale', noOutputMs: 500_000 }];
  assert.strictEqual(calculateFrictionScore(entries), 50);
});

test('frictionScore: caps at 100', () => {
  // 4 stale entries: 4 * (30+20) = 200 -> 100
  const entries = Array.from({ length: 4 }, () => ({
    state: 'stale',
    noOutputMs: 400_000,
  }));
  assert.strictEqual(calculateFrictionScore(entries), 100);
});

test('frictionScore: noOutputMs of exactly 60000 does not trigger (strict >)', () => {
  const entries = [{ state: 'running', noOutputMs: 60_000 }];
  assert.strictEqual(calculateFrictionScore(entries), 0);
});

test('frictionScore: noOutputMs of exactly 300000 falls through to silent threshold', () => {
  const entries = [{ state: 'running', noOutputMs: 300_000 }];
  // 300000 > 300000 is false, falls to > 60000 which is true => +5
  assert.strictEqual(calculateFrictionScore(entries), 5);
});

// ── Risk scoring tests ───────────────────────────────────────────────────

test('riskScore: high severity adds 20', () => {
  const entries = [{ severity: 'high' }];
  assert.strictEqual(calculateRiskScore(entries), 20);
});

test('riskScore: Red severity (capitalized) adds 20', () => {
  const entries = [{ severity: 'Red' }];
  assert.strictEqual(calculateRiskScore(entries), 20);
});

test('riskScore: medium severity adds 10', () => {
  const entries = [{ severity: 'medium' }];
  assert.strictEqual(calculateRiskScore(entries), 10);
});

test('riskScore: Yellow severity adds 10', () => {
  const entries = [{ severity: 'Yellow' }];
  assert.strictEqual(calculateRiskScore(entries), 10);
});

test('riskScore: low severity adds 0', () => {
  const entries = [{ severity: 'low' }];
  assert.strictEqual(calculateRiskScore(entries), 0);
});

test('riskScore: caps at 100', () => {
  const entries = Array.from({ length: 6 }, () => ({ severity: 'high' }));
  assert.strictEqual(calculateRiskScore(entries), 100); // 6*20=120 -> 100
});

// ── Cost tests ───────────────────────────────────────────────────────────

test('cost: converts elapsedMs to worker-minutes', () => {
  const entries = [{ elapsedMs: 120_000 }]; // 2 minutes
  assert.strictEqual(calculateCost(entries), 2);
});

test('cost: sums multiple entries', () => {
  const entries = [
    { elapsedMs: 60_000 },
    { elapsedMs: 120_000 },
    { elapsedMs: 180_000 },
  ];
  assert.strictEqual(calculateCost(entries), 6); // 360000 / 60000
});

test('cost: rounds to nearest minute', () => {
  const entries = [{ elapsedMs: 90_000 }]; // 1.5 min -> rounds to 2
  assert.strictEqual(calculateCost(entries), 2);
});

test('cost: ignores entries with zero or missing elapsedMs', () => {
  const entries = [{ elapsedMs: 0 }, { elapsedMs: null }, {}];
  assert.strictEqual(calculateCost(entries), 0);
});

// ── Trust tests ──────────────────────────────────────────────────────────

test('trust: full failure (100) and zero friction gives 40', () => {
  // 100*0.6 + 0*0.4 = 60, trust = 100-60 = 40
  assert.strictEqual(calculateTrust(100, 0), 40);
});

test('trust: zero failure and full friction (100) gives 60', () => {
  // 0*0.6 + 100*0.4 = 40, trust = 100-40 = 60
  assert.strictEqual(calculateTrust(0, 100), 60);
});

test('trust: both at 100 gives 0', () => {
  // 100*0.6 + 100*0.4 = 100, trust = 100-100 = 0
  assert.strictEqual(calculateTrust(100, 100), 0);
});

test('trust: does not go below 0', () => {
  // Even with extreme inputs, clamp prevents negative
  assert.strictEqual(calculateTrust(200, 200), 0);
});

test('trust: typical moderate values', () => {
  // 30*0.6 + 20*0.4 = 18+8 = 26, trust = 74
  assert.strictEqual(calculateTrust(30, 20), 74);
});

// ── TopPain tests ────────────────────────────────────────────────────────

test('topPain: picks the category with the highest count', () => {
  const counts = { 'runtime compile': 3, 'boundary guard': 1, 'docs guard': 2 };
  assert.strictEqual(findTopPain(counts), 'runtime compile');
});

test('topPain: ties go to the first one encountered with higher count', () => {
  const counts = { 'runtime compile': 2, 'boundary guard': 2 };
  // First entry with topCount wins (iteration order)
  assert.strictEqual(findTopPain(counts), 'runtime compile');
});

test('topPain: single category', () => {
  const counts = { 'dependency/generate': 1 };
  assert.strictEqual(findTopPain(counts), 'dependency/generate');
});

// ── Integration: subprocess test ─────────────────────────────────────────

function runSubprocess(args) {
  const { execSync } = require('child_process');
  const script = path.resolve(__dirname, 'calculate-meta-signals.js');
  const cmd = `node "${script}" ${args.join(' ')}`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 };
  }
}

test('integration: --stdout with no inputs produces zeroed snapshot', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout']);
  assert.strictEqual(exitCode, 0);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.snapshotVersion, 1);
  assert.strictEqual(snapshot.signals.failureScore, 0);
  assert.strictEqual(snapshot.signals.frictionScore, 0);
  assert.strictEqual(snapshot.signals.riskScore, 0);
  assert.strictEqual(snapshot.signals.cost, 0);
  assert.strictEqual(snapshot.signals.trust, 100);
  assert.strictEqual(snapshot.signals.topPain, 'none');
});

test('integration: --help exits 0', () => {
  const { exitCode } = runSubprocess(['--help']);
  assert.strictEqual(exitCode, 0);
});

test('integration: unknown argument exits 2', () => {
  const { exitCode } = runSubprocess(['--bogus']);
  assert.strictEqual(exitCode, 2);
});

test('integration: --stdout with health log produces correct failure score', () => {
  const tmpFile = path.join(os.tmpdir(), `health-test-${Date.now()}.ndjson`);
  const lines = [
    JSON.stringify({ state: 'red', category: 'runtime compile', severity: 'high' }),
    JSON.stringify({ state: 'red', category: 'boundary guard', severity: 'medium' }),
    JSON.stringify({ state: 'green', category: 'runtime compile' }),
  ];
  fs.writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--healthLog', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.signals.failureScore, 40); // 25 + 15
    assert.strictEqual(snapshot.signals.riskScore, 30); // 20 + 10
    assert.strictEqual(snapshot.signals.topPain, 'runtime compile');
    assert.strictEqual(snapshot.inputSources.healthEntryCount, 3);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: --stdout with heartbeat log produces correct friction and cost', () => {
  const tmpFile = path.join(os.tmpdir(), `heartbeat-test-${Date.now()}.ndjson`);
  const lines = [
    JSON.stringify({ state: 'stale', elapsedMs: 120_000, noOutputMs: 400_000 }),
    JSON.stringify({ state: 'running:no-output', elapsedMs: 60_000, noOutputMs: 90_000 }),
  ];
  fs.writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--heartbeatLog', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.signals.frictionScore, 65); // (30+20) + (10+5)
    assert.strictEqual(snapshot.signals.cost, 3); // (120000+60000)/60000
    assert.strictEqual(snapshot.signals.trust, 74); // 100 - (0*0.6 + 65*0.4) = 100-26 = 74
    assert.strictEqual(snapshot.inputSources.heartbeatEntryCount, 2);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: combined health + heartbeat log produces full snapshot', () => {
  const healthFile = path.join(os.tmpdir(), `health-combo-${Date.now()}.ndjson`);
  const heartbeatFile = path.join(os.tmpdir(), `heartbeat-combo-${Date.now()}.ndjson`);
  fs.writeFileSync(healthFile, JSON.stringify({ state: 'red', category: 'dependency/generate', severity: 'high' }) + '\n', 'utf8');
  fs.writeFileSync(heartbeatFile, JSON.stringify({ state: 'stale', elapsedMs: 300_000, noOutputMs: 350_000 }) + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess([
      '--stdout',
      '--healthLog', healthFile,
      '--heartbeatLog', heartbeatFile,
    ]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.signals.failureScore, 30);
    assert.strictEqual(snapshot.signals.frictionScore, 50); // 30 + 20
    assert.strictEqual(snapshot.signals.riskScore, 20);
    assert.strictEqual(snapshot.signals.cost, 5); // 300000 / 60000
    assert.strictEqual(snapshot.signals.topPain, 'dependency/generate');
  } finally {
    fs.unlinkSync(healthFile);
    fs.unlinkSync(heartbeatFile);
  }
});

test('integration: --out writes file and prints relative path', () => {
  const tmpOut = path.join(os.tmpdir(), `meta-signals-out-${Date.now()}.json`);
  try {
    const { stdout, exitCode } = runSubprocess(['--out', tmpOut]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Meta signals written to'));
    const written = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.strictEqual(written.snapshotVersion, 1);
    assert.strictEqual(written.signals.trust, 100);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
});

// ── Malformed input resilience ───────────────────────────────────────────

test('integration: malformed NDJSON lines are skipped gracefully', () => {
  const tmpFile = path.join(os.tmpdir(), `malformed-${Date.now()}.ndjson`);
  const lines = [
    'not json at all',
    JSON.stringify({ state: 'red', category: 'runtime compile' }),
    '{broken',
    '',
  ];
  fs.writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--healthLog', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.signals.failureScore, 25); // only the valid line counted
    assert.strictEqual(snapshot.inputSources.healthEntryCount, 1);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: nonexistent healthLog path produces zeroed snapshot', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--healthLog', '/nonexistent/path.ndjson']);
  assert.strictEqual(exitCode, 0);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.signals.failureScore, 0);
});

// ── Clamp edge cases ─────────────────────────────────────────────────────

test('clamp: value within range returns value', () => {
  assert.strictEqual(clamp(50, 0, 100), 50);
});

test('clamp: value below min returns min', () => {
  assert.strictEqual(clamp(-10, 0, 100), 0);
});

test('clamp: value above max returns max', () => {
  assert.strictEqual(clamp(150, 0, 100), 100);
});

// ── Report ───────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  calculate-meta-signals.test.js`);
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
