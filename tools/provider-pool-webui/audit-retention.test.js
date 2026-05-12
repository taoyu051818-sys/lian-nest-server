#!/usr/bin/env node

/**
 * audit-retention.test.js
 *
 * Tests for audit retention policy compliance.
 * Validates that the audit store respects retention constraints:
 * - Entry size bounds (no unbounded growth per entry)
 * - Sanitization prevents log bloat from raw output
 * - File-level operations remain append-only
 * - Retention helpers correctly identify old entries
 *
 * Run: node tools/provider-pool-webui/audit-retention.test.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createAuditStore,
  buildEntry,
  readEntries,
  countEntries,
  sanitizeString,
  sanitizeValue,
  looksLikeRawProcessOutput,
  validateEntry,
  trimEntries,
  MAX_STRING_LENGTH,
  AUDIT_VERSION,
} = require('./lib/audit-store');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.error('  FAIL  ' + name);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-retention-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ── Retention policy constants ───────────────────────────────────────────────

const RETENTION_DAYS = 30;
const MAX_ENTRIES_SOFT = 10000;
const MAX_ENTRY_BYTES = 4096;

/**
 * Filter entries newer than the given number of days.
 * This is the retention boundary check.
 */
function filterByAge(entries, maxDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  return entries.filter((e) => {
    if (!e.capturedAt) return false;
    return new Date(e.capturedAt) >= cutoff;
  });
}

/**
 * Calculate the byte size of a single JSONL entry.
 */
function entryByteSize(entry) {
  return Buffer.byteLength(JSON.stringify(entry) + '\n', 'utf8');
}

// ── Test suites ──────────────────────────────────────────────────────────────

console.log('\naudit-retention.test.js\n');

// --- Entry size bounds ---

console.log('Entry size bounds');

{
  const entry = buildEntry({ action: 'test.size', actor: 'user', target: 'resource', details: { key: 'value' }, outcome: 'success' });
  const size = entryByteSize(entry);
  assert(size < MAX_ENTRY_BYTES, 'normal entry is under ' + MAX_ENTRY_BYTES + ' bytes (actual: ' + size + ')');

  // Entry with maximally long sanitized strings
  const longEntry = buildEntry({
    action: 'a'.repeat(200),
    actor: 'b'.repeat(100),
    target: 'c'.repeat(100),
    details: { nested: 'd'.repeat(500) },
    outcome: 'e'.repeat(100),
  });
  const longSize = entryByteSize(longEntry);
  assert(longSize < MAX_ENTRY_BYTES * 2, 'max-length entry stays bounded (actual: ' + longSize + ')');
}

// --- Sanitization prevents log bloat ---

console.log('\nSanitization prevents log bloat');

{
  // Raw process output is rejected, not stored verbatim
  const rawEntry = buildEntry({
    action: 'test.raw',
    details: { log: '\x1b[31mERROR\x1b[0m\n'.repeat(100) },
  });
  assert(rawEntry.details._warning !== undefined, 'raw ANSI output is redacted, not stored');

  // Long base64-like strings are truncated
  const b64 = 'A'.repeat(500);
  const sanitized = sanitizeString(b64);
  assert(sanitized.length <= MAX_STRING_LENGTH, 'long base64 string truncated to MAX_STRING_LENGTH');

  // Repeated secret patterns don't cause unbounded growth
  const secretLine = 'ghp_token1234567890abcdefghij '.repeat(50);
  const sanitizedLine = sanitizeString(secretLine);
  assert(sanitizedLine.length <= MAX_STRING_LENGTH, 'repeated secrets truncated');
  assert(!sanitizedLine.includes('ghp_token'), 'all secret instances redacted');
}

// --- Append-only invariant under retention reads ---

console.log('\nAppend-only invariant under retention reads');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit-retention.jsonl');
  const store = createAuditStore({ filePath: auditPath, dryRun: false });

  store.record({ action: 'first', outcome: 'ok' });
  store.record({ action: 'second', outcome: 'ok' });
  store.record({ action: 'third', outcome: 'ok' });

  const before = fs.readFileSync(auditPath, 'utf8');

  // Simulate retention read operations
  const entries = store.read();
  const filtered = filterByAge(entries, RETENTION_DAYS);
  assert(filtered.length === 3, 'all entries are within retention window');

  const after = fs.readFileSync(auditPath, 'utf8');
  assert(before === after, 'retention read does not modify the audit file');
  assert(store.count() === 3, 'count unchanged after retention read');

  cleanup(tmp);
}

// --- Retention boundary: entries older than cutoff ---

console.log('\nRetention boundary: entries older than cutoff');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit-retention-boundary.jsonl');

  // Manually write entries with different timestamps
  const oldEntry = { auditVersion: AUDIT_VERSION, capturedAt: isoDaysAgo(60), action: 'old.action' };
  const recentEntry = { auditVersion: AUDIT_VERSION, capturedAt: isoDaysAgo(5), action: 'recent.action' };
  const boundaryEntry = { auditVersion: AUDIT_VERSION, capturedAt: isoDaysAgo(RETENTION_DAYS), action: 'boundary.action' };

  fs.writeFileSync(auditPath, [oldEntry, recentEntry, boundaryEntry].map(JSON.stringify).join('\n') + '\n', 'utf8');

  const all = readEntries(auditPath);
  assert(all.length === 3, 'reads all 3 entries');

  const withinRetention = filterByAge(all, RETENTION_DAYS);
  assert(withinRetention.length >= 1, 'at least recent entry is within retention');
  const actions = withinRetention.map((e) => e.action);
  assert(actions.includes('recent.action'), 'recent entry retained');

  const outsideRetention = all.filter((e) => !withinRetention.includes(e));
  assert(outsideRetention.length >= 1, 'at least old entry is outside retention');
  assert(outsideRetention.some((e) => e.action === 'old.action'), 'old entry identified for cleanup');

  cleanup(tmp);
}

// --- Soft entry count limit ---

console.log('\nSoft entry count limit');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit-retention-count.jsonl');
  const store = createAuditStore({ filePath: auditPath, dryRun: false });

  // Write a small batch
  const batchSize = 50;
  for (let i = 0; i < batchSize; i++) {
    store.record({ action: `batch.action.${i}`, outcome: 'ok' });
  }

  assert(store.count() === batchSize, 'wrote ' + batchSize + ' entries');
  assert(store.count() < MAX_ENTRIES_SOFT, 'batch is well under soft limit');

  const entries = store.read();
  assert(entries.length === batchSize, 'reads back all ' + batchSize + ' entries');

  // Verify each entry is individually valid JSON
  const raw = fs.readFileSync(auditPath, 'utf8');
  const lines = raw.trim().split('\n');
  assert(lines.length === batchSize, 'JSONL has correct line count');
  for (let i = 0; i < lines.length; i++) {
    const parsed = JSON.parse(lines[i]);
    assert(typeof parsed.action === 'string', 'entry ' + i + ' has valid action');
  }

  cleanup(tmp);
}

// --- Empty / missing file retention behavior ---

console.log('\nEmpty / missing file retention behavior');

{
  const tmp = tmpDir();

  // Missing file
  const missing = readEntries(path.join(tmp, 'no-such-file.jsonl'));
  assert(missing.length === 0, 'missing file returns empty array');

  // Empty file
  const emptyPath = path.join(tmp, 'empty.jsonl');
  fs.writeFileSync(emptyPath, '', 'utf8');
  const empty = readEntries(emptyPath);
  assert(empty.length === 0, 'empty file returns empty array');

  // Empty retention filter
  const filtered = filterByAge([], RETENTION_DAYS);
  assert(filtered.length === 0, 'empty entries returns empty filter');

  cleanup(tmp);
}

// --- SanitizeValue on retention-relevant types ---

console.log('\nSanitizeValue on retention-relevant types');

{
  assert(sanitizeValue(null) === null, 'null passes through');
  assert(sanitizeValue(42) === 42, 'number passes through');
  assert(sanitizeValue(true) === true, 'boolean passes through');

  const arr = sanitizeValue(['ghp_abc', 'safe', null]);
  assert(arr[0] === '[redacted-gh-token]', 'array string sanitized');
  assert(arr[1] === 'safe', 'array safe string preserved');
  assert(arr[2] === null, 'array null preserved');

  const nested = sanitizeValue({ a: [{ b: 'ghp_leak' }] });
  assert(nested.a[0].b === '[redacted-gh-token]', 'deeply nested sanitized');
}

// --- looksLikeRawProcessOutput boundary ---

console.log('\nlooksLikeRawProcessOutput boundary');

{
  assert(looksLikeRawProcessOutput('normal log line') === false, 'normal log accepted');
  assert(looksLikeRawProcessOutput('\x1b[31mred\x1b[0m') === true, 'ANSI escape rejected');
  assert(looksLikeRawProcessOutput('x'.repeat(2001)) === true, 'single line > 2000 chars rejected');
  assert(looksLikeRawProcessOutput('x'.repeat(1999)) === false, 'single line <= 2000 chars accepted');
  assert(looksLikeRawProcessOutput(42) === false, 'non-string returns false');
  assert(looksLikeRawProcessOutput(null) === false, 'null returns false');
}

// --- Retention compliance: no secrets survive in file ---

console.log('\nRetention compliance: no secrets survive in file');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit-retention-secrets.jsonl');
  const store = createAuditStore({ filePath: auditPath, dryRun: false });

  store.record({
    action: 'provider.rotate',
    actor: 'admin',
    details: {
      oldKey: 'ghp_oldtoken_abc123xyz_oldtoken',
      newKey: 'ghp_newtoken_def456uvw_newtoken',
      config: 'password=hunter2',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123',
    },
  });

  const content = fs.readFileSync(auditPath, 'utf8');
  assert(!content.includes('ghp_oldtoken'), 'no old token in file');
  assert(!content.includes('ghp_newtoken'), 'no new token in file');
  assert(!content.includes('hunter2'), 'no password in file');
  assert(!content.includes('eyJhbGciOiJIUzI1NiJ9'), 'no JWT in file');

  cleanup(tmp);
}

// --- filterByAge invalid inputs ---

console.log('\nfilterByAge invalid inputs');

{
  const entries = [
    { capturedAt: isoDaysAgo(5), action: 'recent' },
    { capturedAt: isoDaysAgo(60), action: 'old' },
  ];

  // Zero days — cutoff is now, all entries in the past are excluded
  const zeroResult = filterByAge(entries, 0);
  assert(zeroResult.length === 0, 'filterByAge(entries, 0) returns empty (cutoff is now)');

  // Negative days — cutoff shifts to future, no past entries qualify
  const negResult = filterByAge(entries, -10);
  assert(negResult.length === 0, 'filterByAge(entries, -10) returns empty (future cutoff excludes past entries)');

  // Non-number maxDays — NaN cutoff causes all to fail
  const nanResult = filterByAge(entries, 'not-a-number');
  assert(nanResult.length === 0, 'filterByAge with string maxDays returns empty');

  // Undefined maxDays
  const undefResult = filterByAge(entries, undefined);
  assert(undefResult.length === 0, 'filterByAge with undefined maxDays returns empty');

  // Entry missing capturedAt
  const missingTs = [{ action: 'no-timestamp' }];
  const missingResult = filterByAge(missingTs, 30);
  assert(missingResult.length === 0, 'entry without capturedAt is excluded from retention filter');

  // Entry with invalid capturedAt
  const invalidTs = [{ capturedAt: 'not-a-date', action: 'bad-timestamp' }];
  const invalidResult = filterByAge(invalidTs, 30);
  assert(invalidResult.length === 0, 'entry with invalid capturedAt is excluded');

  // Entry with empty string capturedAt
  const emptyTs = [{ capturedAt: '', action: 'empty-timestamp' }];
  const emptyResult = filterByAge(emptyTs, 30);
  assert(emptyResult.length === 0, 'entry with empty capturedAt is excluded');

  // Entry with null capturedAt
  const nullTs = [{ capturedAt: null, action: 'null-timestamp' }];
  const nullResult = filterByAge(nullTs, 30);
  assert(nullResult.length === 0, 'entry with null capturedAt is excluded');

  // Entry with numeric capturedAt (epoch ms)
  const numericTs = [{ capturedAt: Date.now(), action: 'numeric-timestamp' }];
  const numericResult = filterByAge(numericTs, 1);
  assert(numericResult.length === 1, 'entry with numeric (epoch ms) capturedAt passes filter');

  // Empty entries array
  assert(filterByAge([], 30).length === 0, 'filterByAge on empty array returns empty');
}

// --- trimEntries invalid maxEntries ---

console.log('\ntrimEntries invalid maxEntries');

{
  const tmp = tmpDir();
  const p = path.join(tmp, 'trim-invalid.jsonl');
  fs.writeFileSync(p, '{"i":1}\n{"i":2}\n{"i":3}\n', 'utf8');

  // Negative maxEntries — slice(5) on 3-element array returns [], empties file
  const negRemoved = trimEntries(p, -5);
  assert(negRemoved === 8, 'trimEntries with negative maxEntries reports excess removed');

  // Restore file for next test
  fs.writeFileSync(p, '{"i":1}\n{"i":2}\n{"i":3}\n', 'utf8');

  // NaN maxEntries — 3 <= NaN is false, slice(-NaN)=slice(0)=full array, returns NaN
  const nanRemoved = trimEntries(p, NaN);
  assert(Number.isNaN(nanRemoved), 'trimEntries with NaN maxEntries returns NaN');
  assert(readEntries(p).length === 3, 'trimEntries with NaN maxEntries preserves entries (slice(0))');

  // String maxEntries — coerced via comparison
  fs.writeFileSync(p, '{"i":1}\n{"i":2}\n{"i":3}\n{"i":4}\n{"i":5}\n', 'utf8');
  const strRemoved = trimEntries(p, '3');
  assert(strRemoved === 2, 'trimEntries with string "3" trims to 3');

  // Infinity maxEntries — never exceeds
  fs.writeFileSync(p, '{"i":1}\n{"i":2}\n', 'utf8');
  const infRemoved = trimEntries(p, Infinity);
  assert(infRemoved === 0, 'trimEntries with Infinity is a no-op');

  // Float maxEntries — comparison still works (3.5 > 3 entries → no trim)
  fs.writeFileSync(p, '{"i":1}\n{"i":2}\n{"i":3}\n', 'utf8');
  const floatRemoved = trimEntries(p, 3.5);
  assert(floatRemoved === 0, 'trimEntries with float maxEntries (3.5) on 3 entries is no-op');

  cleanup(tmp);
}

// --- buildEntry edge cases for retention context ---

console.log('\nbuildEntry edge cases for retention context');

{
  // Numeric action — sanitizeString returns non-string as-is
  const numAction = buildEntry({ action: 42 });
  assert(numAction.action === 42, 'numeric action preserved as-is by sanitizeString');

  // Empty details object preserved
  const emptyDetails = buildEntry({ action: 'test', details: {} });
  assert(typeof emptyDetails.details === 'object', 'empty details object preserved');
  assert(Object.keys(emptyDetails.details).length === 0, 'empty details has no keys');

  // Undefined fields are omitted
  const minimal = buildEntry({ action: 'only-action' });
  assert(minimal.actor === undefined, 'undefined actor omitted');
  assert(minimal.target === undefined, 'undefined target omitted');
  assert(minimal.details === undefined, 'undefined details omitted');
  assert(minimal.outcome === undefined, 'undefined outcome omitted');
  assert(minimal.auditVersion === AUDIT_VERSION, 'minimal entry has auditVersion');
  assert(typeof minimal.capturedAt === 'string', 'minimal entry has capturedAt');

  // Null actor/target/outcome are omitted
  const nullFields = buildEntry({ action: 'test', actor: null, target: null, outcome: null });
  assert(nullFields.actor === undefined, 'null actor omitted');
  assert(nullFields.target === undefined, 'null target omitted');
  assert(nullFields.outcome === undefined, 'null outcome omitted');

  // Boolean outcome coerced
  const boolOutcome = buildEntry({ action: 'test', outcome: true });
  assert(typeof boolOutcome.outcome === 'string', 'boolean outcome coerced to string');
  assert(boolOutcome.outcome === 'true', 'boolean true becomes "true"');
}

// --- validateEntry retention edge cases ---

console.log('\nvalidateEntry retention edge cases');

{
  // Whitespace-only action
  assert(validateEntry({ action: '   ' }) === null, 'whitespace-only action passes validation');

  // Numeric action (not a string)
  assert(validateEntry({ action: 42 }) !== null, 'numeric action fails validation');

  // Boolean action
  assert(validateEntry({ action: true }) !== null, 'boolean action fails validation');

  // Action at exact 200-char boundary
  assert(validateEntry({ action: 'a'.repeat(200) }) === null, '200-char action passes validation');
  assert(validateEntry({ action: 'a'.repeat(201) }) !== null, '201-char action fails validation');

  // Details as array — typeof [] === 'object' in JS, so this passes validation
  assert(validateEntry({ action: 'test', details: [1, 2] }) === null, 'details as array passes validation (typeof [] is object)');

  // Details as string
  assert(validateEntry({ action: 'test', details: 'not-obj' }) !== null, 'details as string fails validation');

  // Details as number
  assert(validateEntry({ action: 'test', details: 42 }) !== null, 'details as number fails validation');

  // Entry with extra fields (should still pass)
  assert(validateEntry({ action: 'test', extra: 'field', another: 123 }) === null, 'extra fields do not fail validation');
}

// --- sanitizeValue edge cases for retention ---

console.log('\nsanitizeValue edge cases for retention');

{
  // Undefined input
  assert(sanitizeValue(undefined) === undefined, 'undefined passes through');

  // Empty object
  const emptyObj = sanitizeValue({});
  assert(typeof emptyObj === 'object', 'empty object returns object');
  assert(Object.keys(emptyObj).length === 0, 'empty object has no keys');

  // Nested arrays with mixed types
  const mixed = sanitizeValue([null, 42, 'ghp_token123', true, { key: 'Bearer abc' }]);
  assert(mixed[0] === null, 'mixed array null preserved');
  assert(mixed[1] === 42, 'mixed array number preserved');
  assert(mixed[2] === '[redacted-gh-token]', 'mixed array secret redacted');
  assert(mixed[3] === true, 'mixed array boolean preserved');
  assert(mixed[4].key === 'Bearer [redacted]', 'mixed array nested secret redacted');

  // Object with numeric keys
  const numKeys = sanitizeValue({ '0': 'ghp_leak', '1': 'safe' });
  assert(numKeys['0'] === '[redacted-gh-token]', 'numeric key string value sanitized');
  assert(numKeys['1'] === 'safe', 'numeric key safe value preserved');

  // Deeply nested empty objects
  const deep = sanitizeValue({ a: { b: { c: {} } } });
  assert(typeof deep.a.b.c === 'object', 'deeply nested empty object preserved');
}

// --- Malformed JSONL lines in retention reads ---

console.log('\nMalformed JSONL lines in retention reads');

{
  const tmp = tmpDir();
  const p = path.join(tmp, 'malformed-retention.jsonl');

  // Mix of valid entries, malformed lines, and blank lines
  const validOld = JSON.stringify({ auditVersion: AUDIT_VERSION, capturedAt: isoDaysAgo(60), action: 'old.valid' });
  const validRecent = JSON.stringify({ auditVersion: AUDIT_VERSION, capturedAt: isoDaysAgo(5), action: 'recent.valid' });
  fs.writeFileSync(p, validOld + '\nnot valid json\n\n{"partial":\n' + validRecent + '\n  \n', 'utf8');

  const entries = readEntries(p);
  assert(entries.length === 2, 'malformed JSONL lines are skipped, 2 valid entries read');
  assert(entries[0].action === 'old.valid', 'first valid entry preserved');
  assert(entries[1].action === 'recent.valid', 'second valid entry preserved');

  // countEntries counts all non-blank lines (including malformed)
  const count = countEntries(p);
  assert(count === 4, 'countEntries counts all non-blank lines including malformed');

  // trimEntries operates on all non-blank lines
  const removed = trimEntries(p, 2);
  assert(removed === 2, 'trimEntries removes 2 excess lines (including malformed)');

  cleanup(tmp);
}

// --- Entries missing auditVersion in retention context ---

console.log('\nEntries missing auditVersion in retention context');

{
  const tmp = tmpDir();
  const p = path.join(tmp, 'no-version.jsonl');

  // Entries without auditVersion field — readEntries still returns them
  const noVersion = { capturedAt: isoDaysAgo(5), action: 'no.version', outcome: 'ok' };
  fs.writeFileSync(p, JSON.stringify(noVersion) + '\n', 'utf8');

  const entries = readEntries(p);
  assert(entries.length === 1, 'entry without auditVersion is still readable');
  assert(entries[0].auditVersion === undefined, 'missing auditVersion remains undefined');
  assert(entries[0].action === 'no.version', 'action preserved without auditVersion');

  // filterByAge works on entries without auditVersion
  const filtered = filterByAge(entries, 30);
  assert(filtered.length === 1, 'entry without auditVersion passes age filter');

  // Mix of versioned and unversioned entries
  const withVersion = { auditVersion: AUDIT_VERSION, capturedAt: isoDaysAgo(60), action: 'with.version' };
  fs.writeFileSync(p, JSON.stringify(noVersion) + '\n' + JSON.stringify(withVersion) + '\n', 'utf8');

  const all = readEntries(p);
  assert(all.length === 2, 'reads both versioned and unversioned entries');
  const recentOnly = filterByAge(all, 30);
  assert(recentOnly.length === 1, 'only recent unversioned entry passes filter');
  assert(recentOnly[0].action === 'no.version', 'correct entry retained');

  cleanup(tmp);
}

// --- Retention boundary: exact day boundary precision ---

console.log('\nRetention boundary: exact day boundary precision');

{
  const tmp = tmpDir();
  const p = path.join(tmp, 'boundary-precision.jsonl');

  // Entry captured exactly at the retention boundary (RETENTION_DAYS ago)
  const now = new Date();
  const exactCutoff = new Date(now);
  exactCutoff.setDate(exactCutoff.getDate() - RETENTION_DAYS);

  // Just before cutoff (should be excluded by strict >= check)
  const justBefore = new Date(exactCutoff);
  justBefore.setMilliseconds(justBefore.getMilliseconds() - 1);
  const beforeEntry = { capturedAt: justBefore.toISOString(), action: 'just-before' };

  // Exactly at cutoff (should be included by >= check)
  const atEntry = { capturedAt: exactCutoff.toISOString(), action: 'exactly-at' };

  // Just after cutoff (should be included)
  const justAfter = new Date(exactCutoff);
  justAfter.setMilliseconds(justAfter.getMilliseconds() + 1);
  const afterEntry = { capturedAt: justAfter.toISOString(), action: 'just-after' };

  fs.writeFileSync(p, [beforeEntry, atEntry, afterEntry].map(JSON.stringify).join('\n') + '\n', 'utf8');

  const all = readEntries(p);
  assert(all.length === 3, 'reads all 3 boundary entries');

  const withinRetention = filterByAge(all, RETENTION_DAYS);
  const actions = withinRetention.map((e) => e.action);

  // filterByAge uses >= cutoff, so exactly-at should be included
  assert(actions.includes('exactly-at'), 'entry at exact cutoff is included (>= boundary)');
  assert(actions.includes('just-after'), 'entry after cutoff is included');
  assert(!actions.includes('just-before'), 'entry before cutoff is excluded');

  cleanup(tmp);
}

// --- entryByteSize edge cases ---

console.log('\nentryByteSize edge cases');

{
  // Empty object entry
  const emptySize = entryByteSize({});
  assert(emptySize > 0, 'empty object entry has non-zero byte size');
  assert(emptySize < 100, 'empty object entry is small');

  // Entry with unicode characters
  const unicodeEntry = { action: 'test', details: { msg: '日本語テスト 🎉' } };
  const unicodeSize = entryByteSize(unicodeEntry);
  assert(unicodeSize > 0, 'unicode entry has non-zero byte size');
  // UTF-8 multi-byte chars are larger than ASCII
  const asciiEntry = { action: 'test', details: { msg: 'x'.repeat(20) } };
  assert(unicodeSize !== Buffer.byteLength(JSON.stringify(asciiEntry) + '\n', 'utf8'), 'unicode and ASCII entries differ in byte size');

  // Entry with only auditVersion and capturedAt (minimal retention entry)
  const minimalRetention = { auditVersion: AUDIT_VERSION, capturedAt: new Date().toISOString() };
  const minimalSize = entryByteSize(minimalRetention);
  assert(minimalSize < MAX_ENTRY_BYTES, 'minimal retention entry is under MAX_ENTRY_BYTES');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
