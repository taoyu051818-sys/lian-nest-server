#!/usr/bin/env node

/**
 * check-ai-state-files.test.js
 *
 * Self-contained tests for the AI state files guard.
 * Run: node scripts/guards/check-ai-state-files.test.js
 *
 * Exit codes:
 *   0 -- All tests passed
 *   1 -- One or more tests failed
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  AI_STATE_DIR,
  EXPECTED_FILES,
  checkExistence,
  checkParsable,
  checkSchema,
  checkStaleness,
  run,
} = require('./check-ai-state-files');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    const detail = `${message}\n    expected: ${e}\n    actual:   ${a}`;
    failures.push(detail);
    console.error(`  FAIL: ${detail}`);
  }
}

// --- Temp fixture helpers ---

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-state-guard-test-'));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Tests ---

console.log('Running ai-state-files guard tests...\n');

// checkExistence
console.log('checkExistence');
{
  const tmp = makeTmpDir();
  try {
    const spec = { name: 'test.json' };
    const err = checkExistence(spec, tmp);
    assert(err !== null, 'returns error for missing file');
    assert(err.type === 'missing', 'error type is missing');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'test.json', '{}');
    const spec = { name: 'test.json' };
    const err = checkExistence(spec, tmp);
    assert(err === null, 'returns null for existing file');
  } finally {
    cleanup(tmp);
  }
}

// checkParsable
console.log('checkParsable');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'bad.json', '{not json}');
    const spec = { name: 'bad.json' };
    const err = checkParsable(spec, tmp);
    assert(err !== null, 'returns error for invalid JSON');
    assert(err.type === 'invalid-json', 'error type is invalid-json');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'good.json', '{"ok":true}');
    const spec = { name: 'good.json' };
    const err = checkParsable(spec, tmp);
    assert(err === null, 'returns null for valid JSON');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    const spec = { name: 'missing.json' };
    const err = checkParsable(spec, tmp);
    assert(err === null, 'returns null for missing file (existence check is separate)');
  } finally {
    cleanup(tmp);
  }
}

// checkSchema
console.log('checkSchema');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'test.json', JSON.stringify({ other: 'field' }));
    const spec = { name: 'test.json', versionField: 'markerVersion', requiredKeys: ['markerVersion', 'data'] };
    const err = checkSchema(spec, tmp);
    assert(err !== null, 'returns error for missing version field');
    assert(err.type === 'missing-version', 'error type is missing-version');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'test.json', JSON.stringify({ markerVersion: 1 }));
    const spec = { name: 'test.json', versionField: 'markerVersion', requiredKeys: ['markerVersion', 'data'] };
    const err = checkSchema(spec, tmp);
    assert(err !== null, 'returns error for missing required keys');
    assert(err.type === 'missing-keys', 'error type is missing-keys');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'test.json', JSON.stringify({ markerVersion: 1, data: [] }));
    const spec = { name: 'test.json', versionField: 'markerVersion', requiredKeys: ['markerVersion', 'data'] };
    const err = checkSchema(spec, tmp);
    assert(err === null, 'returns null for valid schema');
  } finally {
    cleanup(tmp);
  }
}

// checkStaleness
console.log('checkStaleness');
{
  const tmp = makeTmpDir();
  try {
    const now = new Date().toISOString();
    writeFile(tmp, 'fresh.json', JSON.stringify({ capturedAt: now }));
    const spec = { name: 'fresh.json' };
    const err = checkStaleness(spec, 48, tmp);
    assert(err === null, 'returns null for fresh timestamp');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    writeFile(tmp, 'stale.json', JSON.stringify({ capturedAt: old }));
    const spec = { name: 'stale.json' };
    const err = checkStaleness(spec, 48, tmp);
    assert(err !== null, 'returns warning for stale timestamp');
    assert(err.type === 'stale', 'warning type is stale');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    writeFile(tmp, 'stale.json', JSON.stringify({ capturedAt: old }));
    const spec = { name: 'stale.json' };
    const err = checkStaleness(spec, 96, tmp);
    assert(err === null, 'returns null when within threshold');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    const recent = new Date().toISOString();
    writeFile(tmp, 'calc.json', JSON.stringify({ calculatedAt: recent }));
    const spec = { name: 'calc.json' };
    const err = checkStaleness(spec, 48, tmp);
    assert(err === null, 'uses calculatedAt as fallback timestamp');
  } finally {
    cleanup(tmp);
  }
}

// run() against real .github/ai-state
console.log('run (real directory)');
{
  const result = run({ staleThresholdHours: 99999 });
  assert(result.fileCount === EXPECTED_FILES.length, `checks all ${EXPECTED_FILES.length} expected files`);
  // The real directory may not have all seed files (e.g. main-health.json is runtime-generated).
  // Verify that no existing file has parse or schema errors.
  const nonMissingErrors = result.errors.filter((e) => e.type !== 'missing');
  assert(nonMissingErrors.length === 0, 'no parse/schema errors on existing state files');
}

// run() against temp dir with all valid files
console.log('run (temp directory, all valid)');
{
  const tmp = makeTmpDir();
  try {
    const now = new Date().toISOString();
    writeFile(tmp, 'launch-locks.json', JSON.stringify({ markerVersion: 1, capturedAt: now, locks: [] }));
    writeFile(tmp, 'main-health.json', JSON.stringify({ markerVersion: 1, state: 'green', capturedAt: now }));
    writeFile(tmp, 'provider-pool.json', JSON.stringify({ stateVersion: 1, providers: [], global: {} }));
    writeFile(tmp, 'worker-trust.json', JSON.stringify({ markerVersion: 1, capturedAt: now, workerClasses: {} }));
    writeFile(tmp, 'active-workers.json', JSON.stringify({ markerVersion: 1, capturedAt: now, workers: [] }));
    writeFile(tmp, 'meta-signals.json', JSON.stringify({ snapshotVersion: 1, signals: {} }));

    const result = run({ dir: tmp, staleThresholdHours: 48 });
    assert(result.errors.length === 0, 'no errors with all valid files');
    assert(result.warnings.length === 0, 'no warnings with fresh timestamps');
  } finally {
    cleanup(tmp);
  }
}

// run() against temp dir with missing files
console.log('run (temp directory, missing files)');
{
  const tmp = makeTmpDir();
  try {
    // Only write some files
    writeFile(tmp, 'launch-locks.json', JSON.stringify({ markerVersion: 1, capturedAt: new Date().toISOString(), locks: [] }));

    const result = run({ dir: tmp });
    assert(result.errors.length > 0, 'reports errors for missing files');
    const missingFiles = result.errors.filter((e) => e.type === 'missing').map((e) => e.file);
    assert(missingFiles.includes('main-health.json'), 'flags main-health.json as missing');
    assert(missingFiles.includes('provider-pool.json'), 'flags provider-pool.json as missing');
  } finally {
    cleanup(tmp);
  }
}

// run() against temp dir with invalid JSON
console.log('run (temp directory, invalid JSON)');
{
  const tmp = makeTmpDir();
  try {
    const now = new Date().toISOString();
    writeFile(tmp, 'launch-locks.json', '{bad json}');
    writeFile(tmp, 'main-health.json', JSON.stringify({ markerVersion: 1, state: 'green', capturedAt: now }));
    writeFile(tmp, 'provider-pool.json', JSON.stringify({ stateVersion: 1, providers: [], global: {} }));
    writeFile(tmp, 'worker-trust.json', JSON.stringify({ markerVersion: 1, capturedAt: now, workerClasses: {} }));
    writeFile(tmp, 'active-workers.json', JSON.stringify({ markerVersion: 1, capturedAt: now, workers: [] }));
    writeFile(tmp, 'meta-signals.json', JSON.stringify({ snapshotVersion: 1, signals: {} }));

    const result = run({ dir: tmp });
    assert(result.errors.length === 1, 'reports one error for invalid JSON');
    assert(result.errors[0].type === 'invalid-json', 'error type is invalid-json');
    assert(result.errors[0].file === 'launch-locks.json', 'error is for launch-locks.json');
  } finally {
    cleanup(tmp);
  }
}

// run() against temp dir with stale timestamps
console.log('run (temp directory, stale timestamps)');
{
  const tmp = makeTmpDir();
  try {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
    writeFile(tmp, 'launch-locks.json', JSON.stringify({ markerVersion: 1, capturedAt: stale, locks: [] }));
    writeFile(tmp, 'main-health.json', JSON.stringify({ markerVersion: 1, state: 'green', capturedAt: now }));
    writeFile(tmp, 'provider-pool.json', JSON.stringify({ stateVersion: 1, providers: [], global: {}, capturedAt: stale }));
    writeFile(tmp, 'worker-trust.json', JSON.stringify({ markerVersion: 1, capturedAt: now, workerClasses: {} }));
    writeFile(tmp, 'active-workers.json', JSON.stringify({ markerVersion: 1, capturedAt: now, workers: [] }));
    writeFile(tmp, 'meta-signals.json', JSON.stringify({ snapshotVersion: 1, signals: {} }));

    const result = run({ dir: tmp, staleThresholdHours: 48 });
    assert(result.errors.length === 0, 'no errors for stale timestamps');
    assert(result.warnings.length >= 1, 'has warnings for stale timestamps');
    const staleWarnings = result.warnings.filter((w) => w.type === 'stale');
    assert(staleWarnings.length >= 1, 'at least one stale warning');
  } finally {
    cleanup(tmp);
  }
}

// EXPECTED_FILES structure
console.log('EXPECTED_FILES structure');
{
  assert(EXPECTED_FILES.length === 6, 'defines 6 expected files');
  for (const spec of EXPECTED_FILES) {
    assert(typeof spec.name === 'string', `${spec.name} has name`);
    assert(typeof spec.versionField === 'string', `${spec.name} has versionField`);
    assert(Array.isArray(spec.requiredKeys), `${spec.name} has requiredKeys array`);
    assert(spec.requiredKeys.length > 0, `${spec.name} has at least one requiredKey`);
  }
}

// --- Results ---

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
} else {
  console.log('All tests passed.');
  process.exit(0);
}
