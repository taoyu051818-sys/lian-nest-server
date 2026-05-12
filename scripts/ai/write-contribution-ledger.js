#!/usr/bin/env node

/**
 * write-contribution-ledger.js
 *
 * Append-only contribution ledger writer for .github/ai-state/contribution-ledger.ndjson.
 * Records agent contribution entries that separate claimed contribution from
 * accepted contribution after PR merge and health green.
 *
 * Contribution is measured by validated outcomes, not token cost.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed.
 *
 * Usage:
 *   node scripts/ai/write-contribution-ledger.js --help
 *   node scripts/ai/write-contribution-ledger.js --task-id wave16-issue-588 --agent-id claude-opus --role worker --type code-change --status claimed --issue 588 --desc "Auth module implementation"
 *   node scripts/ai/write-contribution-ledger.js --task-id wave16-issue-588 --agent-id claude-opus --role worker --type code-change --status accepted --issue 588 --pr 590 --validated true --live
 *   node scripts/ai/write-contribution-ledger.js --self-test
 *
 * Exit codes:
 *   0 — Entry processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'contribution-ledger.ndjson');
const SCHEMA_VERSION = 1;

const CONTRIBUTION_TYPES = [
  'code-change',
  'schema-change',
  'doc-change',
  'test-change',
  'config-change',
  'fact-produced',
  'review',
  'research',
];

const STATUSES = ['claimed', 'accepted', 'rolled-back', 'disputed'];

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-contribution-ledger.js — Append-only contribution ledger writer

USAGE
    node scripts/ai/write-contribution-ledger.js [OPTIONS]

OPTIONS (required)
    --task-id <string>         Worker task identifier (required)
    --issue <number>           GitHub issue number (required)
    --agent-id <string>        Agent identifier (required)
    --role <string>            Worker role from task contract (required)
    --type <type>              Contribution type (required). One of:
                                 code-change, schema-change, doc-change,
                                 test-change, config-change, fact-produced,
                                 review, research
    --status <status>          Contribution status (required). One of:
                                 claimed, accepted, rolled-back, disputed
    --validated <bool>         Whether validation passed: true or false (required)
    --desc <string>            Human-readable description (required)

OPTIONS (optional — identity)
    --pr <number>              GitHub pull request number
    --branch <name>            Git branch or worktree name
    --commit <sha>             Git commit SHA (7-40 hex chars)
    --conflict-group <string>  Conflict group for parallelism control

OPTIONS (optional — contribution detail)
    --reused <bool>            Whether this reused prior work: true or false
    --rollback-of <entryId>    EntryId of the original contribution (for rolled-back status)
    --meta <json>              JSON string for arbitrary extra metadata (no secrets)

OPTIONS (general)
    --out <path>               Output NDJSON file path
                               (default: .github/ai-state/contribution-ledger.ndjson)
    --dry-run                  Preview the entry without writing (default)
    --live                     Append the entry to the ledger file
    --self-test                Run built-in validation and exit
    --help, -h                 Show this help message

EXIT CODES
    0   Entry processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Claim a code contribution
    node scripts/ai/write-contribution-ledger.js \\
      --task-id wave16-issue-588-worker-001 \\
      --issue 588 \\
      --agent-id claude-opus-4-7 \\
      --role worker \\
      --type code-change \\
      --status claimed \\
      --validated false \\
      --desc "Auth module implementation"

    # Accept a contribution (after PR merge + health green)
    node scripts/ai/write-contribution-ledger.js \\
      --task-id wave16-issue-588-worker-001 \\
      --issue 588 \\
      --pr 590 \\
      --agent-id claude-opus-4-7 \\
      --role worker \\
      --type code-change \\
      --status accepted \\
      --validated true \\
      --desc "Auth module implementation" \\
      --live

    # Record a rollback
    node scripts/ai/write-contribution-ledger.js \\
      --task-id wave16-issue-588-worker-001 \\
      --issue 588 \\
      --pr 590 \\
      --agent-id claude-opus-4-7 \\
      --role worker \\
      --type code-change \\
      --status rolled-back \\
      --validated false \\
      --rollback-of <original-entry-id> \\
      --desc "Auth module reverted due to health failure" \\
      --live

    # Run self-test
    node scripts/ai/write-contribution-ledger.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    taskId: null,
    issue: null,
    pr: null,
    agentId: null,
    role: null,
    type: null,
    status: null,
    validated: null,
    reused: null,
    rollbackOf: null,
    branch: null,
    commit: null,
    conflictGroup: null,
    desc: null,
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
    } else if (arg === '--agent-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --agent-id requires a value'); process.exit(2); }
      args.agentId = argv[i];
    } else if (arg === '--role') {
      i++;
      if (i >= argv.length) { console.error('Error: --role requires a value'); process.exit(2); }
      args.role = argv[i];
    } else if (arg === '--type') {
      i++;
      if (i >= argv.length) { console.error('Error: --type requires a value'); process.exit(2); }
      args.type = argv[i];
    } else if (arg === '--status') {
      i++;
      if (i >= argv.length) { console.error('Error: --status requires a value'); process.exit(2); }
      args.status = argv[i];
    } else if (arg === '--validated') {
      i++;
      if (i >= argv.length) { console.error('Error: --validated requires true or false'); process.exit(2); }
      if (argv[i] === 'true') args.validated = true;
      else if (argv[i] === 'false') args.validated = false;
      else { console.error('Error: --validated must be true or false'); process.exit(2); }
    } else if (arg === '--reused') {
      i++;
      if (i >= argv.length) { console.error('Error: --reused requires true or false'); process.exit(2); }
      if (argv[i] === 'true') args.reused = true;
      else if (argv[i] === 'false') args.reused = false;
      else { console.error('Error: --reused must be true or false'); process.exit(2); }
    } else if (arg === '--rollback-of') {
      i++;
      if (i >= argv.length) { console.error('Error: --rollback-of requires a value'); process.exit(2); }
      args.rollbackOf = argv[i];
    } else if (arg === '--branch') {
      i++;
      if (i >= argv.length) { console.error('Error: --branch requires a value'); process.exit(2); }
      args.branch = argv[i];
    } else if (arg === '--commit') {
      i++;
      if (i >= argv.length) { console.error('Error: --commit requires a SHA'); process.exit(2); }
      args.commit = argv[i];
    } else if (arg === '--conflict-group') {
      i++;
      if (i >= argv.length) { console.error('Error: --conflict-group requires a value'); process.exit(2); }
      args.conflictGroup = argv[i];
    } else if (arg === '--desc') {
      i++;
      if (i >= argv.length) { console.error('Error: --desc requires a value'); process.exit(2); }
      args.desc = argv[i];
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

  if (args.issue == null) {
    errors.push('--issue is required');
  }

  if (!args.agentId) {
    errors.push('--agent-id is required');
  }

  if (!args.role) {
    errors.push('--role is required');
  }

  if (!args.type) {
    errors.push('--type is required');
  } else if (!CONTRIBUTION_TYPES.includes(args.type)) {
    errors.push(`--type must be one of: ${CONTRIBUTION_TYPES.join(', ')}. Got: "${args.type}"`);
  }

  if (!args.status) {
    errors.push('--status is required');
  } else if (!STATUSES.includes(args.status)) {
    errors.push(`--status must be one of: ${STATUSES.join(', ')}. Got: "${args.status}"`);
  }

  if (args.validated === null) {
    errors.push('--validated is required');
  }

  if (!args.desc) {
    errors.push('--desc is required');
  }

  if (args.commit && !/^[0-9a-fA-F]{7,40}$/.test(args.commit)) {
    errors.push('--commit must be 7-40 hex characters');
  }

  if (args.status === 'rolled-back' && !args.rollbackOf) {
    errors.push('--rollback-of is required when --status is rolled-back');
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
  return {
    schemaVersion: SCHEMA_VERSION,
    entryId: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    taskId: args.taskId,
    issueNumber: args.issue,
    prNumber: args.pr != null ? args.pr : null,
    agentId: args.agentId,
    role: args.role,
    contributionType: args.type,
    status: args.status,
    validated: args.validated,
    reused: args.reused != null ? args.reused : null,
    rollbackOf: args.rollbackOf || null,
    branch: args.branch || null,
    commit: args.commit || null,
    conflictGroup: args.conflictGroup || null,
    description: args.desc,
    meta: args.meta || null,
  };
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

  console.log('write-contribution-ledger.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildEntry produces correct shape
  const entry = buildEntry({
    taskId: 'test-task-001',
    issue: 588,
    pr: 590,
    agentId: 'claude-opus-4-7',
    role: 'worker',
    type: 'code-change',
    status: 'accepted',
    validated: true,
    reused: false,
    rollbackOf: null,
    branch: 'claude/wave16-test',
    commit: 'abc1234',
    conflictGroup: 'auth-core',
    desc: 'Auth module implementation',
    meta: { key: 'val' },
  });
  assertEq(entry.schemaVersion, 1, 'schemaVersion is 1');
  assert(typeof entry.entryId === 'string' && entry.entryId.length > 0, 'entryId is non-empty string');
  assert(typeof entry.recordedAt === 'string' && entry.recordedAt.includes('T'), 'recordedAt is ISO-8601');
  assertEq(entry.taskId, 'test-task-001', 'taskId preserved');
  assertEq(entry.issueNumber, 588, 'issueNumber preserved');
  assertEq(entry.prNumber, 590, 'prNumber preserved');
  assertEq(entry.agentId, 'claude-opus-4-7', 'agentId preserved');
  assertEq(entry.role, 'worker', 'role preserved');
  assertEq(entry.contributionType, 'code-change', 'contributionType preserved');
  assertEq(entry.status, 'accepted', 'status preserved');
  assertEq(entry.validated, true, 'validated preserved');
  assertEq(entry.reused, false, 'reused preserved');
  assertEq(entry.rollbackOf, null, 'rollbackOf is null');
  assertEq(entry.branch, 'claude/wave16-test', 'branch preserved');
  assertEq(entry.commit, 'abc1234', 'commit preserved');
  assertEq(entry.conflictGroup, 'auth-core', 'conflictGroup preserved');
  assertEq(entry.description, 'Auth module implementation', 'description preserved');
  assertEq(entry.meta.key, 'val', 'meta preserved');

  // Test 2: minimal entry (null optionals)
  const minimal = buildEntry({
    taskId: 'min-001',
    issue: 100,
    agentId: 'test-agent',
    role: 'worker',
    type: 'research',
    status: 'claimed',
    validated: false,
    desc: 'minimal entry',
  });
  assertEq(minimal.prNumber, null, 'null prNumber');
  assertEq(minimal.reused, null, 'null reused');
  assertEq(minimal.rollbackOf, null, 'null rollbackOf');
  assertEq(minimal.branch, null, 'null branch');
  assertEq(minimal.commit, null, 'null commit');
  assertEq(minimal.conflictGroup, null, 'null conflictGroup');
  assertEq(minimal.meta, null, 'null meta');

  // Test 3: all contribution types
  for (const ct of ['code-change', 'schema-change', 'doc-change', 'test-change', 'config-change', 'fact-produced', 'review', 'research']) {
    const e = buildEntry({ taskId: 't', issue: 1, agentId: 'a', role: 'r', type: ct, status: 'claimed', validated: false, desc: 'test' });
    assertEq(e.contributionType, ct, `contributionType "${ct}" preserved`);
  }

  // Test 4: all statuses
  for (const st of ['claimed', 'accepted', 'rolled-back', 'disputed']) {
    const e = buildEntry({ taskId: 't', issue: 1, agentId: 'a', role: 'r', type: 'code-change', status: st, validated: false, desc: 'test', rollbackOf: st === 'rolled-back' ? 'some-id' : null });
    assertEq(e.status, st, `status "${st}" preserved`);
  }

  // Test 5: NDJSON round-trip
  const line = JSON.stringify(entry);
  const parsed = JSON.parse(line);
  assertEq(parsed.taskId, 'test-task-001', 'NDJSON round-trip preserves taskId');
  assertEq(parsed.contributionType, 'code-change', 'NDJSON round-trip preserves contributionType');

  // Test 6: entryId uniqueness
  const e1 = buildEntry({ taskId: 't', issue: 1, agentId: 'a', role: 'r', type: 'code-change', status: 'claimed', validated: false, desc: 'test' });
  const e2 = buildEntry({ taskId: 't', issue: 1, agentId: 'a', role: 'r', type: 'code-change', status: 'claimed', validated: false, desc: 'test' });
  assert(e1.entryId !== e2.entryId, 'entryId is unique per invocation');

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
    console.log('CONTRIBUTION LEDGER WRITER — DRY RUN');
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
  const dir = path.dirname(args.out);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(args.out, line + '\n', 'utf8');

  console.log(`Contribution entry appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  taskId: ${entry.taskId}`);
  console.log(`  status: ${entry.status}`);
  console.log(`  contributionType: ${entry.contributionType}`);
  console.log(`  agentId: ${entry.agentId}`);
  if (entry.prNumber != null) console.log(`  pr: #${entry.prNumber}`);
}

main();
