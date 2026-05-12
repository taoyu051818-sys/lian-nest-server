#!/usr/bin/env node

/**
 * write-self-cycle-queue.test.js
 *
 * Tests for write-self-cycle-queue.js. Exercises queue entry generation,
 * artifact shape, sanitization, and CLI parsing without network access.
 */

'use strict';

const {
  buildQueueEntries,
  buildSeedArtifact,
  sanitizeObject,
  sanitizeValue,
  SCHEMA_VERSION,
} = require('./write-self-cycle-queue');

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (!condition) {
    failed++;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// ── buildQueueEntries ────────────────────────────────────────────────────────

function testBuildQueueEntriesSingleIssue() {
  const entries = buildQueueEntries([1282], 'self-cycle-queue');
  assert(entries.length === 1, 'single issue produces 1 entry');
  assert(entries[0].issueNumber === 1282, 'issueNumber is 1282');
  assert(entries[0].state === 'queued', 'state is queued');
  assert(entries[0].conflictGroup === 'self-cycle-queue', 'conflictGroup matches');
  assert(typeof entries[0].updatedAt === 'string', 'updatedAt is string');
  // Verify it's a valid ISO date
  assert(!isNaN(Date.parse(entries[0].updatedAt)), 'updatedAt is valid ISO date');
}

function testBuildQueueEntriesMultipleIssues() {
  const entries = buildQueueEntries([100, 200, 300], 'test-group');
  assert(entries.length === 3, 'three issues produce 3 entries');
  assert(entries[0].issueNumber === 100, 'first is 100');
  assert(entries[1].issueNumber === 200, 'second is 200');
  assert(entries[2].issueNumber === 300, 'third is 300');
  assert(entries.every(e => e.state === 'queued'), 'all entries are queued');
  assert(entries.every(e => e.conflictGroup === 'test-group'), 'all share conflict group');
}

function testBuildQueueEntriesEmpty() {
  const entries = buildQueueEntries([], 'group');
  assert(entries.length === 0, 'empty input produces empty array');
}

function testBuildQueueEntriesCustomConflictGroup() {
  const entries = buildQueueEntries([42], 'my-custom-group');
  assert(entries[0].conflictGroup === 'my-custom-group', 'custom conflict group preserved');
}

// ── buildSeedArtifact ────────────────────────────────────────────────────────

function testBuildSeedArtifactShape() {
  const artifact = buildSeedArtifact([500, 600], 'my-group');
  assert(artifact.schemaVersion === SCHEMA_VERSION, 'schemaVersion matches');
  assert(typeof artifact.capturedAt === 'string', 'capturedAt is string');
  assert(artifact.mode === 'seed', 'mode is seed');
  assert(artifact.dryRun === true, 'dryRun is true');
  assert(artifact.entryCount === 2, 'entryCount is 2');
  assert(Array.isArray(artifact.entries), 'entries is array');
  assert(artifact.entries.length === 2, 'entries has 2 items');
}

function testBuildSeedArtifactEntryCountMatchesEntries() {
  const artifact = buildSeedArtifact([1, 2, 3, 4, 5], 'group');
  assert(artifact.entryCount === 5, 'entryCount matches entries length');
  assert(artifact.entries.length === 5, 'entries array has correct length');
}

function testBuildSeedArtifactCapturedAtIsValid() {
  const artifact = buildSeedArtifact([1], 'group');
  assert(!isNaN(Date.parse(artifact.capturedAt)), 'capturedAt is valid ISO date');
}

// ── Sanitization ─────────────────────────────────────────────────────────────

function testSanitizeObjectStripsSecrets() {
  const dirty = {
    issueNumber: 1,
    state: 'queued',
    updatedAt: '2026-01-01T00:00:00Z',
    apiToken: 'should-be-removed',
    secret: 'should-be-removed',
    apiKey: 'should-be-removed',
    password: 'should-be-removed',
    bearer: 'should-be-removed',
    credential: 'should-be-removed',
  };
  const clean = sanitizeObject(dirty);
  assert(!('apiToken' in clean), 'apiToken stripped');
  assert(!('secret' in clean), 'secret stripped');
  assert(!('apiKey' in clean), 'apiKey stripped');
  assert(!('password' in clean), 'password stripped');
  assert(!('bearer' in clean), 'bearer stripped');
  assert(!('credential' in clean), 'credential stripped');
  assert(clean.issueNumber === 1, 'non-secret integer preserved');
  assert(clean.state === 'queued', 'non-secret string preserved');
}

function testSanitizeObjectPreservesNormalKeys() {
  const obj = { issueNumber: 42, state: 'queued', conflictGroup: 'test', updatedAt: '2026-01-01' };
  const clean = sanitizeObject(obj);
  assert(Object.keys(clean).length === 4, 'all normal keys preserved');
  assert(clean.issueNumber === 42, 'issueNumber preserved');
}

function testSanitizeObjectNested() {
  const obj = {
    entry: { issueNumber: 1, token: 'secret', state: 'queued' },
    items: [{ apiKey: 'x', value: 42 }],
  };
  const clean = sanitizeObject(obj);
  assert(!('token' in clean.entry), 'nested token stripped');
  assert(clean.entry.issueNumber === 1, 'nested issueNumber preserved');
  assert(!('apiKey' in clean.items[0]), 'array item apiKey stripped');
  assert(clean.items[0].value === 42, 'array item value preserved');
}

function testSanitizeValueTruncatesLongStrings() {
  const longStr = 'x'.repeat(600);
  const truncated = sanitizeValue(longStr);
  assert(truncated.length < 600, 'long string truncated');
  assert(truncated.endsWith('…'), 'ends with ellipsis');
}

function testSanitizeValuePreservesShortStrings() {
  const short = 'hello';
  assert(sanitizeValue(short) === 'hello', 'short string preserved');
}

function testSanitizeValueHandlesNumbers() {
  assert(sanitizeValue(42) === 42, 'number preserved');
  assert(sanitizeValue(0) === 0, 'zero preserved');
}

function testSanitizeValueHandlesNull() {
  assert(sanitizeValue(null) === null, 'null preserved');
}

function testSanitizeValueHandlesArrays() {
  const arr = ['short', 'x'.repeat(600), 42];
  const result = sanitizeValue(arr);
  assert(result[0] === 'short', 'array short string preserved');
  assert(result[1].endsWith('…'), 'array long string truncated');
  assert(result[2] === 42, 'array number preserved');
}

// ── Artifact no-secrets check ────────────────────────────────────────────────

function testArtifactContainsNoSecrets() {
  const artifact = buildSeedArtifact([100, 200], 'group');
  const json = JSON.stringify(artifact);
  assert(!/"token"/.test(json), 'no token key in artifact JSON');
  assert(!/"secret"/.test(json), 'no secret key in artifact JSON');
  assert(!/"apiKey"/.test(json), 'no apiKey key in artifact JSON');
  assert(!/"password"/.test(json), 'no password key in artifact JSON');
  assert(!/"bearer"/.test(json), 'no bearer key in artifact JSON');
  assert(!/"credential"/.test(json), 'no credential key in artifact JSON');
}

// ── QueueEntry shape conformance ─────────────────────────────────────────────

function testEntryShapeMatchesQueueSchema() {
  const entries = buildQueueEntries([42], 'group');
  const entry = entries[0];

  // Required fields from webui-queue-state schema QueueEntry
  assert(typeof entry.issueNumber === 'number', 'issueNumber is number');
  assert(entry.issueNumber >= 1, 'issueNumber >= 1');
  assert(typeof entry.state === 'string', 'state is string');
  assert(['queued', 'launching', 'running', 'pr-created', 'blocked', 'done'].includes(entry.state), 'state is valid enum value');
  assert(typeof entry.updatedAt === 'string', 'updatedAt is string');

  // Optional fields present in seed entries
  assert(typeof entry.conflictGroup === 'string', 'conflictGroup is string');
  assert(entry.conflictGroup.length >= 1, 'conflictGroup is non-empty');
}

// ── Run all tests ────────────────────────────────────────────────────────────

function runAll() {
  testBuildQueueEntriesSingleIssue();
  testBuildQueueEntriesMultipleIssues();
  testBuildQueueEntriesEmpty();
  testBuildQueueEntriesCustomConflictGroup();
  testBuildSeedArtifactShape();
  testBuildSeedArtifactEntryCountMatchesEntries();
  testBuildSeedArtifactCapturedAtIsValid();
  testSanitizeObjectStripsSecrets();
  testSanitizeObjectPreservesNormalKeys();
  testSanitizeObjectNested();
  testSanitizeValueTruncatesLongStrings();
  testSanitizeValuePreservesShortStrings();
  testSanitizeValueHandlesNumbers();
  testSanitizeValueHandlesNull();
  testSanitizeValueHandlesArrays();
  testArtifactContainsNoSecrets();
  testEntryShapeMatchesQueueSchema();

  console.log(`\n  write-self-cycle-queue.test.js`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
    console.log('');
    process.exit(1);
  } else {
    console.log(`\n  All tests passed.\n`);
    process.exit(0);
  }
}

runAll();
