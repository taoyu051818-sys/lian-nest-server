#!/usr/bin/env node

/**
 * plan-concurrency-backfill.js
 *
 * Plans enough independent tasks to reach target concurrency while
 * respecting provider slots, resource slots, conflict groups, locks,
 * risk, review capacity, and failure budget.
 *
 * Reads current system facts and produces a bounded wave plan where
 * tasks sharing the same conflictGroup never run in the same wave,
 * and high-risk tasks are forced to solo waves.
 *
 * This script is read-only on system state — it never launches workers
 * or modifies issues.
 *
 * Usage:
 *   node scripts/ai/plan-concurrency-backfill.js --help
 *   node scripts/ai/plan-concurrency-backfill.js --stdout
 *   node scripts/ai/plan-concurrency-backfill.js --fixture <path> --stdout
 *   node scripts/ai/plan-concurrency-backfill.js --self-test
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
const DEFAULT_OUT = path.join(STATE_DIR, 'concurrency-backfill-plan.json');
const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  taskBoard: 'task-board.json',
  providerPool: 'provider-pool.json',
  localResource: 'local-resource.json',
  activeWorkers: 'active-workers.json',
  riskSignals: 'risk-signals.json',
};

// Defaults for capacity bounds when state files are missing or incomplete.
const DEFAULTS = {
  requestedParallelism: 30,
  reviewCapacity: 5,
  mergeCapacity: 5,
  failureBudget: 3,
};

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
plan-concurrency-backfill.js — Concurrency backfill planner (v${SCHEMA_VERSION})

USAGE
    node scripts/ai/plan-concurrency-backfill.js [options]

OPTIONS
    --fixture <path>  Path to fixture JSON (skip file reads).
    --stdout          Print JSON to stdout instead of writing file.
    --out <path>      Output path (default: .github/ai-state/concurrency-backfill-plan.json).
    --requested <n>   Requested parallelism (default: ${DEFAULTS.requestedParallelism}).
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

INPUT FIXTURE FORMAT
    {
      "taskBoard": { "tasks": [...] },
      "providerPool": { "providers": [...], "global": {...} },
      "localResource": { "process": { "maxAllowed": N }, ... },
      "activeWorkers": { "workers": [...] },
      "riskSignals": { "signals": [...] }
    }

    All keys are optional; missing state is treated conservatively.

OUTPUT
    JSON with schemaVersion, capturedAt, capacity inputs, effective
    parallelism, wave plan, and summary.

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
    requested: DEFAULTS.requestedParallelism,
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
    } else if (arg === '--requested') {
      i++;
      if (i >= argv.length) { console.error('Error: --requested requires a number'); process.exit(2); }
      args.requested = parseInt(argv[i], 10);
      if (isNaN(args.requested) || args.requested < 1) { console.error('Error: --requested must be >= 1'); process.exit(2); }
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
 * Extract provider slot capacity from provider pool state.
 * Returns the number of available provider slots (each slot can run one worker).
 */
function extractProviderSlots(pool) {
  if (!pool || !Array.isArray(pool.providers)) return 0;

  let available = 0;
  for (const p of pool.providers) {
    const current = typeof p.currentConcurrency === 'number' ? p.currentConcurrency : 0;
    const max = typeof p.maxConcurrency === 'number' ? p.maxConcurrency : Infinity;
    if (p.status === 'available' && current < max) {
      available++;
    }
  }
  return available;
}

/**
 * Extract local resource slot capacity.
 * Uses process.maxAllowed as the resource slot count, defaulting to 1 if missing.
 */
function extractResourceSlots(localResource) {
  if (!localResource) return 1;
  const proc = localResource.process;
  if (!proc || typeof proc.maxAllowed !== 'number' || proc.maxAllowed <= 0) return 1;
  return proc.maxAllowed;
}

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
 * Extract risk-safe slots from risk signals.
 * High risk signals reduce the safe parallelism to 1 (solo wave).
 * Medium risk signals cap at half the requested parallelism.
 */
function extractRiskSafeSlots(riskSignals, requested) {
  if (!riskSignals || !Array.isArray(riskSignals.signals)) return requested;

  const hasHigh = riskSignals.signals.some(s => s.severity === 'high' || s.severity === 'critical');
  if (hasHigh) return 1;

  const mediumCount = riskSignals.signals.filter(s => s.severity === 'medium').length;
  if (mediumCount > 0) return Math.max(1, Math.floor(requested / 2));

  return requested;
}

/**
 * Count distinct conflict groups among eligible tasks.
 * Tasks sharing a conflict group must run in separate waves,
 * so the number of distinct groups is the conflict-safe slot count
 * for a single wave.
 */
function countConflictSafeSlots(tasks) {
  const groups = new Set();
  for (const t of tasks) {
    groups.add(t.conflictGroup || 'general');
  }
  return groups.size;
}

// ── Task filtering ───────────────────────────────────────────────────────────

/**
 * Filter task board entries to only executable tasks for backfill planning.
 * Excludes: done, archived, running, blocked, discussion tasks.
 */
function filterExecutableTasks(taskBoard) {
  if (!taskBoard || !Array.isArray(taskBoard.tasks)) return [];

  const excludeStates = new Set(['done', 'archived', 'running', 'blocked', 'discussion/open']);

  return taskBoard.tasks.filter(t => {
    if (excludeStates.has(t.state)) return false;
    if (t.linkedPR) return false;
    return true;
  }).map(t => ({
    issueNumber: t.issue || t.issueNumber,
    conflictGroup: t.conflictGroup || 'general',
    risk: t.risk || 'low',
    state: t.state,
  }));
}

// ── Wave planning ────────────────────────────────────────────────────────────

/**
 * Plan waves of tasks. Tasks with the same conflict group cannot share a wave.
 * High-risk tasks are forced into solo waves.
 *
 * @param {Array} tasks - Executable task descriptors
 * @param {number} effectiveParallelism - Max tasks per wave
 * @returns {Array} Array of wave objects, each containing a tasks array
 */
function planWaves(tasks, effectiveParallelism) {
  if (tasks.length === 0 || effectiveParallelism <= 0) return [];

  // Separate high-risk tasks (solo waves) from normal tasks
  const highRisk = tasks.filter(t => t.risk === 'high');
  const normal = tasks.filter(t => t.risk !== 'high');

  const waves = [];

  // High-risk tasks get solo waves
  for (const task of highRisk) {
    waves.push({
      waveIndex: waves.length,
      tasks: [task],
      isSoloWave: true,
      reason: 'high-risk task forced to solo wave',
    });
  }

  // For normal tasks, use greedy bin-packing by conflict group
  // Each wave tracks which conflict groups are already in it
  const normalWaves = [];
  const remaining = [...normal];

  while (remaining.length > 0) {
    const wave = [];
    const waveGroups = new Set();
    const usedIndices = new Set();

    for (let i = 0; i < remaining.length; i++) {
      if (wave.length >= effectiveParallelism) break;
      const task = remaining[i];
      const group = task.conflictGroup || 'general';
      if (!waveGroups.has(group)) {
        wave.push(task);
        waveGroups.add(group);
        usedIndices.add(i);
      }
    }

    // Remove used tasks
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (usedIndices.has(i)) remaining.splice(i, 1);
    }

    if (wave.length > 0) {
      normalWaves.push(wave);
    } else {
      // Safety: if we can't place any task, break to avoid infinite loop
      break;
    }
  }

  // Merge normal waves into the wave list
  for (const waveTasks of normalWaves) {
    waves.push({
      waveIndex: waves.length,
      tasks: waveTasks,
      isSoloWave: false,
      reason: null,
    });
  }

  return waves;
}

// ── Core planner ─────────────────────────────────────────────────────────────

/**
 * Compute the concurrency backfill plan from system facts.
 *
 * @param {object} inputs - System state inputs
 * @param {number} requestedParallelism - Target parallelism
 * @returns {object} Complete plan with capacity, waves, and summary
 */
function planConcurrencyBackfill(inputs, requestedParallelism) {
  const taskBoard = inputs.taskBoard;
  const providerPool = inputs.providerPool;
  const localResource = inputs.localResource;
  const activeWorkers = inputs.activeWorkers;
  const riskSignals = inputs.riskSignals;

  // Extract capacity inputs
  const providerSlots = extractProviderSlots(providerPool);
  const resourceSlots = extractResourceSlots(localResource);
  const activeWorkerCount = countActiveWorkers(activeWorkers);
  const riskSafeSlots = extractRiskSafeSlots(riskSignals, requestedParallelism);

  // Filter executable tasks
  const executableTasks = filterExecutableTasks(taskBoard);
  const conflictSafeSlots = countConflictSafeSlots(executableTasks);

  // Compute effective parallelism: min of all bounds
  const availableProviderSlots = Math.max(0, providerSlots - activeWorkerCount);
  const effectiveParallelism = Math.max(1, Math.min(
    requestedParallelism,
    availableProviderSlots,
    resourceSlots,
    conflictSafeSlots,
    riskSafeSlots,
    DEFAULTS.reviewCapacity,
    DEFAULTS.mergeCapacity,
    DEFAULTS.failureBudget
  ));

  // Identify limiting factor
  const capacityInputs = {
    requestedParallelism,
    providerSlots: availableProviderSlots,
    resourceSlots,
    conflictSafeSlots,
    riskSafeSlots,
    reviewCapacity: DEFAULTS.reviewCapacity,
    mergeCapacity: DEFAULTS.mergeCapacity,
    failureBudget: DEFAULTS.failureBudget,
  };

  const limitingFactor = identifyLimitingFactor(capacityInputs, effectiveParallelism);

  // Plan waves
  const waves = planWaves(executableTasks, effectiveParallelism);

  // Compute summary
  const totalPlanned = waves.reduce((sum, w) => sum + w.tasks.length, 0);
  const soloWaves = waves.filter(w => w.isSoloWave).length;

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    requestedParallelism,
    effectiveParallelism,
    limitingFactor,
    capacityInputs,
    executableTaskCount: executableTasks.length,
    activeWorkerCount,
    waves,
    summary: {
      totalWaves: waves.length,
      soloWaves,
      parallelWaves: waves.length - soloWaves,
      totalPlannedTasks: totalPlanned,
      effectiveParallelism,
      limitingFactor,
    },
  };
}

/**
 * Identify which capacity input is the binding constraint.
 */
function identifyLimitingFactor(inputs, effective) {
  const factors = [
    { name: 'requestedParallelism', value: inputs.requestedParallelism },
    { name: 'providerSlots', value: inputs.providerSlots },
    { name: 'resourceSlots', value: inputs.resourceSlots },
    { name: 'conflictSafeSlots', value: inputs.conflictSafeSlots },
    { name: 'riskSafeSlots', value: inputs.riskSafeSlots },
    { name: 'reviewCapacity', value: inputs.reviewCapacity },
    { name: 'mergeCapacity', value: inputs.mergeCapacity },
    { name: 'failureBudget', value: inputs.failureBudget },
  ];

  // Find the factor whose value equals the effective parallelism
  // (it's the binding constraint)
  for (const f of factors) {
    if (f.value === effective) return f.name;
  }
  return 'unknown';
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

  // ── extractProviderSlots ──

  assert(extractProviderSlots(null) === 0, 'null pool → 0 slots');
  assert(extractProviderSlots({}) === 0, 'missing providers → 0 slots');
  assert(extractProviderSlots({ providers: [] }) === 0, 'empty providers → 0 slots');

  const availPool = {
    providers: [
      { id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
      { id: 'p2', status: 'available', currentConcurrency: 3, maxConcurrency: 5 },
    ],
  };
  assert(extractProviderSlots(availPool) === 2, '2 available providers');

  const mixedPool = {
    providers: [
      { id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
      { id: 'p2', status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 },
      { id: 'p3', status: 'disabled', currentConcurrency: 0, maxConcurrency: 5 },
    ],
  };
  assert(extractProviderSlots(mixedPool) === 1, '1 available in mixed pool');

  const atCapPool = {
    providers: [
      { id: 'p1', status: 'available', currentConcurrency: 5, maxConcurrency: 5 },
    ],
  };
  assert(extractProviderSlots(atCapPool) === 0, 'at-capacity → 0 slots');

  // ── extractResourceSlots ──

  assert(extractResourceSlots(null) === 1, 'null resource → 1 slot');
  assert(extractResourceSlots({}) === 1, 'missing process → 1 slot');
  assert(extractResourceSlots({ process: { maxAllowed: 12 } }) === 12, 'maxAllowed=12');
  assert(extractResourceSlots({ process: { maxAllowed: 0 } }) === 1, 'maxAllowed=0 → 1');
  assert(extractResourceSlots({ process: { maxAllowed: -1 } }) === 1, 'negative → 1');

  // ── countActiveWorkers ──

  assert(countActiveWorkers(null) === 0, 'null workers → 0');
  assert(countActiveWorkers({ workers: [] }) === 0, 'empty workers → 0');
  assert(countActiveWorkers({ workers: [{ status: 'running' }, { status: 'planned' }, { status: 'completed' }] }) === 2, '2 active workers');

  // ── extractRiskSafeSlots ──

  assert(extractRiskSafeSlots(null, 10) === 10, 'null risk → full requested');
  assert(extractRiskSafeSlots({ signals: [] }, 10) === 10, 'no signals → full requested');
  assert(extractRiskSafeSlots({ signals: [{ severity: 'high' }] }, 10) === 1, 'high risk → 1 slot');
  assert(extractRiskSafeSlots({ signals: [{ severity: 'critical' }] }, 10) === 1, 'critical risk → 1 slot');
  assert(extractRiskSafeSlots({ signals: [{ severity: 'medium' }] }, 10) === 5, 'medium risk → half');
  assert(extractRiskSafeSlots({ signals: [{ severity: 'low' }] }, 10) === 10, 'low risk → full');

  // ── countConflictSafeSlots ──

  assert(countConflictSafeSlots([]) === 0, 'empty tasks → 0 groups');
  assert(countConflictSafeSlots([
    { conflictGroup: 'auth' },
    { conflictGroup: 'auth' },
    { conflictGroup: 'docs' },
  ]) === 2, '2 distinct groups');

  // ── filterExecutableTasks ──

  assert(filterExecutableTasks(null).length === 0, 'null board → empty');
  assert(filterExecutableTasks({ tasks: [] }).length === 0, 'empty tasks → empty');

  const mixedBoard = {
    tasks: [
      { issue: 1, state: 'ready', conflictGroup: 'auth' },
      { issue: 2, state: 'running', conflictGroup: 'docs' },
      { issue: 3, state: 'done', conflictGroup: 'auth' },
      { issue: 4, state: 'todo', conflictGroup: 'test' },
      { issue: 5, state: 'blocked', conflictGroup: 'ai' },
      { issue: 6, state: 'open', conflictGroup: 'docs', linkedPR: 50 },
    ],
  };
  const exec = filterExecutableTasks(mixedBoard);
  assert(exec.length === 2, `2 executable, got ${exec.length}`);
  assert(exec[0].issueNumber === 1, 'first executable is #1');
  assert(exec[1].issueNumber === 4, 'second executable is #4');

  // ── planWaves ──

  assert(planWaves([], 5).length === 0, 'empty tasks → no waves');

  const simpleTasks = [
    { issueNumber: 1, conflictGroup: 'auth', risk: 'low', state: 'ready' },
    { issueNumber: 2, conflictGroup: 'docs', risk: 'low', state: 'ready' },
    { issueNumber: 3, conflictGroup: 'test', risk: 'low', state: 'ready' },
  ];
  const simpleWaves = planWaves(simpleTasks, 10);
  assert(simpleWaves.length === 1, '1 wave for 3 non-conflicting tasks');
  assert(simpleWaves[0].tasks.length === 3, 'all 3 in one wave');
  assert(simpleWaves[0].isSoloWave === false, 'not solo wave');

  // Conflicting tasks
  const conflictTasks = [
    { issueNumber: 1, conflictGroup: 'auth', risk: 'low', state: 'ready' },
    { issueNumber: 2, conflictGroup: 'auth', risk: 'low', state: 'ready' },
    { issueNumber: 3, conflictGroup: 'docs', risk: 'low', state: 'ready' },
  ];
  const conflictWaves = planWaves(conflictTasks, 10);
  assert(conflictWaves.length === 2, '2 waves for conflicting tasks');
  assert(conflictWaves[0].tasks.length === 2, 'wave 0 has 2 tasks');
  assert(conflictWaves[1].tasks.length === 1, 'wave 1 has 1 task');

  // High-risk solo
  const highRiskTasks = [
    { issueNumber: 1, conflictGroup: 'auth', risk: 'high', state: 'ready' },
    { issueNumber: 2, conflictGroup: 'docs', risk: 'low', state: 'ready' },
  ];
  const hrWaves = planWaves(highRiskTasks, 10);
  assert(hrWaves.length === 2, '2 waves (1 solo + 1 normal)');
  assert(hrWaves[0].isSoloWave === true, 'first wave is solo');
  assert(hrWaves[0].tasks[0].risk === 'high', 'solo wave has high-risk task');

  // Parallelism cap
  const capTasks = [
    { issueNumber: 1, conflictGroup: 'a', risk: 'low', state: 'ready' },
    { issueNumber: 2, conflictGroup: 'b', risk: 'low', state: 'ready' },
    { issueNumber: 3, conflictGroup: 'c', risk: 'low', state: 'ready' },
    { issueNumber: 4, conflictGroup: 'd', risk: 'low', state: 'ready' },
  ];
  const capWaves = planWaves(capTasks, 2);
  assert(capWaves.length === 2, '2 waves with parallelism=2');
  assert(capWaves[0].tasks.length === 2, 'wave 0 has 2 tasks');
  assert(capWaves[1].tasks.length === 2, 'wave 1 has 2 tasks');

  // ── planConcurrencyBackfill (integration) ──

  const fullPlan = planConcurrencyBackfill({
    taskBoard: {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'auth' },
        { issue: 2, state: 'ready', conflictGroup: 'auth' },
        { issue: 3, state: 'ready', conflictGroup: 'docs' },
        { issue: 4, state: 'todo', conflictGroup: 'test' },
        { issue: 5, state: 'running', conflictGroup: 'ai' },
      ],
    },
    providerPool: {
      providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 30 }],
    },
    localResource: { process: { maxAllowed: 12 } },
    activeWorkers: { workers: [{ status: 'running', issueNumber: 5 }] },
    riskSignals: { signals: [] },
  }, 30);

  assert(fullPlan.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof fullPlan.capturedAt === 'string', 'capturedAt is string');
  assert(fullPlan.requestedParallelism === 30, 'requested is 30');
  assert(fullPlan.effectiveParallelism >= 1, 'effective >= 1');
  assert(fullPlan.effectiveParallelism <= 30, 'effective <= 30');
  assert(fullPlan.executableTaskCount === 4, '4 executable tasks (running excluded)');
  assert(fullPlan.activeWorkerCount === 1, '1 active worker');
  assert(Array.isArray(fullPlan.waves), 'waves is array');
  assert(fullPlan.waves.length > 0, 'at least 1 wave');
  assert(typeof fullPlan.limitingFactor === 'string', 'limitingFactor is string');
  assert(fullPlan.summary.totalPlannedTasks === 4, '4 planned tasks');
  assert(fullPlan.summary.effectiveParallelism === fullPlan.effectiveParallelism, 'summary matches');

  // Test: no executable tasks
  const emptyPlan = planConcurrencyBackfill({
    taskBoard: { tasks: [{ issue: 1, state: 'done' }] },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 }] },
    localResource: { process: { maxAllowed: 12 } },
    activeWorkers: { workers: [] },
    riskSignals: { signals: [] },
  }, 10);
  assert(emptyPlan.waves.length === 0, 'no waves when no executable tasks');
  assert(emptyPlan.summary.totalPlannedTasks === 0, '0 planned tasks');

  // Test: null inputs
  const nullPlan = planConcurrencyBackfill({
    taskBoard: null,
    providerPool: null,
    localResource: null,
    activeWorkers: null,
    riskSignals: null,
  }, 10);
  assert(nullPlan.effectiveParallelism === 1, 'null inputs → effective=1');
  assert(nullPlan.waves.length === 0, 'no waves with null board');

  // Test: provider exhaustion
  const exhaustPlan = planConcurrencyBackfill({
    taskBoard: { tasks: [{ issue: 1, state: 'ready', conflictGroup: 'a' }] },
    providerPool: { providers: [{ id: 'p1', status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 }] },
    localResource: { process: { maxAllowed: 12 } },
    activeWorkers: { workers: [] },
    riskSignals: { signals: [] },
  }, 10);
  assert(exhaustPlan.effectiveParallelism === 1, 'exhausted provider → effective=1');

  // Test: plan shape has required keys
  const requiredKeys = [
    'schemaVersion', 'capturedAt', 'requestedParallelism',
    'effectiveParallelism', 'limitingFactor', 'capacityInputs',
    'executableTaskCount', 'activeWorkerCount', 'waves', 'summary',
  ];
  for (const key of requiredKeys) {
    assert(key in fullPlan, `key ${key} present`);
  }

  // Report
  console.log(`\n  plan-concurrency-backfill self-test`);
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
      taskBoard: fixture.taskBoard || null,
      providerPool: fixture.providerPool || null,
      localResource: fixture.localResource || null,
      activeWorkers: fixture.activeWorkers || null,
      riskSignals: fixture.riskSignals || null,
    };
  } else {
    inputs = {};
    for (const [key, filename] of Object.entries(INPUT_FILES)) {
      inputs[key] = readJsonFile(path.join(STATE_DIR, filename));
    }
  }

  const plan = planConcurrencyBackfill(inputs, args.requested);
  const json = JSON.stringify(plan, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Concurrency backfill plan written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

// ── Exports for testing ─────────────────────────────────────────────────────

module.exports = {
  extractProviderSlots,
  extractResourceSlots,
  countActiveWorkers,
  extractRiskSafeSlots,
  countConflictSafeSlots,
  filterExecutableTasks,
  planWaves,
  planConcurrencyBackfill,
  identifyLimitingFactor,
  DEFAULTS,
  SCHEMA_VERSION,
};
