#!/usr/bin/env node

/**
 * write-autonomy-handoff-fact.js
 *
 * Append-only writer for autonomy handoff facts.
 * Records operational handoff events (e.g. codex-to-self-cycle, manual-to-autonomous)
 * as sanitized NDJSON lines in .github/ai-state/autonomy-handoff-facts.ndjson.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-autonomy-handoff-fact.js --help
 *   node scripts/ai/write-autonomy-handoff-fact.js --handoff-type codex-to-self-cycle --source codex --destination self-cycle-runner
 *   node scripts/ai/write-autonomy-handoff-fact.js --handoff-type health-gate-pass --outcome pass --live
 *   node scripts/ai/write-autonomy-handoff-fact.js --self-test
 *
 * Exit codes:
 *   0 — Event processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'autonomy-handoff-facts.ndjson');
const EVENT_VERSION = 1;

const VALID_HANDOFF_TYPES = [
  'codex-to-self-cycle',
  'manual-to-autonomous',
  'autonomous-to-fallback',
  'health-gate-pass',
  'health-gate-block',
];

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted-token]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-gh-token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-autonomy-handoff-fact.js — Append-only autonomy handoff fact writer

USAGE
    node scripts/ai/write-autonomy-handoff-fact.js [OPTIONS]

OPTIONS
    --handoff-type <string>   Handoff event type (required).
                              Valid: ${VALID_HANDOFF_TYPES.join(', ')}
    --source <string>         Source agent or system (optional)
    --destination <string>    Destination agent or system (optional)
    --preconditions <json>    JSON object of precondition check results (optional)
    --outcome <string>        Handoff outcome (optional). E.g. success, blocked, pending
    --facts <json>            JSON object of additional key-value facts (optional)
    --actor <string>          Event actor (optional). E.g. script name, operator id
    --out <path>              Output NDJSON file path
                              (default: .github/ai-state/autonomy-handoff-facts.ndjson)
    --dry-run                 Preview the event without writing (default)
    --live                    Append the event to the ledger file
    --self-test               Run built-in validation and exit
    --help, -h                Show this help message

DESCRIPTION
    Appends a single sanitized autonomy handoff fact as one NDJSON line.
    Each event is timestamped, versioned, and scrubbed of potential secrets
    before writing.

    In dry-run mode (default), prints the event JSON to stdout without
    modifying any file.

EVENT SCHEMA
    {
      "eventVersion": 1,
      "handoffType": "string (required)",
      "source": "string | null",
      "destination": "string | null",
      "preconditions": { ... } | null,
      "outcome": "string | null",
      "facts": { ... } | null,
      "capturedAt": "ISO-8601",
      "actor": "string | null"
    }

EXIT CODES
    0   Event processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Preview a codex-to-self-cycle handoff
    node scripts/ai/write-autonomy-handoff-fact.js \\
      --handoff-type codex-to-self-cycle --source codex --destination self-cycle-runner

    # Record a health gate pass with precondition details
    node scripts/ai/write-autonomy-handoff-fact.js \\
      --handoff-type health-gate-pass --outcome pass \\
      --preconditions '{"health":"green","providerPool":"ready"}' \\
      --live

    # Run self-test
    node scripts/ai/write-autonomy-handoff-fact.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    handoffType: null,
    source: null,
    destination: null,
    preconditions: null,
    outcome: null,
    facts: null,
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
    } else if (arg === '--handoff-type') {
      i++;
      if (i >= argv.length) { console.error('Error: --handoff-type requires a value'); process.exit(2); }
      args.handoffType = argv[i];
    } else if (arg === '--source') {
      i++;
      if (i >= argv.length) { console.error('Error: --source requires a value'); process.exit(2); }
      args.source = argv[i];
    } else if (arg === '--destination') {
      i++;
      if (i >= argv.length) { console.error('Error: --destination requires a value'); process.exit(2); }
      args.destination = argv[i];
    } else if (arg === '--preconditions') {
      i++;
      if (i >= argv.length) { console.error('Error: --preconditions requires a JSON string'); process.exit(2); }
      try {
        args.preconditions = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --preconditions must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--outcome') {
      i++;
      if (i >= argv.length) { console.error('Error: --outcome requires a value'); process.exit(2); }
      args.outcome = argv[i];
    } else if (arg === '--facts') {
      i++;
      if (i >= argv.length) { console.error('Error: --facts requires a JSON string'); process.exit(2); }
      try {
        args.facts = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --facts must be valid JSON');
        process.exit(2);
      }
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

// ── Event building ───────────────────────────────────────────────────────────

function buildEvent(args) {
  return {
    eventVersion: EVENT_VERSION,
    handoffType: args.handoffType,
    source: args.source ? sanitize(args.source) : null,
    destination: args.destination ? sanitize(args.destination) : null,
    preconditions: args.preconditions ? sanitizeObject(args.preconditions) : null,
    outcome: args.outcome ? sanitize(args.outcome) : null,
    facts: args.facts ? sanitizeObject(args.facts) : null,
    capturedAt: new Date().toISOString(),
    actor: args.actor ? sanitize(args.actor) : null,
  };
}

// ── Write logic ──────────────────────────────────────────────────────────────

function appendEvent(outPath, event) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(outPath, line, 'utf8');
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

  console.log('write-autonomy-handoff-fact.js — self-test');
  console.log('='.repeat(50));

  // Test 1: buildEvent produces correct shape
  const event = buildEvent({
    handoffType: 'codex-to-self-cycle',
    source: 'codex',
    destination: 'self-cycle-runner',
    preconditions: { health: 'green' },
    outcome: 'success',
    facts: { wave: 'final' },
    actor: 'operator',
  });
  assert(event.eventVersion === 1, 'eventVersion is 1');
  assert(event.handoffType === 'codex-to-self-cycle', 'handoffType preserved');
  assert(event.source === 'codex', 'source preserved');
  assert(event.destination === 'self-cycle-runner', 'destination preserved');
  assert(event.preconditions && event.preconditions.health === 'green', 'preconditions preserved');
  assert(event.outcome === 'success', 'outcome preserved');
  assert(event.facts && event.facts.wave === 'final', 'facts preserved');
  assert(event.actor === 'operator', 'actor preserved');
  assert(typeof event.capturedAt === 'string', 'capturedAt is string');

  // Test 2: null optional fields
  const minimal = buildEvent({
    handoffType: 'health-gate-pass',
    source: null,
    destination: null,
    preconditions: null,
    outcome: null,
    facts: null,
    actor: null,
  });
  assert(minimal.source === null, 'null source stays null');
  assert(minimal.destination === null, 'null destination stays null');
  assert(minimal.preconditions === null, 'null preconditions stays null');
  assert(minimal.outcome === null, 'null outcome stays null');
  assert(minimal.facts === null, 'null facts stays null');
  assert(minimal.actor === null, 'null actor stays null');

  // Test 3: sanitize strips tokens
  const tokenStr = 'a'.repeat(50);
  assert(sanitize(tokenStr) === '[redacted-token]', 'long base64-like string redacted');
  assert(sanitize('ghp_abc123xyz') === '[redacted-gh-token]', 'ghp_ token redacted');
  assert(sanitize('Bearer mytoken123') === 'Bearer [redacted]', 'Bearer token redacted');

  // Test 4: sanitizeObject handles nested strings
  const dirtyObj = { msg: 'ghp_leaked', count: 42 };
  const cleanObj = sanitizeObject(dirtyObj);
  assert(cleanObj.msg === '[redacted-gh-token]', 'sanitizeObject scrubs string values');
  assert(cleanObj.count === 42, 'sanitizeObject preserves non-string values');

  // Test 5: sanitize truncates at 500 chars
  const longStr = 'x'.repeat(600);
  assert(sanitize(longStr).length <= 500, 'sanitize truncates to 500 chars');

  // Test 6: buildEvent sanitizes all string fields
  const dirtyEvent = buildEvent({
    handoffType: 't',
    source: 'ghp_leaked',
    destination: 'Bearer secret123',
    preconditions: { k: 'ghp_also' },
    outcome: 'ghp_out',
    facts: { m: 'ghp_fact' },
    actor: 'ghp_actor',
  });
  assert(dirtyEvent.source === '[redacted-gh-token]', 'buildEvent sanitizes source');
  assert(dirtyEvent.destination === 'Bearer [redacted]', 'buildEvent sanitizes destination');
  assert(dirtyEvent.preconditions.k === '[redacted-gh-token]', 'buildEvent sanitizes preconditions');
  assert(dirtyEvent.outcome === '[redacted-gh-token]', 'buildEvent sanitizes outcome');
  assert(dirtyEvent.facts.m === '[redacted-gh-token]', 'buildEvent sanitizes facts');
  assert(dirtyEvent.actor === '[redacted-gh-token]', 'buildEvent sanitizes actor');

  // Test 7: NDJSON serialization round-trip
  const line = JSON.stringify(event);
  const parsed = JSON.parse(line);
  assert(parsed.handoffType === 'codex-to-self-cycle', 'NDJSON round-trip preserves handoffType');

  // Test 8: valid handoff types constant
  assert(VALID_HANDOFF_TYPES.length === 5, 'five valid handoff types defined');
  assert(VALID_HANDOFF_TYPES.includes('codex-to-self-cycle'), 'codex-to-self-cycle is valid');
  assert(VALID_HANDOFF_TYPES.includes('autonomous-to-fallback'), 'autonomous-to-fallback is valid');

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

  if (!args.handoffType) {
    console.error('Error: --handoff-type is required');
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  const event = buildEvent(args);
  const line = JSON.stringify(event);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('AUTONOMY HANDOFF FACT WRITER — DRY RUN');
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
  appendEvent(args.out, event);
  console.log(`Handoff fact appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  handoffType: ${event.handoffType}`);
  console.log(`  capturedAt: ${event.capturedAt}`);
}

main();
