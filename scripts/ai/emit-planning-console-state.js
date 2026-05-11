#!/usr/bin/env node

/**
 * emit-planning-console-state.js
 *
 * Reads gap ledger, meta-signals, active workers, worker trust, and queue
 * state from .github/ai-state/ and produces a gap discovery projection
 * for the Planning Console in the WebUI.
 *
 * Input sources (all optional — absent files produce null/empty defaults):
 *   gap-ledger.ndjson    — Append-only NDJSON gap events
 *   meta-signals.json    — MetaSignals (aggregate health signals)
 *   active-workers.json  — ActiveWorkers (in-flight workers)
 *   worker-trust.json    — WorkerTrust (trust scores & scheduling)
 *   queue-state.json     — WebUIQueueState (queue lifecycle entries)
 *
 * Safe skeleton: when an input file is missing or malformed, the
 * corresponding section is null/empty so downstream consumers never break.
 *
 * Default mode is dry-run: prints a preview to stdout without writing.
 * Pass --live to persist the snapshot to the output file.
 *
 * Usage:
 *   node scripts/ai/emit-planning-console-state.js --help
 *   node scripts/ai/emit-planning-console-state.js
 *   node scripts/ai/emit-planning-console-state.js --live
 *   node scripts/ai/emit-planning-console-state.js --stdout
 *
 * Exit codes:
 *   0 — snapshot produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'planning-console-state.json');

const SCHEMA_VERSION = 1;

const GAP_TYPES = [
  'worker-failed',
  'worker-stale',
  'health-gate-fail',
  'launch-blocked',
  'plan-drift',
  'stale-row',
];

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const INPUT_FILES = {
  gapLedger:     'gap-ledger.ndjson',
  metaSignals:   'meta-signals.json',
  activeWorkers: 'active-workers.json',
  workerTrust:   'worker-trust.json',
  queue:         'queue-state.json',
};

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;    // 24 hours
const TREND_WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;
const TREND_WINDOW_30D_MS = 30 * 24 * 60 * 60 * 1000;

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

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines silently — non-destructive
    }
  }
  return entries;
}

function zeroByType() {
  const result = {};
  for (const t of GAP_TYPES) result[t] = 0;
  return result;
}

function zeroBySeverity() {
  const result = {};
  for (const s of SEVERITIES) result[s] = 0;
  return result;
}

function printHelp() {
  const help = `
emit-planning-console-state.js — Planning Console gap discovery projection (v1)

USAGE
    node scripts/ai/emit-planning-console-state.js [options]

OPTIONS
    --live          Write the snapshot to the output file.
                    Without this flag, the script runs in dry-run mode
                    and prints a preview to stdout without writing.
    --out <path>    Output path for the planning console state JSON.
                    (default: .github/ai-state/planning-console-state.json)
    --stdout        Print JSON to stdout instead of writing a file.
                    Overrides --out. Always prints regardless of --live.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

INPUT FILES (all optional — absent files produce null/empty defaults)
    .github/ai-state/gap-ledger.ndjson     Gap events (NDJSON)
    .github/ai-state/meta-signals.json     MetaSignals
    .github/ai-state/active-workers.json   ActiveWorkers
    .github/ai-state/worker-trust.json     WorkerTrust
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

// ── Gap analysis ─────────────────────────────────────────────────────────────

function sanitizeEntry(entry) {
  // Strip meta field to avoid leaking secrets; keep only safe fields
  const safe = {
    gapType: entry.gapType || 'unknown',
    severity: entry.severity || 'medium',
    description: entry.description || '',
    recordedAt: entry.recordedAt || null,
  };
  if (entry.issue != null) safe.issue = entry.issue;
  if (entry.pr != null) safe.pr = entry.pr;
  if (entry.branch) safe.branch = entry.branch;
  return safe;
}

function buildGapSummary(entries) {
  const byType = zeroByType();
  const bySeverity = zeroBySeverity();

  for (const entry of entries) {
    const t = entry.gapType || 'unknown';
    const s = entry.severity || 'medium';
    if (t in byType) byType[t]++;
    if (s in bySeverity) bySeverity[s]++;
  }

  return {
    total: entries.length,
    byType,
    bySeverity,
  };
}

function buildRecentGaps(entries, now) {
  const cutoff = now - RECENT_WINDOW_MS;
  const recent = entries.filter(e => {
    if (!e.recordedAt) return false;
    const ts = new Date(e.recordedAt).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });
  return {
    count: recent.length,
    windowHours: 24,
    entries: recent.map(sanitizeEntry),
  };
}

function buildTrend(entries, now) {
  const cutoff7d = now - TREND_WINDOW_7D_MS;
  const cutoff30d = now - TREND_WINDOW_30D_MS;
  const byType7d = zeroByType();
  let total7d = 0;
  let total30d = 0;

  for (const entry of entries) {
    if (!entry.recordedAt) continue;
    const ts = new Date(entry.recordedAt).getTime();
    if (isNaN(ts)) continue;
    if (ts >= cutoff30d) {
      total30d++;
      if (ts >= cutoff7d) {
        total7d++;
        const t = entry.gapType || 'unknown';
        if (t in byType7d) byType7d[t]++;
      }
    }
  }

  return { total7d, total30d, byType7d };
}

function buildUnresolvedGaps(entries) {
  // Heuristic: most recent gap per issue number is unresolved if its type
  // suggests an open problem (worker-failed, worker-stale, health-gate-fail).
  // Gaps without an issue number are tracked individually.
  const terminalTypes = new Set(['plan-drift', 'stale-row']);
  const unresolved = [];
  const seenIssues = new Set();

  // Walk in reverse (newest first) to find latest per issue
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const issue = entry.issue;
    if (issue != null) {
      if (seenIssues.has(issue)) continue;
      seenIssues.add(issue);
    }
    if (!terminalTypes.has(entry.gapType)) {
      unresolved.push(sanitizeEntry(entry));
    }
  }

  const bySeverity = zeroBySeverity();
  for (const g of unresolved) {
    const s = g.severity || 'medium';
    if (s in bySeverity) bySeverity[s]++;
  }

  return {
    count: unresolved.length,
    bySeverity,
    entries: unresolved,
  };
}

// ── Build planning console state ─────────────────────────────────────────────

function buildPlanningConsoleState(inputs, now) {
  const gapEntries = inputs.gapEntries;
  const metaSignals = inputs.metaSignals;
  const activeWorkers = inputs.activeWorkers;
  const workerTrust = inputs.workerTrust;
  const queue = inputs.queue;

  const gapSummary = buildGapSummary(gapEntries);
  const unresolvedGaps = buildUnresolvedGaps(gapEntries);
  const recentGaps = buildRecentGaps(gapEntries, now);
  const trend = buildTrend(gapEntries, now);

  const signals = metaSignals && metaSignals.signals
    ? {
        failureScore: metaSignals.signals.failureScore,
        frictionScore: metaSignals.signals.frictionScore,
        riskScore: metaSignals.signals.riskScore,
        trust: metaSignals.signals.trust,
        topPain: metaSignals.signals.topPain,
      }
    : null;

  const activeWorkerCount = activeWorkers && Array.isArray(activeWorkers.workers)
    ? activeWorkers.workers.length
    : 0;

  const trustScheduling = workerTrust && workerTrust.scheduling
    ? {
        minTrustToLaunch: workerTrust.scheduling.minTrustToLaunch,
        highTrustThreshold: workerTrust.scheduling.highTrustThreshold,
        ruleCount: Array.isArray(workerTrust.scheduling.rules)
          ? workerTrust.scheduling.rules.length
          : 0,
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

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date(now).toISOString(),
    gapSummary,
    unresolvedGaps,
    recentGaps,
    trend,
    planningHealth: signals,
    activeWorkers: {
      count: activeWorkerCount,
    },
    workerTrust: trustScheduling,
    queue: {
      entryCount: queueEntryCount,
      summary: queueSummary,
    },
    inputSources: {
      gapLedgerLoaded: gapEntries.length > 0,
      metaSignalsLoaded: !!metaSignals,
      activeWorkersLoaded: !!activeWorkers,
      workerTrustLoaded: !!workerTrust,
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

  const now = Date.now();

  // Test: buildPlanningConsoleState with all null inputs
  const empty = buildPlanningConsoleState({
    gapEntries: [],
    metaSignals: null,
    activeWorkers: null,
    workerTrust: null,
    queue: null,
  }, now);
  assert(empty.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.gapSummary.total === 0, 'gapSummary total 0');
  assert(empty.gapSummary.byType['worker-failed'] === 0, 'gapSummary byType defaults 0');
  assert(empty.gapSummary.bySeverity.high === 0, 'gapSummary bySeverity defaults 0');
  assert(empty.unresolvedGaps.count === 0, 'unresolvedGaps count 0');
  assert(empty.recentGaps.count === 0, 'recentGaps count 0');
  assert(empty.recentGaps.windowHours === 24, 'recentGaps windowHours 24');
  assert(empty.trend.total7d === 0, 'trend total7d 0');
  assert(empty.trend.total30d === 0, 'trend total30d 0');
  assert(empty.planningHealth === null, 'planningHealth null when no metaSignals');
  assert(empty.activeWorkers.count === 0, 'activeWorkers count 0');
  assert(empty.workerTrust === null, 'workerTrust null when missing');
  assert(empty.queue.entryCount === 0, 'queue entryCount 0');
  assert(empty.queue.summary === null, 'queue summary null when missing');
  assert(empty.inputSources.gapLedgerLoaded === false, 'gapLedgerLoaded false');
  assert(empty.inputSources.metaSignalsLoaded === false, 'metaSignalsLoaded false');

  // Test: with gap entries
  const withGaps = buildPlanningConsoleState({
    gapEntries: [
      { gapType: 'worker-failed', severity: 'high', description: 'exit 1', recordedAt: new Date(now - 1000).toISOString(), issue: 100 },
      { gapType: 'health-gate-fail', severity: 'critical', description: 'tsc failed', recordedAt: new Date(now - 2000).toISOString(), issue: 101 },
      { gapType: 'plan-drift', severity: 'low', description: 'deferred', recordedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(), issue: 102 },
    ],
    metaSignals: null,
    activeWorkers: null,
    workerTrust: null,
    queue: null,
  }, now);
  assert(withGaps.gapSummary.total === 3, 'gapSummary total 3');
  assert(withGaps.gapSummary.byType['worker-failed'] === 1, 'gapSummary byType worker-failed 1');
  assert(withGaps.gapSummary.bySeverity.critical === 1, 'gapSummary bySeverity critical 1');
  assert(withGaps.recentGaps.count === 2, 'recentGaps count 2 (within 24h)');
  assert(withGaps.recentGaps.entries.length === 2, 'recentGaps entries length 2');
  assert(withGaps.trend.total7d === 2, 'trend total7d 2');
  assert(withGaps.trend.total30d === 3, 'trend total30d 3');
  assert(withGaps.trend.byType7d['worker-failed'] === 1, 'trend byType7d worker-failed 1');

  // Test: unresolvedGaps excludes plan-drift
  assert(withGaps.unresolvedGaps.count === 2, 'unresolvedGaps excludes plan-drift');
  const unresolvedTypes = withGaps.unresolvedGaps.entries.map(e => e.gapType);
  assert(!unresolvedTypes.includes('plan-drift'), 'unresolvedGaps does not include plan-drift');

  // Test: with metaSignals
  const withSignals = buildPlanningConsoleState({
    gapEntries: [],
    metaSignals: {
      signals: { failureScore: 15, frictionScore: 8, riskScore: 5, trust: 85, topPain: 'runtime compile' },
    },
    activeWorkers: null,
    workerTrust: null,
    queue: null,
  }, now);
  assert(withSignals.planningHealth.failureScore === 15, 'planningHealth failureScore');
  assert(withSignals.planningHealth.trust === 85, 'planningHealth trust');
  assert(withSignals.planningHealth.topPain === 'runtime compile', 'planningHealth topPain');
  assert(withSignals.inputSources.metaSignalsLoaded === true, 'metaSignalsLoaded true');

  // Test: with active workers
  const withWorkers = buildPlanningConsoleState({
    gapEntries: [],
    metaSignals: null,
    activeWorkers: {
      workers: [
        { conflictGroup: 'a', issue: 1 },
        { conflictGroup: 'b', issue: 2 },
      ],
    },
    workerTrust: null,
    queue: null,
  }, now);
  assert(withWorkers.activeWorkers.count === 2, 'activeWorkers count 2');
  assert(withWorkers.inputSources.activeWorkersLoaded === true, 'activeWorkersLoaded true');

  // Test: with worker trust
  const withTrust = buildPlanningConsoleState({
    gapEntries: [],
    metaSignals: null,
    activeWorkers: null,
    workerTrust: {
      scheduling: {
        minTrustToLaunch: 0.3,
        highTrustThreshold: 0.8,
        rules: [{ condition: 'trustScore < 0.3', action: 'block_launch' }],
      },
    },
    queue: null,
  }, now);
  assert(withTrust.workerTrust.minTrustToLaunch === 0.3, 'workerTrust minTrustToLaunch');
  assert(withTrust.workerTrust.ruleCount === 1, 'workerTrust ruleCount');
  assert(withTrust.inputSources.workerTrustLoaded === true, 'workerTrustLoaded true');

  // Test: with queue
  const withQueue = buildPlanningConsoleState({
    gapEntries: [],
    metaSignals: null,
    activeWorkers: null,
    workerTrust: null,
    queue: {
      entries: [
        { issueNumber: 1, state: 'running' },
        { issueNumber: 2, state: 'blocked' },
      ],
      summary: { queued: 0, launching: 0, running: 1, prCreated: 0, blocked: 1, done: 0 },
    },
  }, now);
  assert(withQueue.queue.entryCount === 2, 'queue entryCount 2');
  assert(withQueue.queue.summary.running === 1, 'queue summary running');
  assert(withQueue.queue.summary.blocked === 1, 'queue summary blocked');
  assert(withQueue.inputSources.queueLoaded === true, 'queueLoaded true');

  // Test: sanitizeEntry strips meta
  const raw = { gapType: 'worker-failed', severity: 'high', description: 'test', meta: { token: 'secret' }, issue: 1, pr: 2, branch: 'feat-a', recordedAt: '2026-01-01T00:00:00.000Z' };
  const sanitized = sanitizeEntry(raw);
  assert(!('meta' in sanitized), 'sanitizeEntry strips meta');
  assert(sanitized.issue === 1, 'sanitizeEntry keeps issue');
  assert(sanitized.pr === 2, 'sanitizeEntry keeps pr');
  assert(sanitized.branch === 'feat-a', 'sanitizeEntry keeps branch');

  // Test: unresolvedGaps with duplicate issues keeps latest
  const dupeGaps = buildPlanningConsoleState({
    gapEntries: [
      { gapType: 'worker-failed', severity: 'high', description: 'first', recordedAt: new Date(now - 5000).toISOString(), issue: 200 },
      { gapType: 'worker-failed', severity: 'medium', description: 'second', recordedAt: new Date(now - 1000).toISOString(), issue: 200 },
    ],
    metaSignals: null,
    activeWorkers: null,
    workerTrust: null,
    queue: null,
  }, now);
  assert(dupeGaps.unresolvedGaps.count === 1, 'unresolvedGaps deduplicates by issue');
  assert(dupeGaps.unresolvedGaps.entries[0].description === 'second', 'unresolvedGaps keeps latest per issue');

  // Test: readJsonFile with nonexistent path
  const missing = readJsonFile('/nonexistent/path.json');
  assert(missing === null, 'readJsonFile missing returns null');

  // Test: readNdjson with nonexistent path
  const missingNdjson = readNdjson('/nonexistent/path.ndjson');
  assert(missingNdjson.length === 0, 'readNdjson missing returns empty array');

  // Test: readNdjson with valid file
  const os = require('os');
  const tmpPath = path.join(os.tmpdir(), `selftest-planning-console-${Date.now()}.ndjson`);
  fs.writeFileSync(tmpPath, '{"gapType":"worker-failed","severity":"high","description":"test"}\n', 'utf8');
  const loaded = readNdjson(tmpPath);
  assert(loaded.length === 1, 'readNdjson loads valid NDJSON');
  assert(loaded[0].gapType === 'worker-failed', 'readNdjson parses entry');
  fs.unlinkSync(tmpPath);

  // Test: readNdjson with malformed lines
  const badPath = path.join(os.tmpdir(), `selftest-planning-console-bad-${Date.now()}.ndjson`);
  fs.writeFileSync(badPath, 'not json\n{"gapType":"ok"}\n', 'utf8');
  const badResult = readNdjson(badPath);
  assert(badResult.length === 1, 'readNdjson skips malformed lines');
  fs.unlinkSync(badPath);

  // Report
  console.log(`\n  emit-planning-console-state self-test`);
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

  const now = Date.now();

  // Read inputs
  const gapEntries = readNdjson(path.join(STATE_DIR, INPUT_FILES.gapLedger));
  const metaSignals = readJsonFile(path.join(STATE_DIR, INPUT_FILES.metaSignals));
  const activeWorkers = readJsonFile(path.join(STATE_DIR, INPUT_FILES.activeWorkers));
  const workerTrust = readJsonFile(path.join(STATE_DIR, INPUT_FILES.workerTrust));
  const queue = readJsonFile(path.join(STATE_DIR, INPUT_FILES.queue));

  const snapshot = buildPlanningConsoleState({
    gapEntries,
    metaSignals,
    activeWorkers,
    workerTrust,
    queue,
  }, now);

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
  process.stdout.write(`Planning console state written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
