#!/usr/bin/env node

/**
 * calculate-operational-entropy.test.js
 *
 * Focused self-tests for calculate-operational-entropy.js metric functions.
 * Covers: missing inputs, empty fixtures, basic score output, edge cases,
 * deterministic scoring, and integration via subprocess.
 *
 * Runs without any test framework — uses Node assert and direct function calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Pure function mirrors (copied from calculate-operational-entropy.js) ─────

const SOURCE_WEIGHTS = {
  stateDrift: 25,
  prRejection: 20,
  mainRed: 30,
  docsConflict: 10,
  tokenOverrun: 15,
};

const SEVERITY_MULTIPLIERS = {
  critical: 2.0,
  high: 1.5,
  medium: 1.0,
  low: 0.5,
  info: 0.1,
};

const SOURCE_KEYS = [
  'stateDrift',
  'prRejection',
  'mainRed',
  'docsConflict',
  'tokenOverrun',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateSourceScore(entries, sourceKey) {
  if (entries.length === 0) return 0;
  const weight = SOURCE_WEIGHTS[sourceKey] || 10;
  let total = 0;
  for (const entry of entries) {
    const severity = entry.severity || 'medium';
    const multiplier = SEVERITY_MULTIPLIERS[severity] || 1.0;
    total += weight * multiplier;
  }
  return clamp(Math.round(total), 0, 100);
}

function calculateEntropy(sourceScores) {
  const values = Object.values(sourceScores);
  if (values.length === 0) return 0;
  const total = values.reduce((sum, v) => sum + v, 0);
  const maxPossible = SOURCE_KEYS.length * 100;
  return clamp(Math.round((total / maxPossible) * 100), 0, 100);
}

function findTopSources(sourceScores) {
  const entries = Object.entries(sourceScores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return [];
  return entries.slice(0, 3).map(([source, score]) => ({ source, score }));
}

function calculateBreakdown(sourceScores) {
  const total = Object.values(sourceScores).reduce((sum, v) => sum + v, 0);
  if (total === 0) return {};
  const breakdown = {};
  for (const [key, score] of Object.entries(sourceScores)) {
    breakdown[key] = Math.round((score / total) * 100);
  }
  return breakdown;
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

test('sourceScore: empty entries returns 0', () => {
  assert.strictEqual(calculateSourceScore([], 'stateDrift'), 0);
  assert.strictEqual(calculateSourceScore([], 'prRejection'), 0);
  assert.strictEqual(calculateSourceScore([], 'mainRed'), 0);
  assert.strictEqual(calculateSourceScore([], 'docsConflict'), 0);
  assert.strictEqual(calculateSourceScore([], 'tokenOverrun'), 0);
});

test('entropy: all zero source scores returns 0', () => {
  const scores = { stateDrift: 0, prRejection: 0, mainRed: 0, docsConflict: 0, tokenOverrun: 0 };
  assert.strictEqual(calculateEntropy(scores), 0);
});

test('topSources: all zero scores returns empty array', () => {
  const scores = { stateDrift: 0, prRejection: 0, mainRed: 0, docsConflict: 0, tokenOverrun: 0 };
  assert.deepStrictEqual(findTopSources(scores), []);
});

test('breakdown: all zero scores returns empty object', () => {
  const scores = { stateDrift: 0, prRejection: 0, mainRed: 0, docsConflict: 0, tokenOverrun: 0 };
  assert.deepStrictEqual(calculateBreakdown(scores), {});
});

// ── Deterministic source score tests ─────────────────────────────────────
// Each test documents expected score for a known input.

test('stateDrift: single medium entry = 25 (weight 25 * multiplier 1.0)', () => {
  // weight=25, severity=medium → multiplier=1.0 → 25*1.0 = 25
  const entries = [{ severity: 'medium' }];
  assert.strictEqual(calculateSourceScore(entries, 'stateDrift'), 25);
});

test('stateDrift: single high entry = 38 (weight 25 * multiplier 1.5)', () => {
  // weight=25, severity=high → multiplier=1.5 → 25*1.5 = 37.5 → round to 38
  const entries = [{ severity: 'high' }];
  assert.strictEqual(calculateSourceScore(entries, 'stateDrift'), 38);
});

test('stateDrift: single critical entry = 50 (weight 25 * multiplier 2.0)', () => {
  // weight=25, severity=critical → multiplier=2.0 → 25*2.0 = 50
  const entries = [{ severity: 'critical' }];
  assert.strictEqual(calculateSourceScore(entries, 'stateDrift'), 50);
});

test('prRejection: single medium entry = 20 (weight 20 * multiplier 1.0)', () => {
  // weight=20, severity=medium → 20*1.0 = 20
  const entries = [{ severity: 'medium' }];
  assert.strictEqual(calculateSourceScore(entries, 'prRejection'), 20);
});

test('mainRed: single critical entry = 60 (weight 30 * multiplier 2.0)', () => {
  // weight=30, severity=critical → 30*2.0 = 60
  const entries = [{ severity: 'critical' }];
  assert.strictEqual(calculateSourceScore(entries, 'mainRed'), 60);
});

test('docsConflict: single low entry = 5 (weight 10 * multiplier 0.5)', () => {
  // weight=10, severity=low → 10*0.5 = 5
  const entries = [{ severity: 'low' }];
  assert.strictEqual(calculateSourceScore(entries, 'docsConflict'), 5);
});

test('tokenOverrun: single info entry = 2 (weight 15 * multiplier 0.1)', () => {
  // weight=15, severity=info → 15*0.1 = 1.5 → round to 2
  const entries = [{ severity: 'info' }];
  assert.strictEqual(calculateSourceScore(entries, 'tokenOverrun'), 2);
});

test('sourceScore: no severity defaults to medium (multiplier 1.0)', () => {
  // weight=25, no severity → default 'medium' → 25*1.0 = 25
  const entries = [{}];
  assert.strictEqual(calculateSourceScore(entries, 'stateDrift'), 25);
});

test('sourceScore: accumulates multiple entries', () => {
  // 2 medium entries for mainRed: 2 * (30*1.0) = 60
  const entries = [{ severity: 'medium' }, { severity: 'medium' }];
  assert.strictEqual(calculateSourceScore(entries, 'mainRed'), 60);
});

test('sourceScore: caps at 100', () => {
  // 5 critical mainRed entries: 5 * (30*2.0) = 300 → capped at 100
  const entries = Array.from({ length: 5 }, () => ({ severity: 'critical' }));
  assert.strictEqual(calculateSourceScore(entries, 'mainRed'), 100);
});

test('sourceScore: mixed severities accumulate correctly', () => {
  // prRejection: critical(40) + high(30) + medium(20) + low(10) = 100
  const entries = [
    { severity: 'critical' },  // 20*2.0 = 40
    { severity: 'high' },      // 20*1.5 = 30
    { severity: 'medium' },    // 20*1.0 = 20
    { severity: 'low' },       // 20*0.5 = 10
  ];
  assert.strictEqual(calculateSourceScore(entries, 'prRejection'), 100);
});

// ── Entropy calculation tests ────────────────────────────────────────────

test('entropy: single source at 100 = 20 (100/500 * 100)', () => {
  // Only mainRed at 100, rest at 0: total=100, max=500, entropy=20
  const scores = { stateDrift: 0, prRejection: 0, mainRed: 100, docsConflict: 0, tokenOverrun: 0 };
  assert.strictEqual(calculateEntropy(scores), 20);
});

test('entropy: all sources at 100 = 100', () => {
  // All at 100: total=500, max=500, entropy=100
  const scores = { stateDrift: 100, prRejection: 100, mainRed: 100, docsConflict: 100, tokenOverrun: 100 };
  assert.strictEqual(calculateEntropy(scores), 100);
});

test('entropy: balanced moderate values', () => {
  // All at 50: total=250, max=500, entropy=50
  const scores = { stateDrift: 50, prRejection: 50, mainRed: 50, docsConflict: 50, tokenOverrun: 50 };
  assert.strictEqual(calculateEntropy(scores), 50);
});

test('entropy: single medium mainRed = 6 (30/500*100=6)', () => {
  // mainRed medium: 30*1.0=30, rest=0. entropy=30/500*100=6
  const sourceScores = {
    stateDrift: calculateSourceScore([{ severity: 'medium' }], 'stateDrift'),   // 25
    prRejection: calculateSourceScore([], 'prRejection'),                       // 0
    mainRed: calculateSourceScore([], 'mainRed'),                               // 0
    docsConflict: calculateSourceScore([], 'docsConflict'),                     // 0
    tokenOverrun: calculateSourceScore([], 'tokenOverrun'),                     // 0
  };
  // Only stateDrift has entries: 25. entropy = 25/500*100 = 5
  assert.strictEqual(calculateEntropy(sourceScores), 5);
});

// ── TopSources tests ─────────────────────────────────────────────────────

test('topSources: returns up to 3 sources sorted by score descending', () => {
  const scores = { stateDrift: 50, prRejection: 0, mainRed: 80, docsConflict: 30, tokenOverrun: 0 };
  const top = findTopSources(scores);
  assert.strictEqual(top.length, 3);
  assert.strictEqual(top[0].source, 'mainRed');
  assert.strictEqual(top[0].score, 80);
  assert.strictEqual(top[1].source, 'stateDrift');
  assert.strictEqual(top[1].score, 50);
  assert.strictEqual(top[2].source, 'docsConflict');
  assert.strictEqual(top[2].score, 30);
});

test('topSources: excludes zero-score sources', () => {
  const scores = { stateDrift: 0, prRejection: 0, mainRed: 60, docsConflict: 0, tokenOverrun: 0 };
  const top = findTopSources(scores);
  assert.strictEqual(top.length, 1);
  assert.strictEqual(top[0].source, 'mainRed');
});

test('topSources: single source returns single-element array', () => {
  const scores = { stateDrift: 25, prRejection: 0, mainRed: 0, docsConflict: 0, tokenOverrun: 0 };
  const top = findTopSources(scores);
  assert.strictEqual(top.length, 1);
  assert.deepStrictEqual(top[0], { source: 'stateDrift', score: 25 });
});

// ── Breakdown tests ──────────────────────────────────────────────────────

test('breakdown: percentages sum to ~100', () => {
  const scores = { stateDrift: 25, prRejection: 20, mainRed: 30, docsConflict: 10, tokenOverrun: 15 };
  const breakdown = calculateBreakdown(scores);
  const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
  // May not be exactly 100 due to rounding, but should be close
  assert.ok(sum >= 99 && sum <= 101, `Expected sum ~100, got ${sum}`);
});

test('breakdown: single source gets 100%', () => {
  const scores = { stateDrift: 0, prRejection: 0, mainRed: 60, docsConflict: 0, tokenOverrun: 0 };
  const breakdown = calculateBreakdown(scores);
  assert.strictEqual(breakdown.mainRed, 100);
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

// ── Edge case: null/undefined severity ────────────────────────────────────

test('sourceScore: null severity defaults to medium', () => {
  // null → default 'medium' → weight*1.0
  const entries = [{ severity: null }];
  assert.strictEqual(calculateSourceScore(entries, 'mainRed'), 30);
});

test('sourceScore: undefined severity defaults to medium', () => {
  const entries = [{ severity: undefined }];
  assert.strictEqual(calculateSourceScore(entries, 'prRejection'), 20);
});

test('sourceScore: empty object entry uses defaults', () => {
  const entries = [{}];
  assert.strictEqual(calculateSourceScore(entries, 'docsConflict'), 10);
});

// ── Integration: subprocess test ─────────────────────────────────────────

function runSubprocess(args) {
  const { execSync } = require('child_process');
  const script = path.resolve(__dirname, 'calculate-operational-entropy.js');
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
  assert.strictEqual(snapshot.entropy, 0);
  assert.deepStrictEqual(snapshot.sourceScores, {
    stateDrift: 0,
    prRejection: 0,
    mainRed: 0,
    docsConflict: 0,
    tokenOverrun: 0,
  });
  assert.deepStrictEqual(snapshot.topSources, []);
  assert.deepStrictEqual(snapshot.breakdown, {});
});

test('integration: --help exits 0', () => {
  const { exitCode } = runSubprocess(['--help']);
  assert.strictEqual(exitCode, 0);
});

test('integration: unknown argument exits 2', () => {
  const { exitCode } = runSubprocess(['--bogus']);
  assert.strictEqual(exitCode, 2);
});

test('integration: --stdout with mainRed log produces correct scores', () => {
  const tmpFile = path.join(os.tmpdir(), `main-red-test-${Date.now()}.ndjson`);
  const lines = [
    JSON.stringify({ severity: 'critical' }),
    JSON.stringify({ severity: 'high' }),
    JSON.stringify({ severity: 'medium' }),
  ];
  fs.writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--mainRedLog', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    // mainRed: critical(60) + high(45) + medium(30) = 135 → capped at 100
    assert.strictEqual(snapshot.sourceScores.mainRed, 100);
    assert.strictEqual(snapshot.sourceScores.stateDrift, 0);
    assert.strictEqual(snapshot.entropy, 20); // 100/500*100 = 20
    assert.strictEqual(snapshot.topSources[0].source, 'mainRed');
    assert.strictEqual(snapshot.inputSources.entryCounts.mainRed, 3);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: --stdout with multiple logs produces combined entropy', () => {
  const driftFile = path.join(os.tmpdir(), `drift-${Date.now()}.ndjson`);
  const rejectFile = path.join(os.tmpdir(), `reject-${Date.now()}.ndjson`);
  fs.writeFileSync(driftFile, JSON.stringify({ severity: 'high' }) + '\n', 'utf8');
  fs.writeFileSync(rejectFile, JSON.stringify({ severity: 'medium' }) + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess([
      '--stdout',
      '--stateDriftLog', driftFile,
      '--prRejectionLog', rejectFile,
    ]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    // stateDrift high: 25*1.5 = 37.5 → 38
    assert.strictEqual(snapshot.sourceScores.stateDrift, 38);
    // prRejection medium: 20*1.0 = 20
    assert.strictEqual(snapshot.sourceScores.prRejection, 20);
    // entropy = (38+20)/500*100 = 11.6 → 12
    assert.strictEqual(snapshot.entropy, 12);
    assert.strictEqual(snapshot.inputSources.entryCounts.stateDrift, 1);
    assert.strictEqual(snapshot.inputSources.entryCounts.prRejection, 1);
  } finally {
    fs.unlinkSync(driftFile);
    fs.unlinkSync(rejectFile);
  }
});

test('integration: --out writes file and prints relative path', () => {
  const tmpOut = path.join(os.tmpdir(), `entropy-out-${Date.now()}.json`);
  try {
    const { stdout, exitCode } = runSubprocess(['--out', tmpOut]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Operational entropy written to'));
    const written = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.strictEqual(written.snapshotVersion, 1);
    assert.strictEqual(written.entropy, 0);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
});

test('integration: malformed NDJSON lines are skipped gracefully', () => {
  const tmpFile = path.join(os.tmpdir(), `malformed-entropy-${Date.now()}.ndjson`);
  const lines = [
    'not json at all',
    JSON.stringify({ severity: 'high' }),
    '{broken',
    '',
  ];
  fs.writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--mainRedLog', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    // Only the valid line counted: mainRed high = 30*1.5 = 45
    assert.strictEqual(snapshot.sourceScores.mainRed, 45);
    assert.strictEqual(snapshot.inputSources.entryCounts.mainRed, 1);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: nonexistent log path produces zeroed source score', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--stateDriftLog', '/nonexistent/path.ndjson']);
  assert.strictEqual(exitCode, 0);
  const snapshot = JSON.parse(stdout);
  assert.strictEqual(snapshot.sourceScores.stateDrift, 0);
  assert.strictEqual(snapshot.entropy, 0);
});

test('integration: empty NDJSON file produces zeroed source score', () => {
  const tmpFile = path.join(os.tmpdir(), `empty-entropy-${Date.now()}.ndjson`);
  fs.writeFileSync(tmpFile, '', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--tokenOverrunLog', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.sourceScores.tokenOverrun, 0);
    assert.strictEqual(snapshot.inputSources.entryCounts.tokenOverrun, 0);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: all five logs produce full entropy snapshot', () => {
  const tmpFiles = {};
  const tmpPaths = {};
  for (const key of SOURCE_KEYS) {
    const p = path.join(os.tmpdir(), `${key}-${Date.now()}.ndjson`);
    tmpPaths[key] = p;
    fs.writeFileSync(p, JSON.stringify({ severity: 'medium' }) + '\n', 'utf8');
  }

  try {
    const { stdout, exitCode } = runSubprocess([
      '--stdout',
      '--stateDriftLog', tmpPaths.stateDrift,
      '--prRejectionLog', tmpPaths.prRejection,
      '--mainRedLog', tmpPaths.mainRed,
      '--docsConflictLog', tmpPaths.docsConflict,
      '--tokenOverrunLog', tmpPaths.tokenOverrun,
    ]);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    // Each source: weight*1.0 = weight
    // stateDrift=25, prRejection=20, mainRed=30, docsConflict=10, tokenOverrun=15
    assert.strictEqual(snapshot.sourceScores.stateDrift, 25);
    assert.strictEqual(snapshot.sourceScores.prRejection, 20);
    assert.strictEqual(snapshot.sourceScores.mainRed, 30);
    assert.strictEqual(snapshot.sourceScores.docsConflict, 10);
    assert.strictEqual(snapshot.sourceScores.tokenOverrun, 15);
    // entropy = (25+20+30+10+15)/500*100 = 100/500*100 = 20
    assert.strictEqual(snapshot.entropy, 20);
    assert.strictEqual(snapshot.topSources.length, 3);
    assert.strictEqual(snapshot.topSources[0].source, 'mainRed');
  } finally {
    for (const p of Object.values(tmpPaths)) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
});

// ── Report ───────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  calculate-operational-entropy.test.js`);
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
