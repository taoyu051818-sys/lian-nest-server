#!/usr/bin/env node

/**
 * write-fact-event.js
 *
 * Append-only fact event writer for the fact projection ledger.
 * Writes sanitized NDJSON events to .github/ai-state/fact-events.ndjson.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-fact-event.js --help
 *   node scripts/ai/write-fact-event.js --type worker.launch --subject "issue #397"
 *   node scripts/ai/write-fact-event.js --type health.red --facts '{"check":"tsc"}'
 *   node scripts/ai/write-fact-event.js --type worker.launch --live
 *   node scripts/ai/write-fact-event.js --self-test
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
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'fact-events.ndjson');
const EVENT_VERSION = 1;

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

function sanitizeFacts(facts) {
  if (!facts || typeof facts !== 'object') return facts;
  const sanitized = {};
  for (const [key, value] of Object.entries(facts)) {
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
write-fact-event.js — Append-only fact event writer for the projection ledger

USAGE
    node scripts/ai/write-fact-event.js [OPTIONS]

OPTIONS
    --type <string>      Event type (required). E.g. worker.launch, health.red,
                         provider.exhausted, merge.complete
    --subject <string>   Event subject (optional). E.g. "issue #397", branch name
    --facts <json>       JSON object of key-value facts (optional)
    --actor <string>     Event actor (optional). E.g. script name, worker id
    --out <path>         Output NDJSON file path
                         (default: .github/ai-state/fact-events.ndjson)
    --dry-run            Preview the event without writing (default)
    --live               Append the event to the ledger file
    --self-test          Run built-in validation and exit
    --help, -h           Show this help message

DESCRIPTION
    Appends a single sanitized fact event as one NDJSON line to the ledger.
    Each event is timestamped, versioned, and scrubbed of potential secrets
    before writing.

    In dry-run mode (default), prints the event JSON to stdout without
    modifying any file.

EVENT SCHEMA
    {
      "eventVersion": 1,
      "eventType": "string (required)",
      "subject": "string | null",
      "facts": { ... } | null,
      "capturedAt": "ISO-8601",
      "actor": "string | null"
    }

EXIT CODES
    0   Event processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Preview a worker launch event
    node scripts/ai/write-fact-event.js --type worker.launch --subject "issue #397"

    # Write a health event with facts
    node scripts/ai/write-fact-event.js --type health.red --live --facts '{"check":"tsc","commit":"abc1234"}'

    # Run self-test
    node scripts/ai/write-fact-event.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    type: null,
    subject: null,
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
    } else if (arg === '--type') {
      i++;
      if (i >= argv.length) { console.error('Error: --type requires a value'); process.exit(2); }
      args.type = argv[i];
    } else if (arg === '--subject') {
      i++;
      if (i >= argv.length) { console.error('Error: --subject requires a value'); process.exit(2); }
      args.subject = argv[i];
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
    eventType: args.type,
    subject: args.subject ? sanitize(args.subject) : null,
    facts: args.facts ? sanitizeFacts(args.facts) : null,
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

  console.log('write-fact-event.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildEvent produces correct shape
  const event = buildEvent({ type: 'test.event', subject: 'hello', facts: { key: 'val' }, actor: 'tester' });
  assert(event.eventVersion === 1, 'eventVersion is 1');
  assert(event.eventType === 'test.event', 'eventType preserved');
  assert(event.subject === 'hello', 'subject preserved');
  assert(event.facts && event.facts.key === 'val', 'facts preserved');
  assert(event.actor === 'tester', 'actor preserved');
  assert(typeof event.capturedAt === 'string', 'capturedAt is string');

  // Test 2: null optional fields
  const minimal = buildEvent({ type: 'minimal', subject: null, facts: null, actor: null });
  assert(minimal.subject === null, 'null subject stays null');
  assert(minimal.facts === null, 'null facts stays null');
  assert(minimal.actor === null, 'null actor stays null');

  // Test 3: sanitize strips tokens
  const tokenStr = 'a'.repeat(50);
  assert(sanitize(tokenStr) === '[redacted-token]', 'long base64-like string redacted');
  assert(sanitize('ghp_abc123xyz') === '[redacted-gh-token]', 'ghp_ token redacted');
  assert(sanitize('Bearer mytoken123') === 'Bearer [redacted]', 'Bearer token redacted');

  // Test 4: sanitizeFacts handles nested strings
  const dirtyFacts = { msg: 'ghp_leaked', count: 42 };
  const cleanFacts = sanitizeFacts(dirtyFacts);
  assert(cleanFacts.msg === '[redacted-gh-token]', 'sanitizeFacts scrubs string values');
  assert(cleanFacts.count === 42, 'sanitizeFacts preserves non-string values');

  // Test 5: sanitize truncates at 500 chars
  const longStr = 'x'.repeat(600);
  assert(sanitize(longStr).length <= 500, 'sanitize truncates to 500 chars');

  // Test 6: buildEvent sanitizes subject and facts
  const dirtyEvent = buildEvent({ type: 't', subject: 'ghp_leaked', facts: { k: 'ghp_also' }, actor: 'ghp_actor' });
  assert(dirtyEvent.subject === '[redacted-gh-token]', 'buildEvent sanitizes subject');
  assert(dirtyEvent.facts.k === '[redacted-gh-token]', 'buildEvent sanitizes facts');
  assert(dirtyEvent.actor === '[redacted-gh-token]', 'buildEvent sanitizes actor');

  // Test 7: NDJSON serialization round-trip
  const line = JSON.stringify(event);
  const parsed = JSON.parse(line);
  assert(parsed.eventType === 'test.event', 'NDJSON round-trip preserves eventType');

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

  if (!args.type) {
    console.error('Error: --type is required');
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  const event = buildEvent(args);
  const line = JSON.stringify(event);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('FACT EVENT WRITER — DRY RUN');
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
  console.log(`Fact event appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  type: ${event.eventType}`);
  console.log(`  capturedAt: ${event.capturedAt}`);
}

main();
