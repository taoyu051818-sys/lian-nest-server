#!/usr/bin/env node

/**
 * write-self-cycle-queue.js
 *
 * Preview-first self-cycle queue seed writer. Accepts explicit issue
 * numbers and produces candidate queue entries as an artifact file.
 * Dry-run by default — prints preview to stdout without side effects.
 *
 * With --write, writes the seed artifact to the output path. Never
 * mutates the live webui-queue-state.json or launches workers.
 *
 * Usage:
 *   node scripts/ai/write-self-cycle-queue.js --issues 1282 1283
 *   node scripts/ai/write-self-cycle-queue.js --issues 1282 --write
 *   node scripts/ai/write-self-cycle-queue.js --issues 1282 --out path/to/file.json
 *   node scripts/ai/write-self-cycle-queue.js --help
 *   node scripts/ai/write-self-cycle-queue.js --self-test
 *
 * Exit codes:
 *   0 — preview or write succeeded
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'self-cycle-queue-seed.json');
const SCHEMA_VERSION = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-self-cycle-queue.js — Self-cycle queue seed writer (v${SCHEMA_VERSION})

USAGE
    node scripts/ai/write-self-cycle-queue.js --issues <n> [n...] [options]

OPTIONS
    --issues <n...>   One or more GitHub issue numbers (required).
    --out <path>      Output path (default: .github/ai-state/self-cycle-queue-seed.json).
    --write           Write the seed artifact to disk. Without this flag,
                      prints preview JSON to stdout (dry-run).
    --conflict <grp>  Conflict group for all entries (default: "self-cycle-queue").
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

OUTPUT
    JSON array of queue seed entries conforming to the webui-queue-state
    QueueEntry shape. Preview-first — nothing is written unless --write
    is passed.

EXIT CODES
    0   Preview or write succeeded
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    issues: [],
    out: DEFAULT_OUT,
    write: false,
    conflictGroup: 'self-cycle-queue',
    selfTest: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--issues') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        const num = parseInt(argv[i], 10);
        if (Number.isNaN(num) || num < 1) {
          console.error(`Error: invalid issue number: ${argv[i]}`);
          process.exit(2);
        }
        args.issues.push(num);
        i++;
      }
      continue; // don't increment again
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--conflict') {
      i++;
      if (i >= argv.length) { console.error('Error: --conflict requires a value'); process.exit(2); }
      args.conflictGroup = argv[i];
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

// ── Queue entry generation ───────────────────────────────────────────────────

function buildQueueEntries(issueNumbers, conflictGroup) {
  const now = new Date().toISOString();
  return issueNumbers.map(num => sanitizeObject({
    issueNumber: num,
    state: 'queued',
    conflictGroup,
    updatedAt: now,
  }));
}

function buildSeedArtifact(issueNumbers, conflictGroup) {
  const entries = buildQueueEntries(issueNumbers, conflictGroup);
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    mode: 'seed',
    dryRun: true,
    entryCount: entries.length,
    entries,
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

  // Test: single issue
  const single = buildQueueEntries([1282], 'self-cycle-queue');
  assert(single.length === 1, 'single issue produces 1 entry');
  assert(single[0].issueNumber === 1282, 'issueNumber is 1282');
  assert(single[0].state === 'queued', 'state is queued');
  assert(single[0].conflictGroup === 'self-cycle-queue', 'conflictGroup matches');
  assert(typeof single[0].updatedAt === 'string', 'updatedAt is string');

  // Test: multiple issues
  const multi = buildQueueEntries([100, 200, 300], 'test-group');
  assert(multi.length === 3, 'three issues produce 3 entries');
  assert(multi[0].issueNumber === 100, 'first entry is 100');
  assert(multi[1].issueNumber === 200, 'second entry is 200');
  assert(multi[2].issueNumber === 300, 'third entry is 300');
  assert(multi.every(e => e.conflictGroup === 'test-group'), 'all share conflict group');

  // Test: artifact shape
  const artifact = buildSeedArtifact([500, 600], 'my-group');
  assert(artifact.schemaVersion === SCHEMA_VERSION, 'schemaVersion matches');
  assert(typeof artifact.capturedAt === 'string', 'capturedAt is string');
  assert(artifact.mode === 'seed', 'mode is seed');
  assert(artifact.dryRun === true, 'dryRun is true');
  assert(artifact.entryCount === 2, 'entryCount is 2');
  assert(Array.isArray(artifact.entries), 'entries is array');
  assert(artifact.entries.length === 2, 'entries has 2 items');

  // Test: entry shape matches webui-queue-state QueueEntry required fields
  const entry = artifact.entries[0];
  assert(typeof entry.issueNumber === 'number', 'entry.issueNumber is number');
  assert(typeof entry.state === 'string', 'entry.state is string');
  assert(typeof entry.updatedAt === 'string', 'entry.updatedAt is string');

  // Test: no secret-shaped keys in output
  const json = JSON.stringify(artifact);
  assert(!json.match(/"token"/), 'no token key in output');
  assert(!json.match(/"secret"/), 'no secret key in output');
  assert(!json.match(/"apiKey"/), 'no apiKey key in output');
  assert(!json.match(/"password"/), 'no password key in output');

  // Test: sanitizeObject strips secret keys
  const dirty = { issueNumber: 1, state: 'queued', updatedAt: '2026-01-01', apiToken: 'abc123' };
  const clean = sanitizeObject(dirty);
  assert(!('apiToken' in clean), 'secret key stripped by sanitizeObject');
  assert(clean.issueNumber === 1, 'non-secret key preserved');

  // Test: sanitizeValue truncates long strings
  const longStr = 'x'.repeat(600);
  const truncated = sanitizeValue(longStr);
  assert(truncated.length < 600, 'long string truncated');
  assert(truncated.endsWith('…'), 'truncated string ends with ellipsis');

  // Test: default conflict group
  const defaultEntries = buildQueueEntries([1], 'self-cycle-queue');
  assert(defaultEntries[0].conflictGroup === 'self-cycle-queue', 'default conflict group is self-cycle-queue');

  // Report
  console.log(`\n  write-self-cycle-queue self-test`);
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

  if (args.issues.length === 0) {
    console.error('Error: --issues <n> [n...] is required (at least one issue number).');
    process.exit(2);
  }

  const artifact = buildSeedArtifact(args.issues, args.conflictGroup);
  const json = JSON.stringify(artifact, null, 2) + '\n';

  // Always print preview to stdout
  process.stdout.write(json);

  if (args.write) {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`\nQueue seed written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  } else {
    process.stdout.write('\n(dry-run: pass --write to persist)\n');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildQueueEntries,
  buildSeedArtifact,
  sanitizeObject,
  sanitizeValue,
  SCHEMA_VERSION,
};
