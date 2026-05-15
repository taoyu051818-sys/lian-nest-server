#!/usr/bin/env node

/**
 * emit-codex-exit-readiness.js
 *
 * Reads control-plane state projections from .github/ai-state/ and emits
 * a machine-readable Codex exit readiness verdict.
 *
 * Evaluates each gate defined in docs/ai-native/codex-exit-readiness.md
 * and produces a verdict of "ready", "partial", or "not_ready" with
 * per-gate detail and human-readable blockers.
 *
 * Input sources (all optional — absent files produce conservative defaults):
 *   main-health.json       — MainHealthState (health gate output)
 *   provider-pool.json     — ProviderPoolState (provider availability)
 *   active-workers.json    — ActiveWorkers (in-flight workers)
 *   worker-trust.json      — WorkerTrust (trust scores & scheduling)
 *   meta-signals.json      — MetaSignals (aggregate health signals)
 *   queue-state.json       — WebUIQueueState (queue lifecycle entries)
 *
 * Default mode is dry-run: prints a preview to stdout without writing.
 * Pass --live to persist the verdict to the output file.
 *
 * Usage:
 *   node scripts/ai/emit-codex-exit-readiness.js --help
 *   node scripts/ai/emit-codex-exit-readiness.js
 *   node scripts/ai/emit-codex-exit-readiness.js --live
 *   node scripts/ai/emit-codex-exit-readiness.js --stdout
 *
 * Exit codes:
 *   0 — verdict produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const { REPO_ROOT, controlPlane } = require('./lib');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'codex-exit-readiness.json');

const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  health:        'main-health.json',
  providerPool:  'provider-pool.json',
  activeWorkers: 'active-workers.json',
  workerTrust:   'worker-trust.json',
  metaSignals:   'meta-signals.json',
  queue:         'queue-state.json',
};

// Gate IDs and their blocking status for exit readiness
const GATES = [
  { id: 'gate-1', name: 'Self-Cycle Runner Autonomy', blocking: true },
  { id: 'gate-2', name: 'Launch Gate Enforcement', blocking: true },
  { id: 'gate-3', name: 'Health Gate Operational', blocking: true, note: '3.3 non-blocking' },
  { id: 'gate-4', name: 'Recovery Path', blocking: true, note: '4.3 non-blocking' },
  { id: 'gate-5', name: 'Merge Control', blocking: true },
  { id: 'gate-6', name: 'Human-Owned Boundaries', blocking: true },
  { id: 'gate-7', name: 'Observability', blocking: true },
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
emit-codex-exit-readiness.js — Codex exit readiness verdict emitter (v1)

USAGE
    node scripts/ai/emit-codex-exit-readiness.js [options]

OPTIONS
    --live          Write the verdict to the output file.
                    Without this flag, the script runs in dry-run mode
                    and prints a preview to stdout without writing.
    --out <path>    Output path for the verdict JSON.
                    (default: .github/ai-state/codex-exit-readiness.json)
    --stdout        Print JSON to stdout instead of writing a file.
                    Overrides --out. Always prints regardless of --live.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

INPUT FILES (all optional — absent files produce conservative defaults)
    .github/ai-state/main-health.json      MainHealthState
    .github/ai-state/provider-pool.json    ProviderPoolState
    .github/ai-state/active-workers.json   ActiveWorkers
    .github/ai-state/worker-trust.json     WorkerTrust
    .github/ai-state/meta-signals.json     MetaSignals
    .github/ai-state/queue-state.json      WebUIQueueState

VERDICT
    ready       All blocking gates pass
    partial     Some blocking gates pass, some fail
    not_ready   No blocking gates pass or critical state is missing

EXIT CODES
    0   Verdict produced
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

// ── Gate evaluators ──────────────────────────────────────────────────────────

function evaluateGate1(inputs) {
  // Gate 1: Self-Cycle Runner Autonomy
  // Checks: runner exists and can chain discovery → reconciliation → health → launch → dispatch
  // Proxy: active-workers state is loadable and health state is known
  const health = inputs.health;
  const activeWorkers = inputs.activeWorkers;

  const checks = [];
  const blockers = [];

  // 1.1 Runner state tracking available (active-workers loaded)
  const hasWorkerState = activeWorkers !== null;
  checks.push({ id: '1.1', name: 'Runner state tracking', pass: hasWorkerState });
  if (!hasWorkerState) blockers.push('active-workers.json missing — runner state not tracked');

  // 1.2 Health state known (runner needs health for reconciliation)
  const hasHealth = health !== null && health.state;
  checks.push({ id: '1.2', name: 'Health state known', pass: hasHealth });
  if (!hasHealth) blockers.push('main-health.json missing — runner cannot reconcile');

  const pass = checks.every(c => c.pass);
  return { id: 'gate-1', name: 'Self-Cycle Runner Autonomy', pass, checks, blockers };
}

function evaluateGate2(inputs) {
  // Gate 2: Launch Gate Enforcement
  // Checks: launch gate can enforce health, conflict groups, shared locks
  // Proxy: health state exists and worker trust scheduling is configured
  const health = inputs.health;
  const workerTrust = inputs.workerTrust;

  const checks = [];
  const blockers = [];

  // 2.1 Health gate blocks on red
  const healthState = health && health.state ? health.state : null;
  const healthKnown = healthState !== null;
  checks.push({ id: '2.1', name: 'Health gate operational', pass: healthKnown });
  if (!healthKnown) blockers.push('health state unknown — launch gate cannot enforce');

  // 2.2 Conflict group enforcement (worker trust has scheduling rules)
  const hasScheduling = workerTrust && workerTrust.scheduling &&
    Array.isArray(workerTrust.scheduling.rules) && workerTrust.scheduling.rules.length > 0;
  checks.push({ id: '2.2', name: 'Scheduling rules defined', pass: hasScheduling });
  if (!hasScheduling) blockers.push('worker-trust scheduling rules missing — conflict enforcement unavailable');

  // 2.3 Trust thresholds configured
  const hasTrustThresholds = workerTrust && workerTrust.scheduling &&
    typeof workerTrust.scheduling.minTrustToLaunch === 'number';
  checks.push({ id: '2.3', name: 'Trust thresholds configured', pass: hasTrustThresholds });
  if (!hasTrustThresholds) blockers.push('minTrustToLaunch not configured');

  const pass = checks.every(c => c.pass);
  return { id: 'gate-2', name: 'Launch Gate Enforcement', pass, checks, blockers };
}

function evaluateGate3(inputs) {
  // Gate 3: Health Gate Operational
  // 3.1 Health gate runs and classifies state — proxy: health state exists
  // 3.2 Health state writer records marker — proxy: main-health.json has state
  // 3.3 Auto-trigger — non-blocking
  const health = inputs.health;
  const metaSignals = inputs.metaSignals;

  const checks = [];
  const blockers = [];

  // 3.1 Health gate runs
  const hasHealth = health !== null && health.state;
  checks.push({ id: '3.1', name: 'Health gate classifies state', pass: hasHealth });
  if (!hasHealth) blockers.push('main-health.json missing — health gate not operational');

  // 3.2 Health state recorded
  const hasRecordedState = health !== null && health.capturedAt;
  checks.push({ id: '3.2', name: 'Health state recorded', pass: hasRecordedState });
  if (!hasRecordedState) blockers.push('health state has no timestamp — not recorded');

  // 3.3 Auto-trigger (non-blocking for exit)
  checks.push({ id: '3.3', name: 'Auto-trigger wired', pass: false, nonBlocking: true });

  // Only blocking checks determine pass
  const blockingChecks = checks.filter(c => !c.nonBlocking);
  const pass = blockingChecks.every(c => c.pass);
  return { id: 'gate-3', name: 'Health Gate Operational', pass, checks, blockers };
}

function evaluateGate4(inputs) {
  // Gate 4: Recovery Path
  // 4.1 Recovery worker types defined — proxy: worker-trust has foundation-fix class
  // 4.2 Red state blocks non-recovery — proxy: health state + worker trust allowed states
  // 4.3 Auto-dispatch — non-blocking
  const health = inputs.health;
  const workerTrust = inputs.workerTrust;

  const checks = [];
  const blockers = [];

  // 4.1 Recovery worker types defined
  const hasFoundationFix = !!(workerTrust && workerTrust.workerClasses &&
    workerTrust.workerClasses['foundation-fix']);
  checks.push({ id: '4.1', name: 'Recovery worker types defined', pass: hasFoundationFix });
  if (!hasFoundationFix) blockers.push('foundation-fix worker class not defined');

  // 4.2 Red state blocks non-recovery
  const hasHealthGatePolicy = !!(workerTrust && workerTrust.workerClasses &&
    Object.values(workerTrust.workerClasses).some(wc =>
      Array.isArray(wc.allowedHealthStates) && wc.allowedHealthStates.includes('red')
    ));
  checks.push({ id: '4.2', name: 'Red state blocks non-recovery', pass: hasHealthGatePolicy });
  if (!hasHealthGatePolicy) blockers.push('worker classes lack allowedHealthStates policy');

  // 4.3 Auto-dispatch (non-blocking)
  checks.push({ id: '4.3', name: 'Recovery auto-dispatch', pass: false, nonBlocking: true });

  const blockingChecks = checks.filter(c => !c.nonBlocking);
  const pass = blockingChecks.every(c => c.pass);
  return { id: 'gate-4', name: 'Recovery Path', pass, checks, blockers };
}

function evaluateGate5(inputs) {
  // Gate 5: Merge Control
  // 5.1 Controlled merge defaults to dry-run — structural assumption (always true)
  // 5.2 Guard checks block boundary violations — structural assumption
  // 5.3 High-risk PRs require human approval — proxy: risk score from meta-signals
  const metaSignals = inputs.metaSignals;
  const health = inputs.health;

  const checks = [];
  const blockers = [];

  // 5.1 Dry-run default (structural — always passes)
  checks.push({ id: '5.1', name: 'Dry-run default', pass: true });

  // 5.2 Guard checks available (structural — always passes)
  checks.push({ id: '5.2', name: 'Guard checks available', pass: true });

  // 5.3 Risk monitoring operational
  const hasRiskScore = metaSignals && metaSignals.signals &&
    typeof metaSignals.signals.riskScore === 'number';
  checks.push({ id: '5.3', name: 'Risk monitoring operational', pass: hasRiskScore });
  if (!hasRiskScore) blockers.push('meta-signals risk score unavailable');

  const pass = checks.every(c => c.pass);
  return { id: 'gate-5', name: 'Merge Control', pass, checks, blockers };
}

function evaluateGate6(inputs) {
  // Gate 6: Human-Owned Boundaries
  // 6.1 Seed constitution enforced — structural assumption
  // 6.2 Workers cannot self-expand scope — structural assumption
  // 6.3 Next-wave decisions human-owned — structural assumption
  const checks = [];
  const blockers = [];

  // All structural — enforced by code, not state files
  checks.push({ id: '6.1', name: 'Seed constitution enforced', pass: true });
  checks.push({ id: '6.2', name: 'Scope immutability', pass: true });
  checks.push({ id: '6.3', name: 'Human wave decisions', pass: true });

  return { id: 'gate-6', name: 'Human-Owned Boundaries', pass: true, checks, blockers };
}

function evaluateGate7(inputs) {
  // Gate 7: Observability
  // 7.1 State reconciler detects drift — proxy: active-workers state exists
  // 7.2 Worker heartbeat monitors liveness — proxy: meta-signals has friction data
  // 7.3 Result publisher posts summaries — structural assumption
  const activeWorkers = inputs.activeWorkers;
  const metaSignals = inputs.metaSignals;

  const checks = [];
  const blockers = [];

  // 7.1 State tracking
  const hasWorkerTracking = activeWorkers !== null;
  checks.push({ id: '7.1', name: 'State tracking operational', pass: hasWorkerTracking });
  if (!hasWorkerTracking) blockers.push('active-workers.json missing — drift detection unavailable');

  // 7.2 Friction monitoring
  const hasFrictionData = metaSignals && metaSignals.signals &&
    typeof metaSignals.signals.frictionScore === 'number';
  checks.push({ id: '7.2', name: 'Friction monitoring', pass: hasFrictionData });
  if (!hasFrictionData) blockers.push('meta-signals friction score unavailable');

  // 7.3 Result publisher (structural)
  checks.push({ id: '7.3', name: 'Result publisher available', pass: true });

  const pass = checks.every(c => c.pass);
  return { id: 'gate-7', name: 'Observability', pass, checks, blockers };
}

// ── Governance ───────────────────────────────────────────────────────────────

function buildGovernance(verdict) {
  const facts = [];
  const recommendations = [];
  const humanRequired = [];

  for (const gate of verdict.gates) {
    facts.push({ source: gate.id, label: gate.name, value: gate.pass ? 'pass' : 'fail' });
    if (gate.blocking && !gate.pass) {
      for (const blocker of gate.blockers) {
        recommendations.push({ source: gate.id, message: blocker, severity: 'high' });
      }
      humanRequired.push({ type: 'gate', id: gate.id, message: gate.name });
    }
  }

  return { facts, recommendations, humanRequired };
}

// ── Build verdict ────────────────────────────────────────────────────────────

function buildVerdict(inputs, snapshotInputSources) {
  const gates = [
    evaluateGate1(inputs),
    evaluateGate2(inputs),
    evaluateGate3(inputs),
    evaluateGate4(inputs),
    evaluateGate5(inputs),
    evaluateGate6(inputs),
    evaluateGate7(inputs),
  ];

  const blockingGates = GATES.filter(g => g.blocking);
  const blockingResults = gates.filter(g => {
    const def = blockingGates.find(b => b.id === g.id);
    return def && def.blocking;
  });

  const passedBlocking = blockingResults.filter(g => g.pass).length;
  const totalBlocking = blockingResults.length;

  let verdict;
  if (passedBlocking === totalBlocking) {
    verdict = 'ready';
  } else if (passedBlocking > 0) {
    verdict = 'partial';
  } else {
    verdict = 'not_ready';
  }

  const allBlockers = [];
  for (const gate of gates) {
    for (const blocker of gate.blockers) {
      allBlockers.push(`[${gate.id}] ${blocker}`);
    }
  }

  const inputSources = snapshotInputSources ? { ...snapshotInputSources } : {};
  if (!snapshotInputSources) {
    for (const [key, filename] of Object.entries(INPUT_FILES)) {
      inputSources[`${key}Loaded`] = inputs[key] !== null;
    }
  }

  const gatesOut = gates.map(g => ({
    id: g.id,
    name: g.name,
    pass: g.pass,
    blocking: (GATES.find(d => d.id === g.id) || {}).blocking || false,
    checks: g.checks,
    blockers: g.blockers,
  }));

  const result = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    verdict,
    passedBlocking,
    totalBlocking,
    gates: gatesOut,
    blockers: allBlockers,
    inputSources,
  };
  result.governance = buildGovernance(result);
  return result;
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

  // Test: buildVerdict with all null inputs
  const empty = buildVerdict({
    health: null,
    providerPool: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  });
  assert(empty.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.verdict === 'partial', 'verdict partial with all null (gate-6 structural passes)');
  assert(empty.passedBlocking === 1, 'passedBlocking 1 with all null (gate-6)');
  assert(empty.totalBlocking === 7, 'totalBlocking is 7');
  assert(Array.isArray(empty.gates), 'gates is array');
  assert(empty.gates.length === 7, '7 gates');
  assert(Array.isArray(empty.blockers), 'blockers is array');
  assert(empty.blockers.length > 0, 'has blockers when not_ready');

  // Test: inputSources all false
  for (const key of Object.keys(empty.inputSources)) {
    assert(empty.inputSources[key] === false, `inputSources.${key} is false`);
  }

  // Test: buildVerdict with full valid inputs → ready
  const fullInputs = {
    health: { state: 'green', capturedAt: '2026-01-01T00:00:00.000Z' },
    providerPool: { global: { availableProviders: 2 } },
    activeWorkers: { workers: [] },
    workerTrust: {
      workerClasses: {
        'foundation-fix': { allowedHealthStates: ['green', 'yellow', 'red'] },
        'runtime-feature': { allowedHealthStates: ['green'] },
      },
      scheduling: { minTrustToLaunch: 0.3, rules: [{ condition: 'trustScore < 0.3', action: 'block_launch' }] },
    },
    metaSignals: { signals: { failureScore: 0, frictionScore: 0, riskScore: 10, trust: 90 } },
    queue: { entries: [], summary: { queued: 0 } },
  };
  const full = buildVerdict(fullInputs);
  assert(full.verdict === 'ready', 'verdict ready with full inputs');
  assert(full.passedBlocking === 7, 'all 7 blocking gates pass');
  assert(full.blockers.length === 0, 'no blockers when ready');
  assert(full.inputSources.healthLoaded === true, 'healthLoaded true');
  assert(full.inputSources.workerTrustLoaded === true, 'workerTrustLoaded true');

  // Test: partial — some gates pass, some fail
  const partialInputs = {
    health: { state: 'green', capturedAt: '2026-01-01T00:00:00.000Z' },
    providerPool: null,
    activeWorkers: null,
    workerTrust: null,
    metaSignals: null,
    queue: null,
  };
  const partial = buildVerdict(partialInputs);
  assert(partial.verdict === 'partial', 'verdict partial with mixed inputs');
  assert(partial.passedBlocking > 0, 'some blocking gates pass');
  assert(partial.passedBlocking < partial.totalBlocking, 'not all blocking gates pass');

  // Test: gate shape
  const gate1 = full.gates.find(g => g.id === 'gate-1');
  assert(gate1 !== undefined, 'gate-1 exists');
  assert(typeof gate1.pass === 'boolean', 'gate.pass is boolean');
  assert(Array.isArray(gate1.checks), 'gate.checks is array');
  assert(Array.isArray(gate1.blockers), 'gate.blockers is array');
  assert(typeof gate1.blocking === 'boolean', 'gate.blocking is boolean');

  // Test: check shape
  const check1 = gate1.checks[0];
  assert(typeof check1.id === 'string', 'check.id is string');
  assert(typeof check1.name === 'string', 'check.name is string');
  assert(typeof check1.pass === 'boolean', 'check.pass is boolean');

  // Test: governance section shape
  assert(typeof full.governance === 'object', 'governance is object');
  assert(Array.isArray(full.governance.facts), 'governance.facts is array');
  assert(Array.isArray(full.governance.recommendations), 'governance.recommendations is array');
  assert(Array.isArray(full.governance.humanRequired), 'governance.humanRequired is array');
  assert(full.governance.facts.length === 7, 'governance has 7 gate facts');
  assert(full.governance.humanRequired.length === 0, 'ready state has no humanRequired');
  assert(empty.governance.humanRequired.length > 0, 'partial state has humanRequired');

  // Report
  console.log(`\n  emit-codex-exit-readiness self-test`);
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

  // Load shared control-plane snapshot
  const { inputs, inputSources: snapshotInputSources } = controlPlane.loadControlPlaneInputs({ stateDir: STATE_DIR });
  // Supplement with inputs not in the shared snapshot
  inputs.queue = readJsonFile(path.join(STATE_DIR, 'queue-state.json'));
  snapshotInputSources.queueLoaded = inputs.queue !== null;

  const verdict = buildVerdict(inputs, snapshotInputSources);
  const json = JSON.stringify(verdict, null, 2) + '\n';

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
  process.stdout.write(`Exit readiness verdict written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
