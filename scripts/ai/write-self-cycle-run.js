#!/usr/bin/env node

/**
 * write-self-cycle-run.js
 *
 * Append-only self-cycle run manifest writer.
 * Writes sanitized NDJSON manifests to .github/ai-state/self-cycle-runs.ndjson.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-self-cycle-run.js --help
 *   node scripts/ai/write-self-cycle-run.js --run-id cycle-20260512-001 --cycle-mode dry-run
 *   node scripts/ai/write-self-cycle-run.js --run-id cycle-20260512-001 --cycle-mode execute --outcome completed --live
 *   node scripts/ai/write-self-cycle-run.js --self-test
 *
 * Exit codes:
 *   0 — Manifest processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, sanitize, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'self-cycle-runs.ndjson');
const MANIFEST_VERSION = 1;

const CYCLE_MODES = ['dry-run', 'execute', 'autopilot-plan', 'plan-first'];
const OUTCOMES = ['completed', 'blocked', 'errored'];
const STEP_STATUSES = ['pass', 'blocked', 'skip', 'error'];
const STEP_NAMES = ['health-gate', 'provider-pool-preflight', 'launch-gate', 'batch-launch', 'cycle-summary'];

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      out[key] = sanitize(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function sanitizeSteps(steps) {
  if (!Array.isArray(steps)) return steps;
  return steps.map(function (s) {
    if (!s || typeof s !== 'object') return s;
    return {
      name: s.name,
      status: s.status,
      detail: s.detail ? sanitize(s.detail) : null,
      durationMs: s.durationMs != null ? s.durationMs : null,
    };
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  var help = [
    'write-self-cycle-run.js — Append-only self-cycle run manifest writer',
    '',
    'USAGE',
    '    node scripts/ai/write-self-cycle-run.js [OPTIONS]',
    '',
    'OPTIONS (required)',
    '    --run-id <string>        Unique run identifier (required)',
    '    --cycle-mode <mode>      Cycle mode (required). One of:',
    '                               dry-run, execute, autopilot-plan, plan-first',
    '',
    'OPTIONS (optional — identity)',
    '    --issue <number>         GitHub issue number (repeatable)',
    '    --pr <number>            GitHub pull request number (repeatable)',
    '    --task-ids <json>        JSON array of task IDs processed',
    '    --actor <string>         Who/what initiated the cycle',
    '',
    'OPTIONS (optional — outcome)',
    '    --outcome <result>       Outcome: completed, blocked, errored',
    '    --block-reason <string>  Reason if outcome is blocked',
    '    --health-state <state>   Main health state at cycle start',
    '',
    'OPTIONS (optional — structured objects, JSON strings)',
    '    --steps <json>           Array of step result objects',
    '    --meta <json>            Arbitrary key-value metadata (no secrets)',
    '',
    'OPTIONS (general)',
    '    --out <path>             Output NDJSON file path',
    '                             (default: .github/ai-state/self-cycle-runs.ndjson)',
    '    --dry-run                Preview the manifest without writing (default)',
    '    --live                   Append the manifest to the ledger file',
    '    --self-test              Run built-in validation and exit',
    '    --help, -h               Show this help message',
    '',
    'EXIT CODES',
    '    0   Manifest processed (dry-run preview or live write)',
    '    1   Self-test failure',
    '    2   Invalid arguments',
    '',
    'EXAMPLES',
    '    # Preview a dry-run cycle manifest',
    '    node scripts/ai/write-self-cycle-run.js \\',
    '      --run-id cycle-20260512-001 \\',
    '      --cycle-mode dry-run \\',
    '      --health-state green',
    '',
    '    # Record a completed execute cycle (live)',
    '    node scripts/ai/write-self-cycle-run.js \\',
    '      --run-id cycle-20260512-002 \\',
    '      --cycle-mode execute \\',
    '      --outcome completed \\',
    '      --task-ids \'["task-001","task-002"]\' \\',
    '      --health-state green \\',
    '      --actor batch-launcher \\',
    '      --live',
    '',
    '    # Record a blocked cycle',
    '    node scripts/ai/write-self-cycle-run.js \\',
    '      --run-id cycle-20260512-003 \\',
    '      --cycle-mode execute \\',
    '      --outcome blocked \\',
    '      --block-reason "Main health is red" \\',
    '      --health-state red',
    '',
    '    # Run self-test',
    '    node scripts/ai/write-self-cycle-run.js --self-test',
  ].join('\n');
  process.stdout.write(help);
}

function parseArgs(argv) {
  var args = {
    runId: null,
    cycleMode: null,
    issues: [],
    prs: [],
    taskIds: null,
    actor: null,
    outcome: null,
    blockReason: null,
    healthState: null,
    steps: null,
    meta: null,
    out: DEFAULT_OUT,
    dryRun: true,
    selfTest: false,
    help: false,
  };

  var i = 2;
  while (i < argv.length) {
    var arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--run-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --run-id requires a value'); process.exit(2); }
      args.runId = argv[i];
    } else if (arg === '--cycle-mode') {
      i++;
      if (i >= argv.length) { console.error('Error: --cycle-mode requires a value'); process.exit(2); }
      args.cycleMode = argv[i];
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a number'); process.exit(2); }
      var issueNum = parseInt(argv[i], 10);
      if (isNaN(issueNum)) { console.error('Error: --issue must be a number'); process.exit(2); }
      args.issues.push(issueNum);
    } else if (arg === '--pr') {
      i++;
      if (i >= argv.length) { console.error('Error: --pr requires a number'); process.exit(2); }
      var prNum = parseInt(argv[i], 10);
      if (isNaN(prNum)) { console.error('Error: --pr must be a number'); process.exit(2); }
      args.prs.push(prNum);
    } else if (arg === '--task-ids') {
      i++;
      if (i >= argv.length) { console.error('Error: --task-ids requires a JSON string'); process.exit(2); }
      try {
        args.taskIds = JSON.parse(argv[i]);
      } catch (e) {
        console.error('Error: --task-ids must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--actor') {
      i++;
      if (i >= argv.length) { console.error('Error: --actor requires a value'); process.exit(2); }
      args.actor = argv[i];
    } else if (arg === '--outcome') {
      i++;
      if (i >= argv.length) { console.error('Error: --outcome requires a value'); process.exit(2); }
      args.outcome = argv[i];
    } else if (arg === '--block-reason') {
      i++;
      if (i >= argv.length) { console.error('Error: --block-reason requires a value'); process.exit(2); }
      args.blockReason = argv[i];
    } else if (arg === '--health-state') {
      i++;
      if (i >= argv.length) { console.error('Error: --health-state requires a value'); process.exit(2); }
      args.healthState = argv[i];
    } else if (arg === '--steps') {
      i++;
      if (i >= argv.length) { console.error('Error: --steps requires a JSON string'); process.exit(2); }
      try {
        args.steps = JSON.parse(argv[i]);
      } catch (e) {
        console.error('Error: --steps must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--meta') {
      i++;
      if (i >= argv.length) { console.error('Error: --meta requires a JSON string'); process.exit(2); }
      try {
        args.meta = JSON.parse(argv[i]);
      } catch (e) {
        console.error('Error: --meta must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = path.resolve(argv[i]);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--live') {
      args.dryRun = false;
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error('Unknown argument: ' + arg);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate(args) {
  var errors = [];

  if (!args.runId) {
    errors.push('--run-id is required');
  }

  if (!args.cycleMode) {
    errors.push('--cycle-mode is required');
  } else if (CYCLE_MODES.indexOf(args.cycleMode) === -1) {
    errors.push('--cycle-mode must be one of: ' + CYCLE_MODES.join(', ') + '. Got: "' + args.cycleMode + '"');
  }

  if (args.outcome && OUTCOMES.indexOf(args.outcome) === -1) {
    errors.push('--outcome must be one of: ' + OUTCOMES.join(', ') + '. Got: "' + args.outcome + '"');
  }

  if (args.taskIds && !Array.isArray(args.taskIds)) {
    errors.push('--task-ids must be a JSON array');
  }

  if (args.steps) {
    if (!Array.isArray(args.steps)) {
      errors.push('--steps must be a JSON array');
    } else {
      for (var j = 0; j < args.steps.length; j++) {
        var s = args.steps[j];
        if (!s || typeof s !== 'object') {
          errors.push('--steps[' + j + '] must be an object');
        } else {
          if (s.name && STEP_NAMES.indexOf(s.name) === -1) {
            errors.push('--steps[' + j + '].name must be one of: ' + STEP_NAMES.join(', ') + '. Got: "' + s.name + '"');
          }
          if (s.status && STEP_STATUSES.indexOf(s.status) === -1) {
            errors.push('--steps[' + j + '].status must be one of: ' + STEP_STATUSES.join(', ') + '. Got: "' + s.status + '"');
          }
        }
      }
    }
  }

  if (args.meta && typeof args.meta !== 'object') {
    errors.push('--meta must be a JSON object');
  }

  if (errors.length > 0) {
    for (var e = 0; e < errors.length; e++) {
      console.error('Error: ' + errors[e]);
    }
    process.exit(2);
  }
}

// ── Manifest building ────────────────────────────────────────────────────────

function buildManifest(args) {
  var issues = args.issues || [];
  var prs = args.prs || [];
  return {
    manifestVersion: MANIFEST_VERSION,
    runId: sanitize(args.runId),
    cycleMode: args.cycleMode,
    issueNumbers: issues.length > 0 ? issues : null,
    prNumbers: prs.length > 0 ? prs : null,
    taskIds: args.taskIds ? args.taskIds.map(function (t) { return sanitize(t); }) : null,
    actor: args.actor ? sanitize(args.actor) : null,
    outcome: args.outcome || null,
    blockReason: args.blockReason ? sanitize(args.blockReason) : null,
    healthState: args.healthState || null,
    steps: args.steps ? sanitizeSteps(args.steps) : null,
    meta: args.meta ? sanitizeObject(args.meta) : null,
    capturedAt: new Date().toISOString(),
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  var passed = 0;
  var failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error('  FAIL: ' + label);
    }
  }

  function assertEq(actual, expected, label) {
    var ok = actual === expected;
    if (!ok) {
      console.error('  FAIL: ' + label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
    assert(ok, label);
  }

  console.log('write-self-cycle-run.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildManifest produces correct shape
  var m = buildManifest({
    runId: 'cycle-001',
    cycleMode: 'execute',
    issues: [100, 200],
    prs: [101],
    taskIds: ['task-a', 'task-b'],
    actor: 'batch-launcher',
    outcome: 'completed',
    blockReason: null,
    healthState: 'green',
    steps: [
      { name: 'health-gate', status: 'pass', detail: 'green', durationMs: 50 },
      { name: 'launch-gate', status: 'pass', detail: 'ok', durationMs: 100 },
    ],
    meta: { wave: 'wave16' },
  });
  assertEq(m.manifestVersion, 1, 'manifestVersion is 1');
  assertEq(m.runId, 'cycle-001', 'runId preserved');
  assertEq(m.cycleMode, 'execute', 'cycleMode preserved');
  assert(m.issueNumbers && m.issueNumbers.length === 2, 'issueNumbers preserved');
  assertEq(m.issueNumbers[0], 100, 'issueNumbers[0] correct');
  assert(m.prNumbers && m.prNumbers.length === 1, 'prNumbers preserved');
  assert(m.taskIds && m.taskIds.length === 2, 'taskIds preserved');
  assertEq(m.actor, 'batch-launcher', 'actor preserved');
  assertEq(m.outcome, 'completed', 'outcome preserved');
  assertEq(m.blockReason, null, 'null blockReason stays null');
  assertEq(m.healthState, 'green', 'healthState preserved');
  assert(m.steps && m.steps.length === 2, 'steps preserved');
  assertEq(m.steps[0].name, 'health-gate', 'step name preserved');
  assertEq(m.steps[0].status, 'pass', 'step status preserved');
  assertEq(m.steps[0].detail, 'green', 'step detail preserved');
  assertEq(m.steps[0].durationMs, 50, 'step durationMs preserved');
  assertEq(m.meta.wave, 'wave16', 'meta preserved');
  assert(typeof m.capturedAt === 'string' && m.capturedAt.includes('T'), 'capturedAt is ISO-8601');

  // Test 2: null optional fields
  var minimal = buildManifest({ runId: 'min', cycleMode: 'dry-run' });
  assertEq(minimal.issueNumbers, null, 'null issueNumbers');
  assertEq(minimal.prNumbers, null, 'null prNumbers');
  assertEq(minimal.taskIds, null, 'null taskIds');
  assertEq(minimal.actor, null, 'null actor');
  assertEq(minimal.outcome, null, 'null outcome');
  assertEq(minimal.blockReason, null, 'null blockReason');
  assertEq(minimal.healthState, null, 'null healthState');
  assertEq(minimal.steps, null, 'null steps');
  assertEq(minimal.meta, null, 'null meta');

  // Test 3: sanitize strips tokens
  var tokenStr = 'a'.repeat(50);
  assertEq(sanitize(tokenStr), '[redacted-token]', 'long base64-like string redacted');
  assertEq(sanitize('ghp_abc123xyz'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');

  // Test 4: buildManifest sanitizes fields
  var dirty = buildManifest({ runId: 'ghp_leaked', cycleMode: 'dry-run', actor: 'Bearer secret', blockReason: 'ghp_blocked' });
  assertEq(dirty.runId, '[redacted-gh-token]', 'buildManifest sanitizes runId');
  assertEq(dirty.actor, 'Bearer [redacted]', 'buildManifest sanitizes actor');
  assertEq(dirty.blockReason, '[redacted-gh-token]', 'buildManifest sanitizes blockReason');

  // Test 5: sanitizeSteps scrubs detail
  var steps = sanitizeSteps([
    { name: 'health-gate', status: 'pass', detail: 'ghp_leaked_detail', durationMs: 10 },
    { name: 'launch-gate', status: 'blocked', detail: 'Bearer bad', durationMs: null },
  ]);
  assertEq(steps[0].detail, '[redacted-gh-token]_detail', 'sanitizeSteps scrubs detail');
  assertEq(steps[0].durationMs, 10, 'sanitizeSteps preserves durationMs');
  assertEq(steps[1].detail, 'Bearer [redacted]', 'sanitizeSteps scrubs Bearer in detail');
  assertEq(steps[1].durationMs, null, 'sanitizeSteps preserves null durationMs');

  // Test 6: sanitizeObject preserves non-string types
  var obj = { str: 'ghp_leaked', num: 42, bool: true, nil: null };
  var clean = sanitizeObject(obj);
  assertEq(clean.str, '[redacted-gh-token]', 'sanitizeObject scrubs string');
  assertEq(clean.num, 42, 'sanitizeObject preserves number');
  assertEq(clean.bool, true, 'sanitizeObject preserves boolean');
  assertEq(clean.nil, null, 'sanitizeObject preserves null');

  // Test 7: sanitize truncates at 500 chars
  function longStr(n) {
    var s = '';
    for (var k = 0; k < n; k++) s += (k % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');

  // Test 8: NDJSON round-trip
  var line = JSON.stringify(m);
  var parsed = JSON.parse(line);
  assertEq(parsed.runId, 'cycle-001', 'NDJSON round-trip preserves runId');
  assertEq(parsed.cycleMode, 'execute', 'NDJSON round-trip preserves cycleMode');

  // Test 9: taskIds sanitized
  var withTasks = buildManifest({ runId: 't', cycleMode: 'dry-run', taskIds: ['ghp_task', 'safe'] });
  assertEq(withTasks.taskIds[0], '[redacted-gh-token]', 'taskIds sanitized');
  assertEq(withTasks.taskIds[1], 'safe', 'safe taskIds preserved');

  console.log();
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  var args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  validate(args);

  var manifest = buildManifest(args);
  var line = JSON.stringify(manifest);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('SELF-CYCLE RUN MANIFEST WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log('Target: ' + path.relative(REPO_ROOT, args.out).replace(/\\/g, '/'));
    console.log();
    console.log('Manifest:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the manifest to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, manifest);
  console.log('Self-cycle run manifest appended to ' + path.relative(REPO_ROOT, args.out).replace(/\\/g, '/'));
  console.log('  runId: ' + manifest.runId);
  console.log('  cycleMode: ' + manifest.cycleMode);
  console.log('  capturedAt: ' + manifest.capturedAt);
}

main();
