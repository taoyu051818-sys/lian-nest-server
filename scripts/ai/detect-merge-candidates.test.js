#!/usr/bin/env node

/**
 * detect-merge-candidates.test.js
 *
 * Tests for detect-merge-candidates.js.
 * Covers: dry-run shape, live write, classification logic, sanitization,
 * CLI error handling, help flag, built-in self-test, fixture input.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'detect-merge-candidates.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePR(overrides) {
  return Object.assign({
    number: 100,
    title: 'feat: test PR',
    body: '',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'feat/test',
    baseRefName: 'main',
    url: 'https://github.com/test/repo/pull/100',
    author: { login: 'testuser' },
    labels: [],
  }, overrides);
}

const FIXTURES = {
  // Clean mergeable PR: non-draft, MERGEABLE, has closing ref, low-risk files
  cleanMergeable: makePR({
    number: 200,
    title: 'feat: add dashboard widget',
    body: 'Closes #150\n\nAdds a new dashboard widget.',
    mergeable: 'MERGEABLE',
    headRefName: 'feat/dashboard-widget',
    url: 'https://github.com/test/repo/pull/200',
  }),

  // Clean mergeable with Fixes ref
  cleanMergeableFixes: makePR({
    number: 201,
    title: 'fix: resolve layout bug',
    body: 'Fixes #151',
    mergeable: 'MERGEABLE',
    headRefName: 'fix/layout-bug',
    url: 'https://github.com/test/repo/pull/201',
  }),

  // Clean mergeable with Resolves in title
  cleanMergeableTitle: makePR({
    number: 202,
    title: 'Resolves #152 - update docs',
    body: '',
    mergeable: 'MERGEABLE',
    headRefName: 'docs/update',
    url: 'https://github.com/test/repo/pull/202',
  }),

  // Blocked: UNKNOWN merge state
  blockedUnknown: makePR({
    number: 300,
    title: 'fix: unknown state',
    body: '',
    mergeable: 'UNKNOWN',
    headRefName: 'fix/unknown',
    url: 'https://github.com/test/repo/pull/300',
  }),

  // Blocked: DIRTY merge state
  blockedDirty: makePR({
    number: 301,
    title: 'fix: merge conflict',
    body: '',
    mergeable: 'DIRTY',
    headRefName: 'fix/conflict',
    url: 'https://github.com/test/repo/pull/301',
  }),

  // Human required: high-risk auth branch
  humanRequiredAuth: makePR({
    number: 400,
    title: 'fix: auth middleware',
    body: '',
    mergeable: 'MERGEABLE',
    headRefName: 'fix/auth-middleware',
    url: 'https://github.com/test/repo/pull/400',
  }),

  // Human required: high-risk src/ branch
  humanRequiredSrc: makePR({
    number: 401,
    title: 'refactor module',
    body: '',
    mergeable: 'MERGEABLE',
    headRefName: 'refactor/src/module',
    url: 'https://github.com/test/repo/pull/401',
  }),

  // Human required: draft PR
  humanRequiredDraft: makePR({
    number: 402,
    title: 'wip: new feature',
    body: '',
    isDraft: true,
    mergeable: 'MERGEABLE',
    headRefName: 'feat/wip',
    url: 'https://github.com/test/repo/pull/402',
  }),

  // Human required: no closing ref (even though MERGEABLE)
  humanRequiredNoRef: makePR({
    number: 403,
    title: 'chore: update deps',
    body: 'Just updating dependencies.',
    mergeable: 'MERGEABLE',
    headRefName: 'chore/deps',
    url: 'https://github.com/test/repo/pull/403',
  }),

  // Human required: prisma label
  humanRequiredPrisma: makePR({
    number: 404,
    title: 'feat: add model',
    body: 'Closes #99',
    mergeable: 'MERGEABLE',
    headRefName: 'feat/new-model',
    labels: [{ name: 'prisma' }],
    url: 'https://github.com/test/repo/pull/404',
  }),
};

function writeFixture(data) {
  const filePath = path.join(os.tmpdir(), `detect-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  return filePath;
}

function cleanupFixtures(paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

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

function parseSnapshot(stdout) {
  const idx = stdout.indexOf('{');
  assert.ok(idx >= 0, 'stdout should contain JSON');
  return JSON.parse(stdout.slice(idx));
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `detect-merge-${name}-${Date.now()}.json`);
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
  const fixturePath = writeFixture([]);
  try {
    const { stdout, exitCode } = run(['--input', fixturePath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('DRY RUN'), 'should include DRY RUN banner');
    assert.ok(stdout.includes('merge-candidates.json'), 'should mention output path');
    const snapshot = parseSnapshot(stdout);
    assert.strictEqual(snapshot.schemaVersion, 1);
    assert.ok(typeof snapshot.capturedAt === 'string');
    const keys = ['schemaVersion', 'capturedAt', 'summary', 'mergeable', 'blocked', 'humanRequired', 'inputSources'];
    for (const key of keys) { assert.ok(key in snapshot, `missing key: ${key}`); }
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('dry-run: does not create output file', () => {
  const outPath = tmpFile('dry-run-no-create');
  const fixturePath = writeFixture([]);
  try {
    const { exitCode } = run(['--input', fixturePath, '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(!fs.existsSync(outPath), 'dry-run should not create file');
  } finally {
    cleanupFixtures([fixturePath, outPath]);
  }
});

// ── Classification tests ─────────────────────────────────────────────────────

test('classification: CLEAN mergeable PR with closing ref is mergeable', () => {
  const fixturePath = writeFixture([FIXTURES.cleanMergeable]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.mergeable.length, 1);
    assert.strictEqual(snapshot.mergeable[0].number, 200);
    assert.strictEqual(snapshot.blocked.length, 0);
    assert.strictEqual(snapshot.humanRequired.length, 0);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: Fixes # ref also qualifies as mergeable', () => {
  const fixturePath = writeFixture([FIXTURES.cleanMergeableFixes]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.mergeable.length, 1);
    assert.strictEqual(snapshot.mergeable[0].number, 201);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: Resolves # in title qualifies as mergeable', () => {
  const fixturePath = writeFixture([FIXTURES.cleanMergeableTitle]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.mergeable.length, 1);
    assert.strictEqual(snapshot.mergeable[0].number, 202);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: UNKNOWN merge state is blocked', () => {
  const fixturePath = writeFixture([FIXTURES.blockedUnknown]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.blocked.length, 1);
    assert.strictEqual(snapshot.blocked[0].number, 300);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: DIRTY merge state is blocked', () => {
  const fixturePath = writeFixture([FIXTURES.blockedDirty]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.blocked.length, 1);
    assert.strictEqual(snapshot.blocked[0].number, 301);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: high-risk auth branch is humanRequired', () => {
  const fixturePath = writeFixture([FIXTURES.humanRequiredAuth]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.humanRequired.length, 1);
    assert.strictEqual(snapshot.humanRequired[0].number, 400);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: src/ branch is humanRequired', () => {
  const fixturePath = writeFixture([FIXTURES.humanRequiredSrc]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.humanRequired.length, 1);
    assert.strictEqual(snapshot.humanRequired[0].number, 401);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: draft PR is humanRequired', () => {
  const fixturePath = writeFixture([FIXTURES.humanRequiredDraft]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.humanRequired.length, 1);
    assert.strictEqual(snapshot.humanRequired[0].number, 402);
    assert.strictEqual(snapshot.humanRequired[0].isDraft, true);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: no closing ref is humanRequired', () => {
  const fixturePath = writeFixture([FIXTURES.humanRequiredNoRef]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.humanRequired.length, 1);
    assert.strictEqual(snapshot.humanRequired[0].number, 403);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('classification: prisma label triggers humanRequired', () => {
  const fixturePath = writeFixture([FIXTURES.humanRequiredPrisma]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.humanRequired.length, 1);
    assert.strictEqual(snapshot.humanRequired[0].number, 404);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

// ── Mixed fixture tests ──────────────────────────────────────────────────────

test('mixed: all three groups represented correctly', () => {
  const allPRs = Object.values(FIXTURES);
  const fixturePath = writeFixture(allPRs);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.summary.total, allPRs.length);
    assert.strictEqual(snapshot.summary.mergeable, 3, '3 mergeable (clean, fixes, resolves)');
    assert.strictEqual(snapshot.summary.blocked, 2, '2 blocked (unknown, dirty)');
    assert.ok(snapshot.summary.humanRequired >= 4, 'at least 4 humanRequired');
    assert.strictEqual(
      snapshot.summary.mergeable + snapshot.summary.blocked + snapshot.summary.humanRequired,
      snapshot.summary.total,
      'groups sum to total',
    );
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('mixed: empty array produces zero counts', () => {
  const fixturePath = writeFixture([]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.summary.total, 0);
    assert.strictEqual(snapshot.mergeable.length, 0);
    assert.strictEqual(snapshot.blocked.length, 0);
    assert.strictEqual(snapshot.humanRequired.length, 0);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

// ── Sanitization tests ───────────────────────────────────────────────────────

test('sanitization: sanitized PR has only safe fields', () => {
  const fixturePath = writeFixture([FIXTURES.cleanMergeable]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    const pr = snapshot.mergeable[0];
    const allowedKeys = ['number', 'title', 'isDraft', 'mergeable', 'headRefName', 'baseRefName', 'url', 'author', 'labels'];
    for (const key of Object.keys(pr)) {
      assert.ok(allowedKeys.includes(key), `unexpected key: ${key}`);
    }
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('sanitization: title truncated to 200 chars', () => {
  const longTitle = 'x'.repeat(300);
  const pr = makePR({ title: longTitle, body: 'Closes #1', mergeable: 'MERGEABLE' });
  const fixturePath = writeFixture([pr]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    const sanitized = snapshot.mergeable[0];
    assert.ok(sanitized.title.length <= 200, `title length ${sanitized.title.length}`);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('sanitization: branch name truncated to 100 chars', () => {
  const longBranch = 'feat/' + 'x'.repeat(150);
  const pr = makePR({ headRefName: longBranch, body: 'Closes #1', mergeable: 'MERGEABLE' });
  const fixturePath = writeFixture([pr]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    const sanitized = snapshot.mergeable[0];
    assert.ok(sanitized.headRefName.length <= 100, `branch length ${sanitized.headRefName.length}`);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('sanitization: author only contains login', () => {
  const pr = makePR({
    author: { login: 'alice', token: 'secret123', email: 'alice@example.com' },
    body: 'Closes #1',
    mergeable: 'MERGEABLE',
  });
  const fixturePath = writeFixture([pr]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    const sanitized = snapshot.mergeable[0];
    assert.deepStrictEqual(sanitized.author, { login: 'alice' });
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

// ── Input source flag ────────────────────────────────────────────────────────

test('inputSources: githubLoaded is true when PRs present', () => {
  const fixturePath = writeFixture([FIXTURES.cleanMergeable]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.inputSources.githubLoaded, true);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('inputSources: githubLoaded is false when empty', () => {
  const fixturePath = writeFixture([]);
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.inputSources.githubLoaded, false);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

// ── Input with { prs: [...] } wrapper ────────────────────────────────────────

test('input: accepts { prs: [...] } wrapper format', () => {
  const fixturePath = writeFixture({ prs: [FIXTURES.cleanMergeable] });
  try {
    const { stdout } = run(['--input', fixturePath, '--stdout']);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.summary.total, 1);
    assert.strictEqual(snapshot.mergeable.length, 1);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

// ── Live write tests ─────────────────────────────────────────────────────────

test('live: writes file and overwrites existing', () => {
  const outPath = tmpFile('live-write');
  const fixturePath = writeFixture([FIXTURES.cleanMergeable]);
  try {
    const { stdout, exitCode } = run(['--input', fixturePath, '--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Merge candidates written to'), 'should print written message');
    assert.ok(fs.existsSync(outPath), 'file should exist');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);

    // Overwrite existing
    fs.writeFileSync(outPath, JSON.stringify({ old: true }), 'utf8');
    run(['--input', fixturePath, '--live', '--out', outPath]);
    const overwritten = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(overwritten.schemaVersion, 1);
    assert.strictEqual(overwritten.old, undefined);
  } finally {
    cleanupFixtures([fixturePath, outPath]);
  }
});

// ── --stdout flag ────────────────────────────────────────────────────────────

test('stdout: prints JSON without banner', () => {
  const fixturePath = writeFixture([]);
  try {
    const { stdout, exitCode } = run(['--input', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    assert.ok(!stdout.includes('DRY RUN'), 'no banner');
    assert.strictEqual(JSON.parse(stdout).schemaVersion, 1);
  } finally {
    cleanupFixtures([fixturePath]);
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

test('cli: --input without value exits 2', () => {
  const { exitCode, stderr } = run(['--input']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--input requires a path'));
});

test('cli: --help and -h exit 0 with usage', () => {
  for (const flag of ['--help', '-h']) {
    const { stdout, exitCode } = run([flag]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('USAGE'));
  }
});

test('cli: --input with nonexistent file exits 2', () => {
  const { exitCode, stderr } = run(['--input', '/nonexistent/path/fake.json']);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('Could not read input file'));
});

// ── Built-in self-test ───────────────────────────────────────────────────────

test('self-test: --self-test exits 0', () => {
  const { stdout, exitCode } = run(['--self-test']);
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.includes('All self-tests passed'));
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: --out with nested directory creates parent dirs', () => {
  const outPath = path.join(os.tmpdir(), `detect-merge-nested-${Date.now()}`, 'sub', 'out.json');
  const fixturePath = writeFixture([]);
  try {
    const { exitCode } = run(['--input', fixturePath, '--live', '--out', outPath]);
    assert.strictEqual(exitCode, 0);
    assert.ok(fs.existsSync(outPath));
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(written.schemaVersion, 1);
  } finally {
    cleanupFixtures([fixturePath, outPath]);
    const parent = path.dirname(outPath);
    try { fs.rmdirSync(parent, { recursive: true }); } catch { /* ignore */ }
  }
});

test('edge: PR with missing body defaults gracefully', () => {
  const pr = makePR({ body: undefined, mergeable: 'MERGEABLE' });
  const fixturePath = writeFixture([pr]);
  try {
    const { stdout, exitCode } = run(['--input', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    // Without body and without closing ref in title, should be humanRequired
    assert.strictEqual(snapshot.humanRequired.length, 1);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

test('edge: PR with null author does not crash', () => {
  const pr = makePR({ author: null, body: 'Closes #1', mergeable: 'MERGEABLE' });
  const fixturePath = writeFixture([pr]);
  try {
    const { stdout, exitCode } = run(['--input', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const snapshot = JSON.parse(stdout);
    assert.strictEqual(snapshot.mergeable.length, 1);
    assert.strictEqual(snapshot.mergeable[0].author, null);
  } finally {
    cleanupFixtures([fixturePath]);
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  detect-merge-candidates.test.js`);
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
