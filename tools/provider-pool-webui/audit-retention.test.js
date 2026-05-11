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

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
