#!/usr/bin/env node

/**
 * validate-external-fact.js
 *
 * Skeleton validator for external fact records (JSON / NDJSON).
 * Validates required fields per the External Reality Intake contract
 * and never prints secrets.
 *
 * Usage:
 *   node scripts/ai/validate-external-fact.js --help
 *   node scripts/ai/validate-external-fact.js --file path/to/facts.ndjson
 *   node scripts/ai/validate-external-fact.js --json '{"sourceClass":"github-issue",...}'
 *   node scripts/ai/validate-external-fact.js --self-test
 *
 * Exit codes:
 *   0 — Validation succeeded (all records valid)
 *   1 — Validation failed (one or more records invalid)
 *   2 — Invalid arguments / usage error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────

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

const REQUIRED_FIELDS = ['sourceClass', 'capturedAt'];

const OPTIONAL_FIELDS = [
  'sourceUrl',
  'rawHash',
  'actor',
  'reliabilityTier',
  'sanitized',
  'rawInput',
  'facts',
];

// ── Sanitization (never echo secrets) ────────────────────────────────────────

function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]');
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateRecord(record, index) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: [`Record ${index}: must be a JSON object`] };
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record) || record[field] == null || record[field] === '') {
      errors.push(`Record ${index}: missing required field "${field}"`);
    }
  }

  // sourceClass must be a known class
  if (record.sourceClass && !SOURCE_CLASSES.includes(record.sourceClass)) {
    errors.push(
      `Record ${index}: unknown sourceClass "${redact(record.sourceClass)}"` +
      ` (expected one of: ${SOURCE_CLASSES.join(', ')})`,
    );
  }

  // reliabilityTier, if present, must be a known tier
  if (record.reliabilityTier && !RELIABILITY_TIERS.includes(record.reliabilityTier)) {
    errors.push(
      `Record ${index}: unknown reliabilityTier "${redact(record.reliabilityTier)}"` +
      ` (expected one of: ${RELIABILITY_TIERS.join(', ')})`,
    );
  }

  // capturedAt must be ISO-8601-parseable
  if (record.capturedAt) {
    const ts = Date.parse(record.capturedAt);
    if (Number.isNaN(ts)) {
      errors.push(`Record ${index}: capturedAt is not a valid ISO-8601 date`);
    }
  }

  // rawHash, if present, should look like a hex string (SHA-256)
  if (record.rawHash && !/^[a-f0-9]{16,64}$/i.test(record.rawHash)) {
    errors.push(`Record ${index}: rawHash does not look like a valid hex hash`);
  }

  return { valid: errors.length === 0, errors };
}

function validateRecords(records) {
  const results = records.map((r, i) => validateRecord(r, i));
  const allErrors = results.flatMap(r => r.errors);
  const allValid = results.every(r => r.valid);
  return { valid: allValid, total: records.length, errors: allErrors };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function parseNdjson(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const records = [];
  const parseErrors = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]));
    } catch {
      parseErrors.push(`Line ${i + 1}: invalid JSON`);
    }
  }

  return { records, parseErrors };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
validate-external-fact.js — External fact record validator skeleton

USAGE
    node scripts/ai/validate-external-fact.js [OPTIONS]

OPTIONS
    --file <path>    Read JSON array or NDJSON from a file
    --json <string>  Validate a single JSON record
    --self-test      Run built-in validation tests
    --help, -h       Show this help message

DESCRIPTION
    Validates external fact records against the External Reality Intake
    contract. Checks required fields, source class validity, and
    timestamp format. Never prints raw input that may contain secrets.

    Accepts either a JSON array of records or newline-delimited JSON
    (NDJSON), one record per line.

REQUIRED FIELDS
    sourceClass    One of: ${SOURCE_CLASSES.join(', ')}
    capturedAt     ISO-8601 timestamp

OPTIONAL FIELDS
    sourceUrl      Canonical URL of the source
    rawHash        SHA-256 hex hash of raw input
    actor          Who or what produced the input
    reliabilityTier  One of: ${RELIABILITY_TIERS.join(', ')}
    sanitized      Whether sanitization was applied (boolean)
    rawInput       Raw input text (will not be echoed)
    facts          Additional key-value facts

EXIT CODES
    0   All records valid
    1   One or more records invalid
    2   Invalid arguments / usage error

EXAMPLES
    # Validate a single record
    node scripts/ai/validate-external-fact.js --json '{"sourceClass":"github-issue","capturedAt":"2026-05-12T10:00:00Z"}'

    # Validate NDJSON file
    node scripts/ai/validate-external-fact.js --file .github/ai-state/fact-events.ndjson

    # Run self-test
    node scripts/ai/validate-external-fact.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    file: null,
    json: null,
    selfTest: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--file') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --file requires a path argument');
        process.exit(2);
      }
      args.file = argv[i];
    } else if (arg === '--json') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --json requires a JSON string');
        process.exit(2);
      }
      args.json = argv[i];
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

  console.log('validate-external-fact.js — self-test');
  console.log('='.repeat(40));

  // Valid record
  const valid = validateRecord({
    sourceClass: 'github-issue',
    capturedAt: '2026-05-12T10:00:00Z',
  }, 0);
  assert(valid.valid === true, 'valid record passes');
  assert(valid.errors.length === 0, 'valid record has no errors');

  // Missing required field
  const missingSource = validateRecord({ capturedAt: '2026-05-12T10:00:00Z' }, 1);
  assert(missingSource.valid === false, 'missing sourceClass fails');
  assert(missingSource.errors.some(e => e.includes('sourceClass')), 'error mentions sourceClass');

  // Unknown sourceClass
  const badClass = validateRecord({
    sourceClass: 'twitter-post',
    capturedAt: '2026-05-12T10:00:00Z',
  }, 2);
  assert(badClass.valid === false, 'unknown sourceClass fails');
  assert(badClass.errors.some(e => e.includes('sourceClass')), 'error mentions sourceClass');

  // Bad timestamp
  const badTime = validateRecord({
    sourceClass: 'github-pr',
    capturedAt: 'not-a-date',
  }, 3);
  assert(badTime.valid === false, 'invalid capturedAt fails');
  assert(badTime.errors.some(e => e.includes('capturedAt')), 'error mentions capturedAt');

  // All known source classes accepted
  for (const cls of SOURCE_CLASSES) {
    const r = validateRecord({ sourceClass: cls, capturedAt: '2026-05-12T10:00:00Z' }, 0);
    assert(r.valid === true, `sourceClass "${cls}" accepted`);
  }

  // Bad reliabilityTier
  const badTier = validateRecord({
    sourceClass: 'web-scan',
    capturedAt: '2026-05-12T10:00:00Z',
    reliabilityTier: 'super-high',
  }, 4);
  assert(badTier.valid === false, 'unknown reliabilityTier fails');

  // Optional fields accepted
  const withOptionals = validateRecord({
    sourceClass: 'external-doc',
    capturedAt: '2026-05-12T10:00:00Z',
    sourceUrl: 'https://example.com',
    rawHash: 'a'.repeat(64),
    actor: 'test-script',
    reliabilityTier: 'medium',
    sanitized: true,
  }, 0);
  assert(withOptionals.valid === true, 'record with optional fields passes');

  // NDJSON parsing
  const ndjson = '{"sourceClass":"github-issue","capturedAt":"2026-05-12T10:00:00Z"}\n{"sourceClass":"ci-result","capturedAt":"2026-05-12T11:00:00Z"}\n';
  const parsed = parseNdjson(ndjson);
  assert(parsed.records.length === 2, 'NDJSON parses 2 records');
  assert(parsed.parseErrors.length === 0, 'NDJSON has no parse errors');

  // Non-object record
  const notObj = validateRecord('just a string', 0);
  assert(notObj.valid === false, 'non-object record fails');

  // Multi-record validation
  const multi = validateRecords([
    { sourceClass: 'github-issue', capturedAt: '2026-05-12T10:00:00Z' },
    { sourceClass: 'ci-result', capturedAt: '2026-05-12T11:00:00Z' },
  ]);
  assert(multi.valid === true, 'multi-record valid batch passes');
  assert(multi.total === 2, 'multi-record total is 2');

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

  // Must have at least one input source
  if (!args.file && !args.json) {
    console.error('Error: provide --file <path> or --json <string>');
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  let records = [];

  if (args.file) {
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(2);
    }
    const text = fs.readFileSync(filePath, 'utf8');

    // Try JSON array first, then NDJSON
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        records = parsed;
      } else {
        records = [parsed];
      }
    } catch {
      const ndjson = parseNdjson(text);
      if (ndjson.parseErrors.length > 0) {
        for (const err of ndjson.parseErrors) {
          console.error(`Parse error: ${err}`);
        }
        process.exit(2);
      }
      records = ndjson.records;
    }
  }

  if (args.json) {
    try {
      const parsed = JSON.parse(args.json);
      records.push(parsed);
    } catch {
      console.error('Error: --json value is not valid JSON');
      process.exit(2);
    }
  }

  const result = validateRecords(records);

  console.log(JSON.stringify({
    valid: result.valid,
    total: result.total,
    errors: result.errors.map(redact),
  }, null, 2));

  process.exit(result.valid ? 0 : 1);
}

main();
