#!/usr/bin/env node

/**
 * write-result-fact.js
 *
 * Converts worker result summaries and PR outcomes into fact-events ndjson.
 * This is the final control-loop helper that allows Codex to exit routine
 * orchestration by recording structured result facts to the ledger.
 *
 * Accepts structured result inputs (kind, issue, PR, status, etc.) and
 * appends a sanitized fact event to .github/ai-state/fact-events.ndjson.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-result-fact.js --help
 *   node scripts/ai/write-result-fact.js --kind worker.complete --issue 397 --status pass
 *   node scripts/ai/write-result-fact.js --kind merge.complete --pr 401 --commit abc1234 --live
 *   node scripts/ai/write-result-fact.js --self-test
 *
 * Exit codes:
 *   0 — Fact processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, sanitize, sanitizeFacts, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'fact-events.ndjson');
const EVENT_VERSION = 1;

const RESULT_KINDS = [
  'worker.complete',
  'worker.fail',
  'merge.complete',
  'merge.conflict',
  'merge.batch',
  'health.green',
  'health.red',
];

const RESULT_STATUSES = ['pass', 'fail', 'skip', 'error', 'timeout', 'conflict'];

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-result-fact.js — Convert worker result summaries and PR outcomes into fact events

USAGE
    node scripts/ai/write-result-fact.js [OPTIONS]

OPTIONS
    --kind <string>       Result kind (required). One of:
                            worker.complete   Worker finished successfully
                            worker.fail       Worker exited with error
                            merge.complete    PR successfully merged
                            merge.conflict    PR has merge conflicts
                            merge.batch       Batch run finished
                            health.green      Health gate passed
                            health.red        Health gate failed

    --status <string>     Outcome status (required). One of:
                            pass, fail, skip, error, timeout, conflict

    --issue <number>      GitHub issue number (optional).
    --pr <number>         GitHub PR number (optional).
    --branch <string>     Git branch or worktree name (optional).
    --commit <sha>        Git commit SHA, 7-40 hex chars (optional).
    --changed <string>    Comma-separated list of changed files (optional).
    --validation <string> Validation summary (optional). E.g. "check PASS, build PASS".
    --elapsed <number>    Elapsed time in ms (optional).
    --exitCode <number>   Worker process exit code (optional).
    --actor <string>      Event actor (optional). E.g. script name, worker id.
    --out <path>          Output NDJSON file path
                          (default: .github/ai-state/fact-events.ndjson)
    --dry-run             Preview the event without writing (default)
    --live                Append the event to the ledger file
    --self-test           Run built-in validation and exit
    --help, -h            Show this help message

DESCRIPTION
    Converts structured worker result data and PR outcomes into a single
    fact event and appends it to the fact event ledger. This is the
    final control-loop layer that allows Codex to record outcomes and
    exit routine orchestration.

    In dry-run mode (default), prints the event JSON to stdout without
    modifying any file.

RESULT KINDS
    worker.complete  — Worker finished with exit code 0 and produced a PR
    worker.fail      — Worker exited non-zero or produced no PR
    merge.complete   — PR was successfully merged to main
    merge.conflict   — PR could not be merged due to conflicts
    merge.batch      — A merge batch run completed (may include multiple PRs)
    health.green     — Post-merge health gate passed
    health.red       — Post-merge health gate failed

EVENT SCHEMA
    {
      "eventVersion": 1,
      "eventType": "<kind>",
      "subject": "issue #<n>" | "pr #<n>" | "branch <name>" | null,
      "facts": {
        "status": "<status>",
        "issue": <number> | undefined,
        "pr": <number> | undefined,
        "branch": "<string>" | undefined,
        "commit": "<sha>" | undefined,
        "changedFiles": ["<file>", ...] | undefined,
        "validation": "<string>" | undefined,
        "elapsedMs": <number> | undefined,
        "exitCode": <number> | undefined
      },
      "capturedAt": "ISO-8601",
      "actor": "<string>" | null
    }

EXIT CODES
    0   Fact processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Preview a worker completion fact
    node scripts/ai/write-result-fact.js --kind worker.complete --issue 397 --status pass

    # Write a merge result with details
    node scripts/ai/write-result-fact.js --kind merge.complete --pr 401 --commit abc1234 --status pass --live

    # Record a health gate failure
    node scripts/ai/write-result-fact.js --kind health.red --status fail --validation "tsc FAIL" --live

    # Run self-test
    node scripts/ai/write-result-fact.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    kind: null,
    status: null,
    issue: null,
    pr: null,
    branch: null,
    commit: null,
    changed: null,
    validation: null,
    elapsed: null,
    exitCode: null,
    actor: null,
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
    } else if (arg === '--kind') {
      i++;
      if (i >= argv.length) { console.error('Error: --kind requires a value'); process.exit(2); }
      args.kind = argv[i];
    } else if (arg === '--status') {
      i++;
      if (i >= argv.length) { console.error('Error: --status requires a value'); process.exit(2); }
      args.status = argv[i];
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
    } else if (arg === '--commit') {
      i++;
      if (i >= argv.length) { console.error('Error: --commit requires a SHA'); process.exit(2); }
      args.commit = argv[i];
    } else if (arg === '--changed') {
      i++;
      if (i >= argv.length) { console.error('Error: --changed requires a value'); process.exit(2); }
      args.changed = argv[i];
    } else if (arg === '--validation') {
      i++;
      if (i >= argv.length) { console.error('Error: --validation requires a value'); process.exit(2); }
      args.validation = argv[i];
    } else if (arg === '--elapsed') {
      i++;
      if (i >= argv.length) { console.error('Error: --elapsed requires a number'); process.exit(2); }
      args.elapsed = parseInt(argv[i], 10);
      if (isNaN(args.elapsed)) { console.error('Error: --elapsed must be a number'); process.exit(2); }
    } else if (arg === '--exitCode') {
      i++;
      if (i >= argv.length) { console.error('Error: --exitCode requires a number'); process.exit(2); }
      args.exitCode = parseInt(argv[i], 10);
      if (isNaN(args.exitCode)) { console.error('Error: --exitCode must be a number'); process.exit(2); }
    } else if (arg === '--actor') {
      i++;
      if (i >= argv.length) { console.error('Error: --actor requires a value'); process.exit(2); }
      args.actor = argv[i];
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

  if (!args.kind) {
    errors.push('--kind is required');
  } else if (!RESULT_KINDS.includes(args.kind)) {
    errors.push(`--kind must be one of: ${RESULT_KINDS.join(', ')}. Got: "${args.kind}"`);
  }

  if (!args.status) {
    errors.push('--status is required');
  } else if (!RESULT_STATUSES.includes(args.status)) {
    errors.push(`--status must be one of: ${RESULT_STATUSES.join(', ')}. Got: "${args.status}"`);
  }

  if (args.commit && !/^[0-9a-fA-F]{7,40}$/.test(args.commit)) {
    errors.push('--commit must be 7-40 hex characters');
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`Error: ${e}`);
    }
    process.exit(2);
  }
}

// ── Event building ───────────────────────────────────────────────────────────

function buildSubject(args) {
  if (args.issue != null) return sanitize(`issue #${args.issue}`);
  if (args.pr != null) return sanitize(`pr #${args.pr}`);
  if (args.branch) return sanitize(`branch ${args.branch}`);
  return null;
}

function buildEvent(args) {
  const facts = {
    status: args.status,
  };

  if (args.issue != null) facts.issue = args.issue;
  if (args.pr != null) facts.pr = args.pr;
  if (args.branch) facts.branch = sanitize(args.branch);
  if (args.commit) facts.commit = sanitize(args.commit);
  if (args.changed) {
    facts.changedFiles = args.changed.split(',').map((f) => sanitize(f.trim())).filter(Boolean);
  }
  if (args.validation) facts.validation = sanitize(args.validation);
  if (args.elapsed != null) facts.elapsedMs = args.elapsed;
  if (args.exitCode != null) facts.exitCode = args.exitCode;

  return sanitizeFacts({
    eventVersion: EVENT_VERSION,
    eventType: args.kind,
    subject: buildSubject(args),
    facts,
    capturedAt: new Date().toISOString(),
    actor: args.actor ? sanitize(args.actor) : null,
  });
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

  console.log('write-result-fact.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildEvent produces correct shape for worker.complete
  const ev1 = buildEvent({ kind: 'worker.complete', status: 'pass', issue: 397, pr: null, branch: null, commit: null, changed: null, validation: null, elapsed: null, exitCode: null, actor: 'test-runner' });
  assert(ev1.eventVersion === 1, 'eventVersion is 1');
  assert(ev1.eventType === 'worker.complete', 'eventType is worker.complete');
  assert(ev1.subject === 'issue #397', 'subject derived from issue');
  assert(ev1.facts.status === 'pass', 'facts.status preserved');
  assert(ev1.facts.issue === 397, 'facts.issue preserved');
  assert(ev1.actor === 'test-runner', 'actor preserved');
  assert(typeof ev1.capturedAt === 'string', 'capturedAt is string');

  // Test 2: merge.complete with PR and commit
  const ev2 = buildEvent({ kind: 'merge.complete', status: 'pass', issue: null, pr: 401, branch: null, commit: 'abc1234', changed: 'src/a.ts,src/b.ts', validation: 'check PASS', elapsed: 5000, exitCode: 0, actor: null });
  assert(ev2.subject === 'pr #401', 'subject derived from PR');
  assert(ev2.facts.pr === 401, 'facts.pr preserved');
  assert(ev2.facts.commit === 'abc1234', 'facts.commit preserved');
  assert(Array.isArray(ev2.facts.changedFiles), 'changedFiles is array');
  assert(ev2.facts.changedFiles.length === 2, 'changedFiles has 2 entries');
  assert(ev2.facts.validation === 'check PASS', 'validation preserved');
  assert(ev2.facts.elapsedMs === 5000, 'elapsedMs preserved');
  assert(ev2.facts.exitCode === 0, 'exitCode preserved');
  assert(ev2.actor === null, 'null actor stays null');

  // Test 3: subject priority — issue over PR
  const ev3 = buildEvent({ kind: 'worker.fail', status: 'fail', issue: 100, pr: 200, branch: null, commit: null, changed: null, validation: null, elapsed: null, exitCode: 1, actor: null });
  assert(ev3.subject === 'issue #100', 'issue takes precedence over PR for subject');

  // Test 4: subject from branch when no issue/PR
  const ev4 = buildEvent({ kind: 'worker.complete', status: 'pass', issue: null, pr: null, branch: 'claude/wave16-abc', commit: null, changed: null, validation: null, elapsed: null, exitCode: null, actor: null });
  assert(ev4.subject === 'branch claude/wave16-abc', 'subject derived from branch');

  // Test 5: null subject when no identifiers
  const ev5 = buildEvent({ kind: 'health.green', status: 'pass', issue: null, pr: null, branch: null, commit: null, changed: null, validation: null, elapsed: null, exitCode: null, actor: null });
  assert(ev5.subject === null, 'subject null when no identifiers');

  // Test 6: sanitize strips secrets from facts
  const ev6 = buildEvent({ kind: 'worker.fail', status: 'fail', issue: null, pr: null, branch: null, commit: null, changed: null, validation: 'Bearer secret123', elapsed: null, exitCode: 1, actor: 'ghp_leaked' });
  assert(ev6.facts.validation === 'Bearer [redacted]', 'validation sanitized');
  assert(ev6.actor === '[redacted-gh-token]', 'actor sanitized');

  // Test 7: changedFiles sanitization
  const ev7 = buildEvent({ kind: 'merge.complete', status: 'pass', issue: null, pr: null, branch: null, commit: null, changed: 'file1.ts, ghp_token.ts, file3.ts', validation: null, elapsed: null, exitCode: null, actor: null });
  assert(ev7.facts.changedFiles.length === 3, 'changedFiles preserves count');
  assert(ev7.facts.changedFiles[1] === '[redacted-gh-token].ts', 'changedFiles sanitized');

  // Test 8: NDJSON serialization round-trip
  const line = JSON.stringify(ev1);
  const parsed = JSON.parse(line);
  assert(parsed.eventType === 'worker.complete', 'NDJSON round-trip preserves eventType');
  assert(parsed.facts.status === 'pass', 'NDJSON round-trip preserves facts');

  // Test 9: all result kinds are accepted
  for (const kind of RESULT_KINDS) {
    const ev = buildEvent({ kind, status: 'pass', issue: null, pr: null, branch: null, commit: null, changed: null, validation: null, elapsed: null, exitCode: null, actor: null });
    assert(ev.eventType === kind, `kind "${kind}" accepted`);
  }

  // Test 10: all result statuses are accepted
  for (const status of RESULT_STATUSES) {
    const ev = buildEvent({ kind: 'worker.complete', status, issue: null, pr: null, branch: null, commit: null, changed: null, validation: null, elapsed: null, exitCode: null, actor: null });
    assert(ev.facts.status === status, `status "${status}" accepted`);
  }

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

  const event = buildEvent(args);
  const line = JSON.stringify(event);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('RESULT FACT WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log();
    console.log('Event:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the event to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, event);
  console.log(`Result fact appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  kind: ${event.eventType}`);
  console.log(`  status: ${event.facts.status}`);
  console.log(`  capturedAt: ${event.capturedAt}`);
}

main();
