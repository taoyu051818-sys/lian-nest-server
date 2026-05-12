#!/usr/bin/env node

/**
 * check-ai-policy-files.test.js
 *
 * Self-contained tests for the AI policy files guard. No external test framework.
 * Run: node scripts/guards/check-ai-policy-files.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkPolicyFiles, REQUIRED_FILES, REQUIRED_JSON, REQUIRED_NON_JSON, POLICY_DIR } = require('./check-ai-policy-files');

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

// --- Helpers ----------------------------------------------------------------

/**
 * Create a temporary directory with a .github/ai-policy subdirectory
 * populated with the given files.
 *
 * @param {Object} files – { relativePath: content } map
 * @returns {string} tmpDir path
 */
function createTmpRepo(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-policy-guard-'));
  const policyDir = path.join(tmpDir, '.github', 'ai-policy');
  fs.mkdirSync(policyDir, { recursive: true });

  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(policyDir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return tmpDir;
}

/**
 * Remove a tmpDir and its contents.
 */
function removeTmpDir(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Return a minimal valid JSON object string.
 */
function validJson() {
  return JSON.stringify({ version: 1, rules: [] });
}

/**
 * Build a files map with all required files present and valid.
 */
function allFilesValid() {
  const files = {};
  for (const f of REQUIRED_JSON) {
    files[f] = validJson();
  }
  for (const f of REQUIRED_NON_JSON) {
    files[f] = '# Seed constitution\n';
  }
  return files;
}

// --- Tests ------------------------------------------------------------------

console.log('\ncheck-ai-policy-files tests\n');

// 1. Constants exported correctly
{
  assert(Array.isArray(REQUIRED_FILES), 'REQUIRED_FILES is array');
  assert(REQUIRED_FILES.length === 8, 'REQUIRED_FILES has 8 entries');
  assert(REQUIRED_JSON.length === 7, 'REQUIRED_JSON has 7 entries');
  assert(REQUIRED_NON_JSON.length === 1, 'REQUIRED_NON_JSON has 1 entry');
  assert(REQUIRED_NON_JSON[0] === 'seed-constitution.md', 'REQUIRED_NON_JSON includes seed-constitution.md');
  assert(typeof POLICY_DIR === 'string', 'POLICY_DIR is string');
  assert(POLICY_DIR === '.github/ai-policy', 'POLICY_DIR is .github/ai-policy');
}

// 2. All files present and valid → ok
{
  const tmpDir = createTmpRepo(allFilesValid());
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'all files present → ok');
  assert(result.dirExists === true, 'all files present → dirExists');
  assert(result.missing.length === 0, 'all files present → no missing');
  assert(result.invalidJson.length === 0, 'all files present → no invalidJson');
  assert(result.checked === REQUIRED_FILES.length, 'all files present → checked count matches');
  removeTmpDir(tmpDir);
}

// 3. Missing directory → not ok
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-policy-guard-'));
  // No .github/ai-policy created
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'missing directory → not ok');
  assert(result.dirExists === false, 'missing directory → dirExists false');
  assert(result.missing.length === REQUIRED_FILES.length, 'missing directory → all files missing');
  removeTmpDir(tmpDir);
}

// 4. Missing one JSON file
{
  const files = allFilesValid();
  delete files['launch-policy.json'];
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'missing launch-policy.json → not ok');
  assert(result.missing.includes('launch-policy.json'), 'missing list includes launch-policy.json');
  assert(result.missing.length === 1, 'exactly one file missing');
  removeTmpDir(tmpDir);
}

// 5. Missing seed-constitution.md
{
  const files = allFilesValid();
  delete files['seed-constitution.md'];
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'missing seed-constitution.md → not ok');
  assert(result.missing.includes('seed-constitution.md'), 'missing list includes seed-constitution.md');
  removeTmpDir(tmpDir);
}

// 6. Invalid JSON file
{
  const files = allFilesValid();
  files['risk-policy.json'] = '{ invalid json content ';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'invalid JSON → not ok');
  assert(result.invalidJson.length === 1, 'one invalid JSON entry');
  assert(result.invalidJson[0].file === 'risk-policy.json', 'invalid JSON entry is risk-policy.json');
  assert(typeof result.invalidJson[0].error === 'string', 'invalid JSON has error message');
  removeTmpDir(tmpDir);
}

// 7. Multiple invalid JSON files
{
  const files = allFilesValid();
  files['merge-policy.json'] = 'not json';
  files['worker-permissions.json'] = '{ "incomplete": ';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'multiple invalid JSON → not ok');
  assert(result.invalidJson.length === 2, 'two invalid JSON entries');
  const invalidNames = result.invalidJson.map((e) => e.file);
  assert(invalidNames.includes('merge-policy.json'), 'invalid includes merge-policy.json');
  assert(invalidNames.includes('worker-permissions.json'), 'invalid includes worker-permissions.json');
  removeTmpDir(tmpDir);
}

// 8. Missing and invalid combined
{
  const files = allFilesValid();
  delete files['failure-taxonomy.json'];
  files['risk-policy.json'] = 'broken';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'missing + invalid → not ok');
  assert(result.missing.includes('failure-taxonomy.json'), 'missing includes failure-taxonomy.json');
  assert(result.invalidJson[0].file === 'risk-policy.json', 'invalid includes risk-policy.json');
  removeTmpDir(tmpDir);
}

// 9. Empty JSON object is valid
{
  const files = allFilesValid();
  files['risk-policy.json'] = '{}';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'empty JSON object is valid');
  removeTmpDir(tmpDir);
}

// 10. Empty JSON array is valid
{
  const files = allFilesValid();
  files['risk-policy.json'] = '[]';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'empty JSON array is valid');
  removeTmpDir(tmpDir);
}

// 11. JSON with BOM is invalid (strict parse)
{
  const files = allFilesValid();
  files['risk-policy.json'] = '﻿{"version":1}';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === false, 'JSON with BOM fails strict parse');
  assert(result.invalidJson.length === 1, 'BOM JSON reported as invalid');
  removeTmpDir(tmpDir);
}

// 12. Check against real repo directory (should pass on a healthy repo)
{
  const repoRoot = path.resolve(__dirname, '..', '..');
  const result = checkPolicyFiles(repoRoot);
  assert(result.ok === true, 'real repo .github/ai-policy passes guard');
  assert(result.dirExists === true, 'real repo dirExists');
  assert(result.checked === REQUIRED_FILES.length, 'real repo checked all files');
}

// 13. dry-run with missing directory does not affect result structure
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-policy-guard-'));
  const result = checkPolicyFiles(tmpDir, { dryRun: true });
  assert(result.ok === false, 'dry-run with missing dir → still reports not ok');
  assert(result.dirExists === false, 'dry-run with missing dir → dirExists false');
  removeTmpDir(tmpDir);
}

// 14. Each required JSON file individually missing is detected
{
  for (const jsonFile of REQUIRED_JSON) {
    const files = allFilesValid();
    delete files[jsonFile];
    const tmpDir = createTmpRepo(files);
    const result = checkPolicyFiles(tmpDir);
    assert(result.ok === false, `missing ${jsonFile} → not ok`);
    assert(result.missing.includes(jsonFile), `missing list includes ${jsonFile}`);
    removeTmpDir(tmpDir);
  }
}

// 15. checked count reflects only present files
{
  const files = allFilesValid();
  delete files['launch-policy.json'];
  delete files['risk-policy.json'];
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.checked === REQUIRED_FILES.length - 2, 'checked count is total minus missing');
  removeTmpDir(tmpDir);
}

// --- External intake policy tests ------------------------------------------

// 16. external-intake-policy.json exists and is valid JSON in the real repo
{
  const repoRoot = path.resolve(__dirname, '..', '..');
  const filePath = path.join(repoRoot, POLICY_DIR, 'external-intake-policy.json');
  const exists = fs.existsSync(filePath);
  assert(exists, 'external-intake-policy.json exists in real repo');
  if (exists) {
    const content = fs.readFileSync(filePath, 'utf-8');
    let parsed = null;
    let err = null;
    try { parsed = JSON.parse(content); } catch (e) { err = e; }
    assert(err === null, 'external-intake-policy.json is valid JSON');
    assert(parsed !== null && typeof parsed === 'object', 'external-intake-policy.json parses to object');
    assert(parsed.version === 1, 'external-intake-policy.json has version 1');
    assert(typeof parsed.sourceClasses === 'object', 'external-intake-policy.json has sourceClasses');
    assert(typeof parsed.reliabilityTiers === 'object', 'external-intake-policy.json has reliabilityTiers');
    assert(typeof parsed.hardRules === 'object', 'external-intake-policy.json has hardRules');
    assert(typeof parsed.sanitization === 'object', 'external-intake-policy.json has sanitization');
    assert(typeof parsed.forbiddenDirectTaskConversion === 'object', 'external-intake-policy.json has forbiddenDirectTaskConversion');
  }
}

// 17. bounded-experiment-policy.json exists and is valid JSON in the real repo
{
  const repoRoot = path.resolve(__dirname, '..', '..');
  const filePath = path.join(repoRoot, POLICY_DIR, 'bounded-experiment-policy.json');
  const exists = fs.existsSync(filePath);
  assert(exists, 'bounded-experiment-policy.json exists in real repo');
  if (exists) {
    const content = fs.readFileSync(filePath, 'utf-8');
    let parsed = null;
    let err = null;
    try { parsed = JSON.parse(content); } catch (e) { err = e; }
    assert(err === null, 'bounded-experiment-policy.json is valid JSON');
    assert(parsed !== null && typeof parsed === 'object', 'bounded-experiment-policy.json parses to object');
    assert(typeof parsed.experimentTypes === 'object', 'bounded-experiment-policy.json has experimentTypes');
    assert(typeof parsed.riskLimits === 'object', 'bounded-experiment-policy.json has riskLimits');
    assert(typeof parsed.humanRequiredCategories === 'object', 'bounded-experiment-policy.json has humanRequiredCategories');
    assert(typeof parsed.scopeConstraints === 'object', 'bounded-experiment-policy.json has scopeConstraints');
    assert(typeof parsed.lifecycle === 'object', 'bounded-experiment-policy.json has lifecycle');
  }
}

// 18. Guard passes when tmp repo includes external-intake-policy.json alongside required files
{
  const files = allFilesValid();
  files['external-intake-policy.json'] = JSON.stringify({ version: 1, sourceClasses: {}, reliabilityTiers: {} });
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard passes with external-intake-policy.json present');
  removeTmpDir(tmpDir);
}

// 19. Guard passes when tmp repo includes bounded-experiment-policy.json alongside required files
{
  const files = allFilesValid();
  files['bounded-experiment-policy.json'] = JSON.stringify({ experimentTypes: {}, riskLimits: {} });
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard passes with bounded-experiment-policy.json present');
  removeTmpDir(tmpDir);
}

// 20. Guard passes when tmp repo includes both external intake policies alongside required files
{
  const files = allFilesValid();
  files['external-intake-policy.json'] = JSON.stringify({ version: 1, sourceClasses: {}, reliabilityTiers: {} });
  files['bounded-experiment-policy.json'] = JSON.stringify({ experimentTypes: {}, riskLimits: {} });
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard passes with both external intake policies present');
  assert(result.checked === REQUIRED_FILES.length, 'checked count unchanged with extra policy files');
  removeTmpDir(tmpDir);
}

// 21. Guard does not flag missing external-intake-policy.json (not yet in REQUIRED_JSON)
{
  const files = allFilesValid();
  delete files['external-intake-policy.json'];
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard passes without external-intake-policy.json (not required)');
  assert(!result.missing.includes('external-intake-policy.json'), 'external-intake-policy.json not in missing list');
  removeTmpDir(tmpDir);
}

// 22. Guard does not flag missing bounded-experiment-policy.json (not yet in REQUIRED_JSON)
{
  const files = allFilesValid();
  delete files['bounded-experiment-policy.json'];
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard passes without bounded-experiment-policy.json (not required)');
  assert(!result.missing.includes('bounded-experiment-policy.json'), 'bounded-experiment-policy.json not in missing list');
  removeTmpDir(tmpDir);
}

// 23. Invalid JSON in external-intake-policy.json is not caught (not in REQUIRED_JSON)
{
  const files = allFilesValid();
  files['external-intake-policy.json'] = '{ broken json ';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard ignores invalid external-intake-policy.json (not required)');
  assert(result.invalidJson.length === 0, 'external-intake-policy.json not in invalidJson list');
  removeTmpDir(tmpDir);
}

// 24. Invalid JSON in bounded-experiment-policy.json is not caught (not in REQUIRED_JSON)
{
  const files = allFilesValid();
  files['bounded-experiment-policy.json'] = 'not json at all';
  const tmpDir = createTmpRepo(files);
  const result = checkPolicyFiles(tmpDir);
  assert(result.ok === true, 'guard ignores invalid bounded-experiment-policy.json (not required)');
  assert(result.invalidJson.length === 0, 'bounded-experiment-policy.json not in invalidJson list');
  removeTmpDir(tmpDir);
}

// 25. Real repo has both external intake policy files with expected top-level keys
{
  const repoRoot = path.resolve(__dirname, '..', '..');
  const eipPath = path.join(repoRoot, POLICY_DIR, 'external-intake-policy.json');
  const bepPath = path.join(repoRoot, POLICY_DIR, 'bounded-experiment-policy.json');

  if (fs.existsSync(eipPath)) {
    const eip = JSON.parse(fs.readFileSync(eipPath, 'utf-8'));
    const eipKeys = Object.keys(eip);
    assert(eipKeys.includes('sourceClasses'), 'external-intake-policy.json has sourceClasses key');
    assert(eipKeys.includes('reliabilityTiers'), 'external-intake-policy.json has reliabilityTiers key');
    assert(eipKeys.includes('hardRules'), 'external-intake-policy.json has hardRules key');
    assert(eipKeys.includes('sanitization'), 'external-intake-policy.json has sanitization key');
    assert(eipKeys.includes('forbiddenDirectTaskConversion'), 'external-intake-policy.json has forbiddenDirectTaskConversion key');
    assert(eipKeys.includes('injectionPatternDetection'), 'external-intake-policy.json has injectionPatternDetection key');
    assert(eipKeys.includes('factEventTypes'), 'external-intake-policy.json has factEventTypes key');

    // Verify source classes cover all 8 classes from the intake spec
    const classes = Object.keys(eip.sourceClasses);
    assert(classes.length === 8, 'external-intake-policy.json has 8 source classes');
    assert(classes.includes('github-issue'), 'sourceClasses includes github-issue');
    assert(classes.includes('github-pr'), 'sourceClasses includes github-pr');
    assert(classes.includes('ci-result'), 'sourceClasses includes ci-result');
    assert(classes.includes('human-instruction'), 'sourceClasses includes human-instruction');
    assert(classes.includes('external-doc'), 'sourceClasses includes external-doc');
    assert(classes.includes('web-scan'), 'sourceClasses includes web-scan');
    assert(classes.includes('user-paste'), 'sourceClasses includes user-paste');
    assert(classes.includes('opaque-external'), 'sourceClasses includes opaque-external');

    // Verify reliability tiers cover all 5 tiers
    const tiers = Object.keys(eip.reliabilityTiers);
    assert(tiers.length === 5, 'external-intake-policy.json has 5 reliability tiers');
    assert(tiers.includes('authoritative'), 'reliabilityTiers includes authoritative');
    assert(tiers.includes('high'), 'reliabilityTiers includes high');
    assert(tiers.includes('medium'), 'reliabilityTiers includes medium');
    assert(tiers.includes('low'), 'reliabilityTiers includes low');
    assert(tiers.includes('untrusted'), 'reliabilityTiers includes untrusted');

    // Verify 5 hard rules
    const rules = Object.keys(eip.hardRules);
    assert(rules.length === 5, 'external-intake-policy.json has 5 hard rules');
  }
}

// 26. Real repo bounded-experiment-policy.json has expected structure
{
  const repoRoot = path.resolve(__dirname, '..', '..');
  const bepPath = path.join(repoRoot, POLICY_DIR, 'bounded-experiment-policy.json');

  if (fs.existsSync(bepPath)) {
    const bep = JSON.parse(fs.readFileSync(bepPath, 'utf-8'));
    const bepKeys = Object.keys(bep);

    assert(bepKeys.includes('experimentTypes'), 'bounded-experiment-policy.json has experimentTypes key');
    assert(bepKeys.includes('riskLimits'), 'bounded-experiment-policy.json has riskLimits key');
    assert(bepKeys.includes('humanRequiredCategories'), 'bounded-experiment-policy.json has humanRequiredCategories key');
    assert(bepKeys.includes('validationPolicy'), 'bounded-experiment-policy.json has validationPolicy key');
    assert(bepKeys.includes('scopeConstraints'), 'bounded-experiment-policy.json has scopeConstraints key');
    assert(bepKeys.includes('lifecycle'), 'bounded-experiment-policy.json has lifecycle key');

    // Verify experiment types
    const expTypes = Object.keys(bep.experimentTypes);
    assert(expTypes.length >= 4, 'bounded-experiment-policy.json has at least 4 experiment types');
    assert(expTypes.includes('code-change'), 'experimentTypes includes code-change');
    assert(expTypes.includes('config-change'), 'experimentTypes includes config-change');
    assert(expTypes.includes('data-collection'), 'experimentTypes includes data-collection');
    assert(expTypes.includes('prototype'), 'experimentTypes includes prototype');

    // Verify risk limits cover all tiers
    const riskTiers = Object.keys(bep.riskLimits);
    assert(riskTiers.includes('low'), 'riskLimits includes low');
    assert(riskTiers.includes('medium'), 'riskLimits includes medium');
    assert(riskTiers.includes('high'), 'riskLimits includes high');

    // Verify human required categories
    assert(typeof bep.humanRequiredCategories.categories === 'object', 'humanRequiredCategories has categories');
    const categories = Object.keys(bep.humanRequiredCategories.categories);
    assert(categories.length >= 4, 'at least 4 human-required categories');
    assert(categories.includes('auth-session'), 'categories includes auth-session');
    assert(categories.includes('database-migration'), 'categories includes database-migration');
  }
}

// --- Summary ----------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
