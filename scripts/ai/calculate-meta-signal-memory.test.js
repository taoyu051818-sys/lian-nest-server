#!/usr/bin/env node

/**
 * calculate-meta-signal-memory.test.js
 *
 * Self-tests for calculate-meta-signal-memory.js.
 * Covers: pure functions, working/archival/episodic memory construction,
 * relevance ranking, edge cases, and subprocess integration.
 *
 * Runs without any test framework — uses Node assert and direct function calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  computeDecayFactor,
  computeRelevanceScore,
  buildWorkingMemory,
  buildArchivalMemory,
  detectEpisodes,
  buildRelevanceRanking,
  computeTierSummary,
  emptyTierSummary,
  clamp,
  TRUST_DROP_THRESHOLD,
  FAILURE_SPIKE_THRESHOLD,
  FRICTION_SURGE_THRESHOLD,
} = require('./calculate-meta-signal-memory.js');

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

// ── Helper: make snapshot ─────────────────────────────────────────────────

function makeSnapshot(calculatedAt, overrides) {
  return {
    calculatedAt,
    snapshotVersion: 1,
    signals: {
      failureScore: 0,
      frictionScore: 0,
      riskScore: 0,
      cost: 0,
      trust: 100,
      topPain: 'none',
      ...overrides,
    },
  };
}

// ── Pure function tests ───────────────────────────────────────────────────

test('clamp: value within range returns value', () => {
  assert.strictEqual(clamp(50, 0, 100), 50);
});

test('clamp: value below min returns min', () => {
  assert.strictEqual(clamp(-10, 0, 100), 0);
});

test('clamp: value above max returns max', () => {
  assert.strictEqual(clamp(150, 0, 100), 100);
});

test('computeDecayFactor: returns 1.0 for current time', () => {
  const now = Date.now();
  const factor = computeDecayFactor(new Date(now).toISOString(), now);
  assert.strictEqual(factor, 1.0);
});

test('computeDecayFactor: returns ~0.5 after one half-life', () => {
  const now = Date.now();
  const halfLifeMs = 72 * 60 * 60 * 1000; // 72 hours
  const past = new Date(now - halfLifeMs).toISOString();
  const factor = computeDecayFactor(past, now);
  assert.ok(Math.abs(factor - 0.5) < 0.01, `Expected ~0.5, got ${factor}`);
});

test('computeDecayFactor: returns ~0.25 after two half-lives', () => {
  const now = Date.now();
  const twoHalfLivesMs = 2 * 72 * 60 * 60 * 1000;
  const past = new Date(now - twoHalfLivesMs).toISOString();
  const factor = computeDecayFactor(past, now);
  assert.ok(Math.abs(factor - 0.25) < 0.01, `Expected ~0.25, got ${factor}`);
});

test('computeDecayFactor: returns 0.5 for null capturedAt', () => {
  assert.strictEqual(computeDecayFactor(null, Date.now()), 0.5);
});

test('computeRelevanceScore: zero signals with full decay gives low score', () => {
  const score = computeRelevanceScore(
    { failureScore: 0, frictionScore: 0, riskScore: 0, trust: 100 },
    1.0,
  );
  // severity=0, recency=1.0, frequency=1.0 => 0.4*1 + 0.35*0 + 0.25*1 = 0.65 => 65
  assert.strictEqual(score, 65);
});

test('computeRelevanceScore: max severity with full decay gives high score', () => {
  const score = computeRelevanceScore(
    { failureScore: 100, frictionScore: 100, riskScore: 100, trust: 0 },
    1.0,
  );
  assert.ok(score > 90, `Expected >90, got ${score}`);
});

test('computeRelevanceScore: high decay reduces score', () => {
  const recent = computeRelevanceScore(
    { failureScore: 50, frictionScore: 30, riskScore: 20, trust: 50 },
    1.0,
  );
  const decayed = computeRelevanceScore(
    { failureScore: 50, frictionScore: 30, riskScore: 20, trust: 50 },
    0.1,
  );
  assert.ok(recent > decayed, `Recent (${recent}) should be > decayed (${decayed})`);
});

test('emptyTierSummary: returns correct defaults', () => {
  const summary = emptyTierSummary();
  assert.strictEqual(summary.avgFailureScore, 0);
  assert.strictEqual(summary.avgFrictionScore, 0);
  assert.strictEqual(summary.avgTrust, 100);
  assert.strictEqual(summary.topPain, 'none');
  assert.strictEqual(summary.dominantCategory, 'none');
});

// ── TierSummary tests ────────────────────────────────────────────────────

test('computeTierSummary: empty snapshots returns empty summary', () => {
  const summary = computeTierSummary([]);
  assert.deepStrictEqual(summary, emptyTierSummary());
});

test('computeTierSummary: single snapshot computes correctly', () => {
  const snapshots = [makeSnapshot('2026-05-10T00:00:00Z', {
    failureScore: 40, frictionScore: 20, trust: 60, topPain: 'runtime compile',
  })];
  const summary = computeTierSummary(snapshots);
  assert.strictEqual(summary.avgFailureScore, 40);
  assert.strictEqual(summary.avgFrictionScore, 20);
  assert.strictEqual(summary.avgTrust, 60);
  assert.strictEqual(summary.topPain, 'runtime compile');
});

test('computeTierSummary: multiple snapshots averages correctly', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { failureScore: 30, frictionScore: 20, trust: 70, topPain: 'runtime compile' }),
    makeSnapshot('2026-05-10T06:00:00Z', { failureScore: 50, frictionScore: 40, trust: 50, topPain: 'runtime compile' }),
    makeSnapshot('2026-05-10T12:00:00Z', { failureScore: 10, frictionScore: 10, trust: 80, topPain: 'boundary guard' }),
  ];
  const summary = computeTierSummary(snapshots);
  assert.strictEqual(summary.avgFailureScore, 30);
  assert.ok(Math.abs(summary.avgFrictionScore - 70 / 3) < 0.1, `avgFrictionScore=${summary.avgFrictionScore}`);
  assert.ok(Math.abs(summary.avgTrust - 200 / 3) < 0.1, `avgTrust=${summary.avgTrust}`);
  assert.strictEqual(summary.topPain, 'runtime compile'); // appears 2x vs 1x
});

// ── Working memory tests ─────────────────────────────────────────────────

test('buildWorkingMemory: empty snapshots returns empty working memory', () => {
  const now = Date.now();
  const working = buildWorkingMemory([], 5, now);
  assert.deepStrictEqual(working.signals, []);
  assert.strictEqual(working.windowSize, 0);
  assert.deepStrictEqual(working.summary, emptyTierSummary());
});

test('buildWorkingMemory: limits to window size', () => {
  const now = Date.now();
  const snapshots = Array.from({ length: 10 }, (_, i) =>
    makeSnapshot(new Date(now - i * 3600000).toISOString(), { failureScore: i * 10 }),
  );
  // snapshots[0] is most recent (i=0), snapshots[9] is oldest
  const working = buildWorkingMemory(snapshots, 3, now);
  assert.strictEqual(working.windowSize, 3);
  assert.strictEqual(working.signals.length, 3);
});

test('buildWorkingMemory: signals are sorted by relevance descending', () => {
  const now = Date.now();
  const snapshots = [
    makeSnapshot(new Date(now - 1000).toISOString(), { failureScore: 10, trust: 90 }),
    makeSnapshot(new Date(now - 500).toISOString(), { failureScore: 80, trust: 20 }),
  ];
  const working = buildWorkingMemory(snapshots, 5, now);
  assert.ok(working.signals[0].relevanceScore >= working.signals[1].relevanceScore);
});

test('buildWorkingMemory: each signal has required fields', () => {
  const now = Date.now();
  const snapshots = [makeSnapshot(new Date(now).toISOString(), { failureScore: 50 })];
  const working = buildWorkingMemory(snapshots, 5, now);
  const sig = working.signals[0];
  assert.ok(sig.signalId.startsWith('mem-'));
  assert.strictEqual(sig.tier, 'working');
  assert.strictEqual(typeof sig.relevanceScore, 'number');
  assert.ok(sig.capturedAt);
  assert.ok(sig.signals);
  assert.strictEqual(typeof sig.decayFactor, 'number');
});

// ── Archival memory tests ────────────────────────────────────────────────

test('buildArchivalMemory: empty snapshots returns empty archival', () => {
  const archival = buildArchivalMemory([], Date.now());
  assert.deepStrictEqual(archival.patterns, []);
  assert.strictEqual(archival.windowSize, 0);
});

test('buildArchivalMemory: groups by topPain category', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { topPain: 'runtime compile', failureScore: 30 }),
    makeSnapshot('2026-05-10T06:00:00Z', { topPain: 'runtime compile', failureScore: 40 }),
    makeSnapshot('2026-05-10T12:00:00Z', { topPain: 'boundary guard', failureScore: 20 }),
  ];
  const archival = buildArchivalMemory(snapshots, Date.now());
  assert.strictEqual(archival.patterns.length, 2);
  assert.strictEqual(archival.patterns[0].category, 'runtime compile'); // higher frequency
  assert.strictEqual(archival.patterns[0].frequency, 2);
});

test('buildArchivalMemory: detects increasing trend', () => {
  // 5 snapshots: first 2 have low failure, last 3 have high failure for same category
  const snapshots = [
    makeSnapshot('2026-05-01T00:00:00Z', { topPain: 'runtime compile', failureScore: 10 }),
    makeSnapshot('2026-05-02T00:00:00Z', { topPain: 'runtime compile', failureScore: 10 }),
    makeSnapshot('2026-05-03T00:00:00Z', { topPain: 'runtime compile', failureScore: 50 }),
    makeSnapshot('2026-05-04T00:00:00Z', { topPain: 'runtime compile', failureScore: 60 }),
    makeSnapshot('2026-05-05T00:00:00Z', { topPain: 'runtime compile', failureScore: 70 }),
  ];
  const archival = buildArchivalMemory(snapshots, Date.now());
  const pattern = archival.patterns.find((p) => p.category === 'runtime compile');
  assert.strictEqual(pattern.trend, 'increasing');
});

test('buildArchivalMemory: skips snapshots with topPain=none', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { topPain: 'none' }),
    makeSnapshot('2026-05-10T06:00:00Z', { topPain: 'runtime compile', failureScore: 30 }),
  ];
  const archival = buildArchivalMemory(snapshots, Date.now());
  assert.strictEqual(archival.patterns.length, 1);
  assert.strictEqual(archival.windowSize, 2); // all snapshots counted for window
});

// ── Episode detection tests ──────────────────────────────────────────────

test('detectEpisodes: empty or single snapshot returns no episodes', () => {
  assert.deepStrictEqual(detectEpisodes([]), []);
  assert.deepStrictEqual(detectEpisodes([makeSnapshot('2026-05-10T00:00:00Z')]), []);
});

test('detectEpisodes: detects trust drop', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { trust: 80, topPain: 'runtime compile' }),
    makeSnapshot('2026-05-10T06:00:00Z', { trust: 60, topPain: 'runtime compile' }),
  ];
  const episodes = detectEpisodes(snapshots);
  assert.ok(episodes.length >= 1);
  const trustDrop = episodes.find((e) => e.type === 'trust-drop');
  assert.ok(trustDrop, 'Should detect trust drop');
  assert.ok(trustDrop.description.includes('20')); // dropped 20 points
});

test('detectEpisodes: detects failure spike', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { failureScore: 10, topPain: 'none' }),
    makeSnapshot('2026-05-10T06:00:00Z', { failureScore: 40, topPain: 'runtime compile' }),
  ];
  const episodes = detectEpisodes(snapshots);
  const spike = episodes.find((e) => e.type === 'failure-spike');
  assert.ok(spike, 'Should detect failure spike');
  assert.ok(spike.description.includes('30')); // delta = 30
});

test('detectEpisodes: detects friction surge', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { frictionScore: 10 }),
    makeSnapshot('2026-05-10T06:00:00Z', { frictionScore: 50 }),
  ];
  const episodes = detectEpisodes(snapshots);
  const surge = episodes.find((e) => e.type === 'friction-surge');
  assert.ok(surge, 'Should detect friction surge');
});

test('detectEpisodes: detects recovery', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { trust: 30 }),
    makeSnapshot('2026-05-10T06:00:00Z', { trust: 60 }),
  ];
  const episodes = detectEpisodes(snapshots);
  const recovery = episodes.find((e) => e.type === 'recovery');
  assert.ok(recovery, 'Should detect recovery');
});

test('detectEpisodes: detects anomaly (high cost, low scores)', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { failureScore: 5 }),
    makeSnapshot('2026-05-10T06:00:00Z', { failureScore: 5, frictionScore: 5, cost: 100 }),
  ];
  const episodes = detectEpisodes(snapshots);
  const anomaly = episodes.find((e) => e.type === 'anomaly');
  assert.ok(anomaly, 'Should detect anomaly');
});

test('detectEpisodes: no episode when changes are below thresholds', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { trust: 80, failureScore: 10, frictionScore: 10, cost: 5 }),
    makeSnapshot('2026-05-10T06:00:00Z', { trust: 75, failureScore: 15, frictionScore: 15, cost: 10 }),
  ];
  const episodes = detectEpisodes(snapshots);
  assert.strictEqual(episodes.length, 0);
});

test('detectEpisodes: episodes sorted by significance descending', () => {
  const snapshots = [
    makeSnapshot('2026-05-10T00:00:00Z', { trust: 80, failureScore: 10, frictionScore: 10 }),
    makeSnapshot('2026-05-10T06:00:00Z', { trust: 40, failureScore: 60, frictionScore: 60 }),
  ];
  const episodes = detectEpisodes(snapshots);
  for (let i = 1; i < episodes.length; i++) {
    assert.ok(episodes[i - 1].significance >= episodes[i].significance,
      `Episode ${i - 1} significance should be >= episode ${i}`);
  }
});

// ── Relevance ranking tests ──────────────────────────────────────────────

test('buildRelevanceRanking: empty inputs returns empty ranking', () => {
  const working = { signals: [], windowSize: 0, summary: emptyTierSummary() };
  const archival = { patterns: [], windowSize: 0, summary: emptyTierSummary() };
  const ranking = buildRelevanceRanking(working, archival, [], 10, Date.now());
  assert.deepStrictEqual(ranking.topGaps, []);
  assert.strictEqual(ranking.totalRanked, 0);
});

test('buildRelevanceRanking: working signals with topPain are included', () => {
  const now = Date.now();
  const working = {
    signals: [{
      signalId: 'mem-test1',
      tier: 'working',
      relevanceScore: 80,
      capturedAt: new Date(now).toISOString(),
      signals: { failureScore: 50, topPain: 'runtime compile', trust: 50 },
      decayFactor: 1.0,
    }],
    windowSize: 1,
    summary: emptyTierSummary(),
  };
  const ranking = buildRelevanceRanking(working, { patterns: [], windowSize: 0, summary: emptyTierSummary() }, [], 10, now);
  assert.strictEqual(ranking.totalRanked, 1);
  assert.strictEqual(ranking.topGaps[0].category, 'runtime compile');
  assert.strictEqual(ranking.topGaps[0].sourceTier, 'working');
});

test('buildRelevanceRanking: deduplicates by sourceTier+category', () => {
  const now = Date.now();
  const working = {
    signals: [{
      signalId: 'mem-test1',
      tier: 'working',
      relevanceScore: 80,
      capturedAt: new Date(now).toISOString(),
      signals: { failureScore: 50, topPain: 'runtime compile', trust: 50 },
      decayFactor: 1.0,
    }],
    windowSize: 1,
    summary: emptyTierSummary(),
  };
  // Same category in working — should be deduped (only highest kept)
  working.signals.push({
    signalId: 'mem-test2',
    tier: 'working',
    relevanceScore: 60,
    capturedAt: new Date(now - 1000).toISOString(),
    signals: { failureScore: 30, topPain: 'runtime compile', trust: 70 },
    decayFactor: 0.9,
  });
  const ranking = buildRelevanceRanking(working, { patterns: [], windowSize: 0, summary: emptyTierSummary() }, [], 10, now);
  assert.strictEqual(ranking.totalRanked, 1); // deduped
  assert.strictEqual(ranking.topGaps[0].relevanceScore, 80); // higher kept
});

test('buildRelevanceRanking: limits to topGaps', () => {
  const now = Date.now();
  const signals = Array.from({ length: 15 }, (_, i) => ({
    signalId: `mem-test${i}`,
    tier: 'working',
    relevanceScore: 90 - i,
    capturedAt: new Date(now).toISOString(),
    signals: { failureScore: 50, topPain: `category-${i}`, trust: 50 },
    decayFactor: 1.0,
  }));
  const working = { signals, windowSize: 15, summary: emptyTierSummary() };
  const ranking = buildRelevanceRanking(working, { patterns: [], windowSize: 0, summary: emptyTierSummary() }, [], 5, now);
  assert.strictEqual(ranking.topGaps.length, 5);
  assert.strictEqual(ranking.totalRanked, 15);
});

test('buildRelevanceRanking: includes archival patterns', () => {
  const now = Date.now();
  const archival = {
    patterns: [{
      patternId: 'pat-test',
      category: 'runtime compile',
      trend: 'increasing',
      frequency: 5,
      avgSeverity: 40,
      firstSeen: new Date(now - 86400000).toISOString(),
      lastSeen: new Date(now).toISOString(),
    }],
    windowSize: 10,
    summary: emptyTierSummary(),
  };
  const ranking = buildRelevanceRanking(
    { signals: [], windowSize: 0, summary: emptyTierSummary() },
    archival,
    [],
    10,
    now,
  );
  assert.strictEqual(ranking.totalRanked, 1);
  assert.strictEqual(ranking.topGaps[0].sourceTier, 'archival');
});

test('buildRelevanceRanking: includes episodic entries', () => {
  const now = Date.now();
  const episodes = [{
    episodeId: 'ep-test',
    type: 'trust-drop',
    description: 'Trust dropped 20 points',
    detectedAt: new Date(now).toISOString(),
    signals: {},
    significance: 70,
  }];
  const ranking = buildRelevanceRanking(
    { signals: [], windowSize: 0, summary: emptyTierSummary() },
    { patterns: [], windowSize: 0, summary: emptyTierSummary() },
    episodes,
    10,
    now,
  );
  assert.strictEqual(ranking.totalRanked, 1);
  assert.strictEqual(ranking.topGaps[0].sourceTier, 'episodic');
});

test('buildRelevanceRanking: entries are sorted by relevance descending', () => {
  const now = Date.now();
  const episodes = [
    { episodeId: 'ep-1', type: 'trust-drop', description: 'low', detectedAt: new Date(now).toISOString(), signals: {}, significance: 30 },
    { episodeId: 'ep-2', type: 'failure-spike', description: 'high', detectedAt: new Date(now).toISOString(), signals: {}, significance: 90 },
  ];
  const ranking = buildRelevanceRanking(
    { signals: [], windowSize: 0, summary: emptyTierSummary() },
    { patterns: [], windowSize: 0, summary: emptyTierSummary() },
    episodes,
    10,
    now,
  );
  assert.strictEqual(ranking.topGaps[0].rank, 1);
  assert.ok(ranking.topGaps[0].relevanceScore >= ranking.topGaps[1].relevanceScore);
});

// ── Threshold constant tests ─────────────────────────────────────────────

test('thresholds: TRUST_DROP_THRESHOLD is 15', () => {
  assert.strictEqual(TRUST_DROP_THRESHOLD, 15);
});

test('thresholds: FAILURE_SPIKE_THRESHOLD is 20', () => {
  assert.strictEqual(FAILURE_SPIKE_THRESHOLD, 20);
});

test('thresholds: FRICTION_SURGE_THRESHOLD is 25', () => {
  assert.strictEqual(FRICTION_SURGE_THRESHOLD, 25);
});

// ── Integration: subprocess tests ────────────────────────────────────────

function runSubprocess(args) {
  const { execSync } = require('child_process');
  const script = path.resolve(__dirname, 'calculate-meta-signal-memory.js');
  const cmd = `node "${script}" ${args.join(' ')}`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 };
  }
}

function createTempHistoryDir(snapshots) {
  const tmpDir = path.join(os.tmpdir(), `meta-signal-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  for (let i = 0; i < snapshots.length; i++) {
    const filePath = path.join(tmpDir, `snapshot-${String(i).padStart(3, '0')}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshots[i]) + '\n', 'utf8');
  }
  return tmpDir;
}

test('integration: --help exits 0', () => {
  const { exitCode } = runSubprocess(['--help']);
  assert.strictEqual(exitCode, 0);
});

test('integration: unknown argument exits 2', () => {
  const { exitCode } = runSubprocess(['--bogus']);
  assert.strictEqual(exitCode, 2);
});

test('integration: --stdout with empty directory produces zeroed snapshot', () => {
  const tmpDir = createTempHistoryDir([]);
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--historyDir', tmpDir]);
    assert.strictEqual(exitCode, 0);
    const memory = JSON.parse(stdout);
    assert.strictEqual(memory.schemaVersion, 1);
    assert.deepStrictEqual(memory.working.signals, []);
    assert.deepStrictEqual(memory.archival.patterns, []);
    assert.deepStrictEqual(memory.episodic, []);
    assert.strictEqual(memory.relevanceRanking.totalRanked, 0);
    assert.strictEqual(memory.inputSources.snapshotCount, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('integration: --stdout with snapshots produces structured memory', () => {
  const now = Date.now();
  const snapshots = [
    makeSnapshot(new Date(now - 7200000).toISOString(), { failureScore: 30, trust: 70, topPain: 'runtime compile' }),
    makeSnapshot(new Date(now - 3600000).toISOString(), { failureScore: 50, trust: 50, topPain: 'runtime compile' }),
    makeSnapshot(new Date(now).toISOString(), { failureScore: 20, trust: 80, topPain: 'boundary guard' }),
  ];
  const tmpDir = createTempHistoryDir(snapshots);
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--historyDir', tmpDir]);
    assert.strictEqual(exitCode, 0);
    const memory = JSON.parse(stdout);
    assert.strictEqual(memory.inputSources.snapshotCount, 3);
    assert.strictEqual(memory.working.windowSize, 3);
    assert.strictEqual(memory.working.signals.length, 3);
    assert.ok(memory.archival.patterns.length > 0);
    assert.strictEqual(typeof memory.relevanceRanking.totalRanked, 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('integration: --stdout with trust drop detects episode', () => {
  const now = Date.now();
  const snapshots = [
    makeSnapshot(new Date(now - 3600000).toISOString(), { trust: 80, failureScore: 10 }),
    makeSnapshot(new Date(now).toISOString(), { trust: 50, failureScore: 10, topPain: 'runtime compile' }),
  ];
  const tmpDir = createTempHistoryDir(snapshots);
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--historyDir', tmpDir]);
    assert.strictEqual(exitCode, 0);
    const memory = JSON.parse(stdout);
    const trustDrop = memory.episodic.find((e) => e.type === 'trust-drop');
    assert.ok(trustDrop, 'Should detect trust drop episode');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('integration: --out writes file', () => {
  const tmpDir = createTempHistoryDir([]);
  const tmpOut = path.join(os.tmpdir(), `memory-out-${Date.now()}.json`);
  try {
    const { stdout, exitCode } = runSubprocess(['--out', tmpOut, '--historyDir', tmpDir]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Meta signal memory written to'));
    const written = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('integration: --workingWindow limits working memory size', () => {
  const now = Date.now();
  const snapshots = Array.from({ length: 10 }, (_, i) =>
    makeSnapshot(new Date(now - i * 3600000).toISOString(), { failureScore: i * 10 }),
  );
  const tmpDir = createTempHistoryDir(snapshots);
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--workingWindow', '3', '--historyDir', tmpDir]);
    assert.strictEqual(exitCode, 0);
    const memory = JSON.parse(stdout);
    assert.strictEqual(memory.working.windowSize, 3);
    assert.strictEqual(memory.working.signals.length, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('integration: nonexistent historyDir produces zeroed snapshot', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--historyDir', '/nonexistent/path']);
  assert.strictEqual(exitCode, 0);
  const memory = JSON.parse(stdout);
  assert.strictEqual(memory.inputSources.snapshotCount, 0);
  assert.deepStrictEqual(memory.working.signals, []);
});

test('integration: malformed JSON files are skipped', () => {
  const tmpDir = path.join(os.tmpdir(), `malformed-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not json', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'good.json'), JSON.stringify(
    makeSnapshot('2026-05-10T00:00:00Z', { failureScore: 30, topPain: 'runtime compile' }),
  ) + '\n', 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--historyDir', tmpDir]);
    assert.strictEqual(exitCode, 0);
    const memory = JSON.parse(stdout);
    assert.strictEqual(memory.inputSources.snapshotCount, 1); // only good file
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Report ───────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  calculate-meta-signal-memory.test.js`);
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
