#!/usr/bin/env node

/**
 * write-opportunity-signal.js
 *
 * Append-only opportunity signal writer.
 * Writes sanitized NDJSON records to .github/ai-state/opportunity-signals.ndjson.
 *
 * Validates basic shape (signalId, status) and redacts secrets before writing.
 * Aligned with the Opportunity Signal Schema.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-opportunity-signal.js --help
 *   node scripts/ai/write-opportunity-signal.js --signalId opp-abc123 --status draft --hypothesis '{"claim":"test"}'
 *   node scripts/ai/write-opportunity-signal.js --signalId opp-abc123 --live
 *   node scripts/ai/write-opportunity-signal.js --self-test
 *
 * Exit codes:
 *   0 — Record processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, sanitize, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'opportunity-signals.ndjson');
const SIGNAL_VERSION = 1;

const VALID_STATUSES = [
  'draft',
  'validated',
  'accepted',
  'scheduled',
  'rejected',
];

const VALID_EXPERIMENT_TYPES = [
  'code-change',
  'config-change',
  'data-collection',
  'prototype',
  'ab-test',
];

const VALID_RISK_LEVELS = ['low', 'medium', 'high'];
const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
const VALID_HEALTH_GATES = ['gate-all', 'gate-docs-only', 'gate-none'];

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitize(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((v) => (typeof v === 'string' ? sanitize(v) : v));
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-opportunity-signal.js — Append-only opportunity signal writer

USAGE
    node scripts/ai/write-opportunity-signal.js [OPTIONS]

OPTIONS
    --signalId <string>          Signal ID (required). Format: opp-<short-uuid>
    --status <string>            Lifecycle status (optional, default: draft).
                                 One of: ${VALID_STATUSES.join(', ')}
    --sourceFacts <json>         JSON array of source fact objects (optional)
    --hypothesis <json>          JSON object with claim, reasoning (optional)
    --expectedImpact <json>      JSON object with metric, currentValue, targetValue (optional)
    --experiment <json>          JSON object with type, description, scope, successCriteria (optional)
    --risk <json>                JSON object with level, concerns (optional)
    --acceptanceGate <json>      JSON object with criteria, acceptanceOwner (optional)
    --tags <json>                JSON array of tag strings (optional)
    --out <path>                 Output NDJSON file path
                                 (default: .github/ai-state/opportunity-signals.ndjson)
    --dry-run                    Preview the record without writing (default)
    --live                       Append the record to the NDJSON file
    --self-test                  Run built-in validation and exit
    --help, -h                   Show this help message

DESCRIPTION
    Appends a single sanitized opportunity signal as one NDJSON line.
    Each record is timestamped, versioned, and scrubbed of potential
    secrets before writing.

    In dry-run mode (default), prints the record JSON to stdout without
    modifying any file.

RECORD SCHEMA
    {
      "schemaVersion": 1,
      "signalId": "string (required)",
      "createdAt": "ISO-8601 (auto-generated)",
      "status": "draft|validated|accepted|scheduled|rejected",
      "tags": [],
      "sourceFacts": [],
      "hypothesis": { ... },
      "expectedImpact": { ... },
      "experiment": { ... },
      "risk": { ... },
      "acceptanceGate": { ... },
      "promotedTaskId": null,
      "rejectionReason": null
    }

EXIT CODES
    0   Record processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Preview a draft signal
    node scripts/ai/write-opportunity-signal.js --signalId opp-test123

    # Write with hypothesis
    node scripts/ai/write-opportunity-signal.js --signalId opp-abc --status draft --hypothesis '{"claim":"test claim","reasoning":"evidence"}' --live

    # Run self-test
    node scripts/ai/write-opportunity-signal.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    signalId: null,
    status: 'draft',
    sourceFacts: null,
    hypothesis: null,
    expectedImpact: null,
    experiment: null,
    risk: null,
    acceptanceGate: null,
    tags: null,
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
    } else if (arg === '--signalId') {
      i++;
      if (i >= argv.length) { console.error('Error: --signalId requires a value'); process.exit(2); }
      args.signalId = argv[i];
    } else if (arg === '--status') {
      i++;
      if (i >= argv.length) { console.error('Error: --status requires a value'); process.exit(2); }
      args.status = argv[i];
    } else if (arg === '--sourceFacts') {
      i++;
      if (i >= argv.length) { console.error('Error: --sourceFacts requires a JSON string'); process.exit(2); }
      try {
        args.sourceFacts = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --sourceFacts must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--hypothesis') {
      i++;
      if (i >= argv.length) { console.error('Error: --hypothesis requires a JSON string'); process.exit(2); }
      try {
        args.hypothesis = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --hypothesis must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--expectedImpact') {
      i++;
      if (i >= argv.length) { console.error('Error: --expectedImpact requires a JSON string'); process.exit(2); }
      try {
        args.expectedImpact = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --expectedImpact must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--experiment') {
      i++;
      if (i >= argv.length) { console.error('Error: --experiment requires a JSON string'); process.exit(2); }
      try {
        args.experiment = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --experiment must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--risk') {
      i++;
      if (i >= argv.length) { console.error('Error: --risk requires a JSON string'); process.exit(2); }
      try {
        args.risk = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --risk must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--acceptanceGate') {
      i++;
      if (i >= argv.length) { console.error('Error: --acceptanceGate requires a JSON string'); process.exit(2); }
      try {
        args.acceptanceGate = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --acceptanceGate must be valid JSON');
        process.exit(2);
      }
    } else if (arg === '--tags') {
      i++;
      if (i >= argv.length) { console.error('Error: --tags requires a JSON string'); process.exit(2); }
      try {
        args.tags = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --tags must be valid JSON');
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

  if (!args.signalId) {
    errors.push('--signalId is required');
  } else if (!/^opp-[a-zA-Z0-9_-]+$/.test(args.signalId)) {
    errors.push('--signalId must match format opp-<identifier>');
  }

  if (!VALID_STATUSES.includes(args.status)) {
    errors.push(`--status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (args.sourceFacts && !Array.isArray(args.sourceFacts)) {
    errors.push('--sourceFacts must be a JSON array');
  }

  if (args.hypothesis && typeof args.hypothesis !== 'object') {
    errors.push('--hypothesis must be a JSON object');
  }

  if (args.experiment) {
    if (typeof args.experiment !== 'object') {
      errors.push('--experiment must be a JSON object');
    } else if (args.experiment.type && !VALID_EXPERIMENT_TYPES.includes(args.experiment.type)) {
      errors.push(`--experiment.type must be one of: ${VALID_EXPERIMENT_TYPES.join(', ')}`);
    }
  }

  if (args.risk) {
    if (typeof args.risk !== 'object') {
      errors.push('--risk must be a JSON object');
    } else if (args.risk.level && !VALID_RISK_LEVELS.includes(args.risk.level)) {
      errors.push(`--risk.level must be one of: ${VALID_RISK_LEVELS.join(', ')}`);
    }
  }

  if (args.acceptanceGate && typeof args.acceptanceGate !== 'object') {
    errors.push('--acceptanceGate must be a JSON object');
  }

  if (args.tags && !Array.isArray(args.tags)) {
    errors.push('--tags must be a JSON array');
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

function buildSignal(args) {
  const now = new Date().toISOString();

  return sanitizeObject({
    schemaVersion: SIGNAL_VERSION,
    signalId: args.signalId,
    createdAt: now,
    status: args.status,
    tags: args.tags || [],
    sourceFacts: args.sourceFacts || [],
    hypothesis: args.hypothesis || null,
    expectedImpact: args.expectedImpact || null,
    experiment: args.experiment || null,
    risk: args.risk || null,
    acceptanceGate: args.acceptanceGate || null,
    promotedTaskId: null,
    rejectionReason: null,
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

  console.log('write-opportunity-signal.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildSignal produces correct shape
  const sig = buildSignal({
    signalId: 'opp-test1',
    status: 'draft',
    sourceFacts: [{ factId: 'fact:test:one', description: 'test', source: 'test' }],
    hypothesis: { claim: 'test claim', reasoning: 'because' },
    tags: ['perf'],
  });
  assert(sig.schemaVersion === 1, 'schemaVersion is 1');
  assert(sig.signalId === 'opp-test1', 'signalId preserved');
  assert(sig.status === 'draft', 'status preserved');
  assert(typeof sig.createdAt === 'string', 'createdAt is string');
  assert(sig.tags[0] === 'perf', 'tags preserved');
  assert(sig.sourceFacts[0].factId === 'fact:test:one', 'sourceFacts preserved');
  assert(sig.hypothesis.claim === 'test claim', 'hypothesis preserved');
  assert(sig.promotedTaskId === null, 'promotedTaskId is null');
  assert(sig.rejectionReason === null, 'rejectionReason is null');

  // Test 2: null optional fields
  const minimal = buildSignal({ signalId: 'opp-min', status: 'draft' });
  assert(minimal.sourceFacts.length === 0, 'empty sourceFacts default');
  assert(minimal.hypothesis === null, 'null hypothesis stays null');
  assert(minimal.experiment === null, 'null experiment stays null');
  assert(minimal.risk === null, 'null risk stays null');
  assert(minimal.acceptanceGate === null, 'null acceptanceGate stays null');
  assert(minimal.tags.length === 0, 'empty tags default');

  // Test 3: sanitize strips tokens
  const tokenStr = 'a'.repeat(50);
  assert(sanitize(tokenStr) === '[redacted-token]', 'long base64-like string redacted');
  assert(sanitize('ghp_abc123xyz') === '[redacted-gh-token]', 'ghp_ token redacted');
  assert(sanitize('Bearer mytoken123') === 'Bearer [redacted]', 'Bearer token redacted');

  // Test 4: sanitizeObject handles nested strings
  const dirty = { claim: 'ghp_leaked', reasoning: 'Bearer secret123' };
  const clean = sanitizeObject(dirty);
  assert(clean.claim === '[redacted-gh-token]', 'sanitizeObject scrubs nested strings');
  assert(clean.reasoning === 'Bearer [redacted]', 'sanitizeObject scrubs Bearer tokens');

  // Test 5: sanitize truncates at 500 chars
  const longStr = 'x'.repeat(600);
  assert(sanitize(longStr).length <= 500, 'sanitize truncates to 500 chars');

  // Test 6: buildSignal sanitizes hypothesis
  const dirtySig = buildSignal({
    signalId: 'opp-dirty',
    status: 'draft',
    hypothesis: { claim: 'ghp_leaked_here', reasoning: 'safe' },
  });
  assert(dirtySig.hypothesis.claim === '[redacted-gh-token]_here', 'buildSignal sanitizes hypothesis');

  // Test 7: all statuses produce valid records
  for (const status of VALID_STATUSES) {
    const s = buildSignal({ signalId: 'opp-s', status });
    assert(s.status === status, `status "${status}" accepted`);
  }

  // Test 8: NDJSON serialization round-trip
  const line = JSON.stringify(sig);
  const parsed = JSON.parse(line);
  assert(parsed.signalId === 'opp-test1', 'NDJSON round-trip preserves signalId');

  // Test 9: sanitizeObject handles arrays
  const withArr = sanitizeObject({ items: ['ghp_leak', 'safe'] });
  assert(withArr.items[0] === '[redacted-gh-token]', 'sanitizeObject scrubs array strings');
  assert(withArr.items[1] === 'safe', 'sanitizeObject preserves clean array strings');

  // Test 10: sanitizeObject handles null
  assert(sanitizeObject(null) === null, 'sanitizeObject handles null');

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

  const signal = buildSignal(args);
  const line = JSON.stringify(signal);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('OPPORTUNITY SIGNAL WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log();
    console.log('Signal:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the signal to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, signal);
  console.log(`Opportunity signal appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  signalId: ${signal.signalId}`);
  console.log(`  status: ${signal.status}`);
  console.log(`  createdAt: ${signal.createdAt}`);
}

main();
