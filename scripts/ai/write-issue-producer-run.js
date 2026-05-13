#!/usr/bin/env node

/**
 * write-issue-producer-run.js
 *
 * Append-only issue producer run record writer.
 * Writes sanitized NDJSON records to .github/ai-state/issue-producer-runs.ndjson.
 *
 * Records what facts generated which issues, which were rejected, and why,
 * making task production auditable.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-issue-producer-run.js --help
 *   node scripts/ai/write-issue-producer-run.js --run-id run-001 --actor self-cycle --mode dry-run
 *   node scripts/ai/write-issue-producer-run.js --run-id run-001 --actor self-cycle --mode execute --outcome completed --live
 *   node scripts/ai/write-issue-producer-run.js --self-test
 *
 * Exit codes:
 *   0 — Record processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO_ROOT, sanitize, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'issue-producer-runs.ndjson');
const SCHEMA_VERSION = 1;

const MODES = ['dry-run', 'execute'];
const OUTCOMES = ['completed', 'blocked', 'errored'];
const TASK_TYPES = ['execution', 'research', 'review'];
const RISKS = ['low', 'medium', 'high'];
const ISSUE_STATUSES = ['proposed', 'created', 'blocked', 'failed'];

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  var out = {};
  for (var _i = 0, _a = Object.entries(obj); _i < _a.length; _i++) {
    var entry = _a[_i];
    var key = entry[0];
    var value = entry[1];
    if (typeof value === 'string') {
      out[key] = sanitize(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function sanitizeArray(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(function (s) { return typeof s === 'string' ? sanitize(s) : s; });
}

function sanitizeFacts(facts) {
  if (!Array.isArray(facts)) return facts;
  return facts.map(function (f) {
    if (!f || typeof f !== 'object') return f;
    return {
      factId: sanitize(f.factId),
      source: sanitize(f.source),
      description: f.description ? sanitize(f.description) : null,
    };
  });
}

function sanitizeProducedIssues(issues) {
  if (!Array.isArray(issues)) return issues;
  return issues.map(function (iss) {
    if (!iss || typeof iss !== 'object') return iss;
    return {
      issueNumber: iss.issueNumber != null ? iss.issueNumber : null,
      title: sanitize(iss.title),
      taskType: iss.taskType,
      risk: iss.risk,
      conflictGroup: sanitize(iss.conflictGroup),
      actorRole: iss.actorRole ? sanitize(iss.actorRole) : null,
      allowedFiles: sanitizeArray(iss.allowedFiles),
      forbiddenFiles: sanitizeArray(iss.forbiddenFiles),
      validationCommands: sanitizeArray(iss.validationCommands),
      rationale: iss.rationale ? sanitize(iss.rationale) : null,
      macroGoal: iss.macroGoal ? sanitize(iss.macroGoal) : null,
      status: iss.status,
      humanRequired: iss.humanRequired != null ? iss.humanRequired : false,
    };
  });
}

function sanitizeRejectedIssues(issues) {
  if (!Array.isArray(issues)) return issues;
  return issues.map(function (iss) {
    if (!iss || typeof iss !== 'object') return iss;
    return {
      title: sanitize(iss.title),
      conflictGroup: iss.conflictGroup ? sanitize(iss.conflictGroup) : null,
      reason: sanitize(iss.reason),
    };
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  var help = [
    'write-issue-producer-run.js — Append-only issue producer run record writer',
    '',
    'USAGE',
    '    node scripts/ai/write-issue-producer-run.js [OPTIONS]',
    '',
    'OPTIONS (required)',
    '    --run-id <string>        Unique run identifier (required)',
    '    --actor <string>         Who/what initiated the run (required)',
    '    --mode <mode>            Run mode (required). One of: dry-run, execute',
    '',
    'OPTIONS (optional — outcome)',
    '    --outcome <result>       Outcome: completed, blocked, errored',
    '    --block-reason <string>  Reason if outcome is blocked',
    '',
    'OPTIONS (optional — structured objects, JSON strings)',
    '    --facts <json>           JSON array of fact references consumed',
    '    --produced <json>        JSON array of produced issue objects',
    '    --rejected <json>        JSON array of rejected issue objects',
    '    --meta <json>            Arbitrary key-value metadata (no secrets)',
    '',
    'OPTIONS (general)',
    '    --out <path>             Output NDJSON file path',
    '                             (default: .github/ai-state/issue-producer-runs.ndjson)',
    '    --dry-run                Preview the record without writing (default)',
    '    --live                   Append the record to the ledger file',
    '    --self-test              Run built-in validation and exit',
    '    --help, -h               Show this help message',
    '',
    'EXIT CODES',
    '    0   Record processed (dry-run preview or live write)',
    '    1   Self-test failure',
    '    2   Invalid arguments',
    '',
    'EXAMPLES',
    '    # Preview a dry-run production record',
    '    node scripts/ai/write-issue-producer-run.js \\',
    '      --run-id run-20260512-001 \\',
    '      --actor self-cycle \\',
    '      --mode dry-run',
    '',
    '    # Record a completed production run (live)',
    '    node scripts/ai/write-issue-producer-run.js \\',
    '      --run-id run-20260512-002 \\',
    '      --actor self-cycle \\',
    '      --mode execute \\',
    '      --outcome completed \\',
    '      --facts \'[{"factId":"fact:health:green","source":"main-health.json"}]\' \\',
    '      --produced \'[{"title":"Add docs","taskType":"execution","risk":"low","conflictGroup":"docs","allowedFiles":["docs/**"],"forbiddenFiles":["src/**"],"validationCommands":["npm run check"],"status":"created","humanRequired":false}]\' \\',
    '      --live',
    '',
    '    # Run self-test',
    '    node scripts/ai/write-issue-producer-run.js --self-test',
  ].join('\n');
  process.stdout.write(help);
}

function parseArgs(argv) {
  var args = {
    runId: null,
    actor: null,
    mode: null,
    outcome: null,
    blockReason: null,
    facts: null,
    produced: null,
    rejected: null,
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
    } else if (arg === '--actor') {
      i++;
      if (i >= argv.length) { console.error('Error: --actor requires a value'); process.exit(2); }
      args.actor = argv[i];
    } else if (arg === '--mode') {
      i++;
      if (i >= argv.length) { console.error('Error: --mode requires a value'); process.exit(2); }
      args.mode = argv[i];
    } else if (arg === '--outcome') {
      i++;
      if (i >= argv.length) { console.error('Error: --outcome requires a value'); process.exit(2); }
      args.outcome = argv[i];
    } else if (arg === '--block-reason') {
      i++;
      if (i >= argv.length) { console.error('Error: --block-reason requires a value'); process.exit(2); }
      args.blockReason = argv[i];
    } else if (arg === '--facts') {
      i++;
      if (i >= argv.length) { console.error('Error: --facts requires a JSON string'); process.exit(2); }
      try {
        args.facts = JSON.parse(argv[i]);
      } catch (e) {
        console.error('Error: --facts must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--produced') {
      i++;
      if (i >= argv.length) { console.error('Error: --produced requires a JSON string'); process.exit(2); }
      try {
        args.produced = JSON.parse(argv[i]);
      } catch (e) {
        console.error('Error: --produced must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--rejected') {
      i++;
      if (i >= argv.length) { console.error('Error: --rejected requires a JSON string'); process.exit(2); }
      try {
        args.rejected = JSON.parse(argv[i]);
      } catch (e) {
        console.error('Error: --rejected must be valid JSON');
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

  if (!args.actor) {
    errors.push('--actor is required');
  }

  if (!args.mode) {
    errors.push('--mode is required');
  } else if (MODES.indexOf(args.mode) === -1) {
    errors.push('--mode must be one of: ' + MODES.join(', ') + '. Got: "' + args.mode + '"');
  }

  if (args.outcome && OUTCOMES.indexOf(args.outcome) === -1) {
    errors.push('--outcome must be one of: ' + OUTCOMES.join(', ') + '. Got: "' + args.outcome + '"');
  }

  if (args.facts) {
    if (!Array.isArray(args.facts)) {
      errors.push('--facts must be a JSON array');
    } else {
      for (var j = 0; j < args.facts.length; j++) {
        var f = args.facts[j];
        if (!f || typeof f !== 'object') {
          errors.push('--facts[' + j + '] must be an object');
        } else if (!f.factId) {
          errors.push('--facts[' + j + '].factId is required');
        } else if (!f.source) {
          errors.push('--facts[' + j + '].source is required');
        }
      }
    }
  }

  if (args.produced) {
    if (!Array.isArray(args.produced)) {
      errors.push('--produced must be a JSON array');
    } else {
      for (var k = 0; k < args.produced.length; k++) {
        var p = args.produced[k];
        if (!p || typeof p !== 'object') {
          errors.push('--produced[' + k + '] must be an object');
        } else {
          if (!p.title) errors.push('--produced[' + k + '].title is required');
          if (p.taskType && TASK_TYPES.indexOf(p.taskType) === -1) {
            errors.push('--produced[' + k + '].taskType must be one of: ' + TASK_TYPES.join(', '));
          }
          if (p.risk && RISKS.indexOf(p.risk) === -1) {
            errors.push('--produced[' + k + '].risk must be one of: ' + RISKS.join(', '));
          }
          if (p.status && ISSUE_STATUSES.indexOf(p.status) === -1) {
            errors.push('--produced[' + k + '].status must be one of: ' + ISSUE_STATUSES.join(', '));
          }
        }
      }
    }
  }

  if (args.rejected) {
    if (!Array.isArray(args.rejected)) {
      errors.push('--rejected must be a JSON array');
    } else {
      for (var m = 0; m < args.rejected.length; m++) {
        var r = args.rejected[m];
        if (!r || typeof r !== 'object') {
          errors.push('--rejected[' + m + '] must be an object');
        } else {
          if (!r.title) errors.push('--rejected[' + m + '].title is required');
          if (!r.reason) errors.push('--rejected[' + m + '].reason is required');
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

// ── Record building ──────────────────────────────────────────────────────────

function buildRecord(args) {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: sanitize(args.runId),
    recordedAt: new Date().toISOString(),
    actor: sanitize(args.actor),
    mode: args.mode,
    factsConsumed: args.facts ? sanitizeFacts(args.facts) : [],
    issuesProduced: args.produced ? sanitizeProducedIssues(args.produced) : [],
    issuesRejected: args.rejected ? sanitizeRejectedIssues(args.rejected) : [],
    outcome: args.outcome || null,
    blockReason: args.blockReason ? sanitize(args.blockReason) : null,
    meta: args.meta ? sanitizeObject(args.meta) : null,
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

  console.log('write-issue-producer-run.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildRecord produces correct shape
  var rec = buildRecord({
    runId: 'run-001',
    actor: 'self-cycle',
    mode: 'execute',
    outcome: 'completed',
    facts: [
      { factId: 'fact:health:green', source: 'main-health.json', description: 'Health is green' },
    ],
    produced: [
      {
        title: 'Add docs',
        issueNumber: 100,
        taskType: 'execution',
        risk: 'low',
        conflictGroup: 'docs',
        actorRole: 'worker',
        allowedFiles: ['docs/**'],
        forbiddenFiles: ['src/**'],
        validationCommands: ['npm run check'],
        rationale: 'Docs missing',
        macroGoal: 'docs-coverage',
        status: 'created',
        humanRequired: false,
      },
    ],
    rejected: [
      { title: 'Old issue', conflictGroup: 'old', reason: 'title overlap with existing' },
    ],
    meta: { wave: 'wave16' },
  });

  assertEq(rec.schemaVersion, 1, 'schemaVersion is 1');
  assert(typeof rec.runId === 'string' && rec.runId.length > 0, 'runId is non-empty string');
  assert(typeof rec.recordedAt === 'string' && rec.recordedAt.includes('T'), 'recordedAt is ISO-8601');
  assertEq(rec.actor, 'self-cycle', 'actor preserved');
  assertEq(rec.mode, 'execute', 'mode preserved');
  assert(rec.factsConsumed && rec.factsConsumed.length === 1, 'factsConsumed preserved');
  assertEq(rec.factsConsumed[0].factId, 'fact:health:green', 'fact factId preserved');
  assertEq(rec.factsConsumed[0].source, 'main-health.json', 'fact source preserved');
  assertEq(rec.factsConsumed[0].description, 'Health is green', 'fact description preserved');
  assert(rec.issuesProduced && rec.issuesProduced.length === 1, 'issuesProduced preserved');
  assertEq(rec.issuesProduced[0].title, 'Add docs', 'produced title preserved');
  assertEq(rec.issuesProduced[0].issueNumber, 100, 'produced issueNumber preserved');
  assertEq(rec.issuesProduced[0].taskType, 'execution', 'produced taskType preserved');
  assertEq(rec.issuesProduced[0].risk, 'low', 'produced risk preserved');
  assertEq(rec.issuesProduced[0].conflictGroup, 'docs', 'produced conflictGroup preserved');
  assertEq(rec.issuesProduced[0].actorRole, 'worker', 'produced actorRole preserved');
  assert(rec.issuesProduced[0].allowedFiles.length === 1, 'produced allowedFiles preserved');
  assert(rec.issuesProduced[0].forbiddenFiles.length === 1, 'produced forbiddenFiles preserved');
  assert(rec.issuesProduced[0].validationCommands.length === 1, 'produced validationCommands preserved');
  assertEq(rec.issuesProduced[0].rationale, 'Docs missing', 'produced rationale preserved');
  assertEq(rec.issuesProduced[0].macroGoal, 'docs-coverage', 'produced macroGoal preserved');
  assertEq(rec.issuesProduced[0].status, 'created', 'produced status preserved');
  assertEq(rec.issuesProduced[0].humanRequired, false, 'produced humanRequired preserved');
  assert(rec.issuesRejected && rec.issuesRejected.length === 1, 'issuesRejected preserved');
  assertEq(rec.issuesRejected[0].title, 'Old issue', 'rejected title preserved');
  assertEq(rec.issuesRejected[0].reason, 'title overlap with existing', 'rejected reason preserved');
  assertEq(rec.outcome, 'completed', 'outcome preserved');
  assertEq(rec.blockReason, null, 'null blockReason stays null');
  assertEq(rec.meta.wave, 'wave16', 'meta preserved');

  // Test 2: minimal record (null optionals)
  var minimal = buildRecord({ runId: 'min', actor: 'test', mode: 'dry-run' });
  assert(Array.isArray(minimal.factsConsumed) && minimal.factsConsumed.length === 0, 'empty factsConsumed');
  assert(Array.isArray(minimal.issuesProduced) && minimal.issuesProduced.length === 0, 'empty issuesProduced');
  assert(Array.isArray(minimal.issuesRejected) && minimal.issuesRejected.length === 0, 'empty issuesRejected');
  assertEq(minimal.outcome, null, 'null outcome');
  assertEq(minimal.blockReason, null, 'null blockReason');
  assertEq(minimal.meta, null, 'null meta');

  // Test 3: sanitize strips tokens
  var dirty = buildRecord({
    runId: 'ghp_leaked',
    actor: 'Bearer secret',
    mode: 'dry-run',
    blockReason: 'ghp_blocked',
  });
  assertEq(dirty.runId, '[redacted-gh-token]', 'runId ghp_ redacted');
  assertEq(dirty.actor, 'Bearer [redacted]', 'actor Bearer redacted');
  assertEq(dirty.blockReason, '[redacted-gh-token]', 'blockReason ghp_ redacted');

  // Test 4: sanitizeFacts scrubs
  var facts = sanitizeFacts([
    { factId: 'ghp_fact123', source: 'Bearer src', description: 'ghp_desc456' },
  ]);
  assertEq(facts[0].factId, '[redacted-gh-token]', 'sanitizeFacts scrubs factId');
  assertEq(facts[0].source, 'Bearer [redacted]', 'sanitizeFacts scrubs source');
  assertEq(facts[0].description, '[redacted-gh-token]', 'sanitizeFacts scrubs description');

  // Test 5: sanitizeProducedIssues scrubs
  var produced = sanitizeProducedIssues([
    {
      title: 'ghp_title123',
      taskType: 'execution',
      risk: 'low',
      conflictGroup: 'Bearer cg',
      allowedFiles: ['docs/**'],
      forbiddenFiles: ['src/**'],
      validationCommands: ['npm run check'],
      status: 'created',
      humanRequired: false,
    },
  ]);
  assertEq(produced[0].title, '[redacted-gh-token]', 'sanitizeProducedIssues scrubs title');
  assertEq(produced[0].conflictGroup, 'Bearer [redacted]', 'sanitizeProducedIssues scrubs conflictGroup');

  // Test 6: sanitizeRejectedIssues scrubs
  var rejected = sanitizeRejectedIssues([
    { title: 'ghp_rej789', reason: 'Bearer dup' },
  ]);
  assertEq(rejected[0].title, '[redacted-gh-token]', 'sanitizeRejectedIssues scrubs title');
  assertEq(rejected[0].reason, 'Bearer [redacted]', 'sanitizeRejectedIssues scrubs reason');

  // Test 7: sanitizeObject preserves non-string types
  var obj = { str: 'ghp_leaked', num: 42, bool: true, nil: null };
  var clean = sanitizeObject(obj);
  assertEq(clean.str, '[redacted-gh-token]', 'sanitizeObject scrubs string');
  assertEq(clean.num, 42, 'sanitizeObject preserves number');
  assertEq(clean.bool, true, 'sanitizeObject preserves boolean');
  assertEq(clean.nil, null, 'sanitizeObject preserves null');

  // Test 8: sanitize truncates at 500 chars
  function longStr(n) {
    var s = '';
    for (var k = 0; k < n; k++) s += (k % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');

  // Test 9: NDJSON round-trip
  var line = JSON.stringify(rec);
  var parsed = JSON.parse(line);
  assertEq(parsed.runId, 'run-001', 'NDJSON round-trip preserves runId');
  assertEq(parsed.mode, 'execute', 'NDJSON round-trip preserves mode');
  assertEq(parsed.issuesProduced[0].title, 'Add docs', 'NDJSON round-trip preserves produced title');

  // Test 10: all modes
  for (var mi = 0; mi < MODES.length; mi++) {
    var m = buildRecord({ runId: 't', actor: 'a', mode: MODES[mi] });
    assertEq(m.mode, MODES[mi], 'mode "' + MODES[mi] + '" preserved');
  }

  // Test 11: all outcomes
  for (var oi = 0; oi < OUTCOMES.length; oi++) {
    var o = buildRecord({ runId: 't', actor: 'a', mode: 'dry-run', outcome: OUTCOMES[oi] });
    assertEq(o.outcome, OUTCOMES[oi], 'outcome "' + OUTCOMES[oi] + '" preserved');
  }

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

  var record = buildRecord(args);
  var line = JSON.stringify(record);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('ISSUE PRODUCER RUN RECORD WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log('Target: ' + path.relative(REPO_ROOT, args.out).replace(/\\/g, '/'));
    console.log();
    console.log('Record:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the record to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, record);
  console.log('Issue producer run record appended to ' + path.relative(REPO_ROOT, args.out).replace(/\\/g, '/'));
  console.log('  runId: ' + record.runId);
  console.log('  actor: ' + record.actor);
  console.log('  mode: ' + record.mode);
  console.log('  outcome: ' + record.outcome);
  console.log('  issuesProduced: ' + record.issuesProduced.length);
  console.log('  issuesRejected: ' + record.issuesRejected.length);
  console.log('  recordedAt: ' + record.recordedAt);
}

main();
