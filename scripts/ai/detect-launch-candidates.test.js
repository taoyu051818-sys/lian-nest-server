#!/usr/bin/env node

/**
 * detect-launch-candidates.test.js
 *
 * Tests for detect-launch-candidates.js.
 * Covers: exclusion logic, workerClass/risk inference, output shape,
 * fixture mode, self-test, CLI error handling.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'detect-launch-candidates.js');

// Import module functions directly
const {
  hasExcludeLabel,
  hasExcludeTitlePattern,
  hasOpenPR,
  getExclusionReason,
  inferWorkerClass,
  inferRisk,
  detectCandidates,
  buildOutput,
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
  return path.join(os.tmpdir(), `detect-candidates-${name}-${Date.now()}.json`);
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

// ── Exclusion label tests ────────────────────────────────────────────────────

test('exclude: discussion label', () => {
  const issue = { number: 96, title: 'Roadmap', body: '', labels: [{ name: 'discussion' }] };
  assert.ok(hasExcludeLabel(issue));
  assert.strictEqual(getExclusionReason(issue, []), 'excluded-label: discussion');
});

test('exclude: human-required label', () => {
  const issue = { number: 50, title: 'Decide auth strategy', body: '', labels: [{ name: 'human-required' }] };
  assert.ok(hasExcludeLabel(issue));
  assert.strictEqual(getExclusionReason(issue, []), 'excluded-label: human-required');
});

test('exclude: umbrella label', () => {
  const issue = { number: 80, title: 'Refactor modules', body: '', labels: [{ name: 'umbrella' }] };
  assert.ok(hasExcludeLabel(issue));
});

test('exclude: agent:done label', () => {
  const issue = { number: 10, title: 'Completed task', body: '', labels: [{ name: 'agent:done' }] };
  assert.ok(hasExcludeLabel(issue));
});

test('exclude: agent:running label', () => {
  const issue = { number: 11, title: 'Running task', body: '', labels: [{ name: 'agent:running' }] };
  assert.ok(hasExcludeLabel(issue));
});

test('exclude: agent:blocked label', () => {
  const issue = { number: 12, title: 'Blocked task', body: '', labels: [{ name: 'agent:blocked' }] };
  assert.ok(hasExcludeLabel(issue));
});

test('exclude: string labels work too', () => {
  const issue = { number: 13, title: 'Task', body: '', labels: ['discussion'] };
  assert.ok(hasExcludeLabel(issue));
});

test('pass: no exclude labels', () => {
  const issue = { number: 200, title: 'Feature', body: '', labels: [{ name: 'agent:ready' }] };
  assert.ok(!hasExcludeLabel(issue));
});

test('pass: empty labels', () => {
  const issue = { number: 201, title: 'Feature', body: '', labels: [] };
  assert.ok(!hasExcludeLabel(issue));
});

// ── Exclusion title pattern tests ────────────────────────────────────────────

test('exclude: umbrella in title', () => {
  assert.ok(hasExcludeTitlePattern('Umbrella: refactor auth module'));
});

test('exclude: discussion in title', () => {
  assert.ok(hasExcludeTitlePattern('Discussion: API design'));
});

test('exclude: meta in title', () => {
  assert.ok(hasExcludeTitlePattern('Meta: tracking issue for sprint'));
});

test('exclude: RFC in title', () => {
  assert.ok(hasExcludeTitlePattern('RFC: new caching strategy'));
});

test('exclude: proposal in title', () => {
  assert.ok(hasExcludeTitlePattern('Proposal: add GraphQL'));
});

test('pass: normal title', () => {
  assert.ok(!hasExcludeTitlePattern('Add user profile endpoint'));
});

// ── Open PR exclusion tests ──────────────────────────────────────────────────

test('exclude: issue with matching PR body', () => {
  const issue = { number: 200, title: 'Feature A', body: '', labels: [] };
  const prs = [{ number: 50, title: 'feat: Feature A', body: 'Closes #200', headRefName: '' }];
  assert.ok(hasOpenPR(issue, prs));
  assert.strictEqual(getExclusionReason(issue, prs), 'has-open-pr');
});

test('exclude: issue with matching PR title', () => {
  const issue = { number: 201, title: 'Feature B', body: '', labels: [] };
  const prs = [{ number: 51, title: 'Fixes #201', body: '', headRefName: '' }];
  assert.ok(hasOpenPR(issue, prs));
});

test('exclude: case insensitive ref', () => {
  const issue = { number: 202, title: 'Feature C', body: '', labels: [] };
  const prs = [{ number: 52, title: 'feat', body: 'resolves #202', headRefName: '' }];
  assert.ok(hasOpenPR(issue, prs));
});

test('pass: no matching PR', () => {
  const issue = { number: 300, title: 'Feature D', body: '', labels: [] };
  const prs = [{ number: 53, title: 'Other', body: 'Closes #999', headRefName: '' }];
  assert.ok(!hasOpenPR(issue, prs));
});

test('pass: empty PR list', () => {
  const issue = { number: 301, title: 'Feature E', body: '', labels: [] };
  assert.ok(!hasOpenPR(issue, []));
});

// ── Worker class inference tests ─────────────────────────────────────────────

test('inferWorkerClass: docs from title', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Update README', body: '' }), 'docs');
});

test('inferWorkerClass: docs from body', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Fix', body: 'Documentation update needed' }), 'docs');
});

test('inferWorkerClass: test from title', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Add test coverage', body: '' }), 'test');
});

test('inferWorkerClass: bugfix from title', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Fix broken login', body: '' }), 'bugfix');
});

test('inferWorkerClass: refactor from title', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Cleanup auth module', body: '' }), 'refactor');
});

test('inferWorkerClass: runtime-feature from title', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Add user profiles', body: '' }), 'runtime-feature');
});

test('inferWorkerClass: default runtime-feature', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Something', body: '' }), 'runtime-feature');
});

test('inferWorkerClass: from CONTROL APPENDIX', () => {
  assert.strictEqual(inferWorkerClass({ title: 'Task', body: 'Task type: research\nCONTROL APPENDIX' }), 'research');
});

// ── Risk inference tests ─────────────────────────────────────────────────────

test('inferRisk: explicit from CONTROL APPENDIX', () => {
  assert.strictEqual(inferRisk({ title: 'Task', body: 'Risk: high\nCONTROL APPENDIX' }), 'high');
});

test('inferRisk: high from auth in body', () => {
  assert.strictEqual(inferRisk({ title: 'Update', body: 'Changes to src/modules/auth' }), 'high');
});

test('inferRisk: high from prisma in body', () => {
  assert.strictEqual(inferRisk({ title: 'Update', body: 'Schema change in prisma/' }), 'high');
});

test('inferRisk: low from scripts in body', () => {
  assert.strictEqual(inferRisk({ title: 'Task', body: 'New script in scripts/ai' }), 'low');
});

test('inferRisk: low from docs', () => {
  assert.strictEqual(inferRisk({ title: 'Task', body: 'Update docs/ai-native/' }), 'low');
});

test('inferRisk: default medium', () => {
  assert.strictEqual(inferRisk({ title: 'Something', body: 'General work' }), 'medium');
});

// ── detectCandidates tests ───────────────────────────────────────────────────

test('detectCandidates: filters discussion issues', () => {
  const issues = [
    { number: 96, title: 'Roadmap discussion', body: '', labels: [{ name: 'discussion' }] },
    { number: 200, title: 'Add feature', body: '', labels: [{ name: 'agent:ready' }] },
  ];
  const result = detectCandidates(issues, []);
  assert.strictEqual(result.candidates.length, 1);
  assert.strictEqual(result.candidates[0].number, 200);
  assert.strictEqual(result.excluded.length, 1);
  assert.strictEqual(result.excluded[0].number, 96);
});

test('detectCandidates: filters umbrella title', () => {
  const issues = [
    { number: 100, title: 'Umbrella: refactor all', body: '', labels: [] },
    { number: 200, title: 'Add feature', body: '', labels: [] },
  ];
  const result = detectCandidates(issues, []);
  assert.strictEqual(result.candidates.length, 1);
  assert.strictEqual(result.excluded[0].reason, 'excluded-title-pattern');
});

test('detectCandidates: filters issues with open PRs', () => {
  const issues = [
    { number: 200, title: 'Feature A', body: '', labels: [] },
    { number: 300, title: 'Feature B', body: '', labels: [] },
  ];
  const prs = [{ number: 50, title: 'feat', body: 'Closes #200', headRefName: '' }];
  const result = detectCandidates(issues, prs);
  assert.strictEqual(result.candidates.length, 1);
  assert.strictEqual(result.candidates[0].number, 300);
});

test('detectCandidates: candidates sorted by number', () => {
  const issues = [
    { number: 300, title: 'C', body: '', labels: [] },
    { number: 100, title: 'A', body: '', labels: [] },
    { number: 200, title: 'B', body: '', labels: [] },
  ];
  const result = detectCandidates(issues, []);
  assert.strictEqual(result.candidates[0].number, 100);
  assert.strictEqual(result.candidates[1].number, 200);
  assert.strictEqual(result.candidates[2].number, 300);
});

test('detectCandidates: candidate has all required fields', () => {
  const issues = [
    { number: 400, title: 'Add endpoint', body: '', labels: [{ name: 'agent:ready' }], updatedAt: '2026-01-01' },
  ];
  const result = detectCandidates(issues, []);
  const c = result.candidates[0];
  assert.strictEqual(typeof c.number, 'number');
  assert.strictEqual(typeof c.title, 'string');
  assert.strictEqual(typeof c.workerClass, 'string');
  assert.strictEqual(typeof c.risk, 'string');
  assert.ok(Array.isArray(c.labels));
  assert.strictEqual(c.updatedAt, '2026-01-01');
});

// ── buildOutput tests ────────────────────────────────────────────────────────

test('buildOutput: has correct schema version and shape', () => {
  const issues = [
    { number: 200, title: 'Feature', body: '', labels: [] },
  ];
  const result = detectCandidates(issues, []);
  const output = buildOutput(issues, [], result);
  assert.strictEqual(output.schemaVersion, 1);
  assert.strictEqual(typeof output.capturedAt, 'string');
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.summary.totalOpen, 1);
  assert.strictEqual(output.summary.candidateCount, 1);
  assert.strictEqual(output.summary.excludedCount, 0);
  assert.ok(Array.isArray(output.candidates));
  assert.ok(Array.isArray(output.excluded));
});

test('buildOutput: sanitizes secret-shaped keys', () => {
  const issues = [
    { number: 200, title: 'Feature', body: 'has apiKey: abc123', labels: [], token: 'secret' },
  ];
  const result = detectCandidates(issues, []);
  const output = buildOutput(issues, [], result);
  const json = JSON.stringify(output);
  assert.ok(!json.includes('abc123'), 'should not contain secret values');
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
  assert.ok(stdout.includes('detect-launch-candidates'));
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

// ── Fixture mode tests ───────────────────────────────────────────────────────

test('fixture: reads from fixture file', () => {
  const fixturePath = tmpFile('fixture');
  const fixture = {
    issues: [
      { number: 100, title: 'Discussion issue', body: '', labels: [{ name: 'discussion' }] },
      { number: 200, title: 'Valid issue', body: '', labels: [{ name: 'agent:ready' }] },
      { number: 300, title: 'Has PR', body: '', labels: [] },
    ],
    openPRs: [
      { number: 50, title: 'feat', body: 'Closes #300', headRefName: '' },
    ],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.summary.totalOpen, 3);
    assert.strictEqual(output.summary.candidateCount, 1);
    assert.strictEqual(output.summary.excludedCount, 2);
    assert.strictEqual(output.candidates[0].number, 200);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

test('fixture: bad fixture exits 2', () => {
  const fixturePath = tmpFile('bad-fixture');
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

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: empty issue list', () => {
  const result = detectCandidates([], []);
  assert.strictEqual(result.candidates.length, 0);
  assert.strictEqual(result.excluded.length, 0);
});

test('edge: issue with null labels', () => {
  const issue = { number: 500, title: 'Feature', body: '', labels: null };
  assert.ok(!hasExcludeLabel(issue));
  const result = detectCandidates([issue], []);
  assert.strictEqual(result.candidates.length, 1);
});

test('edge: issue with undefined body', () => {
  const issue = { number: 501, title: 'Feature', labels: [] };
  const result = detectCandidates([issue], []);
  assert.strictEqual(result.candidates.length, 1);
});

test('edge: all issues excluded', () => {
  const issues = [
    { number: 96, title: 'Discussion', body: '', labels: [{ name: 'discussion' }] },
    { number: 97, title: 'Done', body: '', labels: [{ name: 'agent:done' }] },
  ];
  const result = detectCandidates(issues, []);
  assert.strictEqual(result.candidates.length, 0);
  assert.strictEqual(result.excluded.length, 2);
});

// ── stdout with fixture ──────────────────────────────────────────────────────

test('fixture + stdout: prints valid JSON', () => {
  const fixturePath = tmpFile('stdout-fixture');
  const fixture = {
    issues: [{ number: 600, title: 'Test', body: '', labels: [] }],
    openPRs: [],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.schemaVersion, 1);
    assert.strictEqual(output.candidates[0].number, 600);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  detect-launch-candidates.test.js`);
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
