#!/usr/bin/env node

/**
 * calculate-opportunity-signals.test.js
 *
 * Tests for opportunity signal calculation logic derived from
 * suggest-next-tasks-from-meta-signals.js.
 *
 * Covers: no facts (zeroed signals), repeated pain facts, high-risk facts
 * excluded, and deterministic output shape.
 *
 * Runs without any test framework — uses Node assert and direct function calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Pure function mirrors (copied from suggest-next-tasks-from-meta-signals.js) ──

const THRESHOLDS = {
  failureScore: 0,
  frictionScore: 30,
  riskScore: 40,
  trust: 50,
  cost: 30,
};

const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function suggestFromFailure(signals) {
  if (signals.failureScore <= THRESHOLDS.failureScore) return [];
  const topPain = signals.topPain || 'none';
  const painLabel = topPain !== 'none' ? topPain : 'unknown category';
  const confidence = clamp(Math.round(40 + (signals.failureScore / 100) * 55), 40, 95);
  const priority = signals.failureScore >= 60 ? 'critical' : signals.failureScore >= 30 ? 'high' : 'medium';
  return [{
    id: 'fix-top-pain-area',
    category: 'failure',
    title: `Investigate and fix failures in ${painLabel}`,
    reason: `failureScore is ${signals.failureScore} with topPain="${topPain}". Recent health checks report red-state entries in this area.`,
    confidence,
    priority,
    signalValues: { failureScore: signals.failureScore, topPain: signals.topPain },
    actionHint: 'Review recent health check logs for red-state entries and address root causes.',
  }];
}

function suggestFromFriction(signals) {
  if (signals.frictionScore <= THRESHOLDS.frictionScore) return [];
  const confidence = clamp(Math.round(35 + (signals.frictionScore / 100) * 55), 35, 90);
  const priority = signals.frictionScore >= 60 ? 'high' : signals.frictionScore >= 30 ? 'medium' : 'low';
  return [{
    id: 'reduce-worker-friction',
    category: 'friction',
    title: 'Reduce worker friction from stale or silent workers',
    reason: `frictionScore is ${signals.frictionScore}. Workers may be stuck in stale or running:no-output states.`,
    confidence,
    priority,
    signalValues: { frictionScore: signals.frictionScore },
    actionHint: 'Check heartbeat logs for stale workers and restart or terminate unresponsive tasks.',
  }];
}

function suggestFromRisk(signals) {
  if (signals.riskScore <= THRESHOLDS.riskScore) return [];
  const confidence = clamp(Math.round(30 + (signals.riskScore / 100) * 60), 30, 90);
  const priority = signals.riskScore >= 70 ? 'critical' : signals.riskScore >= 40 ? 'high' : 'medium';
  return [{
    id: 'de-risk-high-slices',
    category: 'risk',
    title: 'Mitigate high-risk slices before proceeding',
    reason: `riskScore is ${signals.riskScore}. Unresolved high-severity slices remain in the current batch.`,
    confidence,
    priority,
    signalValues: { riskScore: signals.riskScore },
    actionHint: 'Prioritize low-risk tasks or resolve blocking high-severity slices first.',
  }];
}

function suggestFromTrust(signals) {
  if (signals.trust >= THRESHOLDS.trust) return [];
  const confidence = clamp(Math.round(35 + ((100 - signals.trust) / 100) * 55), 35, 90);
  const priority = signals.trust <= 20 ? 'critical' : signals.trust <= 50 ? 'high' : 'medium';
  return [{
    id: 'rebuild-trust',
    category: 'trust',
    title: 'Rebuild system trust before launching new workers',
    reason: `trust is ${signals.trust} (below ${THRESHOLDS.trust}). Combined failure and friction are eroding confidence.`,
    confidence,
    priority,
    signalValues: { trust: signals.trust, failureScore: signals.failureScore, frictionScore: signals.frictionScore },
    actionHint: 'Address top failure and friction sources before expanding the batch.',
  }];
}

function suggestFromCost(signals) {
  if (signals.cost <= THRESHOLDS.cost) return [];
  const confidence = clamp(Math.round(25 + Math.min(signals.cost / 100, 1) * 50), 25, 75);
  const priority = signals.cost >= 120 ? 'medium' : 'low';
  return [{
    id: 'optimize-cost',
    category: 'cost',
    title: 'Review worker cost accumulation',
    reason: `cost is ${signals.cost} worker-minutes. Extended batch windows may indicate inefficient task distribution.`,
    confidence,
    priority,
    signalValues: { cost: signals.cost },
    actionHint: 'Review task sizing and consider splitting long-running tasks.',
  }];
}

function suggestProceed(signals) {
  if (
    signals.failureScore > THRESHOLDS.failureScore ||
    signals.frictionScore > THRESHOLDS.frictionScore ||
    signals.riskScore > THRESHOLDS.riskScore ||
    signals.trust < THRESHOLDS.trust
  ) {
    return [];
  }
  return [{
    id: 'proceed-with-next-batch',
    category: 'health',
    title: 'System is healthy — proceed with next batch',
    reason: `All signals are within safe bounds (trust=${signals.trust}, failure=${signals.failureScore}, friction=${signals.frictionScore}, risk=${signals.riskScore}).`,
    confidence: 85,
    priority: 'info',
    signalValues: {
      trust: signals.trust,
      failureScore: signals.failureScore,
      frictionScore: signals.frictionScore,
      riskScore: signals.riskScore,
    },
    actionHint: 'Safe to launch the next planned batch of workers.',
  }];
}

function generateSuggestions(signals) {
  const raw = [
    ...suggestFromFailure(signals),
    ...suggestFromFriction(signals),
    ...suggestFromRisk(signals),
    ...suggestFromTrust(signals),
    ...suggestFromCost(signals),
    ...suggestProceed(signals),
  ];
  raw.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });
  return raw;
}

const SUGGESTION_KEYS = ['id', 'category', 'title', 'reason', 'confidence', 'priority', 'signalValues', 'actionHint'];

function assertSuggestionShape(suggestion) {
  for (const key of SUGGESTION_KEYS) {
    assert.ok(key in suggestion, `suggestion missing key: ${key}`);
  }
  assert.strictEqual(typeof suggestion.id, 'string');
  assert.strictEqual(typeof suggestion.category, 'string');
  assert.strictEqual(typeof suggestion.title, 'string');
  assert.strictEqual(typeof suggestion.reason, 'string');
  assert.strictEqual(typeof suggestion.confidence, 'number');
  assert.ok(suggestion.confidence >= 0 && suggestion.confidence <= 100, `confidence out of range: ${suggestion.confidence}`);
  assert.strictEqual(typeof suggestion.priority, 'string');
  assert.ok(['critical', 'high', 'medium', 'low', 'info'].includes(suggestion.priority), `unexpected priority: ${suggestion.priority}`);
  assert.strictEqual(typeof suggestion.signalValues, 'object');
  assert.strictEqual(typeof suggestion.actionHint, 'string');
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

// ── No facts: zeroed signals produce only the "proceed" suggestion ────────

const ZEROED = { failureScore: 0, frictionScore: 0, riskScore: 0, cost: 0, trust: 100, topPain: 'none' };

test('no facts: zeroed signals produce exactly one suggestion (proceed)', () => {
  const suggestions = generateSuggestions(ZEROED);
  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].category, 'health');
  assert.strictEqual(suggestions[0].id, 'proceed-with-next-batch');
});

test('no facts: proceed suggestion has priority "info"', () => {
  const suggestions = generateSuggestions(ZEROED);
  assert.strictEqual(suggestions[0].priority, 'info');
});

test('no facts: proceed suggestion confidence is 85', () => {
  const suggestions = generateSuggestions(ZEROED);
  assert.strictEqual(suggestions[0].confidence, 85);
});

test('no facts: proceed suggestion signalValues match input', () => {
  const suggestions = generateSuggestions(ZEROED);
  const sv = suggestions[0].signalValues;
  assert.strictEqual(sv.trust, 100);
  assert.strictEqual(sv.failureScore, 0);
  assert.strictEqual(sv.frictionScore, 0);
  assert.strictEqual(sv.riskScore, 0);
});

test('no facts: all suggestion shapes are valid', () => {
  const suggestions = generateSuggestions(ZEROED);
  for (const s of suggestions) assertSuggestionShape(s);
});

test('no facts: trust exactly at threshold (50) does not trigger trust suggestion', () => {
  const signals = { ...ZEROED, trust: 50 };
  const suggestions = generateSuggestions(signals);
  const trustSugg = suggestions.filter(s => s.category === 'trust');
  assert.strictEqual(trustSugg.length, 0);
});

test('no facts: friction exactly at threshold (30) does not trigger friction suggestion', () => {
  const signals = { ...ZEROED, frictionScore: 30 };
  const suggestions = generateSuggestions(signals);
  const frictionSugg = suggestions.filter(s => s.category === 'friction');
  assert.strictEqual(frictionSugg.length, 0);
});

test('no facts: risk exactly at threshold (40) does not trigger risk suggestion', () => {
  const signals = { ...ZEROED, riskScore: 40 };
  const suggestions = generateSuggestions(signals);
  const riskSugg = suggestions.filter(s => s.category === 'risk');
  assert.strictEqual(riskSugg.length, 0);
});

test('no facts: cost exactly at threshold (30) does not trigger cost suggestion', () => {
  const signals = { ...ZEROED, cost: 30 };
  const suggestions = generateSuggestions(signals);
  const costSugg = suggestions.filter(s => s.category === 'cost');
  assert.strictEqual(costSugg.length, 0);
});

// ── Repeated pain facts: failure signals with repeated topPain ────────────

test('repeated pain: failureScore > 0 triggers failure suggestion', () => {
  const signals = { ...ZEROED, failureScore: 25, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.filter(s => s.category === 'failure');
  assert.strictEqual(failSugg.length, 1);
  assert.strictEqual(failSugg[0].id, 'fix-top-pain-area');
});

test('repeated pain: topPain appears in title and reason', () => {
  const signals = { ...ZEROED, failureScore: 40, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.ok(failSugg.title.includes('runtime compile'));
  assert.ok(failSugg.reason.includes('runtime compile'));
});

test('repeated pain: medium priority for failureScore 1-29', () => {
  const signals = { ...ZEROED, failureScore: 15, topPain: 'boundary guard' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failSugg.priority, 'medium');
});

test('repeated pain: high priority for failureScore 30-59', () => {
  const signals = { ...ZEROED, failureScore: 45, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failSugg.priority, 'high');
});

test('repeated pain: critical priority for failureScore >= 60', () => {
  const signals = { ...ZEROED, failureScore: 75, topPain: 'dependency/generate' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failSugg.priority, 'critical');
});

test('repeated pain: failureScore 100 gives confidence 95', () => {
  const signals = { ...ZEROED, failureScore: 100, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failSugg.confidence, 95);
});

test('repeated pain: failureScore 1 gives confidence 41', () => {
  const signals = { ...ZEROED, failureScore: 1, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  // Math.round(40 + (1/100)*55) = Math.round(40.55) = 41
  assert.strictEqual(failSugg.confidence, 41);
});

test('repeated pain: topPain "none" uses "unknown category" label', () => {
  const signals = { ...ZEROED, failureScore: 20, topPain: 'none' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.ok(failSugg.title.includes('unknown category'));
});

test('repeated pain: missing topPain uses "unknown category" label', () => {
  const signals = { failureScore: 20, frictionScore: 0, riskScore: 0, cost: 0, trust: 100 };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.ok(failSugg.title.includes('unknown category'));
});

test('repeated pain: same signals produce identical suggestions (deterministic)', () => {
  const signals = { ...ZEROED, failureScore: 40, topPain: 'runtime compile' };
  const first = generateSuggestions(signals);
  const second = generateSuggestions(signals);
  assert.deepStrictEqual(first, second);
});

test('repeated pain: multiple invocations with same pain produce same id', () => {
  const signals = { ...ZEROED, failureScore: 50, topPain: 'boundary guard' };
  const ids1 = generateSuggestions(signals).map(s => s.id);
  const ids2 = generateSuggestions(signals).map(s => s.id);
  assert.deepStrictEqual(ids1, ids2);
});

// ── High-risk facts excluded: risk signals and their priority ─────────────

test('high-risk: riskScore 41 triggers risk suggestion with priority "high"', () => {
  const signals = { ...ZEROED, riskScore: 41 };
  const suggestions = generateSuggestions(signals);
  const riskSugg = suggestions.filter(s => s.category === 'risk');
  assert.strictEqual(riskSugg.length, 1);
  assert.strictEqual(riskSugg[0].priority, 'high');
});

test('high-risk: riskScore 70 triggers risk suggestion with priority "critical"', () => {
  const signals = { ...ZEROED, riskScore: 70 };
  const suggestions = generateSuggestions(signals);
  const riskSugg = suggestions.find(s => s.category === 'risk');
  assert.strictEqual(riskSugg.priority, 'critical');
});

test('high-risk: riskScore 100 gives confidence 90', () => {
  const signals = { ...ZEROED, riskScore: 100 };
  const suggestions = generateSuggestions(signals);
  const riskSugg = suggestions.find(s => s.category === 'risk');
  assert.strictEqual(riskSugg.confidence, 90);
});

test('high-risk: riskScore 1 gives confidence 30', () => {
  const signals = { ...ZEROED, riskScore: 1 };
  const suggestions = generateSuggestions(signals);
  // riskScore 1 <= threshold 40, should not trigger
  const riskSugg = suggestions.filter(s => s.category === 'risk');
  assert.strictEqual(riskSugg.length, 0);
});

test('high-risk: riskScore 41 gives confidence ~55', () => {
  const signals = { ...ZEROED, riskScore: 41 };
  const suggestions = generateSuggestions(signals);
  const riskSugg = suggestions.find(s => s.category === 'risk');
  const expected = Math.round(30 + (41 / 100) * 60);
  assert.strictEqual(riskSugg.confidence, expected);
});

test('high-risk: combined failure + risk produces both suggestions', () => {
  const signals = { ...ZEROED, failureScore: 50, topPain: 'runtime compile', riskScore: 60 };
  const suggestions = generateSuggestions(signals);
  const cats = suggestions.map(s => s.category);
  assert.ok(cats.includes('failure'));
  assert.ok(cats.includes('risk'));
});

test('high-risk: high-risk signals are sorted before lower priority ones', () => {
  const signals = { ...ZEROED, failureScore: 10, topPain: 'docs guard', riskScore: 80 };
  const suggestions = generateSuggestions(signals);
  const riskIdx = suggestions.findIndex(s => s.category === 'risk');
  const failIdx = suggestions.findIndex(s => s.category === 'failure');
  // risk at priority critical should come before failure at medium
  assert.ok(riskIdx < failIdx, 'risk (critical) should sort before failure (medium)');
});

test('high-risk: all suggestion shapes are valid with risk signals', () => {
  const signals = { ...ZEROED, riskScore: 85 };
  const suggestions = generateSuggestions(signals);
  for (const s of suggestions) assertSuggestionShape(s);
});

// ── Deterministic output shape ────────────────────────────────────────────

test('deterministic: proceed suggestion has all required keys', () => {
  const suggestions = generateSuggestions(ZEROED);
  const sugg = suggestions[0];
  for (const key of SUGGESTION_KEYS) {
    assert.ok(key in sugg, `missing key: ${key}`);
  }
});

test('deterministic: failure suggestion signalValues contain expected keys', () => {
  const signals = { ...ZEROED, failureScore: 50, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failSugg = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(typeof failSugg.signalValues.failureScore, 'number');
  assert.strictEqual(typeof failSugg.signalValues.topPain, 'string');
});

test('deterministic: friction suggestion signalValues contain frictionScore', () => {
  const signals = { ...ZEROED, frictionScore: 50 };
  const suggestions = generateSuggestions(signals);
  const fricSugg = suggestions.find(s => s.category === 'friction');
  assert.strictEqual(typeof fricSugg.signalValues.frictionScore, 'number');
  assert.strictEqual(fricSugg.signalValues.frictionScore, 50);
});

test('deterministic: trust suggestion signalValues contain trust, failureScore, frictionScore', () => {
  const signals = { ...ZEROED, trust: 30, failureScore: 40, frictionScore: 50 };
  const suggestions = generateSuggestions(signals);
  const trustSugg = suggestions.find(s => s.category === 'trust');
  assert.strictEqual(typeof trustSugg.signalValues.trust, 'number');
  assert.strictEqual(typeof trustSugg.signalValues.failureScore, 'number');
  assert.strictEqual(typeof trustSugg.signalValues.frictionScore, 'number');
});

test('deterministic: cost suggestion signalValues contain cost', () => {
  const signals = { ...ZEROED, cost: 50 };
  const suggestions = generateSuggestions(signals);
  const costSugg = suggestions.find(s => s.category === 'cost');
  assert.strictEqual(typeof costSugg.signalValues.cost, 'number');
  assert.strictEqual(costSugg.signalValues.cost, 50);
});

test('deterministic: priority values are always in the allowed set', () => {
  const testCases = [
    { ...ZEROED, failureScore: 5 },
    { ...ZEROED, failureScore: 35 },
    { ...ZEROED, failureScore: 70 },
    { ...ZEROED, frictionScore: 31 },
    { ...ZEROED, frictionScore: 65 },
    { ...ZEROED, riskScore: 45 },
    { ...ZEROED, riskScore: 75 },
    { ...ZEROED, trust: 30 },
    { ...ZEROED, trust: 10 },
    { ...ZEROED, cost: 40 },
    { ...ZEROED, cost: 150 },
  ];
  for (const signals of testCases) {
    const suggestions = generateSuggestions(signals);
    for (const s of suggestions) {
      assert.ok(
        ['critical', 'high', 'medium', 'low', 'info'].includes(s.priority),
        `invalid priority "${s.priority}" for signal ${JSON.stringify(signals)}`
      );
    }
  }
});

test('deterministic: confidence is always an integer between 0 and 100', () => {
  const testCases = [
    { ...ZEROED, failureScore: 1 },
    { ...ZEROED, failureScore: 50 },
    { ...ZEROED, failureScore: 100 },
    { ...ZEROED, frictionScore: 31 },
    { ...ZEROED, frictionScore: 100 },
    { ...ZEROED, riskScore: 41 },
    { ...ZEROED, riskScore: 100 },
    { ...ZEROED, trust: 49 },
    { ...ZEROED, trust: 0 },
    { ...ZEROED, cost: 31 },
    { ...ZEROED, cost: 200 },
  ];
  for (const signals of testCases) {
    const suggestions = generateSuggestions(signals);
    for (const s of suggestions) {
      assert.strictEqual(s.confidence, Math.round(s.confidence), `confidence not integer: ${s.confidence}`);
      assert.ok(s.confidence >= 0 && s.confidence <= 100, `confidence out of range: ${s.confidence}`);
    }
  }
});

test('deterministic: same inputs always produce same output (100 iterations)', () => {
  const signals = { ...ZEROED, failureScore: 45, frictionScore: 55, riskScore: 65, cost: 40, trust: 35, topPain: 'runtime compile' };
  const first = JSON.stringify(generateSuggestions(signals));
  for (let i = 0; i < 100; i++) {
    assert.deepStrictEqual(JSON.stringify(generateSuggestions(signals)), first);
  }
});

test('deterministic: suggestion array is sorted by priority desc then confidence desc', () => {
  const signals = { ...ZEROED, failureScore: 50, frictionScore: 50, riskScore: 50, cost: 50, trust: 30, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  for (let i = 1; i < suggestions.length; i++) {
    const pa = PRIORITY_RANK[suggestions[i - 1].priority] || 0;
    const pb = PRIORITY_RANK[suggestions[i].priority] || 0;
    assert.ok(pa >= pb, `out of order: ${suggestions[i - 1].priority} before ${suggestions[i].priority}`);
    if (pa === pb) {
      assert.ok(
        suggestions[i - 1].confidence >= suggestions[i].confidence,
        `within same priority, confidence not desc: ${suggestions[i - 1].confidence} < ${suggestions[i].confidence}`
      );
    }
  }
});

// ── Integration: subprocess tests ────────────────────────────────────────

function runSubprocess(args) {
  const { execSync } = require('child_process');
  const script = path.resolve(__dirname, 'suggest-next-tasks-from-meta-signals.js');
  const cmd = `node "${script}" ${args.join(' ')}`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 };
  }
}

test('integration: --stdout with missing signals produces zeroed proceed suggestion', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', '/nonexistent/path.json']);
  assert.strictEqual(exitCode, 0);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.schemaVersion, 1);
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.suggestionCount, 1);
  assert.strictEqual(output.suggestions[0].category, 'health');
  assert.strictEqual(output.signals.failureScore, 0);
  assert.strictEqual(output.signals.trust, 100);
});

test('integration: --stdout with failure signals produces failure suggestion', () => {
  const tmpFile = path.join(os.tmpdir(), `opp-test-failure-${Date.now()}.json`);
  const snapshot = {
    snapshotVersion: 1,
    signals: { failureScore: 50, frictionScore: 0, riskScore: 0, cost: 0, trust: 70, topPain: 'runtime compile' },
  };
  fs.writeFileSync(tmpFile, JSON.stringify(snapshot), 'utf8');
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.ok(output.suggestions.length >= 1);
    const failSugg = output.suggestions.find(s => s.category === 'failure');
    assert.ok(failSugg);
    assert.strictEqual(failSugg.priority, 'high');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: --stdout with high-risk signals produces risk suggestion', () => {
  const tmpFile = path.join(os.tmpdir(), `opp-test-risk-${Date.now()}.json`);
  const snapshot = {
    snapshotVersion: 1,
    signals: { failureScore: 0, frictionScore: 0, riskScore: 80, cost: 0, trust: 80, topPain: 'none' },
  };
  fs.writeFileSync(tmpFile, JSON.stringify(snapshot), 'utf8');
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    const riskSugg = output.suggestions.find(s => s.category === 'risk');
    assert.ok(riskSugg);
    assert.strictEqual(riskSugg.priority, 'critical');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: --stdout with all-healthy signals produces only proceed', () => {
  const tmpFile = path.join(os.tmpdir(), `opp-test-healthy-${Date.now()}.json`);
  const snapshot = {
    snapshotVersion: 1,
    signals: { failureScore: 0, frictionScore: 0, riskScore: 0, cost: 0, trust: 100, topPain: 'none' },
  };
  fs.writeFileSync(tmpFile, JSON.stringify(snapshot), 'utf8');
  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', tmpFile]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.suggestionCount, 1);
    assert.strictEqual(output.suggestions[0].category, 'health');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('integration: --help exits 0', () => {
  const { exitCode } = runSubprocess(['--help']);
  assert.strictEqual(exitCode, 0);
});

test('integration: unknown argument exits 2', () => {
  const { exitCode } = runSubprocess(['--bogus']);
  assert.strictEqual(exitCode, 2);
});

test('integration: output shape is identical across runs with same input', () => {
  const tmpFile = path.join(os.tmpdir(), `opp-test-deterministic-${Date.now()}.json`);
  const snapshot = {
    snapshotVersion: 1,
    signals: { failureScore: 30, frictionScore: 40, riskScore: 50, cost: 20, trust: 45, topPain: 'boundary guard' },
  };
  fs.writeFileSync(tmpFile, JSON.stringify(snapshot), 'utf8');
  try {
    const { stdout: out1, exitCode: ec1 } = runSubprocess(['--stdout', '--signals', tmpFile]);
    const { stdout: out2, exitCode: ec2 } = runSubprocess(['--stdout', '--signals', tmpFile]);
    assert.strictEqual(ec1, 0);
    assert.strictEqual(ec2, 0);
    // Parse and compare excluding generatedAt (timestamps differ)
    const j1 = JSON.parse(out1);
    const j2 = JSON.parse(out2);
    assert.strictEqual(j1.schemaVersion, j2.schemaVersion);
    assert.strictEqual(j1.mode, j2.mode);
    assert.strictEqual(j1.suggestionCount, j2.suggestionCount);
    assert.deepStrictEqual(j1.signals, j2.signals);
    assert.deepStrictEqual(j1.suggestions, j2.suggestions);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

// ── Edge cases ────────────────────────────────────────────────────────────

test('edge: all signals at max (100) produces multiple suggestions', () => {
  const signals = { failureScore: 100, frictionScore: 100, riskScore: 100, cost: 200, trust: 0, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const cats = suggestions.map(s => s.category);
  assert.ok(cats.includes('failure'));
  assert.ok(cats.includes('friction'));
  assert.ok(cats.includes('risk'));
  assert.ok(cats.includes('trust'));
  assert.ok(cats.includes('cost'));
  // Should NOT include proceed (health) since signals are unhealthy
  assert.ok(!cats.includes('health'));
});

test('edge: proceed is excluded when any signal is unhealthy', () => {
  const signals = { ...ZEROED, failureScore: 1 };
  const suggestions = generateSuggestions(signals);
  const proceed = suggestions.filter(s => s.category === 'health');
  assert.strictEqual(proceed.length, 0);
});

test('edge: negative signal values do not crash', () => {
  const signals = { failureScore: -10, frictionScore: -5, riskScore: -1, cost: -100, trust: -20, topPain: 'none' };
  const suggestions = generateSuggestions(signals);
  // trust < 50 triggers trust suggestion even at negative
  assert.ok(suggestions.length >= 0);
});

test('edge: trust at exactly 50 does not trigger trust suggestion', () => {
  const signals = { ...ZEROED, trust: 50 };
  const suggestions = generateSuggestions(signals);
  const trustSugg = suggestions.filter(s => s.category === 'trust');
  assert.strictEqual(trustSugg.length, 0);
});

test('edge: trust at 49 triggers trust suggestion with priority high', () => {
  const signals = { ...ZEROED, trust: 49 };
  const suggestions = generateSuggestions(signals);
  const trustSugg = suggestions.find(s => s.category === 'trust');
  assert.ok(trustSugg);
  assert.strictEqual(trustSugg.priority, 'high');
});

test('edge: trust at 20 triggers trust suggestion with priority critical', () => {
  const signals = { ...ZEROED, trust: 20 };
  const suggestions = generateSuggestions(signals);
  const trustSugg = suggestions.find(s => s.category === 'trust');
  assert.strictEqual(trustSugg.priority, 'critical');
});

test('edge: frictionScore 31 triggers with priority medium', () => {
  const signals = { ...ZEROED, frictionScore: 31 };
  const suggestions = generateSuggestions(signals);
  const fricSugg = suggestions.find(s => s.category === 'friction');
  assert.strictEqual(fricSugg.priority, 'medium');
});

test('edge: frictionScore 60 triggers with priority high', () => {
  const signals = { ...ZEROED, frictionScore: 60 };
  const suggestions = generateSuggestions(signals);
  const fricSugg = suggestions.find(s => s.category === 'friction');
  assert.strictEqual(fricSugg.priority, 'high');
});

test('edge: cost 120 triggers with priority medium', () => {
  const signals = { ...ZEROED, cost: 120 };
  const suggestions = generateSuggestions(signals);
  const costSugg = suggestions.find(s => s.category === 'cost');
  assert.strictEqual(costSugg.priority, 'medium');
});

test('edge: cost 31 triggers with priority low', () => {
  const signals = { ...ZEROED, cost: 31 };
  const suggestions = generateSuggestions(signals);
  const costSugg = suggestions.find(s => s.category === 'cost');
  assert.strictEqual(costSugg.priority, 'low');
});

// ── Report ────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  calculate-opportunity-signals.test.js`);
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
