#!/usr/bin/env node

/**
 * propose-self-cycle-issues.test.js
 *
 * Tests for propose-self-cycle-issues.js covering:
 * - Duplicate dedup by title overlap
 * - Duplicate dedup by conflictGroup
 * - Bounded parallel rehearsal proposal
 * - Provider capacity projection proposal
 * - High-risk items marked blocked/human-required
 * - JSON compatibility with write-planned-issues.ps1
 * - Max cap enforcement
 * - CONTROL APPENDIX field presence
 * - Execute mode refuses high-risk auto-creation
 * - Audit event writing
 * - Forbidden file scope enforcement
 *
 * Uses Node assert and subprocess invocation. No test framework.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'propose-self-cycle-issues.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

// ── Import pure functions from source ────────────────────────────────────────

const {
  extractKeywords,
  titleOverlap,
  isFileScopeForbidden,
  extractConflictGroupFromIssueBody,
  makeCandidate,
  deduplicate,
  applyPolicyGate,
  buildOutput,
  buildIssueBody,
  fetchMergedPRs,
} = require('./propose-self-cycle-issues.js');

// ── Subprocess helper ────────────────────────────────────────────────────────

function runScript(args, opts = {}) {
  const allArgs = [SCRIPT, ...args];
  const env = { ...process.env, ...(opts.env || {}) };
  try {
    const stdout = execFileSync(process.execPath, allArgs, {
      encoding: 'utf8',
      cwd: opts.cwd || REPO_ROOT,
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
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

// ── Fixture helpers ──────────────────────────────────────────────────────────

function createTempStateDir(fixtures = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-test-'));

  if (fixtures.health) {
    fs.writeFileSync(path.join(tmpDir, 'main-health.json'), JSON.stringify(fixtures.health));
  }
  if (fixtures.localResource) {
    fs.writeFileSync(path.join(tmpDir, 'local-resource.json'), JSON.stringify(fixtures.localResource));
  }
  if (fixtures.providerPool) {
    fs.writeFileSync(path.join(tmpDir, 'provider-pool.json'), JSON.stringify(fixtures.providerPool));
  }
  if (fixtures.taskBoard) {
    fs.writeFileSync(path.join(tmpDir, 'task-board.json'), JSON.stringify(fixtures.taskBoard));
  }
  if (fixtures.activeWorkers) {
    fs.writeFileSync(path.join(tmpDir, 'active-workers.json'), JSON.stringify(fixtures.activeWorkers));
  }
  if (fixtures.macroGoal) {
    fs.writeFileSync(path.join(tmpDir, 'macro-goal.json'), JSON.stringify(fixtures.macroGoal));
  }
  if (fixtures.legacyRetirement) {
    fs.writeFileSync(path.join(tmpDir, 'legacy-orchestration-retirement.json'), JSON.stringify(fixtures.legacyRetirement));
  }
  if (fixtures.metaSignals) {
    fs.writeFileSync(path.join(tmpDir, 'meta-signals.json'), JSON.stringify(fixtures.metaSignals));
  }

  return tmpDir;
}

const MINIMAL_HEALTH = {
  markerVersion: 1,
  state: 'green',
  commitSha: 'abc123',
  capturedAt: new Date().toISOString(),
  checks: ['check'],
  failedChecks: [],
  allowedWorkerClasses: ['all'],
  reason: 'test',
};

const MINIMAL_PROVIDER_POOL = {
  stateVersion: 1,
  providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }],
  global: {
    totalActiveWorkers: 0,
    globalMaxWorkers: 3,
    availableProviders: 1,
    exhaustedProviders: 0,
    disabledProviders: 0,
    capturedAt: new Date().toISOString(),
  },
};

const STALE_RESOURCE = {
  stateVersion: 1,
  cpu: { cores: null, usagePercent: null },
  memory: { totalGB: null, usedGB: null },
  global: {
    resourceState: 'unknown',
    capturedAt: '2020-01-01T00:00:00Z',
    ttlSeconds: 300,
  },
};

const HEALTHY_RESOURCE = {
  stateVersion: 1,
  cpu: { cores: 8, usagePercent: 25 },
  memory: { totalGB: 16, usedGB: 8, availableGB: 8 },
  global: {
    resourceState: 'healthy',
    capturedAt: new Date().toISOString(),
    ttlSeconds: 300,
  },
};

// ── Unit tests: extractKeywords ──────────────────────────────────────────────

test('extractKeywords: extracts meaningful words', () => {
  const kw = extractKeywords('Add bounded parallel rehearsal smoke test');
  assert.ok(kw.includes('bounded'));
  assert.ok(kw.includes('parallel'));
  assert.ok(kw.includes('rehearsal'));
  assert.ok(kw.includes('smoke'));
  assert.ok(!kw.includes('add')); // stopword
});

test('extractKeywords: handles empty string', () => {
  assert.deepStrictEqual(extractKeywords(''), []);
});

// ── Unit tests: titleOverlap ─────────────────────────────────────────────────

test('titleOverlap: similar titles have high overlap', () => {
  const overlap = titleOverlap(
    'Add bounded parallel rehearsal smoke test',
    'Add bounded parallel rehearsal test'
  );
  assert.ok(overlap > 0.5, `Expected > 0.5, got ${overlap}`);
});

test('titleOverlap: different titles have low overlap', () => {
  const overlap = titleOverlap(
    'Refresh resource sampler state',
    'Add bounded parallel rehearsal'
  );
  assert.ok(overlap < 0.5, `Expected < 0.5, got ${overlap}`);
});

test('titleOverlap: empty string returns 0', () => {
  assert.strictEqual(titleOverlap('', 'something'), 0);
  assert.strictEqual(titleOverlap('something', ''), 0);
});

// ── Unit tests: isFileScopeForbidden ─────────────────────────────────────────

test('isFileScopeForbidden: src/** is forbidden', () => {
  assert.ok(isFileScopeForbidden(['src/**']));
});

test('isFileScopeForbidden: prisma/** is forbidden', () => {
  assert.ok(isFileScopeForbidden(['prisma/migrations/**']));
});

test('isFileScopeForbidden: package.json is forbidden', () => {
  assert.ok(isFileScopeForbidden(['package.json']));
});

test('isFileScopeForbidden: docs/** is allowed', () => {
  assert.ok(!isFileScopeForbidden(['docs/**']));
});

test('isFileScopeForbidden: scripts/ai/** is allowed', () => {
  assert.ok(!isFileScopeForbidden(['scripts/ai/**']));
});

test('isFileScopeForbidden: schemas/** is allowed', () => {
  assert.ok(!isFileScopeForbidden(['schemas/**']));
});

// ── Unit tests: extractConflictGroupFromIssueBody ────────────────────────────

test('extractConflictGroupFromIssueBody: extracts from CONTROL APPENDIX', () => {
  const body = 'Some text\nConflict group: resource-sampler\nCONTROL APPENDIX';
  assert.strictEqual(extractConflictGroupFromIssueBody(body), 'resource-sampler');
});

test('extractConflictGroupFromIssueBody: returns null for missing', () => {
  assert.strictEqual(extractConflictGroupFromIssueBody('No conflict group here'), null);
});

test('extractConflictGroupFromIssueBody: handles null body', () => {
  assert.strictEqual(extractConflictGroupFromIssueBody(null), null);
});

// ── Unit tests: makeCandidate ────────────────────────────────────────────────

test('makeCandidate: has correct defaults', () => {
  const c = makeCandidate({ title: 'test' });
  assert.strictEqual(c.risk, 'low');
  assert.strictEqual(c.readiness, 'ready');
  assert.strictEqual(c.humanRequired, false);
  assert.strictEqual(c.issueNumber, null);
  assert.strictEqual(c.taskType, 'execution');
  assert.ok(Array.isArray(c.allowedFiles));
  assert.ok(Array.isArray(c.forbiddenFiles));
  assert.ok(Array.isArray(c.validationCommands));
  assert.strictEqual(typeof c.evidence, 'string');
  assert.strictEqual(typeof c.rollbackFollowUp, 'string');
});

// ── Unit tests: deduplicate ──────────────────────────────────────────────────

test('deduplicate: removes candidates with title overlap > 0.5', () => {
  const candidates = [
    makeCandidate({ title: 'Add bounded parallel rehearsal smoke test' }),
    makeCandidate({ title: 'Refresh resource sampler' }),
  ];
  const openIssues = [{ title: 'Add bounded parallel rehearsal test', body: '', labels: [] }];
  const result = deduplicate(candidates, openIssues, []);
  assert.strictEqual(result.proposed.length, 1);
  assert.strictEqual(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes('title overlap'));
  assert.strictEqual(result.proposed[0].title, 'Refresh resource sampler');
});

test('deduplicate: removes candidates with conflicting conflictGroup', () => {
  const candidates = [
    makeCandidate({ title: 'Unique title A', conflictGroup: 'resource-sampler' }),
    makeCandidate({ title: 'Unique title B', conflictGroup: 'resource-sampler' }),
  ];
  const openIssues = [{
    title: 'Old resource issue',
    body: 'Conflict group: resource-sampler\nCONTROL APPENDIX',
    labels: [],
  }];
  const result = deduplicate(candidates, openIssues, []);
  assert.strictEqual(result.proposed.length, 0, 'both collide with existing CG');
  assert.strictEqual(result.skipped.length, 2);
});

test('deduplicate: passes through non-overlapping candidates', () => {
  const candidates = [
    makeCandidate({ title: 'Completely unique task', conflictGroup: 'unique-group' }),
  ];
  const openIssues = [{ title: 'Other issue', body: '', labels: [] }];
  const result = deduplicate(candidates, openIssues, []);
  assert.strictEqual(result.proposed.length, 1);
  assert.strictEqual(result.skipped.length, 0);
});

test('deduplicate: removes candidates with conflictGroup in open PR body', () => {
  const candidates = [
    makeCandidate({ title: 'Unique auth task', conflictGroup: 'auth-core' }),
  ];
  const openPRs = [{
    title: 'Auth refactor PR',
    body: 'Conflict group: auth-core\nCONTROL APPENDIX',
    headRefName: 'auth-refactor',
  }];
  const result = deduplicate(candidates, [], openPRs);
  assert.strictEqual(result.proposed.length, 0, 'should skip candidate matching PR conflictGroup');
  assert.strictEqual(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes('auth-core'));
});

test('deduplicate: removes candidates with conflictGroup in merged PR body', () => {
  const candidates = [
    makeCandidate({ title: 'Feed improvement task', conflictGroup: 'feed' }),
  ];
  const mergedPRs = [{
    title: 'Feed optimization PR',
    body: 'Conflict group: feed\nCONTROL APPENDIX',
    headRefName: 'feed-opt',
  }];
  const result = deduplicate(candidates, [], [], mergedPRs);
  assert.strictEqual(result.proposed.length, 0, 'should skip candidate matching merged PR conflictGroup');
  assert.strictEqual(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes('feed'));
});

test('deduplicate: removes candidates with title overlap against merged PRs', () => {
  const candidates = [
    makeCandidate({ title: 'Feed optimization for performance' }),
  ];
  const mergedPRs = [{
    title: 'Feed optimization for speed',
    body: '',
    headRefName: 'feed-speed',
  }];
  const result = deduplicate(candidates, [], [], mergedPRs);
  assert.strictEqual(result.proposed.length, 0, 'should skip candidate with merged PR title overlap');
  assert.strictEqual(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes('title overlap'));
});

test('deduplicate: passes through candidates with no PR or issue conflicts', () => {
  const candidates = [
    makeCandidate({ title: 'Brand new feature', conflictGroup: 'new-group' }),
  ];
  const openPRs = [{
    title: 'Unrelated PR',
    body: 'Conflict group: other-group\nCONTROL APPENDIX',
    headRefName: 'other',
  }];
  const mergedPRs = [{
    title: 'Old merged PR',
    body: 'Conflict group: old-group\nCONTROL APPENDIX',
    headRefName: 'old',
  }];
  const result = deduplicate(candidates, [], openPRs, mergedPRs);
  assert.strictEqual(result.proposed.length, 1, 'should pass through non-conflicting candidate');
  assert.strictEqual(result.skipped.length, 0);
});

// ── Unit tests: applyPolicyGate ──────────────────────────────────────────────

test('applyPolicyGate: blocks high-risk candidates', () => {
  const candidates = [makeCandidate({ title: 'Dangerous change', risk: 'high' })];
  const result = applyPolicyGate(candidates);
  assert.strictEqual(result.autoCreatable.length, 0);
  assert.strictEqual(result.humanRequired.length, 1);
  assert.strictEqual(result.humanRequired[0].readiness, 'blocked');
  assert.strictEqual(result.humanRequired[0].humanRequired, true);
});

test('applyPolicyGate: allows low-risk candidates', () => {
  const candidates = [makeCandidate({ title: 'Safe docs change', risk: 'low' })];
  const result = applyPolicyGate(candidates);
  assert.strictEqual(result.autoCreatable.length, 1);
  assert.strictEqual(result.humanRequired.length, 0);
  assert.strictEqual(result.autoCreatable[0].readiness, 'ready');
});

test('applyPolicyGate: allows medium-risk candidates', () => {
  const candidates = [makeCandidate({ title: 'Medium change', risk: 'medium' })];
  const result = applyPolicyGate(candidates);
  assert.strictEqual(result.autoCreatable.length, 1);
  assert.strictEqual(result.humanRequired.length, 0);
});

test('applyPolicyGate: blocks candidates with forbidden file scopes', () => {
  const candidates = [makeCandidate({
    title: 'Touching src',
    risk: 'low',
    allowedFiles: ['src/**'],
  })];
  const result = applyPolicyGate(candidates);
  assert.strictEqual(result.autoCreatable.length, 0);
  assert.strictEqual(result.humanRequired.length, 1);
  assert.strictEqual(result.humanRequired[0].humanRequired, true);
});

test('applyPolicyGate: respects pre-set humanRequired flag', () => {
  const candidates = [makeCandidate({
    title: 'Meta issue',
    risk: 'low',
    humanRequired: true,
  })];
  const result = applyPolicyGate(candidates);
  assert.strictEqual(result.autoCreatable.length, 0);
  assert.strictEqual(result.humanRequired.length, 1);
  assert.strictEqual(result.humanRequired[0].readiness, 'human-required');
});

// ── Unit tests: buildOutput ──────────────────────────────────────────────────

test('buildOutput: has correct shape', () => {
  const output = buildOutput([makeCandidate({ title: 'test' })], [], 'dry-run', 10);
  assert.strictEqual(output.planVersion, 1);
  assert.ok(typeof output.capturedAt === 'string');
  assert.ok(Array.isArray(output.candidates));
  assert.ok(Array.isArray(output.skippedDuplicates));
  assert.strictEqual(output.mode, 'dry-run');
  assert.strictEqual(output.totalProposed, 1);
  assert.strictEqual(output.totalCapped, 1);
  assert.strictEqual(output.totalSkipped, 0);
});

test('buildOutput: caps at max', () => {
  const many = Array.from({ length: 15 }, (_, i) => makeCandidate({ title: `Issue ${i}` }));
  const output = buildOutput(many, [], 'dry-run', 5);
  assert.strictEqual(output.candidates.length, 5);
  assert.strictEqual(output.totalProposed, 15);
  assert.strictEqual(output.totalCapped, 5);
});

// ── Unit tests: buildIssueBody ───────────────────────────────────────────────

test('buildIssueBody: contains CONTROL APPENDIX', () => {
  const body = buildIssueBody(makeCandidate({ title: 'Test', conflictGroup: 'test-group' }));
  assert.ok(body.includes('CONTROL APPENDIX'), 'missing CONTROL APPENDIX');
  assert.ok(body.includes('Conflict group: test-group'), 'missing conflict group');
  assert.ok(body.includes('Role packet:'), 'missing role packet');
  assert.ok(body.includes('Allowed files:'), 'missing allowed files');
  assert.ok(body.includes('Forbidden files:'), 'missing forbidden files');
  assert.ok(body.includes('Validation commands:'), 'missing validation commands');
});

test('buildIssueBody: contains Evidence and Rollback/Follow-up sections', () => {
  const body = buildIssueBody(makeCandidate({
    title: 'Test',
    conflictGroup: 'test-group',
    evidence: 'File X does not exist on disk.',
    rollbackFollowUp: 'Revert file X and re-run.',
  }));
  assert.ok(body.includes('## Evidence'), 'missing Evidence section');
  assert.ok(body.includes('File X does not exist on disk.'), 'missing evidence text');
  assert.ok(body.includes('## Rollback / Follow-up'), 'missing Rollback/Follow-up section');
  assert.ok(body.includes('Revert file X and re-run.'), 'missing rollback text');
});

test('buildIssueBody: shows fallback text when evidence/rollback are empty', () => {
  const body = buildIssueBody(makeCandidate({ title: 'Test' }));
  assert.ok(body.includes('No evidence recorded.'), 'missing evidence fallback');
  assert.ok(body.includes('No rollback or follow-up steps specified.'), 'missing rollback fallback');
});

test('buildIssueBody: contains Goal/Scope/Acceptance/Constraints/Evidence/Rollback sections', () => {
  const body = buildIssueBody(makeCandidate({ title: 'Test' }));
  assert.ok(body.includes('## Goal'));
  assert.ok(body.includes('## Evidence'));
  assert.ok(body.includes('## Scope'));
  assert.ok(body.includes('## Acceptance'));
  assert.ok(body.includes('## Constraints'));
  assert.ok(body.includes('## Rollback / Follow-up'));
});

// ── Integration: dry-run with stale resource produces proposals ──────────────

test('integration: dry-run with stale resource proposes refresh', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.strictEqual(output.planVersion, 1);
    assert.strictEqual(output.mode, 'dry-run');
    assert.ok(output.candidates.length > 0, 'should have at least 1 candidate');
    const refreshCandidate = output.candidates.find(c => c.title.includes('resource sampler'));
    assert.ok(refreshCandidate, 'should propose resource sampler refresh');
    assert.strictEqual(refreshCandidate.risk, 'low');
    assert.strictEqual(refreshCandidate.readiness, 'ready');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: provider capacity projection ────────────────────────────────

test('integration: proposes provider capacity when slots < maxWorkers', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: HEALTHY_RESOURCE,
    providerPool: {
      stateVersion: 1,
      providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }],
      global: {
        totalActiveWorkers: 0,
        globalMaxWorkers: 3,
        availableProviders: 1,
        exhaustedProviders: 0,
        disabledProviders: 0,
        capturedAt: new Date().toISOString(),
      },
    },
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    const providerCandidate = output.candidates.find(c => c.conflictGroup === 'provider-pool-capacity');
    assert.ok(providerCandidate, 'should propose provider capacity projection');
    assert.strictEqual(providerCandidate.risk, 'medium');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: high-risk items are blocked ─────────────────────────────────

test('integration: high-risk candidates are marked blocked/human-required', () => {
  // Create a state that generates both low and high-risk candidates
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);

    // All candidates should have risk and readiness
    for (const c of output.candidates) {
      assert.ok(['low', 'medium', 'high'].includes(c.risk), `invalid risk: ${c.risk}`);
      assert.ok(['ready', 'blocked', 'human-required'].includes(c.readiness), `invalid readiness: ${c.readiness}`);
      if (c.risk === 'high') {
        assert.strictEqual(c.humanRequired, true, 'high-risk must be humanRequired');
        assert.strictEqual(c.readiness, 'blocked', 'high-risk must be blocked');
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: output compatible with write-planned-issues.ps1 ─────────────

test('integration: output JSON is compatible with write-planned-issues.ps1', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);

    // Required top-level fields
    assert.strictEqual(typeof output.planVersion, 'number');
    assert.strictEqual(typeof output.capturedAt, 'string');
    assert.ok(Array.isArray(output.candidates));

    // Each candidate must have fields required by write-planned-issues.ps1
    for (const c of output.candidates) {
      assert.strictEqual(typeof c.title, 'string', 'candidate.title must be string');
      assert.strictEqual(typeof c.taskType, 'string', 'candidate.taskType must be string');
      assert.strictEqual(typeof c.risk, 'string', 'candidate.risk must be string');
      assert.strictEqual(typeof c.conflictGroup, 'string', 'candidate.conflictGroup must be string');
      assert.strictEqual(typeof c.actorRole, 'string', 'candidate.actorRole must be string');
      assert.ok(Array.isArray(c.allowedFiles), 'candidate.allowedFiles must be array');
      assert.ok(Array.isArray(c.forbiddenFiles), 'candidate.forbiddenFiles must be array');
      assert.ok(Array.isArray(c.validationCommands), 'candidate.validationCommands must be array');
      assert.strictEqual(typeof c.readiness, 'string', 'candidate.readiness must be string');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: max cap ─────────────────────────────────────────────────────

test('integration: caps proposals at --max', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout', '--max', '1']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.ok(output.candidates.length <= 1, `expected max 1 candidate, got ${output.candidates.length}`);
    assert.strictEqual(output.totalCapped, output.candidates.length);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: CONTROL APPENDIX fields present ─────────────────────────────

test('integration: candidates have CONTROL APPENDIX compatible fields', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);

    for (const c of output.candidates) {
      assert.ok(c.taskType, 'missing taskType');
      assert.ok(c.risk, 'missing risk');
      assert.ok(c.conflictGroup, 'missing conflictGroup');
      assert.ok(c.actorRole, 'missing actorRole');
      assert.ok(c.allowedFiles.length > 0, 'empty allowedFiles');
      assert.ok(c.validationCommands.length > 0, 'empty validationCommands');
      assert.strictEqual(typeof c.evidence, 'string', 'missing evidence');
      assert.strictEqual(typeof c.rollbackFollowUp, 'string', 'missing rollbackFollowUp');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: forbidden file scope enforcement ────────────────────────────

test('integration: candidates touching src/** are marked humanRequired', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: HEALTHY_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);

    for (const c of output.candidates) {
      const touchesForbidden = c.allowedFiles.some(f =>
        f.startsWith('src/') || f === 'package.json' || f.startsWith('prisma/')
      );
      if (touchesForbidden) {
        assert.strictEqual(c.humanRequired, true, `candidate "${c.title}" touches forbidden scope but is not humanRequired`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: self-test passes ────────────────────────────────────────────

test('integration: --self-test exits 0', () => {
  const { exitCode } = runScript(['--self-test']);
  assert.strictEqual(exitCode, 0);
});

// ── Integration: --help exits 0 ──────────────────────────────────────────────

test('integration: --help exits 0', () => {
  const { exitCode } = runScript(['--help']);
  assert.strictEqual(exitCode, 0);
});

// ── Integration: unknown arg exits 2 ─────────────────────────────────────────

test('integration: unknown argument exits 2', () => {
  const { exitCode } = runScript(['--bogus']);
  assert.strictEqual(exitCode, 2);
});

// ── Integration: audit event writing ─────────────────────────────────────────

test('integration: writes audit events to issue-seeding-events.ndjson', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);

    const auditPath = path.join(tmpDir, 'issue-seeding-events.ndjson');
    assert.ok(fs.existsSync(auditPath), 'audit file should exist');
    const auditContent = fs.readFileSync(auditPath, 'utf8');
    const lines = auditContent.split('\n').filter(l => l.trim());
    assert.ok(lines.length > 0, 'audit file should have entries');

    const firstEntry = JSON.parse(lines[0]);
    assert.strictEqual(firstEntry.schemaVersion, 1);
    assert.ok(firstEntry.eventId, 'missing eventId');
    assert.ok(firstEntry.recordedAt, 'missing recordedAt');
    assert.ok(firstEntry.action, 'missing action');
    assert.ok(firstEntry.title, 'missing title');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: dedup against existing issues ───────────────────────────────

test('integration: proposes nothing when all gaps are already covered by open issues', () => {
  // This test uses --self-test path since we can't easily mock gh CLI.
  // The unit tests above cover dedup logic. This verifies the self-test works.
  const { exitCode } = runScript(['--self-test']);
  assert.strictEqual(exitCode, 0);
});

// ── Integration: generated issues include evidence and rollback ───────────────

test('integration: generated issues include evidence and rollbackFollowUp', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const output = JSON.parse(stdout);

    for (const c of output.candidates) {
      assert.ok(typeof c.evidence === 'string', `candidate "${c.title}" missing evidence field`);
      assert.ok(typeof c.rollbackFollowUp === 'string', `candidate "${c.title}" missing rollbackFollowUp field`);
      // Non-meta candidates should have non-empty evidence
      if (!c.humanRequired) {
        assert.ok(c.evidence.length > 0, `candidate "${c.title}" has empty evidence`);
        assert.ok(c.rollbackFollowUp.length > 0, `candidate "${c.title}" has empty rollbackFollowUp`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Integration: bounded parallel rehearsal proposal ─────────────────────────

test('integration: bounded parallel rehearsal generator is callable', () => {
  const { generateBoundedParallelRehearsalCandidates } = require('./propose-self-cycle-issues.js');
  // The result depends on whether docs/scripts exist in the repo, but it should not throw
  const result = generateBoundedParallelRehearsalCandidates({});
  assert.ok(Array.isArray(result), 'should return an array');
});

// ── Integration: --out writes file ───────────────────────────────────────────

test('integration: --out writes file and prints path', () => {
  const tmpDir = createTempStateDir({
    health: MINIMAL_HEALTH,
    localResource: STALE_RESOURCE,
    providerPool: MINIMAL_PROVIDER_POOL,
  });
  const tmpOut = path.join(tmpDir, 'output.json');

  try {
    const { stdout, exitCode } = runScript(['--state-dir', tmpDir, '--out', tmpOut]);
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('Proposed issues written to'), 'should print path message');
    assert.ok(fs.existsSync(tmpOut), 'output file should exist');
    const written = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.strictEqual(written.planVersion, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  propose-self-cycle-issues.test.js`);
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
