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

// --- Summary ----------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
