#!/usr/bin/env node

/**
 * project-task-board.test.js
 *
 * Tests for project-task-board.js.
 * Covers: non-task detection, state mapping, PR linkage, worker lookup,
 * conflict group inference, blocked reason, fixture mode, CLI, edge cases.
 *
 * Runs without any test framework — uses Node assert and subprocess calls.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'project-task-board.js');

const {
  isNonTask,
  mapState,
  findLinkedPR,
  findWorker,
  inferConflictGroup,
  inferBlockedReason,
  projectTasks,
  buildProjection,
  discoverGaps,
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
  return path.join(os.tmpdir(), `project-task-board-${name}-${Date.now()}.json`);
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

// ── isNonTask tests ─────────────────────────────────────────────────────────

test('nonTask: discussion label', () => {
  const issue = { number: 96, title: 'Roadmap', body: '', labels: [{ name: 'discussion' }] };
  assert.ok(isNonTask(issue));
});

test('nonTask: human-required label', () => {
  const issue = { number: 50, title: 'Decide', body: '', labels: [{ name: 'human-required' }] };
  assert.ok(isNonTask(issue));
});

test('nonTask: umbrella label', () => {
  const issue = { number: 80, title: 'Refactor', body: '', labels: [{ name: 'umbrella' }] };
  assert.ok(isNonTask(issue));
});

test('nonTask: umbrella in title', () => {
  const issue = { number: 100, title: 'Umbrella: refactor auth', body: '', labels: [] };
  assert.ok(isNonTask(issue));
});

test('nonTask: discussion in title', () => {
  const issue = { number: 101, title: 'Discussion: API design', body: '', labels: [] };
  assert.ok(isNonTask(issue));
});

test('nonTask: meta in title', () => {
  const issue = { number: 102, title: 'Meta: tracking sprint', body: '', labels: [] };
  assert.ok(isNonTask(issue));
});

test('nonTask: RFC in title', () => {
  const issue = { number: 103, title: 'RFC: caching strategy', body: '', labels: [] };
  assert.ok(isNonTask(issue));
});

test('nonTask: proposal in title', () => {
  const issue = { number: 104, title: 'Proposal: add GraphQL', body: '', labels: [] };
  assert.ok(isNonTask(issue));
});

test('nonTask: string labels work', () => {
  const issue = { number: 105, title: 'Something', body: '', labels: ['discussion'] };
  assert.ok(isNonTask(issue));
});

test('nonTask: normal issue is NOT non-task', () => {
  const issue = { number: 200, title: 'Add feature', body: '', labels: [] };
  assert.ok(!isNonTask(issue));
});

test('nonTask: agent:ready is NOT non-task', () => {
  const issue = { number: 201, title: 'Feature', body: '', labels: [{ name: 'agent:ready' }] };
  assert.ok(!isNonTask(issue));
});

test('nonTask: empty labels', () => {
  const issue = { number: 202, title: 'Normal', body: '', labels: [] };
  assert.ok(!isNonTask(issue));
});

test('nonTask: null labels', () => {
  const issue = { number: 203, title: 'Normal', body: '', labels: null };
  assert.ok(!isNonTask(issue));
});

// ── mapState tests ───────────────────────────────────────────────────────────

test('mapState: agent:done → done', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:done' }] }), 'done');
});

test('mapState: agent:merged → done', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:merged' }] }), 'done');
});

test('mapState: agent:archived → archived', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:archived' }] }), 'archived');
});

test('mapState: agent:running → running', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:running' }] }), 'running');
});

test('mapState: agent:blocked → blocked', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:blocked' }] }), 'blocked');
});

test('mapState: agent:queued → ready', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:queued' }] }), 'ready');
});

test('mapState: agent:todo → todo', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:todo' }] }), 'todo');
});

test('mapState: agent:triage → triage', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:triage' }] }), 'triage');
});

test('mapState: no labels → open', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [] }), 'open');
});

test('mapState: null labels → open', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: null }), 'open');
});

test('mapState: string labels work', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: ['agent:running'] }), 'running');
});

test('mapState: priority — done takes precedence', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:running' }, { name: 'agent:done' }] }), 'done');
});

test('mapState: priority — archived takes precedence over running', () => {
  assert.strictEqual(mapState({ number: 1, title: '', labels: [{ name: 'agent:running' }, { name: 'agent:archived' }] }), 'archived');
});

// ── findLinkedPR tests ───────────────────────────────────────────────────────

test('findLinkedPR: finds PR by body ref', () => {
  const prs = [{ number: 50, title: 'feat', body: 'Closes #200', headRefName: '' }];
  assert.strictEqual(findLinkedPR({ number: 200 }, prs), 50);
});

test('findLinkedPR: finds PR by title ref', () => {
  const prs = [{ number: 51, title: 'Fixes #300', body: '', headRefName: '' }];
  assert.strictEqual(findLinkedPR({ number: 300 }, prs), 51);
});

test('findLinkedPR: case insensitive', () => {
  const prs = [{ number: 52, title: 'feat', body: 'resolves #400', headRefName: '' }];
  assert.strictEqual(findLinkedPR({ number: 400 }, prs), 52);
});

test('findLinkedPR: no match returns null', () => {
  const prs = [{ number: 53, title: 'Other', body: 'Closes #999', headRefName: '' }];
  assert.strictEqual(findLinkedPR({ number: 100 }, prs), null);
});

test('findLinkedPR: empty PRs returns null', () => {
  assert.strictEqual(findLinkedPR({ number: 200 }, []), null);
});

// ── findWorker tests ─────────────────────────────────────────────────────────

test('findWorker: finds matching worker', () => {
  const workers = {
    workers: [{
      issue: 258,
      branch: 'claude/wave6-20260511',
      claimant: 'backend-programmer',
      claimedAt: '2026-05-11T09:00:00Z',
      lastHeartbeat: '2026-05-11T09:25:00Z',
      expiresAt: '2026-05-11T10:30:00Z',
    }],
  };
  const w = findWorker({ number: 258 }, workers);
  assert.ok(w !== null);
  assert.strictEqual(w.branch, 'claude/wave6-20260511');
  assert.strictEqual(w.claimant, 'backend-programmer');
});

test('findWorker: no match returns null', () => {
  const workers = { workers: [{ issue: 258 }] };
  assert.strictEqual(findWorker({ number: 999 }, workers), null);
});

test('findWorker: null activeWorkers returns null', () => {
  assert.strictEqual(findWorker({ number: 1 }, null), null);
});

test('findWorker: missing workers array returns null', () => {
  assert.strictEqual(findWorker({ number: 1 }, {}), null);
});

test('findWorker: uses workerClass fallback for claimant', () => {
  const workers = { workers: [{ issue: 100, branch: 'b', workerClass: 'docs' }] };
  const w = findWorker({ number: 100 }, workers);
  assert.strictEqual(w.claimant, 'docs');
});

// ── inferConflictGroup tests ─────────────────────────────────────────────────

test('conflictGroup: explicit from body', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: '', body: 'conflictGroup: auth-core' }), 'auth-core');
});

test('conflictGroup: auth inferred', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: 'Fix auth', body: '' }), 'auth');
});

test('conflictGroup: schema inferred', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: 'Update prisma', body: '' }), 'schema');
});

test('conflictGroup: docs inferred', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: 'Update docs', body: '' }), 'docs');
});

test('conflictGroup: test inferred', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: 'Add test', body: '' }), 'test');
});

test('conflictGroup: ai-native inferred', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: 'Script', body: 'Update scripts/ai/' }), 'ai-native-docs');
});

test('conflictGroup: default general', () => {
  assert.strictEqual(inferConflictGroup({ number: 1, title: 'Something', body: '' }), 'general');
});

// ── inferBlockedReason tests ─────────────────────────────────────────────────

test('blockedReason: from body', () => {
  const issue = { number: 1, title: '', body: 'Blocked reason: waiting on #258', labels: [] };
  assert.strictEqual(inferBlockedReason(issue), 'waiting on #258');
});

test('blockedReason: from blocked: label', () => {
  const issue = { number: 1, title: '', body: '', labels: ['blocked:dependency'] };
  assert.strictEqual(inferBlockedReason(issue), 'dependency');
});

test('blockedReason: default when no reason found', () => {
  const issue = { number: 1, title: '', body: '', labels: [] };
  assert.strictEqual(inferBlockedReason(issue), 'blocked (reason not specified)');
});

test('blockedReason: truncates long reasons', () => {
  const longReason = 'a'.repeat(300);
  const issue = { number: 1, title: '', body: `Blocked: ${longReason}`, labels: [] };
  assert.ok(inferBlockedReason(issue).length <= 200);
});

// ── projectTasks tests ───────────────────────────────────────────────────────

test('projectTasks: mixed issues separate tasks from discussions', () => {
  const issues = [
    { number: 96, title: 'Roadmap discussion', body: '', labels: [{ name: 'discussion' }] },
    { number: 200, title: 'Feature A', body: '', labels: [{ name: 'agent:running' }] },
    { number: 300, title: 'Feature B', body: '', labels: [{ name: 'agent:done' }] },
  ];
  const { tasks, discussions } = projectTasks(issues, [], null, null);
  assert.strictEqual(discussions.length, 1);
  assert.strictEqual(discussions[0].issue, 96);
  assert.strictEqual(discussions[0].state, 'discussion/open');
  assert.strictEqual(tasks.length, 2);
});

test('projectTasks: running task gets worker', () => {
  const issues = [{ number: 200, title: 'F', body: '', labels: [{ name: 'agent:running' }] }];
  const workers = { workers: [{ issue: 200, branch: 'b', claimant: 'c', claimedAt: 't', lastHeartbeat: 't', expiresAt: 't' }] };
  const { tasks } = projectTasks(issues, [], workers, null);
  assert.ok(tasks[0].worker !== null);
});

test('projectTasks: done task has no worker', () => {
  const issues = [{ number: 300, title: 'F', body: '', labels: [{ name: 'agent:done' }] }];
  const { tasks } = projectTasks(issues, [], null, null);
  assert.strictEqual(tasks[0].worker, null);
});

test('projectTasks: done task gets linked PR', () => {
  const issues = [{ number: 300, title: 'F', body: '', labels: [{ name: 'agent:done' }] }];
  const prs = [{ number: 50, title: 'feat', body: 'Closes #300', headRefName: '' }];
  const { tasks } = projectTasks(issues, prs, null, null);
  assert.strictEqual(tasks[0].linkedPR, 50);
});

test('projectTasks: blocked task has blocked reason', () => {
  const issues = [{ number: 310, title: 'F', body: '', labels: [{ name: 'agent:blocked' }] }];
  const { tasks } = projectTasks(issues, [], null, null);
  assert.strictEqual(tasks[0].state, 'blocked');
  assert.ok(tasks[0].blockedReason !== null);
});

test('projectTasks: open task has no worker and no PR', () => {
  const issues = [{ number: 400, title: 'New', body: '', labels: [] }];
  const { tasks } = projectTasks(issues, [], null, null);
  assert.strictEqual(tasks[0].state, 'open');
  assert.strictEqual(tasks[0].worker, null);
  assert.strictEqual(tasks[0].linkedPR, null);
});

test('projectTasks: triage task has no worker', () => {
  const issues = [{ number: 410, title: 'Triage', body: '', labels: [{ name: 'agent:triage' }] }];
  const workers = { workers: [{ issue: 410, branch: 'b', claimant: 'c', claimedAt: 't', lastHeartbeat: 't', expiresAt: 't' }] };
  const { tasks } = projectTasks(issues, [], workers, null);
  assert.strictEqual(tasks[0].state, 'triage');
  assert.strictEqual(tasks[0].worker, null);
});

test('projectTasks: todo task has no worker', () => {
  const issues = [{ number: 420, title: 'Backlog', body: '', labels: [{ name: 'agent:todo' }] }];
  const workers = { workers: [{ issue: 420, branch: 'b', claimant: 'c', claimedAt: 't', lastHeartbeat: 't', expiresAt: 't' }] };
  const { tasks } = projectTasks(issues, [], workers, null);
  assert.strictEqual(tasks[0].state, 'todo');
  assert.strictEqual(tasks[0].worker, null);
});

test('projectTasks: archived task has no worker', () => {
  const issues = [{ number: 430, title: 'Old', body: '', labels: [{ name: 'agent:archived' }] }];
  const { tasks } = projectTasks(issues, [], null, null);
  assert.strictEqual(tasks[0].state, 'archived');
  assert.strictEqual(tasks[0].worker, null);
});

// ── buildProjection tests ────────────────────────────────────────────────────

test('buildProjection: correct schema shape', () => {
  const issues = [{ number: 200, title: 'F', body: '', labels: [] }];
  const proj = buildProjection(issues, [], null, null);
  assert.strictEqual(proj.markerVersion, 1);
  assert.strictEqual(typeof proj.capturedAt, 'string');
  assert.ok(Array.isArray(proj.tasks));
});

test('buildProjection: includes discussions in tasks array', () => {
  const issues = [
    { number: 96, title: 'Discussion', body: '', labels: [{ name: 'discussion' }] },
    { number: 200, title: 'Feature', body: '', labels: [] },
  ];
  const proj = buildProjection(issues, [], null, null);
  assert.strictEqual(proj.tasks.length, 2);
});

test('buildProjection: empty input', () => {
  const proj = buildProjection([], [], null, null);
  assert.strictEqual(proj.tasks.length, 0);
  assert.strictEqual(proj.markerVersion, 1);
});

test('buildProjection: sanitizes secret-shaped keys', () => {
  const issues = [{ number: 500, title: 'F', body: 'token: secret123', labels: [] }];
  const proj = buildProjection(issues, [], null, null);
  const json = JSON.stringify(proj);
  assert.ok(!json.includes('secret123'));
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
  assert.ok(stdout.includes('project-task-board'));
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

test('cli: no --fixture exits 2', () => {
  const { exitCode, stderr } = run([]);
  assert.strictEqual(exitCode, 2);
  assert.ok(stderr.includes('--fixture is required'));
});

// ── Fixture mode tests ───────────────────────────────────────────────────────

test('fixture: reads from fixture and produces projection', () => {
  const fixturePath = tmpFile('fixture');
  const fixture = {
    issues: [
      { number: 96, title: 'Roadmap discussion', body: '', labels: [{ name: 'discussion' }] },
      { number: 200, title: 'Feature A', body: '', labels: [{ name: 'agent:running' }] },
      { number: 275, title: 'Feature B', body: '', labels: [{ name: 'agent:done' }] },
      { number: 400, title: 'New feature', body: '', labels: [] },
      { number: 410, title: 'Triage item', body: '', labels: [{ name: 'agent:triage' }] },
      { number: 420, title: 'Backlog item', body: '', labels: [{ name: 'agent:todo' }] },
      { number: 430, title: 'Old item', body: '', labels: [{ name: 'agent:archived' }] },
    ],
    openPRs: [
      { number: 50, title: 'feat', body: 'Closes #275', headRefName: '' },
    ],
    activeWorkers: {
      workers: [{ issue: 200, branch: 'claude/w1', claimant: 'backend', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }],
    },
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  try {
    const { stdout, exitCode } = run(['--fixture', fixturePath, '--stdout']);
    assert.strictEqual(exitCode, 0);
    const proj = JSON.parse(stdout);
    assert.strictEqual(proj.markerVersion, 1);
    assert.strictEqual(proj.tasks.length, 7);
    // Discussion
    const discussion = proj.tasks.find(t => t.issue === 96);
    assert.strictEqual(discussion.state, 'discussion/open');
    // Running with worker
    const running = proj.tasks.find(t => t.issue === 200);
    assert.strictEqual(running.state, 'running');
    assert.ok(running.worker !== null);
    assert.strictEqual(running.worker.branch, 'claude/w1');
    // Done with PR
    const done = proj.tasks.find(t => t.issue === 275);
    assert.strictEqual(done.state, 'done');
    assert.strictEqual(done.linkedPR, 50);
    assert.strictEqual(done.worker, null);
    // Open
    const open = proj.tasks.find(t => t.issue === 400);
    assert.strictEqual(open.state, 'open');
    // Triage
    const triage = proj.tasks.find(t => t.issue === 410);
    assert.strictEqual(triage.state, 'triage');
    assert.strictEqual(triage.worker, null);
    // Todo
    const todo = proj.tasks.find(t => t.issue === 420);
    assert.strictEqual(todo.state, 'todo');
    assert.strictEqual(todo.worker, null);
    // Archived
    const archived = proj.tasks.find(t => t.issue === 430);
    assert.strictEqual(archived.state, 'archived');
    assert.strictEqual(archived.worker, null);
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
    const proj = JSON.parse(stdout);
    assert.strictEqual(proj.markerVersion, 1);
    assert.strictEqual(proj.tasks[0].issue, 600);
  } finally {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('edge: empty issue list', () => {
  const { tasks, discussions } = projectTasks([], [], null, null);
  assert.strictEqual(tasks.length, 0);
  assert.strictEqual(discussions.length, 0);
});

test('edge: issue with undefined body', () => {
  const issue = { number: 500, title: 'Feature', labels: [] };
  assert.ok(!isNonTask(issue));
  assert.strictEqual(mapState(issue), 'open');
});

test('edge: issue with null labels treated as empty', () => {
  const issue = { number: 501, title: 'Feature', body: '', labels: null };
  assert.ok(!isNonTask(issue));
  assert.strictEqual(mapState(issue), 'open');
});

test('edge: all issues are discussions', () => {
  const issues = [
    { number: 96, title: 'Discussion A', body: '', labels: [{ name: 'discussion' }] },
    { number: 97, title: 'Discussion B', body: '', labels: [{ name: 'discussion' }] },
  ];
  const { tasks, discussions } = projectTasks(issues, [], null, null);
  assert.strictEqual(tasks.length, 0);
  assert.strictEqual(discussions.length, 2);
});

test('edge: task entry has all required fields', () => {
  const issues = [{ number: 300, title: 'Done', body: '', labels: [{ name: 'agent:done' }] }];
  const { tasks } = projectTasks(issues, [], null, null);
  const t = tasks[0];
  assert.strictEqual(typeof t.issue, 'number');
  assert.strictEqual(typeof t.state, 'string');
  assert.strictEqual(typeof t.conflictGroup, 'string');
  assert.ok(t.worker === null || typeof t.worker === 'object');
  assert.ok(t.blockedReason === null || typeof t.blockedReason === 'string');
  assert.ok(t.linkedPR === null || typeof t.linkedPR === 'number');
});

test('edge: discussion entry has correct shape', () => {
  const issues = [{ number: 96, title: 'Discussion', body: '', labels: [{ name: 'discussion' }] }];
  const { discussions } = projectTasks(issues, [], null, null);
  const d = discussions[0];
  assert.strictEqual(d.issue, 96);
  assert.strictEqual(d.state, 'discussion/open');
  assert.strictEqual(d.conflictGroup, null);
  assert.strictEqual(d.worker, null);
  assert.strictEqual(d.blockedReason, null);
  assert.strictEqual(d.linkedPR, null);
});

// ── discoverGaps tests ──────────────────────────────────────────────────────

test('discoverGaps: schema version and shape', () => {
  const proj = buildProjection([], [], null, null);
  const gaps = discoverGaps(proj);
  assert.strictEqual(gaps.schemaVersion, 1);
  assert.strictEqual(typeof gaps.capturedAt, 'string');
  assert.ok(Array.isArray(gaps.signals));
  assert.strictEqual(typeof gaps.summary, 'object');
});

test('discoverGaps: detects blocked lanes', () => {
  const issues = [
    { number: 10, title: 'Blocked A', body: '', labels: [{ name: 'agent:blocked' }] },
    { number: 20, title: 'Blocked B', body: 'blocked reason: waiting on dep', labels: [{ name: 'agent:blocked' }] },
  ];
  const proj = buildProjection(issues, [], null, null);
  const gaps = discoverGaps(proj);
  assert.strictEqual(gaps.summary.blockedCount, 2);
  const blockedSignals = gaps.signals.filter(s => s.type === 'blocked-lane');
  assert.strictEqual(blockedSignals.length, 2);
  assert.strictEqual(blockedSignals[0].issue, 10);
  assert.strictEqual(blockedSignals[1].issue, 20);
  assert.strictEqual(blockedSignals[1].reason, 'waiting on dep');
});

test('discoverGaps: detects empty-ready lane', () => {
  const issues = [
    { number: 1, title: 'Running', body: '', labels: [{ name: 'agent:running' }] },
  ];
  const proj = buildProjection(issues, [], null, null);
  const gaps = discoverGaps(proj, { readyThreshold: 3 });
  assert.strictEqual(gaps.summary.emptyReady, true);
  assert.strictEqual(gaps.summary.readyCount, 0);
  const readySignal = gaps.signals.find(s => s.type === 'empty-ready');
  assert.ok(readySignal !== null);
  assert.strictEqual(readySignal.deficit, 3);
});

test('discoverGaps: no empty-ready when threshold met', () => {
  const issues = [
    { number: 1, title: 'A', body: '', labels: [{ name: 'agent:queued' }] },
    { number: 2, title: 'B', body: '', labels: [{ name: 'agent:queued' }] },
    { number: 3, title: 'C', body: '', labels: [{ name: 'agent:queued' }] },
  ];
  const proj = buildProjection(issues, [], null, null);
  const gaps = discoverGaps(proj, { readyThreshold: 3 });
  assert.strictEqual(gaps.summary.emptyReady, false);
  const readySignal = gaps.signals.find(s => s.type === 'empty-ready');
  assert.strictEqual(readySignal, undefined);
});

test('discoverGaps: detects stale-running with no heartbeat', () => {
  const issues = [{ number: 50, title: 'A', body: '', labels: [{ name: 'agent:running' }] }];
  const workers = { workers: [{ issue: 50, branch: 'b', claimant: 'c', claimedAt: 't' }] };
  const proj = buildProjection(issues, [], workers, null);
  const gaps = discoverGaps(proj);
  const stale = gaps.signals.find(s => s.type === 'stale-running');
  assert.ok(stale !== null);
  assert.strictEqual(stale.reason, 'no-heartbeat');
});

test('discoverGaps: detects stale-running with old heartbeat', () => {
  const issues = [{ number: 60, title: 'A', body: '', labels: [{ name: 'agent:running' }] }];
  const workers = { workers: [{ issue: 60, branch: 'b', claimant: 'c', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:01:00Z', expiresAt: '2026-01-01T01:00:00Z' }] };
  const proj = buildProjection(issues, [], workers, null);
  const now = new Date('2026-01-01T00:15:00Z').getTime();
  const gaps = discoverGaps(proj, { staleHeartbeatMs: 60000, now });
  const stale = gaps.signals.find(s => s.type === 'stale-running');
  assert.ok(stale !== null);
  assert.strictEqual(stale.reason, 'heartbeat-stale');
  assert.strictEqual(stale.ageMinutes, 14);
});

test('discoverGaps: no stale-running with fresh heartbeat', () => {
  const issues = [{ number: 70, title: 'A', body: '', labels: [{ name: 'agent:running' }] }];
  const workers = { workers: [{ issue: 70, branch: 'b', claimant: 'c', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:05:00Z', expiresAt: '2026-01-01T01:00:00Z' }] };
  const proj = buildProjection(issues, [], workers, null);
  const now = new Date('2026-01-01T00:10:00Z').getTime();
  const gaps = discoverGaps(proj, { staleHeartbeatMs: 600000, now });
  const stale = gaps.signals.filter(s => s.type === 'stale-running');
  assert.strictEqual(stale.length, 0);
  assert.strictEqual(gaps.summary.staleRunningCount, 0);
});

test('discoverGaps: excludes discussions from summary', () => {
  const issues = [
    { number: 96, title: 'Discussion', body: '', labels: [{ name: 'discussion' }] },
    { number: 200, title: 'Feature', body: '', labels: [{ name: 'agent:queued' }] },
  ];
  const proj = buildProjection(issues, [], null, null);
  const gaps = discoverGaps(proj);
  assert.strictEqual(gaps.summary.totalTasks, 1);
});

test('discoverGaps: mixed scenario with all signal types', () => {
  const issues = [
    { number: 10, title: 'Blocked', body: '', labels: [{ name: 'agent:blocked' }] },
    { number: 20, title: 'Running stale', body: '', labels: [{ name: 'agent:running' }] },
    { number: 30, title: 'Ready', body: '', labels: [{ name: 'agent:queued' }] },
    { number: 40, title: 'Done', body: '', labels: [{ name: 'agent:done' }] },
  ];
  const workers = { workers: [{ issue: 20, branch: 'b', claimant: 'c', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:01:00Z', expiresAt: '2026-01-01T01:00:00Z' }] };
  const proj = buildProjection(issues, [], workers, null);
  const now = new Date('2026-01-01T00:15:00Z').getTime();
  const gaps = discoverGaps(proj, { readyThreshold: 3, staleHeartbeatMs: 60000, now });
  assert.strictEqual(gaps.summary.blockedCount, 1);
  assert.strictEqual(gaps.summary.readyCount, 1);
  assert.strictEqual(gaps.summary.runningCount, 1);
  assert.strictEqual(gaps.summary.emptyReady, true);
  assert.strictEqual(gaps.summary.staleRunningCount, 1);
  const types = new Set(gaps.signals.map(s => s.type));
  assert.ok(types.has('blocked-lane'));
  assert.ok(types.has('empty-ready'));
  assert.ok(types.has('stale-running'));
});

test('discoverGaps: empty projection', () => {
  const proj = buildProjection([], [], null, null);
  const gaps = discoverGaps(proj);
  assert.strictEqual(gaps.summary.totalTasks, 0);
  assert.strictEqual(gaps.summary.blockedCount, 0);
  assert.strictEqual(gaps.summary.readyCount, 0);
  assert.strictEqual(gaps.summary.emptyReady, true);
  assert.strictEqual(gaps.signals.length, 1);
  assert.strictEqual(gaps.signals[0].type, 'empty-ready');
});

// ── Report ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  project-task-board.test.js`);
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
