#!/usr/bin/env node

/**
 * emit-command-steward-status-bundle.js
 *
 * Reads control-plane state from .github/ai-state/ and GitHub API to emit
 * a single machine-readable Command Steward status bundle. Replaces manual
 * status gathering with a deterministic, sanitized snapshot.
 *
 * All inputs are optional — absent files and unreachable APIs produce safe
 * conservative defaults. Default mode is dry-run. Pass --live to persist.
 *
 * Usage:
 *   node scripts/ai/emit-command-steward-status-bundle.js [--live] [--stdout] [--self-test] [--help]
 *
 * Exit codes: 0 — bundle produced, 2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'command-steward-status-bundle.json');

const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  health:        'main-health.json',
  activeWorkers: 'active-workers.json',
  metaSignals:   'meta-signals.json',
  riskSignals:   'risk-signals.json',
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

function safeGh(args) {
  try {
    const stdout = execFileSync('gh', args, {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
emit-command-steward-status-bundle.js — Command Steward status bundle emitter (v1)

USAGE
    node scripts/ai/emit-command-steward-status-bundle.js [options]

OPTIONS
    --live          Write the bundle to the output file (default: dry-run).
    --out <path>    Output path (default: .github/ai-state/command-steward-status-bundle.json).
    --stdout        Print JSON to stdout without banner.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

INPUT FILES (all optional — absent files produce conservative defaults)
    main-health.json, active-workers.json, meta-signals.json, risk-signals.json

BUNDLE SECTIONS
    health, openPullRequests, openIssues, activeWorkers, recentTelemetry,
    blockers, inputSources

EXIT CODES
    0   Bundle produced
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

// ── Sanitization ─────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /auth/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === 'string') {
    if (value.length > 200) return value.slice(0, 200) + '…';
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

// ── Section builders ─────────────────────────────────────────────────────────

function buildHealth(health) {
  if (!health) {
    return {
      loaded: false,
      state: 'unknown',
      capturedAt: null,
      checks: [],
      failedChecks: [],
      reason: null,
    };
  }

  return {
    loaded: true,
    state: health.state || 'unknown',
    capturedAt: health.capturedAt || null,
    checks: Array.isArray(health.checks) ? health.checks : [],
    failedChecks: Array.isArray(health.failedChecks) ? health.failedChecks : [],
    reason: health.reason || null,
  };
}

function buildOpenPullRequests(prs) {
  if (!prs) {
    return { loaded: false, count: 0, pullRequests: [] };
  }

  const items = (Array.isArray(prs) ? prs : []).map(pr => ({
    number: pr.number,
    title: pr.title || '',
    author: pr.author && pr.author.login ? pr.author.login : 'unknown',
    headRefName: pr.headRefName || '',
  }));

  return {
    loaded: true,
    count: items.length,
    pullRequests: items,
  };
}

function buildOpenIssues(issues) {
  if (!issues) {
    return { loaded: false, count: 0, issues: [] };
  }

  const items = (Array.isArray(issues) ? issues : []).map(issue => ({
    number: issue.number,
    title: issue.title || '',
    state: issue.state || 'OPEN',
    labels: Array.isArray(issue.labels) ? issue.labels.map(l => typeof l === 'string' ? l : l.name || '') : [],
  }));

  return {
    loaded: true,
    count: items.length,
    issues: items,
  };
}

function buildActiveWorkers(activeWorkers) {
  if (!activeWorkers) {
    return { loaded: false, count: 0, workers: [] };
  }

  const workers = Array.isArray(activeWorkers.workers) ? activeWorkers.workers : [];
  const summaries = workers.map(w => ({
    issue: w.issue || null,
    conflictGroup: w.conflictGroup || null,
    state: w.state || 'unknown',
  }));

  return {
    loaded: true,
    count: summaries.length,
    workers: summaries,
  };
}

function buildRecentTelemetry(inputs) {
  const meta = inputs.metaSignals;
  const risk = inputs.riskSignals;

  const metaLoaded = meta && meta.signals;
  const riskLoaded = risk && Array.isArray(risk.signals);

  if (!metaLoaded && !riskLoaded) {
    return { loaded: false };
  }

  const result = { loaded: true };

  if (metaLoaded) {
    const sig = meta.signals;
    result.metaSignals = {
      failureScore: typeof sig.failureScore === 'number' ? sig.failureScore : null,
      frictionScore: typeof sig.frictionScore === 'number' ? sig.frictionScore : null,
      riskScore: typeof sig.riskScore === 'number' ? sig.riskScore : null,
      trust: typeof sig.trust === 'number' ? sig.trust : null,
      topPain: sig.topPain || null,
    };
  }

  if (riskLoaded) {
    result.riskSignalCount = risk.signals.length;
    result.riskSignals = risk.signals.slice(0, 5).map(sanitizeValue);
  }

  return result;
}

// ── Blockers ─────────────────────────────────────────────────────────────────

function collectBlockers(health, activeWorkers, prSummary, issueSummary, telemetry) {
  const blockers = [];

  // Health blockers
  if (!health || !health.loaded) {
    blockers.push({ source: 'health', severity: 'warning', message: 'main-health.json missing — health state unknown' });
  } else if (health.state === 'red' || health.state === 'black') {
    blockers.push({
      source: 'health',
      severity: health.state === 'black' ? 'critical' : 'high',
      message: `Main branch health is ${health.state}`,
      failedChecks: health.failedChecks,
    });
  }

  // Provider blockers — no active providers when workers expected
  if (activeWorkers && activeWorkers.loaded && activeWorkers.count === 0) {
    blockers.push({ source: 'workers', severity: 'info', message: 'No active workers in flight' });
  }

  // Telemetry blockers
  if (telemetry && telemetry.loaded && telemetry.metaSignals) {
    const meta = telemetry.metaSignals;
    if (meta.failureScore !== null && meta.failureScore >= 50) {
      blockers.push({ source: 'telemetry', severity: 'high', message: `Failure score ${meta.failureScore} exceeds threshold` });
    }
    if (meta.frictionScore !== null && meta.frictionScore >= 30) {
      blockers.push({ source: 'telemetry', severity: 'medium', message: `Friction score ${meta.frictionScore} indicates worker stalls` });
    }
  }

  return blockers;
}

// ── Build bundle ─────────────────────────────────────────────────────────────

function buildBundle(inputs, ghPrs, ghIssues) {
  const health = buildHealth(inputs.health);
  const openPullRequests = buildOpenPullRequests(ghPrs);
  const openIssues = buildOpenIssues(ghIssues);
  const activeWorkers = buildActiveWorkers(inputs.activeWorkers);
  const recentTelemetry = buildRecentTelemetry(inputs);

  const blockers = collectBlockers(health, activeWorkers, openPullRequests, openIssues, recentTelemetry);

  const inputSources = {};
  for (const key of Object.keys(INPUT_FILES)) {
    inputSources[`${key}Loaded`] = inputs[key] !== null;
  }
  inputSources.prDataLoaded = ghPrs !== null;
  inputSources.issueDataLoaded = ghIssues !== null;

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    health,
    openPullRequests,
    openIssues,
    activeWorkers,
    recentTelemetry,
    blockers,
    inputSources,
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

  // Test: buildBundle with all null inputs
  const emptyInputs = {};
  for (const key of Object.keys(INPUT_FILES)) { emptyInputs[key] = null; }
  const empty = buildBundle(emptyInputs, null, null);
  assert(empty.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.health.loaded === false, 'health not loaded');
  assert(empty.health.state === 'unknown', 'health unknown');
  assert(empty.openPullRequests.loaded === false, 'prs not loaded');
  assert(empty.openPullRequests.count === 0, 'pr count 0');
  assert(empty.openIssues.loaded === false, 'issues not loaded');
  assert(empty.openIssues.count === 0, 'issue count 0');
  assert(empty.activeWorkers.loaded === false, 'workers not loaded');
  assert(empty.recentTelemetry.loaded === false, 'telemetry not loaded');
  assert(empty.blockers.length > 0, 'has blockers when all null');
  for (const key of Object.keys(INPUT_FILES)) {
    assert(empty.inputSources[`${key}Loaded`] === false, `inputSources.${key}Loaded is false`);
  }
  assert(empty.inputSources.prDataLoaded === false, 'prDataLoaded is false');
  assert(empty.inputSources.issueDataLoaded === false, 'issueDataLoaded is false');

  // Test: buildBundle with full healthy inputs
  const fullInputs = {
    health: { state: 'green', capturedAt: '2026-01-01T00:00:00.000Z', checks: ['tsc', 'lint'], failedChecks: [], reason: null },
    activeWorkers: { workers: [{ issue: 100, conflictGroup: 'runtime-feature', state: 'active' }] },
    metaSignals: { signals: { failureScore: 0, frictionScore: 0, riskScore: 10, trust: 90, topPain: 'none' } },
    riskSignals: { signals: [{ id: 'r1' }] },
  };
  const mockPrs = [{ number: 50, title: 'feat: something', author: { login: 'bot' }, headRefName: 'claude/issue-50' }];
  const mockIssues = [
    { number: 1195, title: 'feat(ai): add status bundle', state: 'OPEN', labels: [] },
    { number: 96, title: '讨论：沉淀架构', state: 'OPEN', labels: [] },
  ];
  const full = buildBundle(fullInputs, mockPrs, mockIssues);
  assert(full.health.loaded === true, 'health loaded');
  assert(full.health.state === 'green', 'health green');
  assert(full.openPullRequests.loaded === true, 'prs loaded');
  assert(full.openPullRequests.count === 1, 'pr count 1');
  assert(full.openPullRequests.pullRequests[0].number === 50, 'pr number');
  assert(full.openIssues.loaded === true, 'issues loaded');
  assert(full.openIssues.count === 2, 'issue count 2');
  assert(full.openIssues.issues.some(i => i.number === 96), 'issue 96 present');
  assert(full.activeWorkers.loaded === true, 'workers loaded');
  assert(full.activeWorkers.count === 1, 'worker count 1');
  assert(full.recentTelemetry.loaded === true, 'telemetry loaded');
  assert(full.recentTelemetry.metaSignals.trust === 90, 'trust score');
  assert(full.inputSources.prDataLoaded === true, 'prDataLoaded true');
  assert(full.inputSources.issueDataLoaded === true, 'issueDataLoaded true');

  // Test: red health produces blocker
  const redInputs = { ...emptyInputs, health: { state: 'red', capturedAt: '2026-01-01T00:00:00.000Z', failedChecks: ['tsc'] } };
  const red = buildBundle(redInputs, null, null);
  assert(red.health.state === 'red', 'health red');
  assert(red.blockers.some(b => b.source === 'health' && b.severity === 'high'), 'red health blocker');

  // Test: black health produces critical blocker
  const blackInputs = { ...emptyInputs, health: { state: 'black', capturedAt: '2026-01-01T00:00:00.000Z' } };
  const black = buildBundle(blackInputs, null, null);
  assert(black.blockers.some(b => b.source === 'health' && b.severity === 'critical'), 'black health blocker');

  // Test: high failure score produces blocker
  const failInputs = { ...emptyInputs, metaSignals: { signals: { failureScore: 60, frictionScore: 0, riskScore: 0, trust: 40, topPain: 'timeout' } } };
  const fail = buildBundle(failInputs, null, null);
  assert(fail.blockers.some(b => b.source === 'telemetry' && b.severity === 'high'), 'failure score blocker');

  // Test: expected top-level keys
  const expectedKeys = ['schemaVersion', 'capturedAt', 'health', 'openPullRequests',
    'openIssues', 'activeWorkers', 'recentTelemetry', 'blockers', 'inputSources'];
  for (const key of expectedKeys) { assert(key in full, `key ${key} present`); }

  // Report
  console.log(`\n  emit-command-steward-status-bundle self-test`);
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

  // Read local state files
  const inputs = {};
  for (const [key, filename] of Object.entries(INPUT_FILES)) {
    inputs[key] = readJsonFile(path.join(STATE_DIR, filename));
  }

  // Fetch GitHub data via gh CLI
  const ghPrs = safeGh(['pr', 'list', '--limit', '50', '--json', 'number,title,author,headRefName']);
  const ghIssues = safeGh(['issue', 'list', '--limit', '50', '--json', 'number,title,state,labels']);

  const bundle = buildBundle(inputs, ghPrs, ghIssues);
  const json = JSON.stringify(bundle, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  if (!args.live) {
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
  process.stdout.write(`Command Steward status bundle written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
