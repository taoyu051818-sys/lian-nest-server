#!/usr/bin/env node

/**
 * check-schema-files.test.js
 *
 * Self-contained tests for the schema files guard.
 * Run: node scripts/guards/check-schema-files.test.js
 *
 * Exit codes:
 *   0 -- All tests passed
 *   1 -- One or more tests failed
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseArgs,
  collectSchemaFiles,
  validateSchemaFile,
  REQUIRED_TOP_LEVEL,
  run,
} = require('./check-schema-files');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'schema-files-test-'));
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

// --- Valid schema fixture ---

function validSchema(overrides) {
  return JSON.stringify({
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'TestSchema',
    description: 'A test schema.',
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A name.' },
    },
    additionalProperties: false,
    ...overrides,
  }, null, 2);
}

// --- Tests ---

console.log('Running schema-files guard tests...\n');

// REQUIRED_TOP_LEVEL
console.log('REQUIRED_TOP_LEVEL');
{
  assert(Array.isArray(REQUIRED_TOP_LEVEL), 'REQUIRED_TOP_LEVEL is an array');
  assert(REQUIRED_TOP_LEVEL.includes('$schema'), 'includes $schema');
  assert(REQUIRED_TOP_LEVEL.includes('title'), 'includes title');
  assert(REQUIRED_TOP_LEVEL.includes('description'), 'includes description');
  assert(REQUIRED_TOP_LEVEL.includes('type'), 'includes type');
  assert(REQUIRED_TOP_LEVEL.includes('properties'), 'includes properties');
  assert(REQUIRED_TOP_LEVEL.length === 5, 'has exactly 5 required keys');
}

// parseArgs: --help
console.log('parseArgs');
{
  const opts = parseArgs(['node', 'script', '--help']);
  assert(opts.help === true, '--help sets help flag');
}
{
  const opts = parseArgs(['node', 'script', '-h']);
  assert(opts.help === true, '-h sets help flag');
}
{
  const opts = parseArgs(['node', 'script']);
  assert(opts.help === false, 'no args => help is false');
  assert(opts.dryRun === false, 'no args => dryRun is false');
  assert(opts.json === false, 'no args => json is false');
  assert(opts.warnOnly === false, 'no args => warnOnly is false');
}
{
  const opts = parseArgs(['node', 'script', '--dry-run', '--json', '--warn-only']);
  assert(opts.dryRun === true, '--dry-run sets dryRun');
  assert(opts.json === true, '--json sets json');
  assert(opts.warnOnly === true, '--warn-only sets warnOnly');
}

// collectSchemaFiles
console.log('collectSchemaFiles');
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'schemas');
    fs.mkdirSync(schemasDir);
    fs.writeFileSync(path.join(schemasDir, 'a.schema.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(schemasDir, 'b.schema.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(schemasDir, 'other.txt'), 'not a schema', 'utf-8');

    const files = collectSchemaFiles(schemasDir);
    assert(files.length === 2, 'collects only .schema.json files');
    assert(files[0].endsWith('a.schema.json'), 'first file is a.schema.json');
    assert(files[1].endsWith('b.schema.json'), 'second file is b.schema.json');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'nonexistent');
    const files = collectSchemaFiles(schemasDir);
    assertDeepEqual(files, [], 'returns empty array for nonexistent directory');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'empty');
    fs.mkdirSync(schemasDir);
    const files = collectSchemaFiles(schemasDir);
    assertDeepEqual(files, [], 'returns empty array for empty directory');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: valid schema passes
console.log('validateSchemaFile');
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/test.schema.json', validSchema());
    const violations = validateSchemaFile(file);
    assertDeepEqual(violations, [], 'valid schema has no violations');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: invalid JSON
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/bad.schema.json', '{not json}');
    const violations = validateSchemaFile(file);
    assert(violations.length === 1, 'invalid JSON produces one violation');
    assert(violations[0].rule === 'json-parse', 'rule is json-parse');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: non-object root
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/array.schema.json', '["not", "object"]');
    const violations = validateSchemaFile(file);
    assert(violations.length === 1, 'array root produces one violation');
    assert(violations[0].rule === 'root-type', 'rule is root-type');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: missing each required key
{
  const tmp = makeTmpDir();
  try {
    for (const key of REQUIRED_TOP_LEVEL) {
      const schema = JSON.parse(validSchema());
      delete schema[key];
      const file = writeFile(tmp, `schemas/no-${key}.schema.json`, JSON.stringify(schema));
      const violations = validateSchemaFile(file);
      assert(violations.some((v) => v.rule === 'missing-key' && v.message.includes(key)),
        `missing "${key}" is flagged`);
    }
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: missing multiple keys
{
  const tmp = makeTmpDir();
  try {
    const schema = { type: 'object', properties: {} };
    const file = writeFile(tmp, 'schemas/sparse.schema.json', JSON.stringify(schema));
    const violations = validateSchemaFile(file);
    assert(violations.length === 3, 'three missing keys flagged ($schema, title, description)');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: $schema not referencing json-schema.org
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/bad-ref.schema.json', validSchema({
      $schema: 'https://example.com/my-schema#',
    }));
    const violations = validateSchemaFile(file);
    assert(violations.length === 1, 'bad $schema ref produces one violation');
    assert(violations[0].rule === 'invalid-schema-ref', 'rule is invalid-schema-ref');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: root type not "object"
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/array-type.schema.json', validSchema({ type: 'array' }));
    const violations = validateSchemaFile(file);
    assert(violations.length === 1, 'non-object root type produces one violation');
    assert(violations[0].rule === 'root-type-value', 'rule is root-type-value');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: multiple violations accumulate
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/many-issues.schema.json', JSON.stringify({
      $schema: 'https://example.com/schema#',
      type: 'array',
    }));
    const violations = validateSchemaFile(file);
    assert(violations.length >= 3, 'multiple violations accumulate');
    const rules = violations.map((v) => v.rule);
    assert(rules.includes('missing-key'), 'includes missing-key');
    assert(rules.includes('invalid-schema-ref'), 'includes invalid-schema-ref');
    assert(rules.includes('root-type-value'), 'includes root-type-value');
  } finally {
    cleanup(tmp);
  }
}

// validateSchemaFile: file path is relative to ROOT
{
  const tmp = makeTmpDir();
  try {
    const file = writeFile(tmp, 'schemas/test.schema.json', '{bad json}');
    const violations = validateSchemaFile(file);
    assert(typeof violations[0].file === 'string', 'file path is a string');
    assert(violations[0].file.includes('schemas/'), 'file path includes schemas/');
  } finally {
    cleanup(tmp);
  }
}

// run: dry-run mode
console.log('run');
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'schemas');
    fs.mkdirSync(schemasDir);
    fs.writeFileSync(path.join(schemasDir, 'a.schema.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(schemasDir, 'b.schema.json'), '{}', 'utf-8');

    const summary = run({ schemasDir, dryRun: true, json: false, warnOnly: false });
    assert(summary.fileCount === 2, 'dry-run reports file count');
    assert(summary.errors.length === 0, 'dry-run has no errors');
    assert(summary.warnings.length === 0, 'dry-run has no warnings');
  } finally {
    cleanup(tmp);
  }
}

// run: all valid schemas pass
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'schemas');
    fs.mkdirSync(schemasDir);
    fs.writeFileSync(path.join(schemasDir, 'good.schema.json'), validSchema());

    const summary = run({ schemasDir, dryRun: false, json: false, warnOnly: false });
    assert(summary.fileCount === 1, 'reports one file scanned');
    assert(summary.errorCount === 0, 'no errors for valid schema');
    assert(summary.warningCount === 0, 'no warnings for valid schema');
  } finally {
    cleanup(tmp);
  }
}

// run: invalid schema fails in enforce mode
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'schemas');
    fs.mkdirSync(schemasDir);
    fs.writeFileSync(path.join(schemasDir, 'bad.schema.json'), '{bad json}');

    const summary = run({ schemasDir, dryRun: false, json: false, warnOnly: false });
    assert(summary.errorCount === 1, 'one error for invalid schema in enforce mode');
    assert(summary.warningCount === 0, 'no warnings in enforce mode');
  } finally {
    cleanup(tmp);
  }
}

// run: invalid schema warns in warn-only mode
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'schemas');
    fs.mkdirSync(schemasDir);
    fs.writeFileSync(path.join(schemasDir, 'bad.schema.json'), '{bad json}');

    const summary = run({ schemasDir, dryRun: false, json: false, warnOnly: true });
    assert(summary.warningCount === 1, 'one warning for invalid schema in warn-only mode');
    assert(summary.errorCount === 0, 'no errors in warn-only mode');
  } finally {
    cleanup(tmp);
  }
}

// run: no schemas directory
{
  const tmp = makeTmpDir();
  try {
    const schemasDir = path.join(tmp, 'nonexistent');
    const summary = run({ schemasDir, dryRun: false, json: false, warnOnly: false });
    assert(summary.fileCount === 0, 'fileCount is 0 for missing directory');
    assert(summary.errors.length === 0, 'no errors for missing directory');
  } finally {
    cleanup(tmp);
  }
}

// run: real schemas directory passes
{
  const realSummary = run({ dryRun: false, json: false, warnOnly: false });
  assert(realSummary.errorCount === 0, 'real schemas pass without errors');
  assert(realSummary.fileCount === 6, 'real schemas directory has 6 files');
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
