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
  { label: 'agent:done',    state: 'done' },
  { label: 'agent:merged',  state: 'done' },
  { label: 'agent:running', state: 'running' },
  { label: 'agent:blocked', state: 'blocked' },
  { label: 'agent:queued',  state: 'ready' },
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
  const match = activeWorkers.workers.find(w => w.issue === issueNum);
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
        conflictGroup: null,
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
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:running' }] }) === 'running', 'agent:running maps to running');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:blocked' }] }) === 'blocked', 'agent:blocked maps to blocked');
  assert(mapState({ number: 1, title: '', labels: [{ name: 'agent:queued' }] }) === 'ready', 'agent:queued maps to ready');
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
  ];
  const testPRs = [{ number: 50, title: 'feat', body: 'Closes #275', headRefName: '' }];
  const testWorkers = { workers: [{ issue: 200, branch: 'claude/w1', claimant: 'backend', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }, { issue: 258, branch: 'claude/w2', claimant: 'backend', claimedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:15:00Z', expiresAt: '2026-01-01T01:30:00Z' }] };
  const { tasks, discussions } = projectTasks(testIssues, testPRs, testWorkers, null);

  assert(discussions.length === 1, `1 discussion, got ${discussions.length}`);
  assert(discussions[0].issue === 96, 'discussion is #96');
  assert(discussions[0].state === 'discussion/open', 'discussion state');

  assert(tasks.length === 5, `5 tasks, got ${tasks.length}`);

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

  // Test: buildProjection shape
  const proj = buildProjection(testIssues, testPRs, testWorkers, null);
  assert(proj.markerVersion === 1, 'markerVersion is 1');
  assert(typeof proj.capturedAt === 'string', 'capturedAt is string');
  assert(Array.isArray(proj.tasks), 'tasks is array');
  assert(proj.tasks.length === 6, 'total tasks includes discussions');

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
};
