#!/usr/bin/env node

/**
 * suggest-next-tasks-from-meta-signals.test.js
 *
 * Focused self-tests for suggest-next-tasks-from-meta-signals.js.
 * Covers: suggestion generation from signals, confidence/priority scaling,
 * safe skeleton behavior, output structure, and subprocess integration.
 *
 * Runs without any test framework — uses Node assert and direct function calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Pure function mirrors (copied from suggest-next-tasks-from-meta-signals.js)

const SCHEMA_VERSION = 1;

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

function buildOutput(signals, suggestions) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    signals: {
      failureScore: signals.failureScore,
      frictionScore: signals.frictionScore,
      riskScore: signals.riskScore,
      cost: signals.cost,
      trust: signals.trust,
      topPain: signals.topPain,
    },
    suggestionCount: suggestions.length,
    suggestions,
  };
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

// ── Healthy (zeroed) signals ──────────────────────────────────────────────

const HEALTHY_SIGNALS = {
  failureScore: 0,
  frictionScore: 0,
  riskScore: 0,
  cost: 0,
  trust: 100,
  topPain: 'none',
};

test('healthy signals: produces only proceed suggestion', () => {
  const suggestions = generateSuggestions(HEALTHY_SIGNALS);
  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].id, 'proceed-with-next-batch');
  assert.strictEqual(suggestions[0].priority, 'info');
  assert.strictEqual(suggestions[0].confidence, 85);
});

test('healthy signals: proceed suggestion has correct signal values', () => {
  const suggestions = generateSuggestions(HEALTHY_SIGNALS);
  assert.deepStrictEqual(suggestions[0].signalValues, {
    trust: 100,
    failureScore: 0,
    frictionScore: 0,
    riskScore: 0,
  });
});

// ── Failure suggestions ───────────────────────────────────────────────────

test('failure: triggers when failureScore > 0', () => {
  const signals = { ...HEALTHY_SIGNALS, failureScore: 1, topPain: 'runtime compile' };
  const suggestions = generateSuggestions(signals);
  const failure = suggestions.find(s => s.id === 'fix-top-pain-area');
  assert.ok(failure, 'should have fix-top-pain-area suggestion');
  assert.strictEqual(failure.category, 'failure');
  assert.strictEqual(failure.priority, 'medium');
});

test('failure: medium priority for score 1-29', () => {
  const signals = { ...HEALTHY_SIGNALS, failureScore: 15, topPain: 'docs guard' };
  const suggestions = generateSuggestions(signals);
  const failure = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failure.priority, 'medium');
});

test('failure: high priority for score 30-59', () => {
  const signals = { ...HEALTHY_SIGNALS, failureScore: 45, topPain: 'boundary guard' };
  const suggestions = generateSuggestions(signals);
  const failure = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failure.priority, 'high');
});

test('failure: critical priority for score >= 60', () => {
  const signals = { ...HEALTHY_SIGNALS, failureScore: 75, topPain: 'dependency/generate' };
  const suggestions = generateSuggestions(signals);
  const failure = suggestions.find(s => s.category === 'failure');
  assert.strictEqual(failure.priority, 'critical');
});

test('failure: confidence scales with score', () => {
  const low = { ...HEALTHY_SIGNALS, failureScore: 1, topPain: 'x' };
  const high = { ...HEALTHY_SIGNALS, failureScore: 100, topPain: 'x' };
  const lowConf = generateSuggestions(low).find(s => s.category === 'failure').confidence;
  const highConf = generateSuggestions(high).find(s => s.category === 'failure').confidence;
  assert.ok(highConf > lowConf, `high confidence (${highConf}) should exceed low (${lowConf})`);
});

test('failure: topPain=none uses "unknown category" in title', () => {
  const signals = { ...HEALTHY_SIGNALS, failureScore: 10, topPain: 'none' };
  const suggestions = generateSuggestions(signals);
  const failure = suggestions.find(s => s.category === 'failure');
  assert.ok(failure.title.includes('unknown category'));
});

// ── Friction suggestions ──────────────────────────────────────────────────

test('friction: does not trigger at threshold (30)', () => {
  const signals = { ...HEALTHY_SIGNALS, frictionScore: 30 };
  const suggestions = generateSuggestions(signals);
  const friction = suggestions.find(s => s.id === 'reduce-worker-friction');
  assert.strictEqual(friction, undefined);
});

test('friction: triggers above threshold', () => {
  const signals = { ...HEALTHY_SIGNALS, frictionScore: 31 };
  const suggestions = generateSuggestions(signals);
  const friction = suggestions.find(s => s.id === 'reduce-worker-friction');
  assert.ok(friction, 'should have friction suggestion');
  assert.strictEqual(friction.priority, 'medium');
});

test('friction: high priority for score >= 60', () => {
  const signals = { ...HEALTHY_SIGNALS, frictionScore: 65 };
  const suggestions = generateSuggestions(signals);
  const friction = suggestions.find(s => s.category === 'friction');
  assert.strictEqual(friction.priority, 'high');
});

// ── Risk suggestions ──────────────────────────────────────────────────────

test('risk: does not trigger at threshold (40)', () => {
  const signals = { ...HEALTHY_SIGNALS, riskScore: 40 };
  const suggestions = generateSuggestions(signals);
  const risk = suggestions.find(s => s.id === 'de-risk-high-slices');
  assert.strictEqual(risk, undefined);
});

test('risk: triggers above threshold', () => {
  const signals = { ...HEALTHY_SIGNALS, riskScore: 41 };
  const suggestions = generateSuggestions(signals);
  const risk = suggestions.find(s => s.id === 'de-risk-high-slices');
  assert.ok(risk, 'should have risk suggestion');
  assert.strictEqual(risk.priority, 'high');
});

test('risk: critical priority for score >= 70', () => {
  const signals = { ...HEALTHY_SIGNALS, riskScore: 80 };
  const suggestions = generateSuggestions(signals);
  const risk = suggestions.find(s => s.category === 'risk');
  assert.strictEqual(risk.priority, 'critical');
});

// ── Trust suggestions ─────────────────────────────────────────────────────

test('trust: does not trigger at threshold (50)', () => {
  const signals = { ...HEALTHY_SIGNALS, trust: 50 };
  const suggestions = generateSuggestions(signals);
  const trust = suggestions.find(s => s.id === 'rebuild-trust');
  assert.strictEqual(trust, undefined);
});

test('trust: triggers below threshold', () => {
  const signals = { ...HEALTHY_SIGNALS, trust: 49 };
  const suggestions = generateSuggestions(signals);
  const trust = suggestions.find(s => s.id === 'rebuild-trust');
  assert.ok(trust, 'should have trust suggestion');
  assert.strictEqual(trust.priority, 'high');
});

test('trust: critical priority for trust <= 20', () => {
  const signals = { ...HEALTHY_SIGNALS, trust: 15 };
  const suggestions = generateSuggestions(signals);
  const trust = suggestions.find(s => s.category === 'trust');
  assert.strictEqual(trust.priority, 'critical');
});

// ── Cost suggestions ──────────────────────────────────────────────────────

test('cost: does not trigger at threshold (30)', () => {
  const signals = { ...HEALTHY_SIGNALS, cost: 30 };
  const suggestions = generateSuggestions(signals);
  const cost = suggestions.find(s => s.id === 'optimize-cost');
  assert.strictEqual(cost, undefined);
});

test('cost: triggers above threshold', () => {
  const signals = { ...HEALTHY_SIGNALS, cost: 31 };
  const suggestions = generateSuggestions(signals);
  const cost = suggestions.find(s => s.id === 'optimize-cost');
  assert.ok(cost, 'should have cost suggestion');
  assert.strictEqual(cost.priority, 'low');
});

test('cost: medium priority for cost >= 120', () => {
  const signals = { ...HEALTHY_SIGNALS, cost: 150 };
  const suggestions = generateSuggestions(signals);
  const cost = suggestions.find(s => s.category === 'cost');
  assert.strictEqual(cost.priority, 'medium');
});

// ── Sort order ────────────────────────────────────────────────────────────

test('sort: critical suggestions come before high', () => {
  const signals = { failureScore: 80, frictionScore: 65, riskScore: 50, cost: 0, trust: 40, topPain: 'x' };
  const suggestions = generateSuggestions(signals);
  const criticalIdx = suggestions.findIndex(s => s.priority === 'critical');
  const highIdx = suggestions.findIndex(s => s.priority === 'high');
  if (highIdx !== -1) {
    assert.ok(criticalIdx < highIdx, 'critical should come before high');
  }
});

test('sort: within same priority, higher confidence comes first', () => {
  const signals = { failureScore: 50, frictionScore: 65, riskScore: 0, cost: 0, trust: 100, topPain: 'x' };
  const suggestions = generateSuggestions(signals);
  // Both should be high priority; failure confidence should be higher
  const highPriority = suggestions.filter(s => s.priority === 'high');
  if (highPriority.length > 1) {
    for (let i = 0; i < highPriority.length - 1; i++) {
      assert.ok(
        highPriority[i].confidence >= highPriority[i + 1].confidence,
        `confidence should be descending within same priority`
      );
    }
  }
});

// ── Proceed suggestion suppression ────────────────────────────────────────

test('proceed: suppressed when any unhealthy signal exists', () => {
  const signals = { failureScore: 1, frictionScore: 0, riskScore: 0, cost: 0, trust: 100, topPain: 'x' };
  const suggestions = generateSuggestions(signals);
  const proceed = suggestions.find(s => s.id === 'proceed-with-next-batch');
  assert.strictEqual(proceed, undefined, 'proceed should be suppressed when failures exist');
});

// ── buildOutput structure ─────────────────────────────────────────────────

test('buildOutput: has correct schema version and mode', () => {
  const output = buildOutput(HEALTHY_SIGNALS, []);
  assert.strictEqual(output.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.suggestionCount, 0);
});

test('buildOutput: signals echo input values', () => {
  const signals = { failureScore: 42, frictionScore: 10, riskScore: 20, cost: 5, trust: 80, topPain: 'test' };
  const output = buildOutput(signals, []);
  assert.deepStrictEqual(output.signals, signals);
});

test('buildOutput: suggestionCount matches suggestions array length', () => {
  const suggestions = generateSuggestions({ ...HEALTHY_SIGNALS, failureScore: 10, topPain: 'x' });
  const output = buildOutput({ ...HEALTHY_SIGNALS, failureScore: 10, topPain: 'x' }, suggestions);
  assert.strictEqual(output.suggestionCount, suggestions.length);
});

// ── Multiple triggers ─────────────────────────────────────────────────────

test('multiple: generates multiple suggestions when several signals fire', () => {
  const signals = {
    failureScore: 30,
    frictionScore: 50,
    riskScore: 60,
    cost: 100,
    trust: 30,
    topPain: 'runtime compile',
  };
  const suggestions = generateSuggestions(signals);
  // Should have: failure, friction, risk, trust, cost — NO proceed
  assert.ok(suggestions.length >= 5, `expected at least 5 suggestions, got ${suggestions.length}`);
  const proceed = suggestions.find(s => s.id === 'proceed-with-next-batch');
  assert.strictEqual(proceed, undefined, 'proceed should not appear with unhealthy signals');
});

// ── Suggestion structure ──────────────────────────────────────────────────

test('structure: every suggestion has required fields', () => {
  const signals = {
    failureScore: 20,
    frictionScore: 40,
    riskScore: 50,
    cost: 50,
    trust: 30,
    topPain: 'test',
  };
  const suggestions = generateSuggestions(signals);
  for (const s of suggestions) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0, `id missing on ${JSON.stringify(s)}`);
    assert.ok(typeof s.category === 'string' && s.category.length > 0, `category missing on ${s.id}`);
    assert.ok(typeof s.title === 'string' && s.title.length > 0, `title missing on ${s.id}`);
    assert.ok(typeof s.reason === 'string' && s.reason.length > 0, `reason missing on ${s.id}`);
    assert.ok(typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 100, `confidence invalid on ${s.id}`);
    assert.ok(typeof s.priority === 'string', `priority missing on ${s.id}`);
    assert.ok(s.signalValues && typeof s.signalValues === 'object', `signalValues missing on ${s.id}`);
    assert.ok(typeof s.actionHint === 'string' && s.actionHint.length > 0, `actionHint missing on ${s.id}`);
  }
});

// ── Integration: subprocess ───────────────────────────────────────────────

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

test('integration: --help exits 0', () => {
  const { exitCode } = runSubprocess(['--help']);
  assert.strictEqual(exitCode, 0);
});

test('integration: unknown argument exits 2', () => {
  const { exitCode } = runSubprocess(['--bogus']);
  assert.strictEqual(exitCode, 2);
});

test('integration: --stdout with no signals file produces healthy default suggestions', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', '/nonexistent/path.json']);
  assert.strictEqual(exitCode, 0);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.schemaVersion, 1);
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.suggestionCount, 1);
  assert.strictEqual(output.suggestions[0].id, 'proceed-with-next-batch');
  assert.strictEqual(output.signals.trust, 100);
  assert.strictEqual(output.signals.topPain, 'none');
});

test('integration: --stdout with signals file produces correct suggestions', () => {
  const signalsPath = path.join(os.tmpdir(), `signals-test-${Date.now()}.json`);
  const snapshot = {
    snapshotVersion: 1,
    calculatedAt: new Date().toISOString(),
    inputSources: { healthLog: null, heartbeatLog: null, healthEntryCount: 0, heartbeatEntryCount: 0 },
    signals: {
      failureScore: 25,
      frictionScore: 45,
      riskScore: 50,
      cost: 60,
      trust: 40,
      topPain: 'runtime compile',
    },
  };
  fs.writeFileSync(signalsPath, JSON.stringify(snapshot, null, 2), 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', signalsPath]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.mode, 'dry-run');
    assert.ok(output.suggestionCount >= 4, `expected >= 4 suggestions, got ${output.suggestionCount}`);
    assert.strictEqual(output.signals.topPain, 'runtime compile');

    // Should have failure, friction, risk, trust, cost — NO proceed
    const ids = output.suggestions.map(s => s.id);
    assert.ok(ids.includes('fix-top-pain-area'), 'should include failure suggestion');
    assert.ok(ids.includes('reduce-worker-friction'), 'should include friction suggestion');
    assert.ok(ids.includes('de-risk-high-slices'), 'should include risk suggestion');
    assert.ok(ids.includes('rebuild-trust'), 'should include trust suggestion');
    assert.ok(ids.includes('optimize-cost'), 'should include cost suggestion');
    assert.ok(!ids.includes('proceed-with-next-batch'), 'should NOT include proceed suggestion');
  } finally {
    fs.unlinkSync(signalsPath);
  }
});

test('integration: --stdout with healthy signals shows only proceed', () => {
  const signalsPath = path.join(os.tmpdir(), `signals-healthy-${Date.now()}.json`);
  const snapshot = {
    snapshotVersion: 1,
    calculatedAt: new Date().toISOString(),
    inputSources: { healthLog: null, heartbeatLog: null, healthEntryCount: 0, heartbeatEntryCount: 0 },
    signals: {
      failureScore: 0,
      frictionScore: 0,
      riskScore: 0,
      cost: 0,
      trust: 100,
      topPain: 'none',
    },
  };
  fs.writeFileSync(signalsPath, JSON.stringify(snapshot, null, 2), 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', signalsPath]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.suggestionCount, 1);
    assert.strictEqual(output.suggestions[0].id, 'proceed-with-next-batch');
  } finally {
    fs.unlinkSync(signalsPath);
  }
});

test('integration: --out writes file and prints relative path', () => {
  const tmpOut = path.join(os.tmpdir(), `suggestions-out-${Date.now()}.json`);
  try {
    const { stdout, exitCode } = runSubprocess(['--out', tmpOut]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Next-task suggestions written to'));
    const written = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
    assert.strictEqual(written.mode, 'dry-run');
    assert.ok(written.suggestionCount >= 1);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
});

test('integration: missing signals file produces proceed suggestion (safe skeleton)', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--signals', '/tmp/does-not-exist-12345.json']);
  assert.strictEqual(exitCode, 0);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.signals.trust, 100);
  assert.strictEqual(output.signals.failureScore, 0);
  assert.strictEqual(output.suggestions[0].id, 'proceed-with-next-batch');
});

// ── Report ───────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  suggest-next-tasks-from-meta-signals.test.js`);
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
