#!/usr/bin/env node

/**
 * top-up-self-cycle-queue.js
 *
 * Keeps ready issue count near target concurrency by selecting additional
 * low-risk tasks when active workers drop below target.
 *
 * Reads active-worker count, task-board ready queue, provider pool capacity,
 * risk signals, launch locks, and main health state. Computes the deficit
 * between target concurrency and active workers, then selects eligible tasks
 * from the ready queue respecting conflict groups, locks, risk constraints,
 * and batch size limits.
 *
 * This script is read-only on system state — it never launches workers,
 * modifies issues, or mutates any files.
 *
 * Usage:
 *   node scripts/ai/top-up-self-cycle-queue.js --help
 *   node scripts/ai/top-up-self-cycle-queue.js --stdout
 *   node scripts/ai/top-up-self-cycle-queue.js --fixture <path> --stdout
 *   node scripts/ai/top-up-self-cycle-queue.js --self-test
 *
 * Exit codes:
 *   0 — plan produced
 *   2 — invalid arguments / missing inputs
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const { REPO_ROOT, clamp } = require('./lib');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'self-cycle-topup-plan.json');
const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  activeWorkers: 'active-workers.json',
  taskBoard: 'task-board.json',
  providerPool: 'provider-pool.json',
  riskSignals: 'risk-signals.json',
  launchLocks: 'launch-locks.json',
  mainHealth: 'main-health.json',
};

const DEFAULTS = {
  targetConcurrency: 30,
  minDispatchThreshold: 25,
  topUpBatchSize: 10,
  reducedBatchSize: 5,
  providerCapacityThreshold: 5,
  heldLocksThreshold: 15,
};

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
top-up-self-cycle-queue.js — Self-cycle top-up controller (v${SCHEMA_VERSION})

USAGE
    node scripts/ai/top-up-self-cycle-queue.js [options]

OPTIONS
    --fixture <path>  Path to fixture JSON (skip file reads).
    --stdout          Print JSON to stdout instead of writing file.
    --out <path>      Output path (default: .github/ai-state/self-cycle-topup-plan.json).
    --target <n>      Target concurrency (default: ${DEFAULTS.targetConcurrency}).
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

INPUT FIXTURE FORMAT
    {
      "activeWorkers": { "workers": [...] },
      "taskBoard": { "tasks": [...] },
      "providerPool": { "providers": [...] },
      "riskSignals": { "signals": [...] },
      "launchLocks": { "locks": [...] },
      "mainHealth": { "status": "green" }
    }

    All keys are optional; missing state is treated conservatively.

OUTPUT
    JSON with schemaVersion, capturedAt, target concurrency, active worker
    count, ready count, deficit, selected tasks, blockers, batch size, and
    dispatch recommendation.

EXIT CODES
    0   Plan produced
    2   Invalid arguments / missing inputs
`.trimStart();
  process.stdout.write(help);
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    fixture: null,
    stdout: false,
    out: DEFAULT_OUT,
    target: DEFAULTS.targetConcurrency,
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
    } else if (arg === '--target') {
      i++;
      if (i >= argv.length) { console.error('Error: --target requires a number'); process.exit(2); }
      args.target = parseInt(argv[i], 10);
      if (isNaN(args.target) || args.target < 1) { console.error('Error: --target must be >= 1'); process.exit(2); }
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ── Capacity extraction ─────────────────────────────────────────────────────

/**
 * Count currently active (running/planned) workers.
 */
function countActiveWorkers(activeWorkers) {
  if (!activeWorkers || !Array.isArray(activeWorkers.workers)) return 0;
  return activeWorkers.workers.filter(w =>
    w.status === 'running' || w.status === 'planned'
  ).length;
}

/**
 * Count ready-state tasks from the task board.
 */
function countReadyTasks(taskBoard) {
  if (!taskBoard || !Array.isArray(taskBoard.tasks)) return 0;
  return taskBoard.tasks.filter(t => t.state === 'ready').length;
}

/**
 * Extract available provider capacity (total available slots).
 */
function extractProviderCapacity(pool) {
  if (!pool || !Array.isArray(pool.providers)) return 0;
  let available = 0;
  for (const p of pool.providers) {
    const current = typeof p.currentConcurrency === 'number' ? p.currentConcurrency : 0;
    const max = typeof p.maxConcurrency === 'number' ? p.maxConcurrency : Infinity;
    if (p.status === 'available' && current < max) {
      available += (max - current);
    }
  }
  return available;
}

/**
 * Count held launch locks.
 */
function countHeldLocks(launchLocks) {
  if (!launchLocks || !Array.isArray(launchLocks.locks)) return 0;
  return launchLocks.locks.filter(l => l.status === 'held').length;
}

/**
 * Extract conflict groups from active workers.
 */
function extractActiveConflictGroups(activeWorkers) {
  if (!activeWorkers || !Array.isArray(activeWorkers.workers)) return new Set();
  const groups = new Set();
  for (const w of activeWorkers.workers) {
    if ((w.status === 'running' || w.status === 'planned') && w.conflictGroup) {
      groups.add(w.conflictGroup);
    }
  }
  return groups;
}

/**
 * Extract conflict groups from held locks.
 */
function extractLockedGroups(launchLocks) {
  if (!launchLocks || !Array.isArray(launchLocks.locks)) return new Set();
  const groups = new Set();
  for (const l of launchLocks.locks) {
    if (l.status === 'held' && l.conflictGroup) {
      groups.add(l.conflictGroup);
    }
  }
  return groups;
}

/**
 * Check if main health allows dispatch.
 * green/yellow = ok, red/black = blocked.
 */
function isHealthOk(mainHealth) {
  if (!mainHealth || typeof mainHealth.status !== 'string') return true;
  return mainHealth.status === 'green' || mainHealth.status === 'yellow';
}

/**
 * Check if risk signals permit top-up dispatch.
 * high/critical = blocked, medium = reduced batch, low/none = normal.
 */
function extractRiskLevel(riskSignals) {
  if (!riskSignals || !Array.isArray(riskSignals.signals)) return 'low';
  const hasHigh = riskSignals.signals.some(s => s.severity === 'high' || s.severity === 'critical');
  if (hasHigh) return 'high';
  const hasMedium = riskSignals.signals.some(s => s.severity === 'medium');
  if (hasMedium) return 'medium';
  return 'low';
}

// ── Task selection ───────────────────────────────────────────────────────────

/**
 * Filter task board entries to only top-up eligible tasks.
 * A task is eligible when:
 *   - state is 'ready' or 'todo'
 *   - no linked PR
 *   - conflictGroup not in active workers or held locks
 *   - risk is not 'high'
 */
function selectEligibleTasks(taskBoard, activeGroups, lockedGroups) {
  if (!taskBoard || !Array.isArray(taskBoard.tasks)) return [];

  const excludeStates = new Set(['done', 'archived', 'running', 'blocked', 'discussion/open']);

  return taskBoard.tasks.filter(t => {
    if (excludeStates.has(t.state)) return false;
    if (t.state !== 'ready' && t.state !== 'todo') return false;
    if (t.linkedPR) return false;
    if (t.risk === 'high') return false;
    const group = t.conflictGroup || 'general';
    if (activeGroups.has(group)) return false;
    if (lockedGroups.has(group)) return false;
    return true;
  }).map(t => ({
    issueNumber: t.issue || t.issueNumber,
    conflictGroup: t.conflictGroup || 'general',
    risk: t.risk || 'low',
    state: t.state,
  }));
}

/**
 * Deduplicate by conflict group — pick the first task per group
 * to avoid dispatching conflicting tasks in the same batch.
 */
function deduplicateByConflictGroup(tasks) {
  const seen = new Set();
  const result = [];
  for (const t of tasks) {
    if (!seen.has(t.conflictGroup)) {
      seen.add(t.conflictGroup);
      result.push(t);
    }
  }
  return result;
}

// ── Core planner ─────────────────────────────────────────────────────────────

/**
 * Compute the top-up plan from system facts.
 *
 * @param {object} inputs - System state inputs
 * @param {number} targetConcurrency - Target active worker count
 * @returns {object} Complete top-up plan
 */
function computeTopUpPlan(inputs, targetConcurrency) {
  const activeWorkers = inputs.activeWorkers;
  const taskBoard = inputs.taskBoard;
  const providerPool = inputs.providerPool;
  const riskSignals = inputs.riskSignals;
  const launchLocks = inputs.launchLocks;
  const mainHealth = inputs.mainHealth;

  // Extract signals
  const activeWorkerCount = countActiveWorkers(activeWorkers);
  const readyCount = countReadyTasks(taskBoard);
  const providerCapacity = extractProviderCapacity(providerPool);
  const heldLocks = countHeldLocks(launchLocks);
  const healthOk = isHealthOk(mainHealth);
  const riskLevel = extractRiskLevel(riskSignals);
  const activeGroups = extractActiveConflictGroups(activeWorkers);
  const lockedGroups = extractLockedGroups(launchLocks);

  // Compute deficit
  const deficit = Math.max(0, targetConcurrency - activeWorkerCount);

  // Determine blockers
  const blockers = [];
  if (!healthOk) {
    blockers.push({
      type: 'health-gate',
      message: `Main health is '${mainHealth.status}' — dispatch blocked`,
    });
  }
  if (riskLevel === 'high') {
    blockers.push({
      type: 'risk-gate',
      message: 'High/critical risk signals — dispatch blocked',
    });
  }
  if (providerCapacity === 0) {
    blockers.push({
      type: 'provider-exhausted',
      message: 'No provider capacity available',
    });
  }

  // Determine batch size limits
  let batchSize = DEFAULTS.topUpBatchSize;
  if (providerCapacity < DEFAULTS.providerCapacityThreshold) {
    batchSize = DEFAULTS.reducedBatchSize;
  }
  if (heldLocks > DEFAULTS.heldLocksThreshold) {
    batchSize = Math.min(batchSize, DEFAULTS.reducedBatchSize);
  }
  if (riskLevel === 'medium') {
    batchSize = Math.min(batchSize, DEFAULTS.reducedBatchSize);
  }

  // Select eligible tasks
  const eligible = selectEligibleTasks(taskBoard, activeGroups, lockedGroups);
  const deduplicated = deduplicateByConflictGroup(eligible);

  // Compute how many we can actually dispatch
  const blockedDispatch = blockers.length > 0;
  const slotsToFill = blockedDispatch ? 0 : deficit;
  const selectedTasks = deduplicated.slice(0, Math.min(slotsToFill, batchSize));

  // Dispatch recommendation
  let recommendation;
  if (blockedDispatch) {
    recommendation = 'hold';
  } else if (deficit === 0) {
    recommendation = 'hold';
  } else if (activeWorkerCount < DEFAULTS.minDispatchThreshold) {
    recommendation = 'immediate';
  } else {
    recommendation = 'next-tick';
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    targetConcurrency,
    activeWorkerCount,
    readyCount,
    deficit,
    providerCapacity,
    heldLocks,
    healthOk,
    riskLevel,
    batchSize,
    blockers,
    eligibleTaskCount: eligible.length,
    selectedTaskCount: selectedTasks.length,
    selectedTasks,
    recommendation,
    summary: {
      targetConcurrency,
      activeWorkerCount,
      deficit,
      blocked: blockedDispatch,
      recommendation,
      selectedTaskCount: selectedTasks.length,
    },
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

  // ── countActiveWorkers ──

  assert(countActiveWorkers(null) === 0, 'null workers → 0');
  assert(countActiveWorkers({ workers: [] }) === 0, 'empty workers → 0');
  assert(countActiveWorkers({ workers: [{ status: 'running' }, { status: 'planned' }, { status: 'completed' }] }) === 2, '2 active workers');

  // ── countReadyTasks ──

  assert(countReadyTasks(null) === 0, 'null board → 0');
  assert(countReadyTasks({ tasks: [] }) === 0, 'empty tasks → 0');
  assert(countReadyTasks({ tasks: [{ state: 'ready' }, { state: 'ready' }, { state: 'todo' }] }) === 2, '2 ready tasks');

  // ── extractProviderCapacity ──

  assert(extractProviderCapacity(null) === 0, 'null pool → 0');
  assert(extractProviderCapacity({ providers: [] }) === 0, 'empty providers → 0');
  assert(extractProviderCapacity({
    providers: [
      { status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
      { status: 'available', currentConcurrency: 3, maxConcurrency: 5 },
    ],
  }) === 7, '5+2=7 available capacity');
  assert(extractProviderCapacity({
    providers: [
      { status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 },
    ],
  }) === 0, 'exhausted → 0');

  // ── countHeldLocks ──

  assert(countHeldLocks(null) === 0, 'null locks → 0');
  assert(countHeldLocks({ locks: [] }) === 0, 'empty locks → 0');
  assert(countHeldLocks({ locks: [{ status: 'held' }, { status: 'released' }, { status: 'held' }] }) === 2, '2 held locks');

  // ── extractActiveConflictGroups ──

  assert(extractActiveConflictGroups(null).size === 0, 'null workers → empty groups');
  const groups = extractActiveConflictGroups({
    workers: [
      { status: 'running', conflictGroup: 'auth' },
      { status: 'planned', conflictGroup: 'docs' },
      { status: 'completed', conflictGroup: 'test' },
    ],
  });
  assert(groups.size === 2, '2 active groups');
  assert(groups.has('auth'), 'has auth group');
  assert(groups.has('docs'), 'has docs group');
  assert(!groups.has('test'), 'excludes completed');

  // ── extractLockedGroups ──

  assert(extractLockedGroups(null).size === 0, 'null locks → empty groups');
  assert(extractLockedGroups({ locks: [{ status: 'held', conflictGroup: 'auth' }] }).size === 1, '1 locked group');

  // ── isHealthOk ──

  assert(isHealthOk(null) === true, 'null health → ok');
  assert(isHealthOk({ status: 'green' }) === true, 'green → ok');
  assert(isHealthOk({ status: 'yellow' }) === true, 'yellow → ok');
  assert(isHealthOk({ status: 'red' }) === false, 'red → blocked');
  assert(isHealthOk({ status: 'black' }) === false, 'black → blocked');

  // ── extractRiskLevel ──

  assert(extractRiskLevel(null) === 'low', 'null risk → low');
  assert(extractRiskLevel({ signals: [] }) === 'low', 'empty signals → low');
  assert(extractRiskLevel({ signals: [{ severity: 'high' }] }) === 'high', 'high signal → high');
  assert(extractRiskLevel({ signals: [{ severity: 'critical' }] }) === 'high', 'critical → high');
  assert(extractRiskLevel({ signals: [{ severity: 'medium' }] }) === 'medium', 'medium → medium');
  assert(extractRiskLevel({ signals: [{ severity: 'low' }] }) === 'low', 'low → low');

  // ── selectEligibleTasks ──

  assert(selectEligibleTasks(null, new Set(), new Set()).length === 0, 'null board → empty');
  const board = {
    tasks: [
      { issue: 1, state: 'ready', conflictGroup: 'auth', risk: 'low' },
      { issue: 2, state: 'ready', conflictGroup: 'docs', risk: 'low' },
      { issue: 3, state: 'running', conflictGroup: 'test', risk: 'low' },
      { issue: 4, state: 'done', conflictGroup: 'ai', risk: 'low' },
      { issue: 5, state: 'ready', conflictGroup: 'auth', risk: 'high' },
      { issue: 6, state: 'ready', conflictGroup: 'locked-group', risk: 'low' },
    ],
  };
  const eligible = selectEligibleTasks(board, new Set(['running-group']), new Set(['locked-group']));
  assert(eligible.length === 2, `2 eligible, got ${eligible.length}`);
  assert(eligible[0].issueNumber === 1, 'first eligible is #1');
  assert(eligible[1].issueNumber === 2, 'second eligible is #2');

  // ── deduplicateByConflictGroup ──

  assert(deduplicateByConflictGroup([]).length === 0, 'empty → empty');
  const deduped = deduplicateByConflictGroup([
    { issueNumber: 1, conflictGroup: 'auth' },
    { issueNumber: 2, conflictGroup: 'auth' },
    { issueNumber: 3, conflictGroup: 'docs' },
  ]);
  assert(deduped.length === 2, '2 after dedup');
  assert(deduped[0].issueNumber === 1, 'first auth kept');
  assert(deduped[1].issueNumber === 3, 'docs kept');

  // ── computeTopUpPlan — normal case ──

  const normalPlan = computeTopUpPlan({
    activeWorkers: {
      workers: [
        { status: 'running', conflictGroup: 'a' },
        { status: 'running', conflictGroup: 'b' },
      ],
    },
    taskBoard: {
      tasks: [
        { issue: 10, state: 'ready', conflictGroup: 'c', risk: 'low' },
        { issue: 11, state: 'ready', conflictGroup: 'd', risk: 'low' },
        { issue: 12, state: 'ready', conflictGroup: 'e', risk: 'low' },
      ],
    },
    providerPool: {
      providers: [{ status: 'available', currentConcurrency: 2, maxConcurrency: 30 }],
    },
    riskSignals: { signals: [] },
    launchLocks: { locks: [] },
    mainHealth: { status: 'green' },
  }, 30);

  assert(normalPlan.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof normalPlan.capturedAt === 'string', 'capturedAt is string');
  assert(normalPlan.targetConcurrency === 30, 'target is 30');
  assert(normalPlan.activeWorkerCount === 2, '2 active workers');
  assert(normalPlan.deficit === 28, 'deficit is 28');
  assert(normalPlan.selectedTaskCount === 3, '3 selected tasks');
  assert(normalPlan.recommendation === 'immediate', 'immediate dispatch');
  assert(normalPlan.blockers.length === 0, 'no blockers');

  // ── computeTopUpPlan — health blocked ──

  const healthBlockedPlan = computeTopUpPlan({
    activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
    taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'b', risk: 'low' }] },
    providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
    riskSignals: { signals: [] },
    launchLocks: { locks: [] },
    mainHealth: { status: 'red' },
  }, 30);

  assert(healthBlockedPlan.recommendation === 'hold', 'hold when health red');
  assert(healthBlockedPlan.blockers.length === 1, '1 blocker');
  assert(healthBlockedPlan.blockers[0].type === 'health-gate', 'health blocker');
  assert(healthBlockedPlan.selectedTaskCount === 0, 'no tasks selected when blocked');

  // ── computeTopUpPlan — risk blocked ──

  const riskBlockedPlan = computeTopUpPlan({
    activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
    taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'b', risk: 'low' }] },
    providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
    riskSignals: { signals: [{ severity: 'high' }] },
    launchLocks: { locks: [] },
    mainHealth: { status: 'green' },
  }, 30);

  assert(riskBlockedPlan.recommendation === 'hold', 'hold when high risk');
  assert(riskBlockedPlan.blockers.some(b => b.type === 'risk-gate'), 'risk blocker');

  // ── computeTopUpPlan — at capacity ──

  const atCapPlan = computeTopUpPlan({
    activeWorkers: {
      workers: Array.from({ length: 30 }, () => ({ status: 'running', conflictGroup: 'x' })),
    },
    taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'y', risk: 'low' }] },
    providerPool: { providers: [{ status: 'available', currentConcurrency: 30, maxConcurrency: 30 }] },
    riskSignals: { signals: [] },
    launchLocks: { locks: [] },
    mainHealth: { status: 'green' },
  }, 30);

  assert(atCapPlan.deficit === 0, 'deficit is 0');
  assert(atCapPlan.recommendation === 'hold', 'hold at capacity');
  assert(atCapPlan.selectedTaskCount === 0, 'no tasks at capacity');

  // ── computeTopUpPlan — conflict group filtering ──

  const conflictPlan = computeTopUpPlan({
    activeWorkers: { workers: [{ status: 'running', conflictGroup: 'auth' }] },
    taskBoard: {
      tasks: [
        { issue: 10, state: 'ready', conflictGroup: 'auth', risk: 'low' },
        { issue: 11, state: 'ready', conflictGroup: 'docs', risk: 'low' },
      ],
    },
    providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
    riskSignals: { signals: [] },
    launchLocks: { locks: [] },
    mainHealth: { status: 'green' },
  }, 30);

  assert(conflictPlan.selectedTaskCount === 1, '1 selected (auth filtered)');
  assert(conflictPlan.selectedTasks[0].issueNumber === 11, 'docs task selected');

  // ── computeTopUpPlan — next-tick recommendation ──

  const nextTickPlan = computeTopUpPlan({
    activeWorkers: {
      workers: Array.from({ length: 27 }, (_, i) => ({ status: 'running', conflictGroup: `g${i}` })),
    },
    taskBoard: {
      tasks: [
        { issue: 100, state: 'ready', conflictGroup: 'new-group', risk: 'low' },
      ],
    },
    providerPool: { providers: [{ status: 'available', currentConcurrency: 27, maxConcurrency: 30 }] },
    riskSignals: { signals: [] },
    launchLocks: { locks: [] },
    mainHealth: { status: 'green' },
  }, 30);

  assert(nextTickPlan.deficit === 3, 'deficit is 3');
  assert(nextTickPlan.recommendation === 'next-tick', 'next-tick at 27 workers');
  assert(nextTickPlan.selectedTaskCount === 1, '1 task selected');

  // ── computeTopUpPlan — locked conflict groups ──

  const lockedPlan = computeTopUpPlan({
    activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
    taskBoard: {
      tasks: [
        { issue: 10, state: 'ready', conflictGroup: 'locked', risk: 'low' },
        { issue: 11, state: 'ready', conflictGroup: 'free', risk: 'low' },
      ],
    },
    providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
    riskSignals: { signals: [] },
    launchLocks: { locks: [{ status: 'held', conflictGroup: 'locked' }] },
    mainHealth: { status: 'green' },
  }, 30);

  assert(lockedPlan.selectedTaskCount === 1, '1 selected (locked filtered)');
  assert(lockedPlan.selectedTasks[0].conflictGroup === 'free', 'free group selected');

  // ── computeTopUpPlan — required shape ──

  const requiredKeys = [
    'schemaVersion', 'capturedAt', 'targetConcurrency', 'activeWorkerCount',
    'readyCount', 'deficit', 'providerCapacity', 'heldLocks', 'healthOk',
    'riskLevel', 'batchSize', 'blockers', 'eligibleTaskCount',
    'selectedTaskCount', 'selectedTasks', 'recommendation', 'summary',
  ];
  for (const key of requiredKeys) {
    assert(key in normalPlan, `key ${key} present`);
  }

  // Report
  console.log(`\n  top-up-self-cycle-queue self-test`);
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

  let inputs;

  if (args.fixture) {
    const fixture = readJsonFile(args.fixture);
    if (!fixture) {
      console.error(`Error: Could not read fixture file: ${args.fixture}`);
      process.exit(2);
    }
    inputs = {
      activeWorkers: fixture.activeWorkers || null,
      taskBoard: fixture.taskBoard || null,
      providerPool: fixture.providerPool || null,
      riskSignals: fixture.riskSignals || null,
      launchLocks: fixture.launchLocks || null,
      mainHealth: fixture.mainHealth || null,
    };
  } else {
    inputs = {};
    for (const [key, filename] of Object.entries(INPUT_FILES)) {
      inputs[key] = readJsonFile(path.join(STATE_DIR, filename));
    }
  }

  const plan = computeTopUpPlan(inputs, args.target);
  const json = JSON.stringify(plan, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Self-cycle top-up plan written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

// ── Exports for testing ─────────────────────────────────────────────────────

module.exports = {
  countActiveWorkers,
  countReadyTasks,
  extractProviderCapacity,
  countHeldLocks,
  extractActiveConflictGroups,
  extractLockedGroups,
  isHealthOk,
  extractRiskLevel,
  selectEligibleTasks,
  deduplicateByConflictGroup,
  computeTopUpPlan,
  DEFAULTS,
  SCHEMA_VERSION,
};
