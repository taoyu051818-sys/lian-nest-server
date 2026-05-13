#!/usr/bin/env node

/**
 * project-task-board.js
 *
 * Projects issues, PRs, and worker process facts into a Hermes-style
 * task board. Read-only — produces a JSON projection consumed by the
 * Command Steward, orchestrator, and launch gate.
 *
 * Usage:
 *   node scripts/ai/project-task-board.js [options]
 *
 * Options:
 *   --fixture <path>  Path to fixture JSON (required; no network)
 *   --stdout          Print JSON to stdout
 *   --out <path>      Output file path
 *   --self-test       Run built-in assertions and exit
 *   --help            Show usage
 *
 * Exit codes:
 *   0 — projection produced
 *   2 — invalid arguments / fixture error
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'task-board.json');
const MARKER_VERSION = 1;

// Labels that map to projection states (checked in priority order)
const STATE_LABEL_MAP = [
  { label: 'agent:done',     state: 'done' },
  { label: 'agent:merged',   state: 'done' },
  { label: 'agent:archived', state: 'archived' },
  { label: 'agent:running',  state: 'running' },
  { label: 'agent:blocked',  state: 'blocked' },
  { label: 'agent:queued',   state: 'ready' },
  { label: 'agent:todo',     state: 'todo' },
  { label: 'agent:triage',   state: 'triage' },
];

// Labels that mark an issue as non-executable (discussion / tracking)
const NON_TASK_LABELS = [
  'discussion',
  'human-required',
  'umbrella',
];

// Title patterns for non-executable issues
const NON_TASK_TITLE_PATTERNS = [
  /\bumbrella\b/i,
  /\bdiscussion\b/i,
  /\bmeta\b/i,
  /\brfc\b/i,
  /\bproposal\b/i,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
project-task-board.js — Hermes-style task board projector (v1)

USAGE
    node scripts/ai/project-task-board.js [options]

OPTIONS
    --fixture <path>  Path to fixture JSON (required).
    --stdout          Print JSON to stdout instead of writing file.
    --out <path>      Output path (default: .github/ai-state/task-board.json).
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

INPUT FIXTURE FORMAT
    {
      "issues": [...],
      "openPRs": [...],
      "activeWorkers": { "workers": [...] },
      "launchLocks": { "locks": [...] }
    }

    activeWorkers and launchLocks are optional.

OUTPUT
    Sanitized JSON matching the task-board-projection.md schema.

EXIT CODES
    0   Projection produced
    2   Invalid arguments / fixture error
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    fixture: null,
    stdout: false,
    out: DEFAULT_OUT,
    selfTest: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture') {
      i++;
      if (i >= argv.length) { console.error('Error: --fixture requires a path'); process.exit(2); }
      args.fixture = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ── Sanitization ─────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === 'string') {
    if (value.length > 500) return value.slice(0, 500) + '…';
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some(p => p.test(key))) continue;
    result[key] = sanitizeValue(value);
  }
  return result;
}

// ── Label extraction ─────────────────────────────────────────────────────────

function getLabelNames(issue) {
  const labels = issue.labels || [];
  return labels.map(l => typeof l === 'string' ? l : (l.name || ''));
}

// ── State mapping ────────────────────────────────────────────────────────────

function isNonTask(issue) {
  const labels = getLabelNames(issue);
  if (labels.some(l => NON_TASK_LABELS.includes(l))) return true;
  const title = issue.title || '';
  if (NON_TASK_TITLE_PATTERNS.some(p => p.test(title))) return true;
  return false;
}

function mapState(issue) {
  const labels = getLabelNames(issue);
  for (const { label, state } of STATE_LABEL_MAP) {
    if (labels.includes(label)) return state;
  }
  return 'open';
}

// ── PR linkage ───────────────────────────────────────────────────────────────

function findLinkedPR(issue, openPRs) {
  const issueNum = issue.number;
  const match = openPRs.find(pr => {
    const body = (pr.body || '').toLowerCase();
    const title = (pr.title || '').toLowerCase();
    const pattern = new RegExp(`(?:#|closes|fixes|resolves)\\s*${issueNum}\\b`, 'i');
    return pattern.test(body) || pattern.test(title);
  });
  return match ? match.number : null;
}

// ── Worker lookup ────────────────────────────────────────────────────────────

function findWorker(issue, activeWorkers) {
  if (!activeWorkers || !Array.isArray(activeWorkers.workers)) return null;
  const issueNum = issue.number;
  const match = activeWorkers.workers.find(w => (w.issueNumber ?? w.issue) === issueNum);
  if (!match) return null;
  return {
    branch: match.branch || null,
    claimant: match.claimant || match.workerClass || 'unknown',
    claimedAt: match.claimedAt || null,
    lastHeartbeat: match.lastHeartbeat || null,
    expiresAt: match.expiresAt || null,
  };
}

// ── Project tasks ────────────────────────────────────────────────────────────

function projectTasks(issues, openPRs, activeWorkers, launchLocks) {
  const tasks = [];
  const discussions = [];

  for (const issue of issues) {
    if (isNonTask(issue)) {
      discussions.push({
        issue: issue.number,
        state: 'discussion/open',
        conflictGroup: inferConflictGroup(issue),
        worker: null,
        blockedReason: null,
        linkedPR: null,
      });
      continue;
    }

    const state = mapState(issue);
    const linkedPR = findLinkedPR(issue, openPRs);
    const worker = (state === 'running' || state === 'blocked' || state === 'ready')
      ? findWorker(issue, activeWorkers)
      : null;

    tasks.push({
      issue: issue.number,
      state,
      conflictGroup: inferConflictGroup(issue),
      worker,
      blockedReason: state === 'blocked' ? inferBlockedReason(issue) : null,
      linkedPR,
    });
  }

  return { tasks, discussions };
}

function inferConflictGroup(issue) {
  const body = issue.body || '';
  const title = issue.title || '';
  const combined = `${title} ${body}`.toLowerCase();

  // Match "conflictGroup:" or "conflict group:" (case-insensitive)
  const cgMatch = combined.match(/conflict\s*group:\s*([a-z0-9-]+)/i);
  if (cgMatch) return cgMatch[1];
  if (combined.includes('auth')) return 'auth';
  if (combined.includes('prisma') || combined.includes('schema')) return 'schema';
  if (combined.includes('docs') || combined.includes('documentation')) return 'docs';
  if (combined.includes('test') || combined.includes('spec')) return 'test';
  if (combined.includes('scripts/ai') || combined.includes('ai-native')) return 'ai-native-docs';
  return 'general';
}

function inferBlockedReason(issue) {
  const body = issue.body || '';
  const match = body.match(/blocked(?:\s*reason)?[:\s]+(.+)/i);
  if (match) return match[1].trim().slice(0, 200);
  const labelMatch = getLabelNames(issue).find(l => l.startsWith('blocked:'));
  if (labelMatch) return labelMatch.replace('blocked:', '').trim();
  return 'blocked (reason not specified)';
}

// ── Build output ─────────────────────────────────────────────────────────────

function buildProjection(issues, openPRs, activeWorkers, launchLocks) {
  const { tasks, discussions } = projectTasks(issues, openPRs, activeWorkers, launchLocks);

  return {
    markerVersion: MARKER_VERSION,
    capturedAt: new Date().toISOString(),
    tasks: [...tasks, ...discussions],
  };
}

// ── Gap discovery ────────────────────────────────────────────────────────────

const DEFAULT_READY_THRESHOLD = 3;
const DEFAULT_STALE_HEARTBEAT_MS = 10 * 60 * 1000; // 10 minutes

function discoverGaps(projection, options) {
  const opts = options || {};
  const readyThreshold = opts.readyThreshold || DEFAULT_READY_THRESHOLD;
  const staleHeartbeatMs = opts.staleHeartbeatMs || DEFAULT_STALE_HEARTBEAT_MS;
  const now = opts.now || Date.now();

  const tasks = (projection.tasks || []).filter(t => t.state !== 'discussion/open');

  // Count tasks per state
  const laneCounts = {};
  for (const t of tasks) {
    laneCounts[t.state] = (laneCounts[t.state] || 0) + 1;
  }

  const signals = [];

  // 1. Blocked lanes
  const blocked = tasks.filter(t => t.state === 'blocked');
  for (const t of blocked) {
    signals.push({
      type: 'blocked-lane',
      issue: t.issue,
      reason: t.blockedReason || 'unknown',
      conflictGroup: t.conflictGroup,
    });
  }

  // 2. Empty-ready lane
  const readyCount = laneCounts['ready'] || 0;
  if (readyCount < readyThreshold) {
    signals.push({
      type: 'empty-ready',
      readyCount,
      threshold: readyThreshold,
      deficit: readyThreshold - readyCount,
    });
  }

  // 3. Stale-running lanes
  const running = tasks.filter(t => t.state === 'running');
  for (const t of running) {
    if (!t.worker || !t.worker.lastHeartbeat) {
      signals.push({
        type: 'stale-running',
        issue: t.issue,
        conflictGroup: t.conflictGroup,
        reason: 'no-heartbeat',
      });
      continue;
    }
    const heartbeatTime = new Date(t.worker.lastHeartbeat).getTime();
    if (isNaN(heartbeatTime)) {
      signals.push({
        type: 'stale-running',
        issue: t.issue,
        conflictGroup: t.conflictGroup,
        reason: 'invalid-heartbeat',
      });
      continue;
    }
    const ageMs = now - heartbeatTime;
    if (ageMs > staleHeartbeatMs) {
      signals.push({
        type: 'stale-running',
        issue: t.issue,
        conflictGroup: t.conflictGroup,
        reason: 'heartbeat-stale',
        ageMinutes: Math.round(ageMs / 60000),
      });
    }
  }

  // Summary
  const summary = {
    totalTasks: tasks.length,
    laneCounts,
    blockedCount: blocked.length,
    readyCount,
    runningCount: running.length,
    staleRunningCount: signals.filter(s => s.type === 'stale-running').length,
    emptyReady: readyCount < readyThreshold,
  };

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    summary,
    signals,
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (!condition) {
      failed++;
      console.error(`  FAIL: ${msg}`);
    } else {
      passed++;
    }
  }

  // Test: isNonTask with discussion label
  assert(isNonTask({ number: 96, title: 'Roadmap', body: '', labels: [{ name: 'discussion' }] }), 'discussion label is non-task');

  // Test: isNonTask with umbrella title
  assert(isNonTask({ number: 100, title: 'Umbrella: refactor auth', body: '', labels: [] }), 'umbrella title is non-task');

  // Test: isNonTask with human-required label
  assert(isNonTask({ number: 101, title: 'Decide', body: '', labels: [{ name: 'human-required' }] }), 'human-required is non-task');

  // Test: normal issue is a task
  assert(!isNonTask({ number: 200, title: 'Add feature', body: '', labels: [] }), 'normal issue is a task');

  // Test: mapState for each label
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:done' }] }) === 'done', 'agent:done maps to done');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:merged' }] }) === 'done', 'agent:merged maps to done');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:archived' }] }) === 'archived', 'agent:archived maps to archived');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:running' }] }) === 'running', 'agent:running maps to running');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:blocked' }] }) === 'blocked', 'agent:blocked maps to blocked');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:queued' }] }) === 'ready', 'agent:queued maps to ready');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:todo' }] }) === 'todo', 'agent:todo maps to todo');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:triage' }] }) === 'triage', 'agent:triage maps to triage');
  assert(mapState({ number: 1, title: '', labels: [] }) === 'open', 'no label maps to open');

  // Test: mapState with string labels
  assert(mapState({ number: 1, title: '', labels: ['agent:running'] }) === 'running', 'string label works');

  // Test: findLinkedPR
  const prs = [{ number: 50, title: 'feat', body: 'Closes #200', headRefName: '' }];
  assert(findLinkedPR({ number: 200 }, prs) === 50, 'finds linked PR');
  assert(findLinkedPR({ number: 999 }, prs) === null, 'no linked PR');
  assert(findLinkedPR({ number: 200 }, []) === null, 'empty PRs');

  // Test: findWorker
  const workers = { workers: [{ issue: 258, branch: 'claude/wave6', claimant: 'backend-programmer', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }] };
  const w = findWorker({ number: 258 }, workers);
  assert(w !== null, 'finds worker');
  assert(w.branch === 'claude/wave6', 'worker branch');
  assert(w.claimant === 'backend-programmer', 'worker claimant');
  assert(findWorker({ number: 999 }, workers) === null, 'no worker for issue');

  // Test: findWorker with issueNumber (real manifest contract)
  const issueNumberWorkers = { workers: [{ issueNumber: 258, branch: 'claude/wave6', claimant: 'backend-programmer', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }] };
  const w2 = findWorker({ number: 258 }, issueNumberWorkers);
  assert(w2 !== null, 'finds worker by issueNumber');
  assert(w2.branch === 'claude/wave6', 'issueNumber worker branch');

  // Test: findWorker with null activeWorkers
  assert(findWorker({ number: 1 }, null) === null, 'null activeWorkers');

  // Test: inferConflictGroup
  assert(inferConflictGroup({ number: 1, title: '', body: 'conflictGroup: auth-core' }) === 'auth-core', 'explicit conflict group');
  assert(inferConflictGroup({ number: 1, title: 'Fix auth', body: '' }) === 'auth', 'auth inferred');
  assert(inferConflictGroup({ number: 1, title: 'Add test', body: '' }) === 'test', 'test inferred');
  assert(inferConflictGroup({ number: 1, title: 'Update docs', body: '' }) === 'docs', 'docs inferred');
  assert(inferConflictGroup({ number: 1, title: 'Something', body: '' }) === 'general', 'default general');

  // Test: projectTasks with mixed issues
  const testIssues = [
    { number: 96, title: 'Roadmap discussion', body: '', labels: [{ name: 'discussion' }] },
    { number: 200, title: 'Feature A', body: '', labels: [{ name: 'agent:running' }] },
    { number: 258, title: 'Feature B', body: '', labels: [{ name: 'agent:queued' }] },
    { number: 275, title: 'Feature C', body: '', labels: [{ name: 'agent:done' }] },
    { number: 310, title: 'Feature D', body: '', labels: [{ name: 'agent:blocked' }] },
    { number: 400, title: 'New feature', body: '', labels: [] },
    { number: 410, title: 'Triage me', body: '', labels: [{ name: 'agent:triage' }] },
    { number: 420, title: 'Backlog item', body: '', labels: [{ name: 'agent:todo' }] },
    { number: 430, title: 'Old feature', body: '', labels: [{ name: 'agent:archived' }] },
  ];
  const testPRs = [{ number: 50, title: 'feat', body: 'Closes #275', headRefName: '' }];
  const testWorkers = { workers: [{ issue: 200, branch: 'claude/w1', claimant: 'backend', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }, { issue: 258, branch: 'claude/w2', claimant: 'backend', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }] };
  const { tasks, discussions } = projectTasks(testIssues, testPRs, testWorkers, null);

  assert(discussions.length === 1, `1 discussion, got ${discussions.length}`);
  assert(discussions[0].issue === 96, 'discussion is #96');
  assert(discussions[0].state === 'discussion/open', 'discussion state');
  assert(typeof discussions[0].conflictGroup === 'string' && discussions[0].conflictGroup.length > 0, 'discussion has conflictGroup');

  assert(tasks.length === 8, `8 tasks, got ${tasks.length}`);

  const t200 = tasks.find(t => t.issue === 200);
  assert(t200.state === 'running', '#200 is running');
  assert(t200.worker !== null, '#200 has worker');
  assert(t200.worker.branch === 'claude/w1', '#200 worker branch');

  const t258 = tasks.find(t => t.issue === 258);
  assert(t258.state === 'ready', '#258 is ready');
  assert(t258.worker !== null, '#258 has worker');

  const t275 = tasks.find(t => t.issue === 275);
  assert(t275.state === 'done', '#275 is done');
  assert(t275.linkedPR === 50, '#275 linked to PR 50');
  assert(t275.worker === null, '#275 has no worker');

  const t310 = tasks.find(t => t.issue === 310);
  assert(t310.state === 'blocked', '#310 is blocked');
  assert(t310.blockedReason !== null, '#310 has blocked reason');

  const t400 = tasks.find(t => t.issue === 400);
  assert(t400.state === 'open', '#400 is open');
  assert(t400.worker === null, '#400 has no worker');
  assert(t400.linkedPR === null, '#400 has no linked PR');

  const t410 = tasks.find(t => t.issue === 410);
  assert(t410.state === 'triage', '#410 is triage');
  assert(t410.worker === null, '#410 has no worker');

  const t420 = tasks.find(t => t.issue === 420);
  assert(t420.state === 'todo', '#420 is todo');
  assert(t420.worker === null, '#420 has no worker');

  const t430 = tasks.find(t => t.issue === 430);
  assert(t430.state === 'archived', '#430 is archived');
  assert(t430.worker === null, '#430 has no worker');

  // Test: buildProjection shape
  const proj = buildProjection(testIssues, testPRs, testWorkers, null);
  assert(proj.markerVersion === 1, 'markerVersion is 1');
  assert(typeof proj.capturedAt === 'string', 'capturedAt is string');
  assert(Array.isArray(proj.tasks), 'tasks is array');
  assert(proj.tasks.length === 9, 'total tasks includes discussions');

  // Test: empty input
  const emptyProj = buildProjection([], [], null, null);
  assert(emptyProj.tasks.length === 0, 'empty input produces empty tasks');
  assert(emptyProj.markerVersion === 1, 'empty markerVersion');

  // Test: sanitization strips secrets
  const secretIssue = [{ number: 500, title: 'Feature', body: 'token: abc123secret', labels: [] }];
  const secretProj = buildProjection(secretIssue, [], null, null);
  const json = JSON.stringify(secretProj);
  assert(!json.includes('abc123secret'), 'secrets sanitized');

  // Test: string labels work (not just object labels)
  const stringLabelIssue = [{ number: 600, title: 'Feature', body: '', labels: ['agent:done'] }];
  const stringProj = buildProjection(stringLabelIssue, [], null, null);
  assert(stringProj.tasks[0].state === 'done', 'string label maps to done');

  // Test: discoverGaps with mixed states
  const gapIssues = [
    { number: 10, title: 'A', body: '', labels: [{ name: 'agent:blocked' }] },
    { number: 20, title: 'B', body: '', labels: [{ name: 'agent:running' }] },
    { number: 30, title: 'C', body: '', labels: [{ name: 'agent:queued' }] },
  ];
  const gapWorkers = { workers: [{ issue: 20, branch: 'b', claimant: 'c', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:01:00Z', expiresAt: '2026-01-01T01:00:00Z' }] };
  const gapProj = buildProjection(gapIssues, [], gapWorkers, null);
  const gaps = discoverGaps(gapProj, { readyThreshold: 3, staleHeartbeatMs: 60000, now: new Date('2026-01-01T00:15:00Z').getTime() });
  assert(gaps.schemaVersion === 1, 'discoverGaps schemaVersion');
  assert(Array.isArray(gaps.signals), 'discoverGaps signals is array');
  assert(gaps.summary.blockedCount === 1, '1 blocked');
  assert(gaps.summary.readyCount === 1, '1 ready');
  assert(gaps.summary.emptyReady === true, 'empty-ready detected');
  assert(gaps.summary.staleRunningCount === 1, '1 stale-running');
  const blockedSignal = gaps.signals.find(s => s.type === 'blocked-lane');
  assert(blockedSignal && blockedSignal.issue === 10, 'blocked signal for #10');
  const staleSignal = gaps.signals.find(s => s.type === 'stale-running');
  assert(staleSignal && staleSignal.issue === 20, 'stale signal for #20');
  const readySignal = gaps.signals.find(s => s.type === 'empty-ready');
  assert(readySignal && readySignal.deficit === 2, 'ready deficit is 2');

  // Test: discoverGaps with sufficient ready
  const fullReadyIssues = [
    { number: 1, title: 'A', body: '', labels: [{ name: 'agent:queued' }] },
    { number: 2, title: 'B', body: '', labels: [{ name: 'agent:queued' }] },
    { number: 3, title: 'C', body: '', labels: [{ name: 'agent:queued' }] },
  ];
  const fullProj = buildProjection(fullReadyIssues, [], null, null);
  const fullGaps = discoverGaps(fullProj, { readyThreshold: 3 });
  assert(fullGaps.summary.emptyReady === false, 'ready not empty when threshold met');
  assert(fullGaps.signals.every(s => s.type !== 'empty-ready'), 'no empty-ready signal');

  // Test: discoverGaps with healthy running
  const healthyIssues = [
    { number: 50, title: 'A', body: '', labels: [{ name: 'agent:running' }] },
  ];
  const healthyWorkers = { workers: [{ issue: 50, branch: 'b', claimant: 'c', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:05:00Z', expiresAt: '2026-01-01T01:00:00Z' }] };
  const healthyProj = buildProjection(healthyIssues, [], healthyWorkers, null);
  const healthyGaps = discoverGaps(healthyProj, { now: new Date('2026-01-01T00:10:00Z').getTime() });
  assert(healthyGaps.summary.staleRunningCount === 0, 'no stale when heartbeat fresh');

  // Report
  console.log(`\n  project-task-board self-test`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\n  Some self-tests failed.\n`);
    process.exit(1);
  } else {
    console.log(`\n  All self-tests passed.\n`);
    process.exit(0);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  if (!args.fixture) {
    console.error('Error: --fixture is required. This script is fixture-driven (no network).');
    process.exit(2);
  }

  const fixture = readJsonFile(args.fixture);
  if (!fixture || !Array.isArray(fixture.issues)) {
    console.error('Error: fixture must contain an "issues" array.');
    process.exit(2);
  }

  const issues = fixture.issues;
  const openPRs = fixture.openPRs || [];
  const activeWorkers = fixture.activeWorkers || null;
  const launchLocks = fixture.launchLocks || null;

  const projection = buildProjection(issues, openPRs, activeWorkers, launchLocks);
  const json = JSON.stringify(projection, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Task board written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  isNonTask,
  mapState,
  findLinkedPR,
  findWorker,
  inferConflictGroup,
  inferBlockedReason,
  projectTasks,
  buildProjection,
  discoverGaps,
};
