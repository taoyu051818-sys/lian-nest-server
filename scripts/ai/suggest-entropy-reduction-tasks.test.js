#!/usr/bin/env node

/**
 * suggest-entropy-reduction-tasks.test.js
 *
 * Focused self-tests for suggest-entropy-reduction-tasks.js.
 * Covers: suggestion generation from entropy signals, confidence/priority
 * scaling, safe skeleton behavior, output structure, and subprocess integration.
 *
 * Runs without any test framework — uses Node assert and direct function calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Pure function mirrors (copied from suggest-entropy-reduction-tasks.js)

const SCHEMA_VERSION = 1;

const THRESHOLDS = {
  mainRed: 30,
  prHandoff: 25,
  workerFriction: 30,
  mergeConflict: 20,
};

const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function suggestFromMainRed(entropy) {
  if (entropy.mainRed <= THRESHOLDS.mainRed) return [];
  const confidence = clamp(Math.round(40 + (entropy.mainRed / 100) * 55), 40, 95);
  const priority = entropy.mainRed >= 70 ? 'critical' : entropy.mainRed >= 50 ? 'high' : 'medium';
  return [{
    id: 'health-gate-stabilize',
    category: 'mainRed',
    title: 'Stabilize main branch health gate',
    reason: `mainRed entropy is ${entropy.mainRed} (threshold ${THRESHOLDS.mainRed}). Frequent red-state episodes indicate systemic health issues.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'foundation-fix',
    allowedFiles: [
      'scripts/ai/write-main-health-state.ps1',
      'scripts/post-merge-health-gate.js',
      '.github/ai-state/main-health.json',
    ],
    evidence: {
      mainRed: entropy.mainRed,
      threshold: THRESHOLDS.mainRed,
      signal: 'main-branch-health',
    },
    actionHint: 'Run health gate, diagnose root cause of red-state, and dispatch a foundation-fix worker to repair.',
  }];
}

function suggestFromPrHandoff(entropy) {
  if (entropy.prHandoff <= THRESHOLDS.prHandoff) return [];
  const confidence = clamp(Math.round(35 + (entropy.prHandoff / 100) * 55), 35, 90);
  const priority = entropy.prHandoff >= 60 ? 'high' : entropy.prHandoff >= 40 ? 'medium' : 'low';
  return [{
    id: 'handoff-guard-check',
    category: 'prHandoff',
    title: 'Add handoff guard checks for stalled PRs',
    reason: `prHandoff entropy is ${entropy.prHandoff} (threshold ${THRESHOLDS.prHandoff}). Stalled or failed handoffs block downstream work.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'docs/ai-native/pr-handoff-template.md',
      'docs/ai-native/command-steward-handoff-examples.md',
      'scripts/ai/state-reconciler.ps1',
    ],
    evidence: {
      prHandoff: entropy.prHandoff,
      threshold: THRESHOLDS.prHandoff,
      signal: 'pr-handoff-stall',
    },
    actionHint: 'Review stalled PR handoffs, update handoff template if needed, and run state reconciler to clear drift.',
  }];
}

function suggestFromWorkerFriction(entropy) {
  if (entropy.workerFriction <= THRESHOLDS.workerFriction) return [];
  const confidence = clamp(Math.round(30 + (entropy.workerFriction / 100) * 60), 30, 90);
  const priority = entropy.workerFriction >= 60 ? 'high' : entropy.workerFriction >= 40 ? 'medium' : 'low';
  return [{
    id: 'worker-friction-reduce',
    category: 'workerFriction',
    title: 'Reduce worker friction from stale or silent workers',
    reason: `workerFriction entropy is ${entropy.workerFriction} (threshold ${THRESHOLDS.workerFriction}). Stale workers consume resources without progress.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'foundation-fix',
    allowedFiles: [
      'scripts/ai/worktree-janitor.ps1',
      '.github/ai-state/active-workers.json',
      '.claude/worktrees/',
    ],
    evidence: {
      workerFriction: entropy.workerFriction,
      threshold: THRESHOLDS.workerFriction,
      signal: 'worker-stale-or-silent',
    },
    actionHint: 'Run worktree janitor in dry-run mode, review stale workers, and terminate or restart unresponsive tasks.',
  }];
}

function suggestFromMergeConflict(entropy) {
  if (entropy.mergeConflict <= THRESHOLDS.mergeConflict) return [];
  const confidence = clamp(Math.round(25 + (entropy.mergeConflict / 100) * 55), 25, 80);
  const priority = entropy.mergeConflict >= 50 ? 'high' : entropy.mergeConflict >= 30 ? 'medium' : 'low';
  return [{
    id: 'merge-queue-stabilize',
    category: 'mergeConflict',
    title: 'Stabilize merge queue and reduce conflict rate',
    reason: `mergeConflict entropy is ${entropy.mergeConflict} (threshold ${THRESHOLDS.mergeConflict}). Queue failures or conflicts block batch progress.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      '.ai/merge-queue.json',
      '.ai/merge-queue-state.json',
      'scripts/ai/merge-clean-pr-batch.ps1',
    ],
    evidence: {
      mergeConflict: entropy.mergeConflict,
      threshold: THRESHOLDS.mergeConflict,
      signal: 'merge-queue-failure',
    },
    actionHint: 'Review merge queue state, resolve conflicts, and consider rebasing stalled PRs before re-queuing.',
  }];
}

function suggestAllHealthy(entropy) {
  if (
    entropy.mainRed > THRESHOLDS.mainRed ||
    entropy.prHandoff > THRESHOLDS.prHandoff ||
    entropy.workerFriction > THRESHOLDS.workerFriction ||
    entropy.mergeConflict > THRESHOLDS.mergeConflict
  ) {
    return [];
  }
  return [{
    id: 'entropy-low-no-action',
    category: 'health',
    title: 'Entropy is low — no reduction tasks needed',
    reason: `All entropy dimensions are within safe bounds (mainRed=${entropy.mainRed}, prHandoff=${entropy.prHandoff}, workerFriction=${entropy.workerFriction}, mergeConflict=${entropy.mergeConflict}).`,
    confidence: 85,
    priority: 'info',
    risk: 'none',
    workerClass: null,
    allowedFiles: [],
    evidence: {
      mainRed: entropy.mainRed,
      prHandoff: entropy.prHandoff,
      workerFriction: entropy.workerFriction,
      mergeConflict: entropy.mergeConflict,
    },
    actionHint: 'System entropy is low. Safe to proceed with normal operations.',
  }];
}

function generateSuggestions(entropy) {
  const raw = [
    ...suggestFromMainRed(entropy),
    ...suggestFromPrHandoff(entropy),
    ...suggestFromWorkerFriction(entropy),
    ...suggestFromMergeConflict(entropy),
    ...suggestAllHealthy(entropy),
  ];
  raw.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });
  return raw;
}

function buildOutput(entropy, suggestions) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    entropy: {
      mainRed: entropy.mainRed,
      prHandoff: entropy.prHandoff,
      workerFriction: entropy.workerFriction,
      mergeConflict: entropy.mergeConflict,
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

// ── Healthy (zeroed) entropy ─────────────────────────────────────────────

const HEALTHY_ENTROPY = {
  mainRed: 0,
  prHandoff: 0,
  workerFriction: 0,
  mergeConflict: 0,
};

test('healthy entropy: produces only no-action suggestion', () => {
  const suggestions = generateSuggestions(HEALTHY_ENTROPY);
  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].id, 'entropy-low-no-action');
  assert.strictEqual(suggestions[0].priority, 'info');
  assert.strictEqual(suggestions[0].confidence, 85);
});

test('healthy entropy: no-action suggestion has correct evidence', () => {
  const suggestions = generateSuggestions(HEALTHY_ENTROPY);
  assert.deepStrictEqual(suggestions[0].evidence, {
    mainRed: 0,
    prHandoff: 0,
    workerFriction: 0,
    mergeConflict: 0,
  });
});

// ── mainRed suggestions ──────────────────────────────────────────────────

test('mainRed: triggers above threshold', () => {
  const entropy = { ...HEALTHY_ENTROPY, mainRed: 31 };
  const suggestions = generateSuggestions(entropy);
  const red = suggestions.find(s => s.id === 'health-gate-stabilize');
  assert.ok(red, 'should have health-gate-stabilize suggestion');
  assert.strictEqual(red.category, 'mainRed');
  assert.strictEqual(red.priority, 'medium');
  assert.strictEqual(red.risk, 'low');
  assert.strictEqual(red.workerClass, 'foundation-fix');
});

test('mainRed: does not trigger at threshold (30)', () => {
  const entropy = { ...HEALTHY_ENTROPY, mainRed: 30 };
  const suggestions = generateSuggestions(entropy);
  const red = suggestions.find(s => s.id === 'health-gate-stabilize');
  assert.strictEqual(red, undefined);
});

test('mainRed: high priority for score 50-69', () => {
  const entropy = { ...HEALTHY_ENTROPY, mainRed: 55 };
  const suggestions = generateSuggestions(entropy);
  const red = suggestions.find(s => s.category === 'mainRed');
  assert.strictEqual(red.priority, 'high');
});

test('mainRed: critical priority for score >= 70', () => {
  const entropy = { ...HEALTHY_ENTROPY, mainRed: 80 };
  const suggestions = generateSuggestions(entropy);
  const red = suggestions.find(s => s.category === 'mainRed');
  assert.strictEqual(red.priority, 'critical');
});

test('mainRed: confidence scales with score', () => {
  const low = { ...HEALTHY_ENTROPY, mainRed: 31 };
  const high = { ...HEALTHY_ENTROPY, mainRed: 100 };
  const lowConf = generateSuggestions(low).find(s => s.category === 'mainRed').confidence;
  const highConf = generateSuggestions(high).find(s => s.category === 'mainRed').confidence;
  assert.ok(highConf > lowConf, `high confidence (${highConf}) should exceed low (${lowConf})`);
});

test('mainRed: has allowedFiles and evidence', () => {
  const entropy = { ...HEALTHY_ENTROPY, mainRed: 50 };
  const suggestions = generateSuggestions(entropy);
  const red = suggestions.find(s => s.category === 'mainRed');
  assert.ok(Array.isArray(red.allowedFiles), 'allowedFiles should be an array');
  assert.ok(red.allowedFiles.length > 0, 'allowedFiles should not be empty');
  assert.ok(red.evidence, 'evidence should exist');
  assert.strictEqual(red.evidence.mainRed, 50);
  assert.strictEqual(red.evidence.signal, 'main-branch-health');
});

// ── prHandoff suggestions ────────────────────────────────────────────────

test('prHandoff: triggers above threshold', () => {
  const entropy = { ...HEALTHY_ENTROPY, prHandoff: 26 };
  const suggestions = generateSuggestions(entropy);
  const handoff = suggestions.find(s => s.id === 'handoff-guard-check');
  assert.ok(handoff, 'should have handoff-guard-check suggestion');
  assert.strictEqual(handoff.category, 'prHandoff');
  assert.strictEqual(handoff.workerClass, 'docs');
});

test('prHandoff: does not trigger at threshold (25)', () => {
  const entropy = { ...HEALTHY_ENTROPY, prHandoff: 25 };
  const suggestions = generateSuggestions(entropy);
  const handoff = suggestions.find(s => s.id === 'handoff-guard-check');
  assert.strictEqual(handoff, undefined);
});

test('prHandoff: medium priority for score 40-59', () => {
  const entropy = { ...HEALTHY_ENTROPY, prHandoff: 45 };
  const suggestions = generateSuggestions(entropy);
  const handoff = suggestions.find(s => s.category === 'prHandoff');
  assert.strictEqual(handoff.priority, 'medium');
});

test('prHandoff: high priority for score >= 60', () => {
  const entropy = { ...HEALTHY_ENTROPY, prHandoff: 70 };
  const suggestions = generateSuggestions(entropy);
  const handoff = suggestions.find(s => s.category === 'prHandoff');
  assert.strictEqual(handoff.priority, 'high');
});

test('prHandoff: has allowedFiles and evidence', () => {
  const entropy = { ...HEALTHY_ENTROPY, prHandoff: 40 };
  const suggestions = generateSuggestions(entropy);
  const handoff = suggestions.find(s => s.category === 'prHandoff');
  assert.ok(Array.isArray(handoff.allowedFiles), 'allowedFiles should be an array');
  assert.ok(handoff.allowedFiles.length > 0, 'allowedFiles should not be empty');
  assert.ok(handoff.evidence, 'evidence should exist');
  assert.strictEqual(handoff.evidence.signal, 'pr-handoff-stall');
});

// ── workerFriction suggestions ───────────────────────────────────────────

test('workerFriction: triggers above threshold', () => {
  const entropy = { ...HEALTHY_ENTROPY, workerFriction: 31 };
  const suggestions = generateSuggestions(entropy);
  const friction = suggestions.find(s => s.id === 'worker-friction-reduce');
  assert.ok(friction, 'should have worker-friction-reduce suggestion');
  assert.strictEqual(friction.category, 'workerFriction');
  assert.strictEqual(friction.workerClass, 'foundation-fix');
});

test('workerFriction: does not trigger at threshold (30)', () => {
  const entropy = { ...HEALTHY_ENTROPY, workerFriction: 30 };
  const suggestions = generateSuggestions(entropy);
  const friction = suggestions.find(s => s.id === 'worker-friction-reduce');
  assert.strictEqual(friction, undefined);
});

test('workerFriction: high priority for score >= 60', () => {
  const entropy = { ...HEALTHY_ENTROPY, workerFriction: 65 };
  const suggestions = generateSuggestions(entropy);
  const friction = suggestions.find(s => s.category === 'workerFriction');
  assert.strictEqual(friction.priority, 'high');
});

// ── mergeConflict suggestions ────────────────────────────────────────────

test('mergeConflict: triggers above threshold', () => {
  const entropy = { ...HEALTHY_ENTROPY, mergeConflict: 21 };
  const suggestions = generateSuggestions(entropy);
  const merge = suggestions.find(s => s.id === 'merge-queue-stabilize');
  assert.ok(merge, 'should have merge-queue-stabilize suggestion');
  assert.strictEqual(merge.category, 'mergeConflict');
  assert.strictEqual(merge.workerClass, 'docs');
});

test('mergeConflict: does not trigger at threshold (20)', () => {
  const entropy = { ...HEALTHY_ENTROPY, mergeConflict: 20 };
  const suggestions = generateSuggestions(entropy);
  const merge = suggestions.find(s => s.id === 'merge-queue-stabilize');
  assert.strictEqual(merge, undefined);
});

test('mergeConflict: medium priority for score 30-49', () => {
  const entropy = { ...HEALTHY_ENTROPY, mergeConflict: 35 };
  const suggestions = generateSuggestions(entropy);
  const merge = suggestions.find(s => s.category === 'mergeConflict');
  assert.strictEqual(merge.priority, 'medium');
});

test('mergeConflict: high priority for score >= 50', () => {
  const entropy = { ...HEALTHY_ENTROPY, mergeConflict: 55 };
  const suggestions = generateSuggestions(entropy);
  const merge = suggestions.find(s => s.category === 'mergeConflict');
  assert.strictEqual(merge.priority, 'high');
});

// ── Sort order ───────────────────────────────────────────────────────────

test('sort: critical suggestions come before high', () => {
  const entropy = { mainRed: 80, prHandoff: 65, workerFriction: 50, mergeConflict: 40 };
  const suggestions = generateSuggestions(entropy);
  const criticalIdx = suggestions.findIndex(s => s.priority === 'critical');
  const highIdx = suggestions.findIndex(s => s.priority === 'high');
  if (highIdx !== -1) {
    assert.ok(criticalIdx < highIdx, 'critical should come before high');
  }
});

test('sort: within same priority, higher confidence comes first', () => {
  const entropy = { mainRed: 50, prHandoff: 65, workerFriction: 0, mergeConflict: 0 };
  const suggestions = generateSuggestions(entropy);
  const highPriority = suggestions.filter(s => s.priority === 'high');
  if (highPriority.length > 1) {
    for (let i = 0; i < highPriority.length - 1; i++) {
      assert.ok(
        highPriority[i].confidence >= highPriority[i + 1].confidence,
        'confidence should be descending within same priority'
      );
    }
  }
});

// ── No-action suppression ────────────────────────────────────────────────

test('no-action: suppressed when any entropy is elevated', () => {
  const entropy = { ...HEALTHY_ENTROPY, mainRed: 31 };
  const suggestions = generateSuggestions(entropy);
  const noAction = suggestions.find(s => s.id === 'entropy-low-no-action');
  assert.strictEqual(noAction, undefined, 'no-action should be suppressed when mainRed is elevated');
});

test('no-action: suppressed when prHandoff is elevated', () => {
  const entropy = { ...HEALTHY_ENTROPY, prHandoff: 26 };
  const suggestions = generateSuggestions(entropy);
  const noAction = suggestions.find(s => s.id === 'entropy-low-no-action');
  assert.strictEqual(noAction, undefined);
});

// ── buildOutput structure ────────────────────────────────────────────────

test('buildOutput: has correct schema version and mode', () => {
  const output = buildOutput(HEALTHY_ENTROPY, []);
  assert.strictEqual(output.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.suggestionCount, 0);
});

test('buildOutput: entropy echoes input values', () => {
  const entropy = { mainRed: 42, prHandoff: 10, workerFriction: 20, mergeConflict: 5 };
  const output = buildOutput(entropy, []);
  assert.deepStrictEqual(output.entropy, entropy);
});

test('buildOutput: suggestionCount matches suggestions array length', () => {
  const suggestions = generateSuggestions({ ...HEALTHY_ENTROPY, mainRed: 50 });
  const output = buildOutput({ ...HEALTHY_ENTROPY, mainRed: 50 }, suggestions);
  assert.strictEqual(output.suggestionCount, suggestions.length);
});

// ── Multiple triggers ────────────────────────────────────────────────────

test('multiple: generates multiple suggestions when several dimensions fire', () => {
  const entropy = {
    mainRed: 50,
    prHandoff: 40,
    workerFriction: 45,
    mergeConflict: 35,
  };
  const suggestions = generateSuggestions(entropy);
  assert.ok(suggestions.length >= 4, `expected at least 4 suggestions, got ${suggestions.length}`);
  const noAction = suggestions.find(s => s.id === 'entropy-low-no-action');
  assert.strictEqual(noAction, undefined, 'no-action should not appear with elevated entropy');
});

// ── Suggestion structure ─────────────────────────────────────────────────

test('structure: every suggestion has required fields', () => {
  const entropy = {
    mainRed: 50,
    prHandoff: 40,
    workerFriction: 45,
    mergeConflict: 35,
  };
  const suggestions = generateSuggestions(entropy);
  for (const s of suggestions) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0, `id missing on ${JSON.stringify(s)}`);
    assert.ok(typeof s.category === 'string' && s.category.length > 0, `category missing on ${s.id}`);
    assert.ok(typeof s.title === 'string' && s.title.length > 0, `title missing on ${s.id}`);
    assert.ok(typeof s.reason === 'string' && s.reason.length > 0, `reason missing on ${s.id}`);
    assert.ok(typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 100, `confidence invalid on ${s.id}`);
    assert.ok(typeof s.priority === 'string', `priority missing on ${s.id}`);
    assert.ok(typeof s.risk === 'string', `risk missing on ${s.id}`);
    assert.ok(typeof s.actionHint === 'string' && s.actionHint.length > 0, `actionHint missing on ${s.id}`);
    assert.ok(s.evidence && typeof s.evidence === 'object', `evidence missing on ${s.id}`);
  }
});

test('structure: every non-info suggestion has workerClass and allowedFiles', () => {
  const entropy = {
    mainRed: 50,
    prHandoff: 40,
    workerFriction: 45,
    mergeConflict: 35,
  };
  const suggestions = generateSuggestions(entropy);
  for (const s of suggestions) {
    if (s.priority !== 'info') {
      assert.ok(typeof s.workerClass === 'string' && s.workerClass.length > 0, `workerClass missing on ${s.id}`);
      assert.ok(Array.isArray(s.allowedFiles), `allowedFiles should be array on ${s.id}`);
    }
  }
});

// ── Integration: subprocess ──────────────────────────────────────────────

function runSubprocess(args) {
  const { execSync } = require('child_process');
  const script = path.resolve(__dirname, 'suggest-entropy-reduction-tasks.js');
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

test('integration: --stdout with no entropy file produces healthy default', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--entropy', '/nonexistent/path.json']);
  assert.strictEqual(exitCode, 0);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.schemaVersion, 1);
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.suggestionCount, 1);
  assert.strictEqual(output.suggestions[0].id, 'entropy-low-no-action');
  assert.strictEqual(output.entropy.mainRed, 0);
});

test('integration: --stdout with entropy file produces correct suggestions', () => {
  const entropyPath = path.join(os.tmpdir(), `entropy-test-${Date.now()}.json`);
  const snapshot = {
    schemaVersion: 1,
    calculatedAt: new Date().toISOString(),
    entropy: {
      mainRed: 50,
      prHandoff: 40,
      workerFriction: 45,
      mergeConflict: 35,
    },
  };
  fs.writeFileSync(entropyPath, JSON.stringify(snapshot, null, 2), 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--entropy', entropyPath]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.mode, 'dry-run');
    assert.ok(output.suggestionCount >= 4, `expected >= 4 suggestions, got ${output.suggestionCount}`);
    assert.strictEqual(output.entropy.mainRed, 50);

    const ids = output.suggestions.map(s => s.id);
    assert.ok(ids.includes('health-gate-stabilize'), 'should include mainRed suggestion');
    assert.ok(ids.includes('handoff-guard-check'), 'should include prHandoff suggestion');
    assert.ok(ids.includes('worker-friction-reduce'), 'should include workerFriction suggestion');
    assert.ok(ids.includes('merge-queue-stabilize'), 'should include mergeConflict suggestion');
    assert.ok(!ids.includes('entropy-low-no-action'), 'should NOT include no-action suggestion');
  } finally {
    fs.unlinkSync(entropyPath);
  }
});

test('integration: --stdout with healthy entropy shows only no-action', () => {
  const entropyPath = path.join(os.tmpdir(), `entropy-healthy-${Date.now()}.json`);
  const snapshot = {
    schemaVersion: 1,
    calculatedAt: new Date().toISOString(),
    entropy: {
      mainRed: 0,
      prHandoff: 0,
      workerFriction: 0,
      mergeConflict: 0,
    },
  };
  fs.writeFileSync(entropyPath, JSON.stringify(snapshot, null, 2), 'utf8');

  try {
    const { stdout, exitCode } = runSubprocess(['--stdout', '--entropy', entropyPath]);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.suggestionCount, 1);
    assert.strictEqual(output.suggestions[0].id, 'entropy-low-no-action');
  } finally {
    fs.unlinkSync(entropyPath);
  }
});

test('integration: --out writes file and prints relative path', () => {
  const tmpOut = path.join(os.tmpdir(), `entropy-out-${Date.now()}.json`);
  try {
    const { stdout, exitCode } = runSubprocess(['--out', tmpOut]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Entropy reduction tasks written to'));
    const written = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
    assert.strictEqual(written.mode, 'dry-run');
    assert.ok(written.suggestionCount >= 1);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
});

test('integration: missing entropy file produces no-action (safe skeleton)', () => {
  const { stdout, exitCode } = runSubprocess(['--stdout', '--entropy', '/tmp/does-not-exist-entropy-12345.json']);
  assert.strictEqual(exitCode, 0);
  const output = JSON.parse(stdout);
  assert.strictEqual(output.entropy.mainRed, 0);
  assert.strictEqual(output.suggestions[0].id, 'entropy-low-no-action');
});

// ── Report ───────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  suggest-entropy-reduction-tasks.test.js`);
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
