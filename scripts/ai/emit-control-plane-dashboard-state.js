#!/usr/bin/env node

/**
 * emit-control-plane-dashboard-state.js
 *
 * Reads all control-plane state projections from .github/ai-state/ and
 * combines them into a single WebUI-safe dashboard state snapshot.
 *
 * Input sources (all optional — absent files produce null/empty defaults):
 *   main-health.json       — MainHealthState (health gate output)
 *   provider-pool.json     — ProviderPoolState (provider availability)
 *   local-resource.json    — LocalResource (resource inventory)
 *   active-workers.json    — ActiveWorkers (in-flight workers)
 *   worker-trust.json      — WorkerTrust (trust scores & scheduling)
 *   meta-signals.json      — MetaSignals (aggregate health signals)
 *   queue-state.json       — WebUIQueueState (queue lifecycle entries)
 *
 * Safe skeleton: when an input file is missing or malformed, the
 * corresponding section is null so downstream consumers never break.
 *
 * Default mode is dry-run: prints a preview to stdout without writing.
 * Pass --live to persist the snapshot to the output file.
 *
 * Usage:
 *   node scripts/ai/emit-control-plane-dashboard-state.js --help
 *   node scripts/ai/emit-control-plane-dashboard-state.js
 *   node scripts/ai/emit-control-plane-dashboard-state.js --live
 *   node scripts/ai/emit-control-plane-dashboard-state.js --stdout
 *
 * Exit codes:
 *   0 — snapshot produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'dashboard-state.json');

const SCHEMA_VERSION = 2;

const INPUT_FILES = {
  health:        'main-health.json',
  providerPool:  'provider-pool.json',
  resources:     'local-resource.json',
  activeWorkers: 'active-workers.json',
  workerTrust:   'worker-trust.json',
  metaSignals:   'meta-signals.json',
  queue:         'queue-state.json',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
emit-control-plane-dashboard-state.js — Dashboard state emitter (v2)

USAGE
    node scripts/ai/emit-control-plane-dashboard-state.js [options]

OPTIONS
    --live          Write the snapshot to the output file.
                    Without this flag, the script runs in dry-run mode
                    and prints a preview to stdout without writing.
    --out <path>    Output path for the dashboard state JSON.
                    (default: .github/ai-state/dashboard-state.json)
    --stdout        Print JSON to stdout instead of writing a file.
                    Overrides --out. Always prints regardless of --live.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

INPUT FILES (all optional — absent files produce null/empty defaults)
    .github/ai-state/main-health.json      MainHealthState
    .github/ai-state/provider-pool.json    ProviderPoolState
    .github/ai-state/local-resource.json   LocalResource
    .github/ai-state/active-workers.json   ActiveWorkers
    .github/ai-state/worker-trust.json     WorkerTrust
    .github/ai-state/meta-signals.json     MetaSignals
    .github/ai-state/queue-state.json      WebUIQueueState

EXIT CODES
    0   Snapshot produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    live: false,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
    selfTest: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--live') {
      args.live = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
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

// ── Action readiness ─────────────────────────────────────────────────────────

const ACTION_IDS = [
  'launch-worker',
  'merge-pr',
  'retry-failed',
  'drain-queue',
];

function computeActionReadiness({ health, providerPool, workerTrust, metaSignals, queue }) {
  const healthState = health && health.state ? health.state : 'unknown';
  const isHealthy = healthState === 'green' || healthState === 'yellow';
  const isBlocked = !isHealthy;

  const availableProviders = providerPool && providerPool.global
    ? (providerPool.global.availableProviders || 0)
    : 0;

  const minTrust = workerTrust && workerTrust.scheduling
    ? workerTrust.scheduling.minTrustToLaunch
    : null;

  const trust = metaSignals && metaSignals.signals
    ? metaSignals.signals.trust
    : null;

  const riskScore = metaSignals && metaSignals.signals
    ? metaSignals.signals.riskScore
    : 0;

  const queueSummary = queue && queue.summary ? queue.summary : null;
  const queuedCount = queueSummary ? (queueSummary.queued || 0) : 0;
  const blockedCount = queueSummary ? (queueSummary.blocked || 0) : 0;
  const runningCount = queueSummary ? (queueSummary.running || 0) : 0;

  const healthBlockedReason = isBlocked
    ? (healthState === 'unknown' ? 'health state unknown' : `health state is ${healthState}`)
    : null;

  function computeLaunchWorker() {
    const reasons = [];
    if (isBlocked) reasons.push(healthBlockedReason);
    if (availableProviders === 0) reasons.push('no available providers');
    if (minTrust !== null && trust !== null && trust < minTrust) {
      reasons.push(`trust ${trust} below minimum ${minTrust}`);
    }
    return { id: 'launch-worker', ready: reasons.length === 0, blockedReasons: reasons };
  }

  function computeMergePr() {
    const reasons = [];
    if (isBlocked) reasons.push(healthBlockedReason);
    if (riskScore > 80) reasons.push(`risk score ${riskScore} exceeds threshold 80`);
    return { id: 'merge-pr', ready: reasons.length === 0, blockedReasons: reasons };
  }

  function computeRetryFailed() {
    const reasons = [];
    if (isBlocked) reasons.push(healthBlockedReason);
    if (blockedCount === 0 && queuedCount === 0) reasons.push('no failed or blocked entries');
    return { id: 'retry-failed', ready: reasons.length === 0, blockedReasons: reasons };
  }

  function computeDrainQueue() {
    const reasons = [];
    if (isBlocked) reasons.push(healthBlockedReason);
    if (queuedCount === 0 && runningCount === 0) reasons.push('queue is empty');
    if (availableProviders === 0) reasons.push('no available providers');
    return { id: 'drain-queue', ready: reasons.length === 0, blockedReasons: reasons };
  }

  const actionFns = {
    'launch-worker': computeLaunchWorker,
    'merge-pr': computeMergePr,
    'retry-failed': computeRetryFailed,
    'drain-queue': computeDrainQueue,
  };

  const actions = ACTION_IDS.map(id => actionFns[id]());
  const readyCount = actions.filter(a => a.ready).length;

  return {
    actions,
    readyCount,
    totalActions: actions.length,
    allReady: readyCount === actions.length,
  };
}

// ── Audit summary ────────────────────────────────────────────────────────────

function computeAuditSummary(queue) {
  if (!queue || !Array.isArray(queue.entries) || queue.entries.length === 0) {
    return {
      totalEntries: 0,
      byState: { queued: 0, launching: 0, running: 0, prCreated: 0, blocked: 0, done: 0 },
      lastActivityAt: null,
      blockedReasons: [],
    };
  }

  const entries = queue.entries;
  const byState = { queued: 0, launching: 0, running: 0, prCreated: 0, blocked: 0, done: 0 };
  let lastActivityAt = null;
  const blockedReasons = [];

  for (const entry of entries) {
    const state = entry.state || 'unknown';
    if (state in byState) byState[state]++;

    if (entry.updatedAt) {
      if (!lastActivityAt || entry.updatedAt > lastActivityAt) {
        lastActivityAt = entry.updatedAt;
      }
    }

    if (state === 'blocked' && entry.blockedReason) {
      blockedReasons.push(entry.blockedReason);
    }
  }

  return {
    totalEntries: entries.length,
    byState,
    lastActivityAt,
    blockedReasons: [...new Set(blockedReasons)],
  };
}

// ── Build dashboard state ────────────────────────────────────────────────────

function buildDashboardState(inputs) {
  const health = inputs.health;
  const providerPool = inputs.providerPool;
  const resources = inputs.resources;
  const activeWorkers = inputs.activeWorkers;
  const workerTrust = inputs.workerTrust;
  const metaSignals = inputs.metaSignals;
  const queue = inputs.queue;

  const activeWorkerCount = activeWorkers && Array.isArray(activeWorkers.workers)
    ? activeWorkers.workers.length
    : 0;

  const providerSummary = providerPool && providerPool.global
    ? {
        totalActiveWorkers: providerPool.global.totalActiveWorkers || 0,
        globalMaxWorkers: providerPool.global.globalMaxWorkers || 0,
        availableProviders: providerPool.global.availableProviders || 0,
        exhaustedProviders: providerPool.global.exhaustedProviders || 0,
        disabledProviders: providerPool.global.disabledProviders || 0,
      }
    : null;

  const resourceSummary = resources && resources.summary
    ? {
        totalFiles: resources.summary.totalFiles || 0,
        existingFiles: resources.summary.existingFiles || 0,
        missingFiles: resources.summary.missingFiles || 0,
      }
    : null;

  const trustScheduling = workerTrust && workerTrust.scheduling
    ? {
        minTrustToLaunch: workerTrust.scheduling.minTrustToLaunch,
        highTrustThreshold: workerTrust.scheduling.highTrustThreshold,
        ruleCount: Array.isArray(workerTrust.scheduling.rules)
          ? workerTrust.scheduling.rules.length
          : 0,
      }
    : null;

  const signals = metaSignals && metaSignals.signals
    ? {
        failureScore: metaSignals.signals.failureScore,
        frictionScore: metaSignals.signals.frictionScore,
        riskScore: metaSignals.signals.riskScore,
        cost: metaSignals.signals.cost,
        trust: metaSignals.signals.trust,
        topPain: metaSignals.signals.topPain,
      }
    : null;

  const queueSummary = queue && queue.summary
    ? {
        queued: queue.summary.queued || 0,
        launching: queue.summary.launching || 0,
        running: queue.summary.running || 0,
        prCreated: queue.summary.prCreated || 0,
        blocked: queue.summary.blocked || 0,
        done: queue.summary.done || 0,
      }
    : null;

  const queueEntryCount = queue && Array.isArray(queue.entries)
    ? queue.entries.length
    : 0;

  const actionReadiness = computeActionReadiness({
    health, providerPool, workerTrust, metaSignals, queue,
  });

  const auditSummary = computeAuditSummary(queue);

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    health: health
      ? {
          state: health.state || 'unknown',
          commitSha: health.commitSha || null,
          capturedAt: health.capturedAt || null,
          failedChecks: health.failedChecks || [],
          allowedWorkerClasses: health.allowedWorkerClasses || [],
        }
      : null,
    providerPool: providerSummary,
    resources: resourceSummary,
    activeWorkers: {
      count: activeWorkerCount,
    },
    workerTrust: trustScheduling,
    metaSignals: signals,
    queue: {
      entryCount: queueEntryCount,
      summary: queueSummary,
    },
    actionReadiness,
    auditSummary,
    inputSources: {
      healthLoaded: !!health,
      providerPoolLoaded: !!providerPool,
      resourcesLoaded: !!resources,
      activeWorkersLoaded: !!activeWorkers,
      workerTrustLoaded: !!workerTrust,
      metaSignalsLoaded: !!metaSignals,
      queueLoaded: !!queue,
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

  // Test: buildDashboardState with all null inputs
  const empty = buildDashboardState({
    health: null,
    providerPool: null,
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  assert(empty.schemaVersion === 2, 'schemaVersion is 2');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.health === null, 'health is null when missing');
  assert(empty.providerPool === null, 'providerPool is null when missing');
  assert(empty.resources === null, 'resources is null when missing');
  assert(empty.activeWorkers.count === 0, 'activeWorkers defaults to 0');
  assert(empty.workerTrust === null, 'workerTrust is null when missing');
  assert(empty.metaSignals === null, 'metaSignals is null when missing');
  assert(empty.queue.entryCount === 0, 'queue entryCount defaults to 0');
  assert(empty.queue.summary === null, 'queue summary is null when missing');
  assert(empty.inputSources.healthLoaded === false, 'healthLoaded false');

  // Test: actionReadiness with all null inputs
  assert(empty.actionReadiness.readyCount === 0, 'actionReadiness readyCount defaults to 0');
  assert(empty.actionReadiness.totalActions === 4, 'actionReadiness totalActions is 4');
  assert(empty.actionReadiness.allReady === false, 'actionReadiness allReady false when unhealthy');
  assert(empty.actionReadiness.actions.length === 4, 'actionReadiness has 4 actions');
  const launchAction = empty.actionReadiness.actions.find(a => a.id === 'launch-worker');
  assert(launchAction.ready === false, 'launch-worker not ready with null inputs');
  assert(Array.isArray(launchAction.blockedReasons), 'launch-worker has blockedReasons array');

  // Test: auditSummary with null queue
  assert(empty.auditSummary.totalEntries === 0, 'auditSummary totalEntries defaults to 0');
  assert(empty.auditSummary.lastActivityAt === null, 'auditSummary lastActivityAt null when no queue');
  assert(Array.isArray(empty.auditSummary.blockedReasons), 'auditSummary blockedReasons is array');

  // Test: buildDashboardState with health data
  const withHealth = buildDashboardState({
    health: {
      state: 'green',
      commitSha: 'abc1234',
      capturedAt: '2026-01-01T00:00:00.000Z',
      failedChecks: [],
      allowedWorkerClasses: ['all'],
    },
    providerPool: null,
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  assert(withHealth.health.state === 'green', 'health.state is green');
  assert(withHealth.health.commitSha === 'abc1234', 'health.commitSha passed');
  assert(withHealth.inputSources.healthLoaded === true, 'healthLoaded true');

  // Test: buildDashboardState with provider pool
  const withProviders = buildDashboardState({
    health: null,
    providerPool: {
      global: {
        totalActiveWorkers: 3,
        globalMaxWorkers: 10,
        availableProviders: 2,
        exhaustedProviders: 1,
        disabledProviders: 0,
        lastUpdatedBy: 'test',
        capturedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  assert(withProviders.providerPool.totalActiveWorkers === 3, 'provider totalActiveWorkers');
  assert(withProviders.providerPool.availableProviders === 2, 'provider availableProviders');

  // Test: buildDashboardState with active workers
  const withWorkers = buildDashboardState({
    health: null,
    providerPool: null,
    resources: null,
    activeWorkers: {
      workers: [
        { conflictGroup: 'a', issue: 1, branch: 'feat-a' },
        { conflictGroup: 'b', issue: 2, branch: 'feat-b' },
      ],
    },
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  assert(withWorkers.activeWorkers.count === 2, 'activeWorkers count 2');

  // Test: buildDashboardState with meta signals
  const withSignals = buildDashboardState({
    health: null,
    providerPool: null,
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: {
      signals: { failureScore: 10, frictionScore: 5, riskScore: 3, cost: 42, trust: 90, topPain: 'runtime compile' },
    },
    queue: null,
  });
  assert(withSignals.metaSignals.failureScore === 10, 'metaSignals failureScore');
  assert(withSignals.metaSignals.trust === 90, 'metaSignals trust');
  assert(withSignals.metaSignals.topPain === 'runtime compile', 'metaSignals topPain');

  // Test: buildDashboardState with queue
  const withQueue = buildDashboardState({
    health: null,
    providerPool: null,
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: {
      entries: [
        { issueNumber: 1, state: 'running', updatedAt: '2026-01-01T00:00:00.000Z' },
        { issueNumber: 2, state: 'done', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      summary: { queued: 0, launching: 0, running: 1, prCreated: 0, blocked: 0, done: 1 },
    },
  });
  assert(withQueue.queue.entryCount === 2, 'queue entryCount 2');
  assert(withQueue.queue.summary.running === 1, 'queue summary running');

  // Test: buildDashboardState with worker trust
  const withTrust = buildDashboardState({
    health: null,
    providerPool: null,
    resources: null,
    activeWorkers: null,
    workerTrust: {
      scheduling: {
        minTrustToLaunch: 0.3,
        highTrustThreshold: 0.8,
        rules: [{ condition: 'trustScore < 0.3', action: 'block_launch', description: 'test' }],
      },
    },
    metaSignals: null,
    queue: null,
  });
  assert(withTrust.workerTrust.minTrustToLaunch === 0.3, 'workerTrust minTrustToLaunch');
  assert(withTrust.workerTrust.ruleCount === 1, 'workerTrust ruleCount');

  // Test: buildDashboardState with resources
  const withResources = buildDashboardState({
    health: null,
    providerPool: null,
    resources: {
      summary: { totalFiles: 50, existingFiles: 48, missingFiles: 2 },
    },
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  assert(withResources.resources.totalFiles === 50, 'resources totalFiles');
  assert(withResources.resources.missingFiles === 2, 'resources missingFiles');

  // Test: actionReadiness with green health and available providers
  const readyInputs = buildDashboardState({
    health: { state: 'green' },
    providerPool: { global: { availableProviders: 2, totalActiveWorkers: 0, globalMaxWorkers: 3, exhaustedProviders: 0, disabledProviders: 0 } },
    resources: null,
    activeWorkers: null,
    workerTrust: { scheduling: { minTrustToLaunch: 0.3, highTrustThreshold: 0.8, rules: [] } },
    metaSignals: { signals: { failureScore: 0, frictionScore: 0, riskScore: 0, cost: 0, trust: 90, topPain: 'none' } },
    queue: {
      entries: [{ issueNumber: 1, state: 'queued', updatedAt: '2026-01-01T00:00:00.000Z' }],
      summary: { queued: 1, launching: 0, running: 0, prCreated: 0, blocked: 0, done: 0 },
    },
  });
  assert(readyInputs.actionReadiness.allReady === true, 'allReady true when healthy with providers');
  assert(readyInputs.actionReadiness.readyCount === 4, 'readyCount 4 when all ready');
  const launchReady = readyInputs.actionReadiness.actions.find(a => a.id === 'launch-worker');
  assert(launchReady.ready === true, 'launch-worker ready with green health and providers');
  assert(launchReady.blockedReasons.length === 0, 'launch-worker no blocked reasons');

  // Test: actionReadiness blocked when red health
  const redInputs = buildDashboardState({
    health: { state: 'red' },
    providerPool: { global: { availableProviders: 2, totalActiveWorkers: 0, globalMaxWorkers: 3, exhaustedProviders: 0, disabledProviders: 0 } },
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  const redLaunch = redInputs.actionReadiness.actions.find(a => a.id === 'launch-worker');
  assert(redLaunch.ready === false, 'launch-worker not ready when red health');
  assert(redLaunch.blockedReasons.some(r => r.includes('health')), 'launch-worker blocked by red health');

  // Test: actionReadiness blocked when no providers
  const noProviders = buildDashboardState({
    health: { state: 'green' },
    providerPool: { global: { availableProviders: 0, totalActiveWorkers: 3, globalMaxWorkers: 3, exhaustedProviders: 1, disabledProviders: 0 } },
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  const noProvLaunch = noProviders.actionReadiness.actions.find(a => a.id === 'launch-worker');
  assert(noProvLaunch.ready === false, 'launch-worker not ready with no providers');
  assert(noProvLaunch.blockedReasons.includes('no available providers'), 'launch-worker blocked by no providers');

  // Test: auditSummary with queue entries
  const withAuditQueue = buildDashboardState({
    health: null,
    providerPool: null,
    resources: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: {
      entries: [
        { issueNumber: 1, state: 'running', updatedAt: '2026-01-02T00:00:00.000Z' },
        { issueNumber: 2, state: 'blocked', updatedAt: '2026-01-03T00:00:00.000Z', blockedReason: 'provider unavailable' },
        { issueNumber: 3, state: 'done', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      summary: { queued: 0, launching: 0, running: 1, prCreated: 0, blocked: 1, done: 1 },
    },
  });
  assert(withAuditQueue.auditSummary.totalEntries === 3, 'auditSummary totalEntries 3');
  assert(withAuditQueue.auditSummary.byState.running === 1, 'auditSummary byState running');
  assert(withAuditQueue.auditSummary.byState.blocked === 1, 'auditSummary byState blocked');
  assert(withAuditQueue.auditSummary.lastActivityAt === '2026-01-03T00:00:00.000Z', 'auditSummary lastActivityAt is latest');
  assert(withAuditQueue.auditSummary.blockedReasons.includes('provider unavailable'), 'auditSummary captures blockedReason');

  // Test: readJsonFile with nonexistent path
  const missing = readJsonFile('/nonexistent/path.json');
  assert(missing === null, 'readJsonFile missing returns null');

  // Test: readJsonFile with valid file
  const os = require('os');
  const tmpPath = path.join(os.tmpdir(), `selftest-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify({ test: true }), 'utf8');
  const loaded = readJsonFile(tmpPath);
  assert(loaded && loaded.test === true, 'readJsonFile loads valid JSON');
  fs.unlinkSync(tmpPath);

  // Test: readJsonFile with malformed JSON
  const badPath = path.join(os.tmpdir(), `selftest-bad-${Date.now()}.json`);
  fs.writeFileSync(badPath, 'not json{{{', 'utf8');
  const badResult = readJsonFile(badPath);
  assert(badResult === null, 'readJsonFile malformed returns null');
  fs.unlinkSync(badPath);

  // Report
  console.log(`\n  emit-control-plane-dashboard-state self-test`);
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

  // Read all input files
  const inputs = {};
  for (const [key, filename] of Object.entries(INPUT_FILES)) {
    inputs[key] = readJsonFile(path.join(STATE_DIR, filename));
  }

  const snapshot = buildDashboardState(inputs);
  const json = JSON.stringify(snapshot, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  if (!args.live) {
    // Dry-run mode
    const banner = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                     DRY RUN                                ║',
      '╚══════════════════════════════════════════════════════════════╝',
    ].join('\n');
    process.stdout.write(`${banner}\n`);
    process.stdout.write(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n\n`);
    process.stdout.write(json);
    return;
  }

  // Live mode — write the file
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Dashboard state written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
