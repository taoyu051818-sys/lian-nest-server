#!/usr/bin/env node

/**
 * audit-store.test.js
 *
 * Tests for the WebUI action audit store.
 * Validates sanitization, append-only behavior, dry-run mode,
 * and secret redaction.
 *
 * Run: node tools/provider-pool-webui/audit-store.test.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createAuditStore,
  sanitizeString,
  sanitizeValue,
  sanitizeObject,
  looksLikeRawProcessOutput,
  validateEntry,
  buildEntry,
  readEntries,
  countEntries,
  AUDIT_VERSION,
  MAX_STRING_LENGTH,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ── Test suites ──────────────────────────────────────────────────────────────

console.log('\naudit-store.js tests\n');

// --- sanitizeString ---

console.log('sanitizeString');

{
  assert(sanitizeString('hello world') === 'hello world', 'plain text preserved');
  assert(sanitizeString('ghp_abc123xyz') === '[redacted-gh-token]', 'GitHub PAT redacted');
  assert(sanitizeString('gho_abc123xyz') === '[redacted-gh-oauth]', 'GitHub OAuth token redacted');
  assert(sanitizeString('ghu_abc123xyz') === '[redacted-gh-app]', 'GitHub user token redacted');
  assert(sanitizeString('ghs_abc123xyz') === '[redacted-gh-app]', 'GitHub app token redacted');
  assert(sanitizeString('Bearer mytoken123') === 'Bearer [redacted]', 'Bearer token redacted');
  assert(sanitizeString('Basic dXNlcjpwYXNz') === 'Basic [redacted]', 'Basic auth redacted');
  assert(sanitizeString('password=secret123') === 'password=[redacted]', 'password= redacted');
  assert(sanitizeString('api_key: sk-12345') === 'api_key:[redacted]', 'api_key: redacted');
  assert(sanitizeString('AKIAIOSFODNN7EXAMPLE') === '[redacted-aws-key]', 'AWS key redacted');
  assert(sanitizeString('a'.repeat(50)) === '[redacted-token]', 'long base64-like string redacted');

  const longStr = 'x'.repeat(600);
  assert(sanitizeString(longStr).length <= MAX_STRING_LENGTH, 'truncates to MAX_STRING_LENGTH');
  assert(sanitizeString(42) === 42, 'non-string returns as-is');
  assert(sanitizeString(null) === null, 'null returns as-is');
}

// --- sanitizeValue ---

console.log('\nsanitizeValue');

{
  assert(sanitizeValue('ghp_leaked') === '[redacted-gh-token]', 'sanitizes strings');
  assert(sanitizeValue(42) === 42, 'preserves numbers');
  assert(sanitizeValue(true) === true, 'preserves booleans');
  assert(sanitizeValue(null) === null, 'preserves null');

  const arr = sanitizeValue(['ghp_token', 'safe', 123]);
  assert(arr[0] === '[redacted-gh-token]', 'sanitizes array string elements');
  assert(arr[1] === 'safe', 'preserves safe array elements');
  assert(arr[2] === 123, 'preserves array numbers');

  const nested = sanitizeValue({ a: { b: 'ghp_leaked' } });
  assert(nested.a.b === '[redacted-gh-token]', 'sanitizes nested objects');
}

// --- sanitizeObject ---

console.log('\nsanitizeObject');

{
  const obj = { key: 'ghp_token', count: 5, nested: { secret: 'Bearer abc' } };
  const clean = sanitizeObject(obj);
  assert(clean.key === '[redacted-gh-token]', 'sanitizes top-level strings');
  assert(clean.count === 5, 'preserves numbers');
  assert(clean.nested.secret === 'Bearer [redacted]', 'sanitizes nested strings');
  assert(sanitizeObject(null) === null, 'handles null');
}

// --- looksLikeRawProcessOutput ---

console.log('\nlooksLikeRawProcessOutput');

{
  assert(looksLikeRawProcessOutput('hello world') === false, 'plain text is not raw output');
  assert(looksLikeRawProcessOutput('\x1b[31mred\x1b[0m') === true, 'ANSI codes detected');
  assert(looksLikeRawProcessOutput('STDERR: some error') === true, 'STDERR prefix detected');
  assert(looksLikeRawProcessOutput('stdout: output here') === true, 'stdout prefix detected');
  assert(looksLikeRawProcessOutput('x'.repeat(2001)) === true, 'very long single line detected');
  assert(looksLikeRawProcessOutput('x'.repeat(100)) === false, 'moderate length accepted');
  assert(looksLikeRawProcessOutput(42) === false, 'non-string returns false');
}

// --- validateEntry ---

console.log('\nvalidateEntry');

{
  assert(validateEntry(null) !== null, 'null entry is invalid');
  assert(validateEntry({}) !== null, 'missing action is invalid');
  assert(validateEntry({ action: '' }) !== null, 'empty action is invalid');
  assert(validateEntry({ action: 'test' }) === null, 'valid entry passes');
  assert(validateEntry({ action: 'a'.repeat(201) }) !== null, 'action too long is invalid');
  assert(validateEntry({ action: 'test', details: 'not-obj' }) !== null, 'details must be object');
  assert(validateEntry({ action: 'test', details: { ok: true } }) === null, 'valid details passes');
}

// --- buildEntry ---

console.log('\nbuildEntry');

{
  const entry = buildEntry({ action: 'test.action', actor: 'user1', target: 'resource1', details: { key: 'val' }, outcome: 'success' });
  assert(entry.auditVersion === AUDIT_VERSION, 'has correct version');
  assert(typeof entry.capturedAt === 'string', 'has capturedAt timestamp');
  assert(entry.action === 'test.action', 'preserves action');
  assert(entry.actor === 'user1', 'preserves actor');
  assert(entry.target === 'resource1', 'preserves target');
  assert(entry.details.key === 'val', 'preserves details');
  assert(entry.outcome === 'success', 'preserves outcome');

  // Sanitization in buildEntry
  const dirty = buildEntry({ action: 'test', actor: 'ghp_leaked', details: { msg: 'ghp_also' }, outcome: 'Bearer xyz' });
  assert(dirty.actor === '[redacted-gh-token]', 'sanitizes actor');
  assert(dirty.details.msg === '[redacted-gh-token]', 'sanitizes details');
  assert(dirty.outcome === 'Bearer [redacted]', 'sanitizes outcome');

  // Raw output rejection
  const rawOutput = buildEntry({ action: 'test', details: { log: '\x1b[31mERROR\x1b[0m' } });
  assert(rawOutput.details._warning !== undefined, 'rejects raw process output in details');

  // Minimal entry
  const minimal = buildEntry({ action: 'minimal' });
  assert(minimal.action === 'minimal', 'minimal entry has action');
  assert(minimal.actor === undefined, 'minimal entry omits undefined fields');
}

// --- createAuditStore (dry-run mode) ---

console.log('\ncreateAuditStore (dry-run)');

{
  const tmp = tmpDir();
  const store = createAuditStore({ filePath: path.join(tmp, 'audit.jsonl') });

  assert(store.isDryRun() === true, 'defaults to dry-run');
  assert(store.getPath().endsWith('audit.jsonl'), 'has correct path');

  const result = store.record({ action: 'test.action', actor: 'user1' });
  assert(result.ok === true, 'dry-run record succeeds');
  assert(result.dryRun === true, 'result indicates dry-run');
  assert(result.entry.action === 'test.action', 'result includes entry');

  // File should NOT exist in dry-run mode
  assert(!fs.existsSync(store.getPath()), 'no file created in dry-run');

  // Invalid entry in dry-run
  const invalid = store.record({ action: '' });
  assert(invalid.ok === false, 'invalid entry fails in dry-run');
  assert(invalid.error !== undefined, 'error message provided');

  cleanup(tmp);
}

// --- createAuditStore (live mode) ---

console.log('\ncreateAuditStore (live)');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit.jsonl');
  const store = createAuditStore({ filePath: auditPath, dryRun: false });

  assert(store.isDryRun() === false, 'live mode enabled');

  // Record first entry
  const r1 = store.record({ action: 'provider.enable', actor: 'admin', target: 'openai', outcome: 'success' });
  assert(r1.ok === true, 'first record succeeds');
  assert(r1.dryRun === false, 'result indicates live');

  // Record second entry
  const r2 = store.record({ action: 'provider.disable', actor: 'admin', target: 'anthropic', details: { reason: 'quota exceeded' } });
  assert(r2.ok === true, 'second record succeeds');

  // Read entries
  const entries = store.read();
  assert(entries.length === 2, 'reads back 2 entries');
  assert(entries[0].action === 'provider.enable', 'first entry correct');
  assert(entries[1].action === 'provider.disable', 'second entry correct');

  // Count
  assert(store.count() === 2, 'count returns 2');

  // Verify append-only (file content)
  const content = fs.readFileSync(auditPath, 'utf8');
  const lines = content.trim().split('\n');
  assert(lines.length === 2, 'file has 2 lines');
  assert(JSON.parse(lines[0]).action === 'provider.enable', 'first line is first entry');
  assert(JSON.parse(lines[1]).action === 'provider.disable', 'second line is second entry');

  cleanup(tmp);
}

// --- readEntries edge cases ---

console.log('\nreadEntries edge cases');

{
  const tmp = tmpDir();

  // Non-existent file
  assert(readEntries(path.join(tmp, 'missing.jsonl')).length === 0, 'missing file returns empty array');

  // Empty file
  const emptyPath = path.join(tmp, 'empty.jsonl');
  fs.writeFileSync(emptyPath, '', 'utf8');
  assert(readEntries(emptyPath).length === 0, 'empty file returns empty array');

  // File with malformed lines
  const badPath = path.join(tmp, 'bad.jsonl');
  fs.writeFileSync(badPath, '{"ok":true}\nnot json\n{"ok":false}\n', 'utf8');
  const badEntries = readEntries(badPath);
  assert(badEntries.length === 2, 'skips malformed lines');
  assert(badEntries[0].ok === true, 'first valid entry preserved');
  assert(badEntries[1].ok === false, 'second valid entry preserved');

  // countEntries with malformed lines
  assert(countEntries(badPath) === 3, 'count includes malformed lines');

  cleanup(tmp);
}

// --- Secret redaction end-to-end ---

console.log('\nSecret redaction end-to-end');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit.jsonl');
  const store = createAuditStore({ filePath: auditPath, dryRun: false });

  store.record({
    action: 'provider.rotate',
    actor: 'admin',
    details: {
      oldKey: 'ghp_oldtokenabc123xyzoldtoken',
      newKey: 'ghp_newtokendef456uvwnewtoken',
      config: 'password=hunter2',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123',
    },
  });

  const entries = store.read();
  const details = entries[0].details;

  assert(details.oldKey === '[redacted-gh-token]', 'old key redacted');
  assert(details.newKey === '[redacted-gh-token]', 'new key redacted');
  assert(details.config === 'password=[redacted]', 'password redacted');
  assert(details.jwt === '[redacted-jwt]', 'JWT redacted');

  // Verify file content has no secrets
  const content = fs.readFileSync(auditPath, 'utf8');
  assert(!content.includes('ghp_oldtokenabc'), 'file has no old token');
  assert(!content.includes('ghp_newtokendef'), 'file has no new token');
  assert(!content.includes('hunter2'), 'file has no password');
  assert(!content.includes('eyJhbGciOiJIUzI1NiJ9'), 'file has no JWT');

  cleanup(tmp);
}

// --- Append-only invariant ---

console.log('\nAppend-only invariant');

{
  const tmp = tmpDir();
  const auditPath = path.join(tmp, 'audit.jsonl');
  const store = createAuditStore({ filePath: auditPath, dryRun: false });

  // Write entries
  store.record({ action: 'first' });
  store.record({ action: 'second' });
  store.record({ action: 'third' });

  // Read content before
  const before = fs.readFileSync(auditPath, 'utf8');

  // Read (should not modify)
  store.read();
  store.count();

  // Read content after
  const after = fs.readFileSync(auditPath, 'utf8');
  assert(before === after, 'read operations do not modify file');

  // Verify line count matches
  const lines = after.trim().split('\n');
  assert(lines.length === 3, 'file has exactly 3 lines');

  cleanup(tmp);
}

// --- CLI self-test ---

console.log('\nCLI self-test');

{
  // Verify the module can be required without errors
  const mod = require('./lib/audit-store');
  assert(typeof mod.createAuditStore === 'function', 'exports createAuditStore');
  assert(typeof mod.sanitizeString === 'function', 'exports sanitizeString');
  assert(typeof mod.sanitizeValue === 'function', 'exports sanitizeValue');
  assert(typeof mod.sanitizeObject === 'function', 'exports sanitizeObject');
  assert(typeof mod.validateEntry === 'function', 'exports validateEntry');
  assert(typeof mod.buildEntry === 'function', 'exports buildEntry');
  assert(typeof mod.readEntries === 'function', 'exports readEntries');
  assert(typeof mod.countEntries === 'function', 'exports countEntries');
  assert(mod.AUDIT_VERSION === 1, 'exports AUDIT_VERSION');
  assert(typeof mod.MAX_STRING_LENGTH === 'number', 'exports MAX_STRING_LENGTH');
  assert(Array.isArray(mod.SECRET_PATTERNS), 'exports SECRET_PATTERNS');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
