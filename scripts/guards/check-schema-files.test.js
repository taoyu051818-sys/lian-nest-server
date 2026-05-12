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

const ROOT = path.join(__dirname, '..', '..');

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
  assert(realSummary.fileCount === 35, 'real schemas directory has 35 files');
}

// --- External intake schemas ---

console.log('external intake schemas');

const EXTERNAL_INTAKE_SCHEMAS = [
  'external-fact.schema.json',
  'opportunity-signal.schema.json',
  'risk-signal.schema.json',
  'bounded-experiment.schema.json',
  'evidence-reliability.schema.json',
];

const EXTERNAL_INTAKE_TITLES = {
  'external-fact.schema.json': 'ExternalFact',
  'opportunity-signal.schema.json': 'Opportunity Signal',
  'risk-signal.schema.json': 'RiskSignalSnapshot',
  'bounded-experiment.schema.json': 'Bounded Experiment',
  'evidence-reliability.schema.json': 'EvidenceReliability',
};

const EXTERNAL_INTAKE_REQUIRED_FIELDS = {
  'external-fact.schema.json': ['entryVersion', 'factType', 'subject', 'claim', 'capturedAt', 'sourceReliability'],
  'opportunity-signal.schema.json': ['schemaVersion', 'signalId', 'createdAt', 'status', 'sourceFacts', 'hypothesis', 'expectedImpact', 'experiment', 'risk', 'acceptanceGate'],
  'risk-signal.schema.json': ['signalVersion', 'capturedAt', 'signals'],
  'bounded-experiment.schema.json': ['allowedFiles', 'validation', 'successMetric', 'rollback', 'budget', 'risk'],
  'evidence-reliability.schema.json': ['schemaVersion', 'sourceType', 'score', 'confidence', 'verificationStatus', 'capturedAt'],
};

// Each external intake schema passes validateSchemaFile with no violations
for (const name of EXTERNAL_INTAKE_SCHEMAS) {
  const filePath = path.join(ROOT, 'schemas', name);
  const violations = validateSchemaFile(filePath);
  assertDeepEqual(violations, [], `${name} has no violations`);
}

// Each external intake schema has the expected title
for (const name of EXTERNAL_INTAKE_SCHEMAS) {
  const filePath = path.join(ROOT, 'schemas', name);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(content.title === EXTERNAL_INTAKE_TITLES[name],
    `${name} has title "${EXTERNAL_INTAKE_TITLES[name]}"`);
}

// Each external intake schema has type "object"
for (const name of EXTERNAL_INTAKE_SCHEMAS) {
  const filePath = path.join(ROOT, 'schemas', name);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(content.type === 'object', `${name} has type "object"`);
}

// Each external intake schema references json-schema.org
for (const name of EXTERNAL_INTAKE_SCHEMAS) {
  const filePath = path.join(ROOT, 'schemas', name);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(content.$schema.includes('json-schema.org'),
    `${name} $schema references json-schema.org`);
}

// Each external intake schema has properties defined
for (const name of EXTERNAL_INTAKE_SCHEMAS) {
  const filePath = path.join(ROOT, 'schemas', name);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(typeof content.properties === 'object' && content.properties !== null,
    `${name} has properties object`);
}

// Each external intake schema declares required fields
for (const name of EXTERNAL_INTAKE_SCHEMAS) {
  const filePath = path.join(ROOT, 'schemas', name);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(Array.isArray(content.required), `${name} has required array`);
  for (const field of EXTERNAL_INTAKE_REQUIRED_FIELDS[name]) {
    assert(content.required.includes(field),
      `${name} required includes "${field}"`);
  }
}

// external-fact has additionalProperties: false
{
  const filePath = path.join(ROOT, 'schemas', 'external-fact.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(content.additionalProperties === false,
    'external-fact.schema.json has additionalProperties: false');
}

// risk-signal defines RiskSignal with domain enum
{
  const filePath = path.join(ROOT, 'schemas', 'risk-signal.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const riskSignal = content.definitions && content.definitions.RiskSignal;
  assert(typeof riskSignal === 'object', 'risk-signal defines RiskSignal definition');
  const domainEnum = riskSignal.properties.domain && riskSignal.properties.domain.enum;
  assert(Array.isArray(domainEnum), 'risk-signal RiskSignal.domain has enum');
  assert(domainEnum.includes('security'), 'risk-signal domain includes "security"');
  assert(domainEnum.includes('compliance'), 'risk-signal domain includes "compliance"');
  assert(domainEnum.includes('product'), 'risk-signal domain includes "product"');
  assert(domainEnum.includes('runtime'), 'risk-signal domain includes "runtime"');
  assert(domainEnum.includes('market'), 'risk-signal domain includes "market"');
}

// risk-signal defines RiskSignal with severity enum
{
  const filePath = path.join(ROOT, 'schemas', 'risk-signal.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const riskSignal = content.definitions.RiskSignal;
  const severityEnum = riskSignal.properties.severity && riskSignal.properties.severity.enum;
  assert(Array.isArray(severityEnum), 'risk-signal RiskSignal.severity has enum');
  assert(severityEnum.includes('critical'), 'risk-signal severity includes "critical"');
  assert(severityEnum.includes('high'), 'risk-signal severity includes "high"');
  assert(severityEnum.includes('medium'), 'risk-signal severity includes "medium"');
  assert(severityEnum.includes('low'), 'risk-signal severity includes "low"');
  assert(severityEnum.includes('info'), 'risk-signal severity includes "info"');
}

// risk-signal defines RiskSignal with status enum
{
  const filePath = path.join(ROOT, 'schemas', 'risk-signal.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const riskSignal = content.definitions.RiskSignal;
  const statusEnum = riskSignal.properties.status && riskSignal.properties.status.enum;
  assert(Array.isArray(statusEnum), 'risk-signal RiskSignal.status has enum');
  assert(statusEnum.includes('open'), 'risk-signal status includes "open"');
  assert(statusEnum.includes('acknowledged'), 'risk-signal status includes "acknowledged"');
  assert(statusEnum.includes('mitigated'), 'risk-signal status includes "mitigated"');
  assert(statusEnum.includes('accepted'), 'risk-signal status includes "accepted"');
  assert(statusEnum.includes('expired'), 'risk-signal status includes "expired"');
}

// risk-signal signals property references RiskSignal definition
{
  const filePath = path.join(ROOT, 'schemas', 'risk-signal.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(content.properties.signals.type === 'array',
    'risk-signal signals is array type');
  assert(content.properties.signals.items.$ref === '#/definitions/RiskSignal',
    'risk-signal signals items reference RiskSignal definition');
}

// opportunity-signal has status enum
{
  const filePath = path.join(ROOT, 'schemas', 'opportunity-signal.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const statusEnum = content.properties.status && content.properties.status.enum;
  assert(Array.isArray(statusEnum), 'opportunity-signal.schema.json status has enum');
  assert(statusEnum.includes('draft'), 'opportunity-signal status includes "draft"');
  assert(statusEnum.includes('validated'), 'opportunity-signal status includes "validated"');
  assert(statusEnum.includes('accepted'), 'opportunity-signal status includes "accepted"');
  assert(statusEnum.includes('scheduled'), 'opportunity-signal status includes "scheduled"');
  assert(statusEnum.includes('rejected'), 'opportunity-signal status includes "rejected"');
}

// evidence-reliability has score enum
{
  const filePath = path.join(ROOT, 'schemas', 'evidence-reliability.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const scoreEnum = content.properties.score && content.properties.score.enum;
  assert(Array.isArray(scoreEnum), 'evidence-reliability.schema.json score has enum');
  assert(scoreEnum.includes('A'), 'evidence-reliability score includes "A"');
  assert(scoreEnum.includes('B'), 'evidence-reliability score includes "B"');
  assert(scoreEnum.includes('C'), 'evidence-reliability score includes "C"');
  assert(scoreEnum.includes('D'), 'evidence-reliability score includes "D"');
}

// evidence-reliability has verificationStatus enum
{
  const filePath = path.join(ROOT, 'schemas', 'evidence-reliability.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const statusEnum = content.properties.verificationStatus && content.properties.verificationStatus.enum;
  assert(Array.isArray(statusEnum), 'evidence-reliability.schema.json verificationStatus has enum');
  assert(statusEnum.includes('verified'), 'evidence-reliability verificationStatus includes "verified"');
  assert(statusEnum.includes('cross-verified'), 'evidence-reliability verificationStatus includes "cross-verified"');
  assert(statusEnum.includes('unverified'), 'evidence-reliability verificationStatus includes "unverified"');
  assert(statusEnum.includes('conflicting'), 'evidence-reliability verificationStatus includes "conflicting"');
}

// bounded-experiment has allowedFiles and validation array types
{
  const filePath = path.join(ROOT, 'schemas', 'bounded-experiment.schema.json');
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(content.properties.allowedFiles && content.properties.allowedFiles.type === 'array',
    'bounded-experiment allowedFiles is array type');
  assert(content.properties.validation && content.properties.validation.type === 'array',
    'bounded-experiment validation is array type');
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
