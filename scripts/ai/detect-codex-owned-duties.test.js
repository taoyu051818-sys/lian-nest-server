#!/usr/bin/env node

/**
 * detect-codex-owned-duties.test.js
 *
 * Tests for detect-codex-owned-duties.js.
 * Covers: merge-pending, launch-pending, issue-close-pending,
 * ai-state duties, output shape, fixture mode, self-test, CLI.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'detect-codex-owned-duties.js');

// Import module functions directly
const {
  isMergePending,
  hasExcludeLabel,
  hasExcludeTitlePattern,
  hasOpenPR,
  findMergedClosingPR,
  detectMergePending,
  detectLaunchPending,
  detectIssueClosePending,
  detectHealthGateManual,
  detectRecoveryDispatchManual,
  buildOutput,
  DUTY_TYPES,
  SCHEMA_VERSION,
} = require(SCRIPT);

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

function tmpFile(name) {
  return path.join(os.tmpdir(), `detect-codex-duties-${name}-${Date.now()}.json`);
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePR(overrides) {
  return {
    number: 100,
    title: 'feat: add feature',
    body: 'Closes #50',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'feat/add',
    baseRefName: 'main',
    ...overrides,
  };
}

function makeIssue(overrides) {
  return {
    number: 200,
    title: 'Add feature',
    body: '',
    state: 'open',
    labels: [],
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── isMergePending tests ─────────────────────────────────────────────────────

test('isMergePending: MERGEABLE PR with closing ref', () => {
  assert.ok(isMergePending(makePR()));
});

test('isMergePending: draft PR excluded', () => {
  assert.ok(!isMergePending(makePR({ isDraft: true })));
});

test('isMergePending: UNKNOWN merge state excluded', () => {
  assert.ok(!isMergePending(makePR({ mergeable: 'UNKNOWN' })));
});

test('isMergePending: DIRTY merge state excluded', () => {
  assert.ok(!isMergePending(makePR({ mergeable: 'DIRTY' })));
});

test('isMergePending: no closing ref excluded', () => {
  assert.ok(!isMergePending(makePR({ body: 'no references' })));
});

test('isMergePending: CLOSED state excluded', () => {
  assert.ok(!isMergePending(makePR({ state: 'CLOSED' })));
});

test('isMergePending: MERGED state excluded', () => {
  assert.ok(!isMergePending(makePR({ state: 'MERGED' })));
});

test('isMergePending: fixes keyword works', () => {
  assert.ok(isMergePending(makePR({ body: 'Fixes #50' })));
});

test('isMergePending: resolves keyword works', () => {
  assert.ok(isMergePending(makePR({ body: 'Resolves #50' })));
});

test('isMergePending: case insensitive', () => {
  assert.ok(isMergePending(makePR({ body: 'CLOSES #50' })));
});

// ── hasExcludeLabel tests ────────────────────────────────────────────────────

test('hasExcludeLabel: discussion excluded', () => {
  assert.ok(hasExcludeLabel(makeIssue({ labels: [{ name: 'discussion' }] })));
});

test('hasExcludeLabel: human-required excluded', () => {
  assert.ok(hasExcludeLabel(makeIssue({ labels: [{ name: 'human-required' }] })));
});

test('hasExcludeLabel: umbrella excluded', () => {
  assert.ok(hasExcludeLabel(makeIssue({ labels: [{ name: 'umbrella' }] })));
});

test('hasExcludeLabel: agent:done excluded', () => {
  assert.ok(hasExcludeLabel(makeIssue({ labels: [{ name: 'agent:done' }] })));
});

test('hasExcludeLabel: agent:running excluded', () => {
  assert.ok(hasExcludeLabel(makeIssue({ labels: [{ name: 'agent:running' }] })));
});

test('hasExcludeLabel: agent:ready not excluded', () => {
  assert.ok(!hasExcludeLabel(makeIssue({ labels: [{ name: 'agent:ready' }] })));
});

test('hasExcludeLabel: string labels work', () => {
  assert.ok(hasExcludeLabel(makeIssue({ labels: ['discussion'] })));
});

test('hasExcludeLabel: empty labels', () => {
  assert.ok(!hasExcludeLabel(makeIssue({ labels: [] })));
});

test('hasExcludeLabel: null labels', () => {
  assert.ok(!hasExcludeLabel(makeIssue({ labels: null })));
});

// ── hasExcludeTitlePattern tests ─────────────────────────────────────────────

test('hasExcludeTitlePattern: umbrella', () => {
  assert.ok(hasExcludeTitlePattern('Umbrella: refactor auth'));
});

test('hasExcludeTitlePattern: discussion', () => {
  assert.ok(hasExcludeTitlePattern('Discussion: API design'));
});

test('hasExcludeTitlePattern: meta', () => {
  assert.ok(hasExcludeTitlePattern('Meta: tracking sprint'));
});

test('hasExcludeTitlePattern: RFC', () => {
  assert.ok(hasExcludeTitlePattern('RFC: caching strategy'));
});

test('hasExcludeTitlePattern: proposal', () => {
  assert.ok(hasExcludeTitlePattern('Proposal: add GraphQL'));
});

test('hasExcludeTitlePattern: normal title passes', () => {
  assert.ok(!hasExcludeTitlePattern('Add user profile endpoint'));
});

// ── hasOpenPR tests ──────────────────────────────────────────────────────────

test('hasOpenPR: matching PR body', () => {
  const issue = makeIssue({ number: 200 });
  const prs = [makePR({ body: 'Closes #200' })];
  assert.ok(hasOpenPR(issue, prs));
});

test('hasOpenPR: matching PR title', () => {
  const issue = makeIssue({ number: 201 });
  const prs = [makePR({ title: 'Fixes #201', body: '' })];
  assert.ok(hasOpenPR(issue, prs));
});

test('hasOpenPR: no match', () => {
  const issue = makeIssue({ number: 300 });
  const prs = [makePR({ body: 'Closes #999' })];
  assert.ok(!hasOpenPR(issue, prs));
});

test('hasOpenPR: empty PR list', () => {
  assert.ok(!hasOpenPR(makeIssue(), []));
});

// ── findMergedClosingPR tests ────────────────────────────────────────────────

test('findMergedClosingPR: finds matching PR', () => {
  const issue = makeIssue({ number: 200 });
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Closes #200', mergedAt: '2026-01-01' }];
  const result = findMergedClosingPR(issue, mergedPRs);
  assert.ok(result !== null);
  assert.strictEqual(result.number, 50);
});

test('findMergedClosingPR: no match', () => {
  const issue = makeIssue({ number: 300 });
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Closes #999', mergedAt: '2026-01-01' }];
  assert.strictEqual(findMergedClosingPR(issue, mergedPRs), null);
});

test('findMergedClosingPR: negation pattern', () => {
  const issue = makeIssue({ number: 200 });
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Does not close #200', mergedAt: '2026-01-01' }];
  assert.strictEqual(findMergedClosingPR(issue, mergedPRs), null);
});

test('findMergedClosingPR: empty list', () => {
  assert.strictEqual(findMergedClosingPR(makeIssue(), []), null);
});

// ── detectMergePending tests ─────────────────────────────────────────────────

test('detectMergePending: filters to mergeable only', () => {
  const prs = [
    makePR({ number: 100 }),
    makePR({ number: 101, isDraft: true }),
    makePR({ number: 102, mergeable: 'UNKNOWN' }),
    makePR({ number: 103, body: 'no refs' }),
  ];
  const result = detectMergePending(prs);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].number, 100);
});

test('detectMergePending: empty list', () => {
  assert.deepStrictEqual(detectMergePending([]), []);
});

test('detectMergePending: result shape', () => {
  const result = detectMergePending([makePR()]);
  assert.strictEqual(typeof result[0].number, 'number');
  assert.strictEqual(typeof result[0].title, 'string');
  assert.strictEqual(typeof result[0].headRefName, 'string');
  assert.strictEqual(typeof result[0].mergeable, 'string');
});

// ── detectLaunchPending tests ────────────────────────────────────────────────

test('detectLaunchPending: excludes discussion issues', () => {
  const issues = [
    makeIssue({ number: 10, labels: [{ name: 'discussion' }] }),
    makeIssue({ number: 20, labels: [{ name: 'agent:ready' }] }),
  ];
  const result = detectLaunchPending(issues, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].number, 20);
});

test('detectLaunchPending: excludes issues with open PRs', () => {
  const issues = [
    makeIssue({ number: 200 }),
    makeIssue({ number: 300 }),
  ];
  const prs = [makePR({ body: 'Closes #200' })];
  const result = detectLaunchPending(issues, prs);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].number, 300);
});

test('detectLaunchPending: excludes umbrella title', () => {
  const issues = [
    makeIssue({ number: 100, title: 'Umbrella: refactor all' }),
    makeIssue({ number: 200, title: 'Normal task' }),
  ];
  const result = detectLaunchPending(issues, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].number, 200);
});

test('detectLaunchPending: result shape', () => {
  const result = detectLaunchPending([makeIssue()], []);
  assert.strictEqual(typeof result[0].number, 'number');
  assert.strictEqual(typeof result[0].title, 'string');
  assert.ok(Array.isArray(result[0].labels));
  assert.strictEqual(result[0].updatedAt, '2026-01-01T00:00:00Z');
});

test('detectLaunchPending: empty list', () => {
  assert.deepStrictEqual(detectLaunchPending([], []), []);
});

// ── detectIssueClosePending tests ────────────────────────────────────────────

test('detectIssueClosePending: finds issues with merged PRs', () => {
  const issues = [
    makeIssue({ number: 200, state: 'open' }),
    makeIssue({ number: 300, state: 'open' }),
  ];
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Closes #200', mergedAt: '2026-01-01' }];
  const result = detectIssueClosePending(issues, mergedPRs);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].issueNumber, 200);
  assert.strictEqual(result[0].mergedPR.number, 50);
});

test('detectIssueClosePending: skips closed issues', () => {
  const issues = [makeIssue({ number: 200, state: 'closed' })];
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Closes #200', mergedAt: '2026-01-01' }];
  const result = detectIssueClosePending(issues, mergedPRs);
  assert.strictEqual(result.length, 0);
});

test('detectIssueClosePending: no merged PR', () => {
  const issues = [makeIssue({ number: 200, state: 'open' })];
  const result = detectIssueClosePending(issues, []);
  assert.strictEqual(result.length, 0);
});

test('detectIssueClosePending: result shape', () => {
  const issues = [makeIssue({ number: 200, state: 'open' })];
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Closes #200', mergedAt: '2026-01-01' }];
  const result = detectIssueClosePending(issues, mergedPRs);
  assert.strictEqual(typeof result[0].issueNumber, 'number');
  assert.strictEqual(typeof result[0].title, 'string');
  assert.strictEqual(typeof result[0].mergedPR.number, 'number');
  assert.strictEqual(typeof result[0].mergedPR.title, 'string');
  assert.strictEqual(result[0].mergedPR.mergedAt, '2026-01-01');
});

// ── detectHealthGateManual tests ─────────────────────────────────────────────

test('detectHealthGateManual: returns object with wired=false', () => {
  const result = detectHealthGateManual();
  assert.strictEqual(result.wired, false);
  assert.strictEqual(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('detectHealthGateManual: has lastHealthState and lastCapturedAt fields', () => {
  const result = detectHealthGateManual();
  assert.ok('lastHealthState' in result);
  assert.ok('lastCapturedAt' in result);
});

// ── detectRecoveryDispatchManual tests ───────────────────────────────────────

test('detectRecoveryDispatchManual: returns object with wired=false', () => {
  const result = detectRecoveryDispatchManual();
  assert.strictEqual(result.wired, false);
  assert.strictEqual(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('detectRecoveryDispatchManual: has recoveryWorkerDefined field', () => {
  const result = detectRecoveryDispatchManual();
  assert.ok('recoveryWorkerDefined' in result);
});

// ── buildOutput tests ────────────────────────────────────────────────────────

test('buildOutput: correct schema version', () => {
  const output = buildOutput([], [], []);
  assert.strictEqual(output.schemaVersion, SCHEMA_VERSION);
});

test('buildOutput: capturedAt is ISO string', () => {
  const output = buildOutput([], [], []);
  assert.ok(new Date(output.capturedAt).toISOString() === output.capturedAt);
});

test('buildOutput: summary has totalDuties and byType', () => {
  const output = buildOutput([], [], []);
  assert.strictEqual(typeof output.summary.totalDuties, 'number');
  assert.strictEqual(typeof output.summary.byType, 'object');
});

test('buildOutput: byType has all duty types', () => {
  const output = buildOutput([], [], []);
  for (const dt of DUTY_TYPES) {
    assert.ok(dt in output.summary.byType, `byType missing ${dt}`);
  }
});

test('buildOutput: duties is array', () => {
  const output = buildOutput([], [], []);
  assert.ok(Array.isArray(output.duties));
});

test('buildOutput: always includes ai-state duties', () => {
  const output = buildOutput([], [], []);
  const types = output.duties.map(d => d.type);
  assert.ok(types.includes('health-gate-manual'), 'has health-gate-manual');
  assert.ok(types.includes('recovery-dispatch-manual'), 'has recovery-dispatch-manual');
});

test('buildOutput: inputSources shape', () => {
  const output = buildOutput([], [], []);
  assert.strictEqual(typeof output.inputSources.issuesLoaded, 'boolean');
  assert.strictEqual(typeof output.inputSources.openPRsLoaded, 'boolean');
  assert.strictEqual(typeof output.inputSources.mergedPRsLoaded, 'boolean');
  assert.strictEqual(typeof output.inputSources.aiStateDirExists, 'boolean');
});

test('buildOutput: full data integration', () => {
  const issues = [
    makeIssue({ number: 300, state: 'open', labels: [{ name: 'agent:ready' }] }),
  ];
  const openPRs = [makePR({ number: 100 })];
  const mergedPRs = [{ number: 50, title: 'feat', body: 'Closes #300', mergedAt: '2026-01-01' }];
  const output = buildOutput(issues, openPRs, mergedPRs);

  assert.strictEqual(output.summary.byType['merge-pending'], 1);
  assert.strictEqual(output.summary.byType['issue-close-pending'], 1);
  assert.strictEqual(output.summary.byType['health-gate-manual'], 1);
  assert.strictEqual(output.summary.byType['recovery-dispatch-manual'], 1);
  // launch-pending: issue 300 has a merged PR (but merged PRs are checked against open issues, not open PRs)
  // issue 300 has no open PR, so it should be launch-pending
  assert.strictEqual(output.summary.byType['launch-pending'], 1);
});

test('buildOutput: sanitizes secret-shaped keys', () => {
  const issues = [makeIssue({ token: 'secret123' })];
  const output = buildOutput(issues, [], []);
  const json = JSON.stringify(output);
  assert.ok(!json.includes('secret123'), 'should not contain secret values');
});

test('buildOutput: empty inputs produce minimal duties', () => {
  const output = buildOutput([], [], []);
  // Only the two ai-state duties
  assert.strictEqual(output.summary.totalDuties, 2);
  assert.strictEqual(output.duties.length, 2);
});

// ── Self-test flag ───────────────────────────────────────────────────────────

test('cli: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── CLI help ─────────────────────────────────────────────────────────────────

test('cli: --help exits 0 with usage', () => {
  const { stdout, exitCode } = run(['--help']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('USAGE'));
  assert.ok(stdout.includes('detect-codex-owned-duties'));
});

test('cli: -h exits 0', () => {
  const { stdout, exitCode } = run(['-h']);
  assert.strictEqual(exitCode, 0);
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

test('cli: --fixture without value exits 2', () => {
  const { exitCode, stderr } = run(['--fixture']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--fixture requires a path'));
});

test('cli: --repo without value exits 2', () => {
  const { exitCode, stderr } = run(['--repo']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--repo requires a value'));
});

// ── Fixture mode tests ───────────────────────────────────────────────────────

test('fixture: reads from fixture file', () => {
  const fixturePath = tmpFile('fixture');
  const fixture = {
    issues: [
      makeIssue({ number: 10, title: 'Discussion', labels: [{ name: 'discussion' }] }),
      makeIssue({ number: 300, title: 'Ready task', labels: [{ name: 'agent:ready' }] }),
    ],
    openPRs: [makePR({ number: 100, body: 'Closes #999' })],
    mergedPRs: [],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.summary.byType['launch-pending'], 1);
    assert.strictEqual(output.inputSources.issuesLoaded, true);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

test('fixture: bad fixture exits 2', () => {
  const fixturePath = tmpFile('bad');
  fs.writeFileSync(fixturePath, JSON.stringify({ notIssues: [] }), 'utf8');
  try {
    const { exitCode, stderr } = run(['--fixture', fixturePath]);
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes('fixture must contain'));
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

test('fixture: missing fixture exits 2', () => {
  const { exitCode } = run(['--fixture', '/nonexistent/path.json']);
  assert.strictEqual(exitCode, 2);
});

// ── stdout with fixture ──────────────────────────────────────────────────────

test('fixture + stdout: prints valid JSON', () => {
  const fixturePath = tmpFile('stdout');
  const fixture = {
    issues: [makeIssue({ number: 600 })],
    openPRs: [],
    mergedPRs: [],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.schemaVersion, 1);
    assert.ok(output.summary.totalDuties >= 2);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: empty all inputs', () => {
  const output = buildOutput([], [], []);
  assert.strictEqual(output.summary.totalDuties, 2);
  assert.strictEqual(output.inputSources.issuesLoaded, false);
  assert.strictEqual(output.inputSources.openPRsLoaded, false);
  assert.strictEqual(output.inputSources.mergedPRsLoaded, false);
});

test('edge: issue with null labels', () => {
  const issue = makeIssue({ number: 500, labels: null });
  assert.ok(!hasExcludeLabel(issue));
  const result = detectLaunchPending([issue], []);
  assert.strictEqual(result.length, 1);
});

test('edge: issue with undefined body', () => {
  const issue = { number: 501, title: 'Feature', labels: [] };
  const result = detectLaunchPending([issue], []);
  assert.strictEqual(result.length, 1);
});

test('edge: PR with null body', () => {
  const pr = makePR({ body: null });
  assert.ok(!isMergePending(pr));
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  detect-codex-owned-duties.test.js`);
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
