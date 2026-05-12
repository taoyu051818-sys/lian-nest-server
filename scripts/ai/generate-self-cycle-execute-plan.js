#!/usr/bin/env node

/**
 * generate-self-cycle-execute-plan.js
 *
 * Generates a guarded execute plan for low-risk self-cycle actions.
 * Reads main health, provider pool, and queue state to emit a
 * plan-only output with explicit action allowlists. Never mutates
 * external state — all steps are dry-run projections.
 *
 * Usage:
 *   node scripts/ai/generate-self-cycle-execute-plan.js [options]
 *
 * Options:
 *   --fixture <path>  Path to fixture JSON (skip file reads)
 *   --stdout          Print JSON to stdout
 *   --out <path>      Output file path
 *   --self-test       Run built-in assertions and exit
 *   --help            Show usage
 *
 * Exit codes:
 *   0 — plan produced
 *   2 — invalid arguments / missing inputs
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'self-cycle-execute-plan.json');
const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  health: 'main-health.json',
  providerPool: 'provider-pool.json',
  queue: 'webui-queue-state.json',
};

const VALID_HEALTH_STATES = ['green', 'yellow', 'red', 'black'];

// Self-cycle actions that are always allowed in plan mode.
// Each action is low-risk, read-only or plan-only, and does not
// require human confirmation for preview.
const SELF_CYCLE_ACTIONS = [
  {
    actionId: 'health-gate-check',
    label: 'Health Gate Check',
    description: 'Read main branch health state and determine if launches are permitted.',
    risk: 'low',
    humanRequired: false,
    mutation: false,
    allowlist: ['read .github/ai-state/main-health.json'],
  },
  {
    actionId: 'provider-pool-preflight',
    label: 'Provider Pool Preflight',
    description: 'Check provider availability, exhaustion, and concurrency capacity.',
    risk: 'low',
    humanRequired: false,
    mutation: false,
    allowlist: ['read .github/ai-state/provider-pool.json'],
  },
  {
    actionId: 'queue-status-scan',
    label: 'Queue Status Scan',
    description: 'Read queued issues and count pending dispatch targets.',
    risk: 'low',
    humanRequired: false,
    mutation: false,
    allowlist: ['read .github/ai-state/webui-queue-state.json'],
  },
  {
    actionId: 'launch-candidate-detection',
    label: 'Launch Candidate Detection',
    description: 'Identify issues eligible for worker dispatch based on queue and health.',
    risk: 'low',
    humanRequired: false,
    mutation: false,
    allowlist: [
      'read .github/ai-state/main-health.json',
      'read .github/ai-state/webui-queue-state.json',
      'read .github/ai-state/provider-pool.json',
    ],
  },
  {
    actionId: 'conflict-group-check',
    label: 'Conflict Group Check',
    description: 'Scan in-flight workers for conflict group collisions with queued tasks.',
    risk: 'low',
    humanRequired: false,
    mutation: false,
    allowlist: ['read .github/ai-state/active-workers.json'],
  },
];

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
generate-self-cycle-execute-plan.js — Guarded self-cycle plan generator (v1)

USAGE
    node scripts/ai/generate-self-cycle-execute-plan.js [options]

OPTIONS
    --fixture <path>  Path to fixture JSON with health/providerPool/queue keys.
    --stdout          Print JSON to stdout instead of writing file.
    --out <path>      Output path (default: .github/ai-state/self-cycle-execute-plan.json).
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

OUTPUT
    Sanitized JSON plan with action allowlists, health gate status,
    and pipeline readiness. Plan-only — no mutations.

EXIT CODES
    0   Plan produced
    2   Invalid arguments / missing inputs
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

// ── Health gate ──────────────────────────────────────────────────────────────

function evaluateHealthGate(health) {
  if (!health || !health.state) {
    return {
      state: 'unknown',
      gatePassed: false,
      reason: 'main-health.json missing or malformed — cannot determine health state',
    };
  }

  const state = health.state;
  if (!VALID_HEALTH_STATES.includes(state)) {
    return {
      state,
      gatePassed: false,
      reason: `Unrecognized health state: ${state}`,
    };
  }

  if (state === 'red' || state === 'black') {
    return {
      state,
      gatePassed: false,
      reason: `Main branch health is ${state} — self-cycle execution blocked`,
      failedChecks: health.failedChecks || [],
    };
  }

  return {
    state,
    gatePassed: true,
    reason: `Main branch health is ${state} — gate passed`,
    allowedWorkerClasses: health.allowedWorkerClasses || [],
  };
}

// ── Provider pool evaluation ─────────────────────────────────────────────────

function evaluateProviderPool(pool) {
  if (!pool || !Array.isArray(pool.providers)) {
    return {
      available: 0,
      exhausted: 0,
      disabled: 0,
      atCapacity: 0,
      total: 0,
      ready: false,
      reason: 'provider-pool.json missing or malformed',
    };
  }

  let available = 0;
  let exhausted = 0;
  let disabled = 0;
  let atCapacity = 0;

  for (const p of pool.providers) {
    const current = typeof p.currentConcurrency === 'number' ? p.currentConcurrency : 0;
    const max = typeof p.maxConcurrency === 'number' ? p.maxConcurrency : Infinity;
    const isAtCapacity = max !== Infinity && current >= max;
    switch (p.status) {
      case 'available':
        if (isAtCapacity) { atCapacity++; } else { available++; }
        break;
      case 'exhausted':
        exhausted++;
        break;
      case 'disabled':
        disabled++;
        break;
    }
  }

  const total = pool.providers.length;
  const ready = available > 0;

  return {
    available,
    exhausted,
    disabled,
    atCapacity,
    total,
    ready,
    reason: ready
      ? `${available} provider(s) available`
      : 'No available providers — dispatch blocked',
  };
}

// ── Queue evaluation ─────────────────────────────────────────────────────────

function evaluateQueue(queue) {
  if (!queue || !Array.isArray(queue.entries)) {
    return {
      total: 0,
      queued: 0,
      entries: [],
      hasWork: false,
    };
  }

  const queued = queue.entries.filter(e => e && e.state === 'queued');
  return {
    total: queue.entries.length,
    queued: queued.length,
    entries: queued.map(sanitizeObject),
    hasWork: queued.length > 0,
  };
}

// ── Plan generation ──────────────────────────────────────────────────────────

function generatePlan(inputs) {
  const healthGate = evaluateHealthGate(inputs.health);
  const providerPool = evaluateProviderPool(inputs.providerPool);
  const queue = evaluateQueue(inputs.queue);

  const pipelineReady = healthGate.gatePassed && providerPool.ready;
  const canProceed = pipelineReady && queue.hasWork;

  // Determine which actions are enabled based on pipeline state
  const allowedActions = SELF_CYCLE_ACTIONS.map(action => {
    const enabled = healthGate.gatePassed;
    return {
      ...action,
      enabled,
      disabledReason: enabled ? null : 'Health gate failed — action disabled',
    };
  });

  // Build blockers list
  const blockers = [];
  if (!healthGate.gatePassed) {
    blockers.push({
      source: 'health-gate',
      severity: healthGate.state === 'black' ? 'critical' : 'high',
      message: healthGate.reason,
    });
  }
  if (!providerPool.ready) {
    blockers.push({
      source: 'provider-pool',
      severity: 'medium',
      message: providerPool.reason,
    });
  }
  if (!queue.hasWork) {
    blockers.push({
      source: 'queue',
      severity: 'info',
      message: 'No queued issues — nothing to dispatch',
    });
  }

  // Compute summary
  const enabledCount = allowedActions.filter(a => a.enabled).length;

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    mode: 'plan-only',
    dryRun: true,
    pipelineReady: canProceed,
    healthGate: sanitizeObject(healthGate),
    providerPool: sanitizeObject(providerPool),
    queue: sanitizeObject(queue),
    allowedActions,
    actionAllowlist: allowedActions.filter(a => a.enabled).map(a => a.actionId),
    blockers,
    summary: {
      totalActions: allowedActions.length,
      enabledActions: enabledCount,
      disabledActions: allowedActions.length - enabledCount,
      pipelineReady: canProceed,
      healthGatePassed: healthGate.gatePassed,
      providersAvailable: providerPool.available,
      queuedIssues: queue.queued,
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

  // Test: evaluateHealthGate with null
  const nullHealth = evaluateHealthGate(null);
  assert(nullHealth.gatePassed === false, 'null health → gate failed');
  assert(nullHealth.state === 'unknown', 'null health → state unknown');

  // Test: evaluateHealthGate with green
  const greenHealth = evaluateHealthGate({ state: 'green', allowedWorkerClasses: ['all'] });
  assert(greenHealth.gatePassed === true, 'green health → gate passed');
  assert(greenHealth.state === 'green', 'green health → state green');

  // Test: evaluateHealthGate with red
  const redHealth = evaluateHealthGate({ state: 'red', failedChecks: ['tsc'] });
  assert(redHealth.gatePassed === false, 'red health → gate failed');
  assert(redHealth.state === 'red', 'red health → state red');

  // Test: evaluateHealthGate with black
  const blackHealth = evaluateHealthGate({ state: 'black' });
  assert(blackHealth.gatePassed === false, 'black health → gate failed');
  assert(blackHealth.state === 'black', 'black health → state black');

  // Test: evaluateHealthGate with yellow (allowed)
  const yellowHealth = evaluateHealthGate({ state: 'yellow' });
  assert(yellowHealth.gatePassed === true, 'yellow health → gate passed');

  // Test: evaluateHealthGate with unknown state
  const weirdHealth = evaluateHealthGate({ state: 'purple' });
  assert(weirdHealth.gatePassed === false, 'unknown state → gate failed');

  // Test: evaluateProviderPool with null
  const nullPool = evaluateProviderPool(null);
  assert(nullPool.ready === false, 'null pool → not ready');
  assert(nullPool.available === 0, 'null pool → 0 available');

  // Test: evaluateProviderPool with available provider
  const availPool = evaluateProviderPool({
    providers: [
      { id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 },
    ],
  });
  assert(availPool.ready === true, 'available pool → ready');
  assert(availPool.available === 1, 'available pool → 1 available');

  // Test: evaluateProviderPool with all exhausted
  const exhaustPool = evaluateProviderPool({
    providers: [
      { id: 'p1', status: 'exhausted', currentConcurrency: 0, maxConcurrency: 1 },
    ],
  });
  assert(exhaustPool.ready === false, 'exhausted pool → not ready');
  assert(exhaustPool.exhausted === 1, 'exhausted pool → 1 exhausted');

  // Test: evaluateProviderPool with at-capacity
  const capPool = evaluateProviderPool({
    providers: [
      { id: 'p1', status: 'available', currentConcurrency: 1, maxConcurrency: 1 },
    ],
  });
  assert(capPool.ready === false, 'at-capacity pool → not ready');
  assert(capPool.atCapacity === 1, 'at-capacity pool → 1 atCapacity');

  // Test: evaluateQueue with null
  const nullQueue = evaluateQueue(null);
  assert(nullQueue.hasWork === false, 'null queue → no work');
  assert(nullQueue.queued === 0, 'null queue → 0 queued');

  // Test: evaluateQueue with entries
  const workQueue = evaluateQueue({
    entries: [
      { issueNumber: 100, state: 'queued' },
      { issueNumber: 101, state: 'processed' },
      { issueNumber: 102, state: 'queued' },
    ],
  });
  assert(workQueue.hasWork === true, 'queue with work → hasWork');
  assert(workQueue.queued === 2, 'queue → 2 queued');
  assert(workQueue.total === 3, 'queue → 3 total');

  // Test: generatePlan with all green
  const greenPlan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert(greenPlan.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof greenPlan.capturedAt === 'string', 'capturedAt is string');
  assert(greenPlan.mode === 'plan-only', 'mode is plan-only');
  assert(greenPlan.dryRun === true, 'dryRun is true');
  assert(greenPlan.pipelineReady === true, 'pipeline ready when all green');
  assert(greenPlan.healthGate.gatePassed === true, 'health gate passed');
  assert(greenPlan.providerPool.ready === true, 'provider pool ready');
  assert(greenPlan.queue.hasWork === true, 'queue has work');
  assert(greenPlan.allowedActions.length === SELF_CYCLE_ACTIONS.length, 'all actions present');
  assert(greenPlan.allowedActions.every(a => a.enabled === true), 'all actions enabled');
  assert(greenPlan.actionAllowlist.length === SELF_CYCLE_ACTIONS.length, 'allowlist matches');
  assert(greenPlan.blockers.length === 0, 'no blockers');
  assert(greenPlan.summary.pipelineReady === true, 'summary pipelineReady');
  assert(greenPlan.summary.enabledActions === SELF_CYCLE_ACTIONS.length, 'summary enabled count');

  // Test: generatePlan with red health
  const redPlan = generatePlan({
    health: { state: 'red', failedChecks: ['tsc'] },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [{ issueNumber: 100, state: 'queued' }] },
  });
  assert(redPlan.pipelineReady === false, 'pipeline not ready with red health');
  assert(redPlan.healthGate.gatePassed === false, 'health gate failed');
  assert(redPlan.allowedActions.every(a => a.enabled === false), 'all actions disabled');
  assert(redPlan.actionAllowlist.length === 0, 'empty allowlist');
  assert(redPlan.blockers.length > 0, 'has blockers');
  assert(redPlan.blockers[0].source === 'health-gate', 'health blocker present');

  // Test: generatePlan with no queue
  const noQueuePlan = generatePlan({
    health: { state: 'green' },
    providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 1 }] },
    queue: { entries: [] },
  });
  assert(noQueuePlan.pipelineReady === false, 'pipeline not ready with empty queue');
  assert(noQueuePlan.queue.hasWork === false, 'queue has no work');
  assert(noQueuePlan.blockers.some(b => b.source === 'queue'), 'queue blocker present');

  // Test: generatePlan with all null inputs
  const emptyPlan = generatePlan({ health: null, providerPool: null, queue: null });
  assert(emptyPlan.pipelineReady === false, 'pipeline not ready with null inputs');
  assert(emptyPlan.healthGate.gatePassed === false, 'health gate failed');
  assert(emptyPlan.providerPool.ready === false, 'provider pool not ready');
  assert(emptyPlan.queue.hasWork === false, 'queue has no work');
  assert(emptyPlan.blockers.length >= 2, 'multiple blockers');

  // Test: plan shape has required keys
  const requiredKeys = [
    'schemaVersion', 'capturedAt', 'mode', 'dryRun', 'pipelineReady',
    'healthGate', 'providerPool', 'queue', 'allowedActions',
    'actionAllowlist', 'blockers', 'summary',
  ];
  for (const key of requiredKeys) {
    assert(key in greenPlan, `key ${key} present`);
  }

  // Test: action allowlist items are strings
  assert(greenPlan.actionAllowlist.every(a => typeof a === 'string'), 'allowlist items are strings');

  // Test: no secret-shaped keys in output
  const planJson = JSON.stringify(greenPlan);
  assert(!planJson.match(/"token"/), 'no token key in output');
  assert(!planJson.match(/"secret"/), 'no secret key in output');
  assert(!planJson.match(/"apiKey"/), 'no apiKey key in output');

  // Report
  console.log(`\n  generate-self-cycle-execute-plan self-test`);
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
      health: fixture.health || null,
      providerPool: fixture.providerPool || null,
      queue: fixture.queue || null,
    };
  } else {
    inputs = {};
    for (const [key, filename] of Object.entries(INPUT_FILES)) {
      inputs[key] = readJsonFile(path.join(STATE_DIR, filename));
    }
  }

  const plan = generatePlan(inputs);
  const json = JSON.stringify(plan, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Self-cycle execute plan written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateHealthGate,
  evaluateProviderPool,
  evaluateQueue,
  generatePlan,
  SELF_CYCLE_ACTIONS,
};
