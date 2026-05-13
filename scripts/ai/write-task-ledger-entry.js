#!/usr/bin/env node

/**
 * write-task-ledger-entry.js
 *
 * Append-only task ledger writer for .github/ai-state/task-ledger.ndjson.
 * Records task lifecycle events (launch, complete, fail, timeout, progress),
 * fact flow (produced, consumed), validation outcomes, and gate decisions.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed.
 *
 * Usage:
 *   node scripts/ai/write-task-ledger-entry.js --help
 *   node scripts/ai/write-task-ledger-entry.js --task-id wave16-issue-588 --event-type task.launch --desc "Worker launched"
 *   node scripts/ai/write-task-ledger-entry.js --task-id wave16-issue-588 --event-type task.complete --live
 *   node scripts/ai/write-task-ledger-entry.js --self-test
 *
 * Exit codes:
 *   0 — Entry processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, sanitize, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'task-ledger.ndjson');
const SCHEMA_VERSION = 1;

const EVENT_TYPES = [
  'task.launch',
  'task.complete',
  'task.fail',
  'task.timeout',
  'task.progress',
  'fact.produced',
  'fact.consumed',
  'validation.pass',
  'validation.fail',
  'gate.pass',
  'gate.block',
];

const TASK_TYPES = ['execution', 'research', 'review'];
const SEVERITIES = ['info', 'warning', 'error', 'critical'];
const GATE_TYPES = ['launch', 'pr-review', 'merge', 'post-merge-health'];
const GATE_DECISIONS = ['pass', 'block', 'warn', 'override'];

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

function sanitizeFacts(facts) {
  if (!facts || typeof facts !== 'object') return facts;
  const out = {};
  if (facts.produced && Array.isArray(facts.produced)) {
    out.produced = facts.produced.map((f) => ({
      factId: sanitize(f.factId),
      description: sanitize(f.description),
      ...(f.confidence != null ? { confidence: f.confidence } : {}),
    }));
  }
  if (facts.consumed && Array.isArray(facts.consumed)) {
    out.consumed = facts.consumed.map((f) => ({
      factId: sanitize(f.factId),
      ...(f.source != null ? { source: sanitize(f.source) } : {}),
    }));
  }
  return out;
}

function sanitizeValidation(validation) {
  if (!validation || typeof validation !== 'object') return validation;
  const out = {};
  if (validation.command != null) out.command = sanitize(validation.command);
  if (validation.exitCode != null) out.exitCode = validation.exitCode;
  if (validation.durationMs != null) out.durationMs = validation.durationMs;
  return out;
}

function sanitizeGate(gate) {
  if (!gate || typeof gate !== 'object') return gate;
  const out = {};
  if (gate.gateType != null) out.gateType = gate.gateType;
  if (gate.decision != null) out.decision = gate.decision;
  if (gate.markerId != null) out.markerId = sanitize(gate.markerId);
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-task-ledger-entry.js — Append-only task ledger writer

USAGE
    node scripts/ai/write-task-ledger-entry.js [OPTIONS]

OPTIONS (required)
    --task-id <string>       Unique task identifier (required)
    --event-type <type>      Event type (required). One of:
                               task.launch, task.complete, task.fail,
                               task.timeout, task.progress,
                               fact.produced, fact.consumed,
                               validation.pass, validation.fail,
                               gate.pass, gate.block

OPTIONS (optional — identity)
    --issue <number>         GitHub issue number
    --pr <number>            GitHub pull request number
    --branch <name>          Git branch or worktree name
    --task-type <type>       Task type: execution, research, review
    --actor-role <string>    Worker role from task contract
    --pm-phase <string>      Wave or phase identifier

OPTIONS (optional — event detail)
    --severity <level>       Severity: info, warning, error, critical
    --desc <string>          Human-readable description

OPTIONS (optional — structured objects, JSON strings)
    --facts <json>           Facts object: {"produced":[...],"consumed":[...]}
    --validation <json>      Validation object: {"command":"...","exitCode":0,"durationMs":1000}
    --gate <json>            Gate object: {"gateType":"launch","decision":"pass","markerId":"..."}
    --meta <json>            Arbitrary key-value metadata (no secrets)

OPTIONS (general)
    --out <path>             Output NDJSON file path
                             (default: .github/ai-state/task-ledger.ndjson)
    --dry-run                Preview the entry without writing (default)
    --live                   Append the entry to the ledger file
    --self-test              Run built-in validation and exit
    --help, -h               Show this help message

EXIT CODES
    0   Entry processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Record a task launch
    node scripts/ai/write-task-ledger-entry.js \\
      --task-id wave16-issue-588-worker-001 \\
      --event-type task.launch \\
      --issue 588 \\
      --task-type execution \\
      --desc "Worker launched for issue #588"

    # Record task completion with facts (live)
    node scripts/ai/write-task-ledger-entry.js \\
      --task-id wave16-issue-588-worker-001 \\
      --event-type task.complete \\
      --event-type task.complete \\
      --pr 590 \\
      --desc "Task completed" \\
      --facts '{"produced":[{"factId":"fact:writer:task-ledger","description":"Writer script created","confidence":"definite"}]}' \\
      --live

    # Record a validation failure
    node scripts/ai/write-task-ledger-entry.js \\
      --task-id wave16-issue-588-worker-001 \\
      --event-type validation.fail \\
      --severity warning \\
      --desc "npm run check failed" \\
      --validation '{"command":"npm run check","exitCode":1,"durationMs":12000}'

    # Run self-test
    node scripts/ai/write-task-ledger-entry.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    taskId: null,
    eventType: null,
    issue: null,
    pr: null,
    branch: null,
    taskType: null,
    actorRole: null,
    pmPhase: null,
    severity: null,
    desc: null,
    facts: null,
    validation: null,
    gate: null,
    meta: null,
    out: DEFAULT_OUT,
    dryRun: true,
    selfTest: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--task-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --task-id requires a value'); process.exit(2); }
      args.taskId = argv[i];
    } else if (arg === '--event-type') {
      i++;
      if (i >= argv.length) { console.error('Error: --event-type requires a value'); process.exit(2); }
      args.eventType = argv[i];
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a number'); process.exit(2); }
      args.issue = parseInt(argv[i], 10);
      if (isNaN(args.issue)) { console.error('Error: --issue must be a number'); process.exit(2); }
    } else if (arg === '--pr') {
      i++;
      if (i >= argv.length) { console.error('Error: --pr requires a number'); process.exit(2); }
      args.pr = parseInt(argv[i], 10);
      if (isNaN(args.pr)) { console.error('Error: --pr must be a number'); process.exit(2); }
    } else if (arg === '--branch') {
      i++;
      if (i >= argv.length) { console.error('Error: --branch requires a value'); process.exit(2); }
      args.branch = argv[i];
    } else if (arg === '--task-type') {
      i++;
      if (i >= argv.length) { console.error('Error: --task-type requires a value'); process.exit(2); }
      args.taskType = argv[i];
    } else if (arg === '--actor-role') {
      i++;
      if (i >= argv.length) { console.error('Error: --actor-role requires a value'); process.exit(2); }
      args.actorRole = argv[i];
    } else if (arg === '--pm-phase') {
      i++;
      if (i >= argv.length) { console.error('Error: --pm-phase requires a value'); process.exit(2); }
      args.pmPhase = argv[i];
    } else if (arg === '--severity') {
      i++;
      if (i >= argv.length) { console.error('Error: --severity requires a value'); process.exit(2); }
      args.severity = argv[i];
    } else if (arg === '--desc') {
      i++;
      if (i >= argv.length) { console.error('Error: --desc requires a value'); process.exit(2); }
      args.desc = argv[i];
    } else if (arg === '--facts') {
      i++;
      if (i >= argv.length) { console.error('Error: --facts requires a JSON string'); process.exit(2); }
      try {
        args.facts = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --facts must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--validation') {
      i++;
      if (i >= argv.length) { console.error('Error: --validation requires a JSON string'); process.exit(2); }
      try {
        args.validation = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --validation must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--gate') {
      i++;
      if (i >= argv.length) { console.error('Error: --gate requires a JSON string'); process.exit(2); }
      try {
        args.gate = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --gate must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--meta') {
      i++;
      if (i >= argv.length) { console.error('Error: --meta requires a JSON string'); process.exit(2); }
      try {
        args.meta = JSON.parse(argv[i]);
      } catch {
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
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate(args) {
  const errors = [];

  if (!args.taskId) {
    errors.push('--task-id is required');
  }

  if (!args.eventType) {
    errors.push('--event-type is required');
  } else if (!EVENT_TYPES.includes(args.eventType)) {
    errors.push(`--event-type must be one of: ${EVENT_TYPES.join(', ')}. Got: "${args.eventType}"`);
  }

  if (args.taskType && !TASK_TYPES.includes(args.taskType)) {
    errors.push(`--task-type must be one of: ${TASK_TYPES.join(', ')}. Got: "${args.taskType}"`);
  }

  if (args.severity && !SEVERITIES.includes(args.severity)) {
    errors.push(`--severity must be one of: ${SEVERITIES.join(', ')}. Got: "${args.severity}"`);
  }

  if (args.gate) {
    if (args.gate.gateType && !GATE_TYPES.includes(args.gate.gateType)) {
      errors.push(`gate.gateType must be one of: ${GATE_TYPES.join(', ')}. Got: "${args.gate.gateType}"`);
    }
    if (args.gate.decision && !GATE_DECISIONS.includes(args.gate.decision)) {
      errors.push(`gate.decision must be one of: ${GATE_DECISIONS.join(', ')}. Got: "${args.gate.decision}"`);
    }
  }

  if (args.facts) {
    if (args.facts.produced && !Array.isArray(args.facts.produced)) {
      errors.push('--facts.produced must be an array');
    }
    if (args.facts.consumed && !Array.isArray(args.facts.consumed)) {
      errors.push('--facts.consumed must be an array');
    }
  }

  if (args.meta && typeof args.meta !== 'object') {
    errors.push('--meta must be a JSON object');
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`Error: ${e}`);
    }
    process.exit(2);
  }
}

// ── Entry building ───────────────────────────────────────────────────────────

function buildEntry(args) {
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    taskId: sanitize(args.taskId),
    eventType: args.eventType,
    recordedAt: new Date().toISOString(),
  };

  // Identity fields (include if provided, null otherwise for schema compliance)
  entry.issueNumber = args.issue != null ? args.issue : null;
  entry.prNumber = args.pr != null ? args.pr : null;
  entry.branch = args.branch ? sanitize(args.branch) : null;
  entry.taskType = args.taskType || null;
  entry.actorRole = args.actorRole ? sanitize(args.actorRole) : null;
  entry.pmPhase = args.pmPhase ? sanitize(args.pmPhase) : null;

  // Event detail fields
  entry.severity = args.severity || null;
  entry.description = args.desc ? sanitize(args.desc) : null;

  // Structured objects
  entry.facts = args.facts ? sanitizeFacts(args.facts) : null;
  entry.validation = args.validation ? sanitizeValidation(args.validation) : null;
  entry.gate = args.gate ? sanitizeGate(args.gate) : null;
  entry.meta = args.meta ? sanitizeObject(args.meta) : null;

  return entry;
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${label}`);
    }
  }

  function assertEq(actual, expected, label) {
    const ok = actual === expected;
    if (!ok) {
      console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    assert(ok, label);
  }

  console.log('write-task-ledger-entry.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildEntry produces correct shape
  const entry = buildEntry({
    taskId: 'test-task-001',
    eventType: 'task.launch',
    issue: 588,
    branch: 'claude/wave16-test',
    taskType: 'execution',
    actorRole: 'worker',
    pmPhase: 'wave16',
    severity: 'info',
    desc: 'Test launch',
    facts: { produced: [{ factId: 'fact:test', description: 'test fact' }], consumed: [] },
    validation: null,
    gate: null,
    meta: { key: 'val' },
  });
  assertEq(entry.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(entry.taskId, 'test-task-001', 'taskId preserved');
  assertEq(entry.eventType, 'task.launch', 'eventType preserved');
  assert(typeof entry.recordedAt === 'string' && entry.recordedAt.includes('T'), 'recordedAt is ISO-8601');
  assertEq(entry.issueNumber, 588, 'issueNumber preserved');
  assertEq(entry.branch, 'claude/wave16-test', 'branch preserved');
  assertEq(entry.taskType, 'execution', 'taskType preserved');
  assertEq(entry.actorRole, 'worker', 'actorRole preserved');
  assertEq(entry.pmPhase, 'wave16', 'pmPhase preserved');
  assertEq(entry.severity, 'info', 'severity preserved');
  assertEq(entry.description, 'Test launch', 'description preserved');
  assert(entry.facts && entry.facts.produced && entry.facts.produced.length === 1, 'facts.produced preserved');
  assertEq(entry.facts.produced[0].factId, 'fact:test', 'fact factId preserved');
  assertEq(entry.meta.key, 'val', 'meta preserved');

  // Test 2: null optional fields
  const minimal = buildEntry({ taskId: 'min', eventType: 'task.complete' });
  assertEq(minimal.issueNumber, null, 'null issueNumber');
  assertEq(minimal.prNumber, null, 'null prNumber');
  assertEq(minimal.branch, null, 'null branch');
  assertEq(minimal.taskType, null, 'null taskType');
  assertEq(minimal.severity, null, 'null severity');
  assertEq(minimal.facts, null, 'null facts');
  assertEq(minimal.validation, null, 'null validation');
  assertEq(minimal.gate, null, 'null gate');
  assertEq(minimal.meta, null, 'null meta');

  // Test 3: sanitize strips tokens
  const tokenStr = 'a'.repeat(50);
  assertEq(sanitize(tokenStr), '[redacted-token]', 'long base64-like string redacted');
  assertEq(sanitize('ghp_abc123xyz'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');

  // Test 4: sanitizeFacts handles produced/consumed
  const dirtyFacts = {
    produced: [{ factId: 'ghp_leaked', description: 'Bearer secret123' }],
    consumed: [{ factId: 'fact:ok', source: 'ghp_source' }],
  };
  const cleanFacts = sanitizeFacts(dirtyFacts);
  assertEq(cleanFacts.produced[0].factId, '[redacted-gh-token]', 'sanitizeFacts scrubs produced factId');
  assertEq(cleanFacts.produced[0].description, 'Bearer [redacted]', 'sanitizeFacts scrubs produced description');
  assertEq(cleanFacts.consumed[0].factId, 'fact:ok', 'sanitizeFacts preserves safe consumed factId');
  assertEq(cleanFacts.consumed[0].source, '[redacted-gh-token]', 'sanitizeFacts scrubs consumed source');

  // Test 5: sanitizeValidation
  const dirtyVal = { command: 'Bearer token123', exitCode: 1, durationMs: 500 };
  const cleanVal = sanitizeValidation(dirtyVal);
  assertEq(cleanVal.command, 'Bearer [redacted]', 'sanitizeValidation scrubs command');
  assertEq(cleanVal.exitCode, 1, 'sanitizeValidation preserves exitCode');
  assertEq(cleanVal.durationMs, 500, 'sanitizeValidation preserves durationMs');

  // Test 6: sanitizeGate
  const dirtyGate = { gateType: 'launch', decision: 'pass', markerId: 'ghp_marker' };
  const cleanGate = sanitizeGate(dirtyGate);
  assertEq(cleanGate.gateType, 'launch', 'sanitizeGate preserves gateType');
  assertEq(cleanGate.decision, 'pass', 'sanitizeGate preserves decision');
  assertEq(cleanGate.markerId, '[redacted-gh-token]', 'sanitizeGate scrubs markerId');

  // Test 7: sanitize truncates at 500 chars (use hyphens to break base64 pattern)
  function longStr(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += (i % 31 === 30) ? '-' : 'x';
    return s;
  }
  assertEq(sanitize(longStr(500)).length, 500, 'exactly 500 chars preserved');
  assertEq(sanitize(longStr(501)).length, 500, '501 chars truncated to 500');

  // Test 8: NDJSON round-trip
  const line = JSON.stringify(entry);
  const parsed = JSON.parse(line);
  assertEq(parsed.eventType, 'task.launch', 'NDJSON round-trip preserves eventType');
  assertEq(parsed.taskId, 'test-task-001', 'NDJSON round-trip preserves taskId');

  // Test 9: validation object passthrough
  const valEntry = buildEntry({
    taskId: 'val-test',
    eventType: 'validation.pass',
    validation: { command: 'npm run check', exitCode: 0, durationMs: 15000 },
  });
  assertEq(valEntry.validation.command, 'npm run check', 'validation command preserved');
  assertEq(valEntry.validation.exitCode, 0, 'validation exitCode preserved');
  assertEq(valEntry.validation.durationMs, 15000, 'validation durationMs preserved');

  // Test 10: gate object passthrough
  const gateEntry = buildEntry({
    taskId: 'gate-test',
    eventType: 'gate.block',
    gate: { gateType: 'merge', decision: 'block', markerId: 'pr-590-merge' },
  });
  assertEq(gateEntry.gate.gateType, 'merge', 'gate gateType preserved');
  assertEq(gateEntry.gate.decision, 'block', 'gate decision preserved');
  assertEq(gateEntry.gate.markerId, 'pr-590-merge', 'gate markerId preserved');

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
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
  }

  validate(args);

  const entry = buildEntry(args);
  const line = JSON.stringify(entry);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('TASK LEDGER WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log();
    console.log('Entry:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the entry to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, entry);
  console.log(`Task ledger entry appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  taskId: ${entry.taskId}`);
  console.log(`  eventType: ${entry.eventType}`);
  console.log(`  recordedAt: ${entry.recordedAt}`);
}

main();
