#!/usr/bin/env node

/**
 * write-external-fact.js
 *
 * Append-only external fact writer.
 * Writes sanitized NDJSON records to .github/ai-state/external-facts.ndjson.
 *
 * Validates required fields (sourceClass, capturedAt) and redacts secrets
 * before writing. Aligned with the External Reality Intake contract.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-external-fact.js --help
 *   node scripts/ai/write-external-fact.js --sourceClass github-issue --actor "intake-worker"
 *   node scripts/ai/write-external-fact.js --sourceClass web-scan --sourceUrl "https://example.com" --live
 *   node scripts/ai/write-external-fact.js --self-test
 *
 * Exit codes:
 *   0 — Record processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, sanitize, sanitizeFacts, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'external-facts.ndjson');
const EVENT_VERSION = 1;

const SOURCE_CLASSES = [
  'github-issue',
  'github-pr',
  'ci-result',
  'human-instruction',
  'external-doc',
  'web-scan',
  'user-paste',
  'opaque-external',
];

const RELIABILITY_TIERS = [
  'authoritative',
  'high',
  'medium',
  'low',
  'untrusted',
];

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-external-fact.js — Append-only external fact writer

USAGE
    node scripts/ai/write-external-fact.js [OPTIONS]

OPTIONS
    --sourceClass <string>       Source class (required). One of:
                                 ${SOURCE_CLASSES.join(', ')}
    --sourceUrl <string>         Canonical URL of the source (optional)
    --rawHash <string>           SHA-256 hex hash of raw input (optional)
    --actor <string>             Who or what produced the input (optional)
    --reliabilityTier <string>   Reliability tier (optional). One of:
                                 ${RELIABILITY_TIERS.join(', ')}
    --facts <json>               JSON object of key-value facts (optional)
    --out <path>                 Output NDJSON file path
                                 (default: .github/ai-state/external-facts.ndjson)
    --dry-run                    Preview the record without writing (default)
    --live                       Append the record to the NDJSON file
    --self-test                  Run built-in validation and exit
    --help, -h                   Show this help message

DESCRIPTION
    Appends a single sanitized external fact record as one NDJSON line.
    Each record is timestamped, versioned, and scrubbed of potential
    secrets before writing.

    In dry-run mode (default), prints the record JSON to stdout without
    modifying any file.

RECORD SCHEMA
    {
      "eventVersion": 1,
      "sourceClass": "string (required)",
      "capturedAt": "ISO-8601 (auto-generated)",
      "sourceUrl": "string | null",
      "rawHash": "string | null",
      "actor": "string | null",
      "reliabilityTier": "string | null",
      "sanitized": true,
      "facts": { ... } | null
    }

EXIT CODES
    0   Record processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Preview a GitHub issue fact
    node scripts/ai/write-external-fact.js --sourceClass github-issue --actor "intake-worker"

    # Write a web-scan fact with source URL
    node scripts/ai/write-external-fact.js --sourceClass web-scan --sourceUrl "https://example.com" --live

    # Write with reliability tier and facts
    node scripts/ai/write-external-fact.js --sourceClass ci-result --reliabilityTier high --facts '{"commit":"abc1234"}' --live

    # Run self-test
    node scripts/ai/write-external-fact.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    sourceClass: null,
    sourceUrl: null,
    rawHash: null,
    actor: null,
    reliabilityTier: null,
    facts: null,
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
    } else if (arg === '--sourceClass') {
      i++;
      if (i >= argv.length) { console.error('Error: --sourceClass requires a value'); process.exit(2); }
      args.sourceClass = argv[i];
    } else if (arg === '--sourceUrl') {
      i++;
      if (i >= argv.length) { console.error('Error: --sourceUrl requires a value'); process.exit(2); }
      args.sourceUrl = argv[i];
    } else if (arg === '--rawHash') {
      i++;
      if (i >= argv.length) { console.error('Error: --rawHash requires a value'); process.exit(2); }
      args.rawHash = argv[i];
    } else if (arg === '--actor') {
      i++;
      if (i >= argv.length) { console.error('Error: --actor requires a value'); process.exit(2); }
      args.actor = argv[i];
    } else if (arg === '--reliabilityTier') {
      i++;
      if (i >= argv.length) { console.error('Error: --reliabilityTier requires a value'); process.exit(2); }
      args.reliabilityTier = argv[i];
    } else if (arg === '--facts') {
      i++;
      if (i >= argv.length) { console.error('Error: --facts requires a JSON string'); process.exit(2); }
      try {
        args.facts = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --facts must be valid JSON');
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

  if (!args.sourceClass) {
    errors.push('--sourceClass is required');
  } else if (!SOURCE_CLASSES.includes(args.sourceClass)) {
    errors.push(`--sourceClass must be one of: ${SOURCE_CLASSES.join(', ')}`);
  }

  if (args.reliabilityTier && !RELIABILITY_TIERS.includes(args.reliabilityTier)) {
    errors.push(`--reliabilityTier must be one of: ${RELIABILITY_TIERS.join(', ')}`);
  }

  if (args.rawHash && !/^[a-f0-9]{16,64}$/i.test(args.rawHash)) {
    errors.push('--rawHash must be a hex string (16-64 chars)');
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`Error: ${err}`);
    }
    console.error('Run with --help for usage information');
    process.exit(2);
  }
}

// ── Record building ──────────────────────────────────────────────────────────

function buildRecord(args) {
  return {
    eventVersion: EVENT_VERSION,
    sourceClass: args.sourceClass,
    capturedAt: new Date().toISOString(),
    sourceUrl: args.sourceUrl ? sanitize(args.sourceUrl) : null,
    rawHash: args.rawHash || null,
    actor: args.actor ? sanitize(args.actor) : null,
    reliabilityTier: args.reliabilityTier || null,
    sanitized: true,
    facts: args.facts ? sanitizeFacts(args.facts) : null,
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

  console.log('write-external-fact.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildRecord produces correct shape
  const rec = buildRecord({
    sourceClass: 'github-issue',
    sourceUrl: 'https://github.com/test/repo/issues/1',
    rawHash: 'a'.repeat(64),
    actor: 'intake-worker',
    reliabilityTier: 'high',
    facts: { key: 'val' },
  });
  assert(rec.eventVersion === 1, 'eventVersion is 1');
  assert(rec.sourceClass === 'github-issue', 'sourceClass preserved');
  assert(rec.sourceUrl === 'https://github.com/test/repo/issues/1', 'sourceUrl preserved');
  assert(rec.rawHash === 'a'.repeat(64), 'rawHash preserved');
  assert(rec.actor === 'intake-worker', 'actor preserved');
  assert(rec.reliabilityTier === 'high', 'reliabilityTier preserved');
  assert(rec.sanitized === true, 'sanitized is true');
  assert(rec.facts && rec.facts.key === 'val', 'facts preserved');
  assert(typeof rec.capturedAt === 'string', 'capturedAt is string');

  // Test 2: null optional fields
  const minimal = buildRecord({ sourceClass: 'opaque-external' });
  assert(minimal.sourceUrl === null, 'null sourceUrl stays null');
  assert(minimal.rawHash === null, 'null rawHash stays null');
  assert(minimal.actor === null, 'null actor stays null');
  assert(minimal.reliabilityTier === null, 'null reliabilityTier stays null');
  assert(minimal.facts === null, 'null facts stays null');

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

  // Test 6: buildRecord sanitizes sourceUrl and actor
  const dirtyRec = buildRecord({ sourceClass: 'web-scan', sourceUrl: 'ghp_leaked', actor: 'ghp_actor' });
  assert(dirtyRec.sourceUrl === '[redacted-gh-token]', 'buildRecord sanitizes sourceUrl');
  assert(dirtyRec.actor === '[redacted-gh-token]', 'buildRecord sanitizes actor');

  // Test 7: NDJSON serialization round-trip
  const line = JSON.stringify(rec);
  const parsed = JSON.parse(line);
  assert(parsed.sourceClass === 'github-issue', 'NDJSON round-trip preserves sourceClass');

  // Test 8: all source classes produce valid records
  for (const cls of SOURCE_CLASSES) {
    const r = buildRecord({ sourceClass: cls });
    assert(r.sourceClass === cls, `sourceClass "${cls}" accepted`);
  }

  // Test 9: all reliability tiers produce valid records
  for (const tier of RELIABILITY_TIERS) {
    const r = buildRecord({ sourceClass: 'web-scan', reliabilityTier: tier });
    assert(r.reliabilityTier === tier, `reliabilityTier "${tier}" accepted`);
  }

  // Test 10: rawHash validation accepts valid hex
  const hexHash = 'a'.repeat(64);
  assert(/^[a-f0-9]{16,64}$/i.test(hexHash), 'valid hex hash accepted');

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

  const record = buildRecord(args);
  const line = JSON.stringify(record);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('EXTERNAL FACT WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log();
    console.log('Record:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the record to the NDJSON file.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, record);
  console.log(`External fact appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  sourceClass: ${record.sourceClass}`);
  console.log(`  capturedAt: ${record.capturedAt}`);
}

main();
