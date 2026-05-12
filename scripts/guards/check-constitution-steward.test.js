/**
 * check-constitution-steward.test.js
 *
 * Self-contained tests for the constitution steward checker.
 * Run: node scripts/guards/check-constitution-steward.test.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, 'check-constitution-steward.js');
const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, '__fixtures__');

const {
  FORBIDDEN_CATEGORIES,
  scanForViolations,
  buildResult,
  parseArgs,
} = require('./check-constitution-steward');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${message}`);
  } else {
    failed++;
    console.error(`  FAIL  ${message}`);
  }
}

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function run(args = []) {
  try {
    const out = execSync(`node "${SCRIPT}" ${args.join(' ')}`, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

// ── parseArgs tests ──────────────────────────────────────────────────────

console.log('\nparseArgs:');
{
  let a = parseArgs(['node', 's']);
  assert(a.input === null, 'default input is null');
  assert(a.stdin === false, 'default stdin is false');
  assert(a.json === false, 'default json is false');
  assert(a.dryRun === false, 'default dryRun is false');
  assert(a.help === false, 'default help is false');

  a = parseArgs(['node', 's', '--input', 'file.json']);
  assert(a.input === 'file.json', '--input sets path');

  a = parseArgs(['node', 's', '--stdin']);
  assert(a.stdin === true, '--stdin sets flag');

  a = parseArgs(['node', 's', '--json']);
  assert(a.json === true, '--json sets flag');

  a = parseArgs(['node', 's', '--dry-run']);
  assert(a.dryRun === true, '--dry-run sets flag');

  a = parseArgs(['node', 's', '--help']);
  assert(a.help === true, '--help sets flag');

  a = parseArgs(['node', 's', '-h']);
  assert(a.help === true, '-h sets flag');
}

// ── scanForViolations: valid doc passes ──────────────────────────────────

console.log('\nscanForViolations — valid doc passes:');
{
  const text = fixture('valid-proposal.json');
  const violations = scanForViolations(text);
  assert(violations.length === 0, 'valid proposal has no violations');
}

// ── scanForViolations: auto high-risk merge fails ────────────────────────

console.log('\nscanForViolations — auto high-risk merge fails:');
{
  const text = fixture('auto-merge-proposal.json');
  const violations = scanForViolations(text);
  assert(violations.length > 0, 'auto-merge proposal triggers violations');

  const codes = violations.map((v) => v.code);
  assert(codes.includes('AUTO_HIGH_RISK'), 'violates AUTO_HIGH_RISK category');

  const autoRisk = violations.find((v) => v.code === 'AUTO_HIGH_RISK');
  assert(autoRisk.matches.length > 0, 'AUTO_HIGH_RISK has match details');
  assert(autoRisk.matches.some((m) => m.label === 'auto-action-keyword'), 'matches auto-action-keyword pattern');
}

// ── scanForViolations: self-approval fails ───────────────────────────────

console.log('\nscanForViolations — self-approval fails:');
{
  const text = fixture('self-approve-proposal.json');
  const violations = scanForViolations(text);
  assert(violations.length > 0, 'self-approve proposal triggers violations');

  const codes = violations.map((v) => v.code);
  assert(codes.includes('SELF_APPROVE'), 'violates SELF_APPROVE category');

  const selfApprove = violations.find((v) => v.code === 'SELF_APPROVE');
  assert(selfApprove.matches.length > 0, 'SELF_APPROVE has match details');
}

// ── scanForViolations: unverified fact write fails ───────────────────────

console.log('\nscanForViolations — unverified fact write fails:');
{
  const text = fixture('unverified-facts-proposal.json');
  const violations = scanForViolations(text);
  assert(violations.length > 0, 'unverified facts proposal triggers violations');

  const codes = violations.map((v) => v.code);
  assert(codes.includes('WRITE_UNVERIFIED_FACTS'), 'violates WRITE_UNVERIFIED_FACTS category');

  const unverified = violations.find((v) => v.code === 'WRITE_UNVERIFIED_FACTS');
  assert(unverified.matches.length > 0, 'WRITE_UNVERIFIED_FACTS has match details');
}

// ── scanForViolations: amendment proposal allowed ────────────────────────

console.log('\nscanForViolations — amendment proposal allowed:');
{
  const text = fixture('amendment-proposal.json');
  const violations = scanForViolations(text);
  assert(violations.length === 0, 'amendment proposal has no violations');
}

// ── buildResult tests ────────────────────────────────────────────────────

console.log('\nbuildResult:');
{
  const text = 'clean input with no forbidden patterns';
  const violations = scanForViolations(text);
  const result = buildResult(text, 'test-source', violations);

  assert(result.tool === 'check-constitution-steward', 'result has correct tool name');
  assert(result.pass === true, 'result pass is true for clean input');
  assert(result.inputSource === 'test-source', 'result preserves input source');
  assert(result.inputLength === text.length, 'result has correct input length');
  assert(result.violationCount === 0, 'result has zero violation count');
  assert(Array.isArray(result.violations), 'result has violations array');
  assert(Array.isArray(result.categories), 'result has categories array');
  assert(result.categories.length === FORBIDDEN_CATEGORIES.length, 'categories count matches FORBIDDEN_CATEGORIES');

  const risky = 'please auto-merge this and self-approve the change';
  const riskyViolations = scanForViolations(risky);
  const riskyResult = buildResult(risky, 'stdin', riskyViolations);
  assert(riskyResult.pass === false, 'result pass is false for risky input');
  assert(riskyResult.violationCount > 0, 'result has violations for risky input');
}

// ── FORBIDDEN_CATEGORIES structure ───────────────────────────────────────

console.log('\nFORBIDDEN_CATEGORIES structure:');
{
  assert(FORBIDDEN_CATEGORIES.length === 5, 'has 5 forbidden categories');

  const expectedCodes = ['BYPASS_GATE', 'AUTO_HIGH_RISK', 'SELF_APPROVE', 'LOWER_HUMAN_REQUIRED', 'WRITE_UNVERIFIED_FACTS'];
  for (const code of expectedCodes) {
    const cat = FORBIDDEN_CATEGORIES.find((c) => c.code === code);
    assert(cat !== undefined, `category ${code} exists`);
    assert(cat.description.length > 0, `category ${code} has description`);
    assert(Array.isArray(cat.patterns), `category ${code} has patterns array`);
    assert(cat.patterns.length > 0, `category ${code} has at least one pattern`);

    for (const pat of cat.patterns) {
      assert(pat.regex instanceof RegExp, `pattern ${pat.label} has regex`);
      assert(typeof pat.label === 'string' && pat.label.length > 0, `pattern ${pat.label} has label`);
    }
  }
}

// ── CLI integration: --input with fixtures ───────────────────────────────

console.log('\nCLI integration — --input with fixtures:');
{
  const validPath = path.join(FIXTURES, 'valid-proposal.json');
  const validRun = run(['--input', validPath]);
  assert(validRun.code === 0, 'valid proposal exits 0');
  assert(validRun.stdout.includes('PASS'), 'valid proposal prints PASS');

  const autoPath = path.join(FIXTURES, 'auto-merge-proposal.json');
  const autoRun = run(['--input', autoPath]);
  assert(autoRun.code === 1, 'auto-merge proposal exits 1');
  assert(autoRun.stdout.includes('FAIL'), 'auto-merge proposal prints FAIL');
  assert(autoRun.stdout.includes('AUTO_HIGH_RISK'), 'auto-merge output mentions AUTO_HIGH_RISK');

  const selfPath = path.join(FIXTURES, 'self-approve-proposal.json');
  const selfRun = run(['--input', selfPath]);
  assert(selfRun.code === 1, 'self-approve proposal exits 1');
  assert(selfRun.stdout.includes('SELF_APPROVE'), 'self-approve output mentions SELF_APPROVE');

  const unverifiedPath = path.join(FIXTURES, 'unverified-facts-proposal.json');
  const unverifiedRun = run(['--input', unverifiedPath]);
  assert(unverifiedRun.code === 1, 'unverified facts proposal exits 1');
  assert(unverifiedRun.stdout.includes('WRITE_UNVERIFIED_FACTS'), 'unverified output mentions WRITE_UNVERIFIED_FACTS');

  const amendPath = path.join(FIXTURES, 'amendment-proposal.json');
  const amendRun = run(['--input', amendPath]);
  assert(amendRun.code === 0, 'amendment proposal exits 0');
  assert(amendRun.stdout.includes('PASS'), 'amendment proposal prints PASS');
}

// ── CLI integration: --json output ───────────────────────────────────────

console.log('\nCLI integration — --json output:');
{
  const validPath = path.join(FIXTURES, 'valid-proposal.json');
  const jsonRun = run(['--input', validPath, '--json']);
  assert(jsonRun.code === 0, '--json exits 0 for valid input');
  const parsed = JSON.parse(jsonRun.stdout);
  assert(parsed.pass === true, 'JSON pass is true for valid input');
  assert(parsed.tool === 'check-constitution-steward', 'JSON tool field correct');
  assert(parsed.violationCount === 0, 'JSON violationCount is 0');

  const autoPath = path.join(FIXTURES, 'auto-merge-proposal.json');
  const autoJson = run(['--input', autoPath, '--json']);
  const autoParsed = JSON.parse(autoJson.stdout);
  assert(autoParsed.pass === false, 'JSON pass is false for auto-merge');
  assert(autoParsed.violations.length > 0, 'JSON has violations array');
}

// ── CLI integration: --dry-run ───────────────────────────────────────────

console.log('\nCLI integration — --dry-run:');
{
  const autoPath = path.join(FIXTURES, 'auto-merge-proposal.json');
  const dryRun = run(['--input', autoPath, '--dry-run']);
  assert(dryRun.code === 0, '--dry-run exits 0 even with violations');
}

// ── CLI integration: --help ──────────────────────────────────────────────

console.log('\nCLI integration — --help:');
{
  const help = run(['--help']);
  assert(help.code === 0, '--help exits 0');
  assert(help.stdout.includes('check-constitution-steward'), '--help shows script name');
  assert(help.stdout.includes('--input'), '--help mentions --input');
  assert(help.stdout.includes('--stdin'), '--help mentions --stdin');
  assert(help.stdout.includes('--dry-run'), '--help mentions --dry-run');
  assert(help.stdout.includes('--json'), '--help mentions --json');
  assert(help.stdout.includes('BYPASS_GATE'), '--help lists BYPASS_GATE');
  assert(help.stdout.includes('AUTO_HIGH_RISK'), '--help lists AUTO_HIGH_RISK');
  assert(help.stdout.includes('SELF_APPROVE'), '--help lists SELF_APPROVE');
  assert(help.stdout.includes('LOWER_HUMAN_REQUIRED'), '--help lists LOWER_HUMAN_REQUIRED');
  assert(help.stdout.includes('WRITE_UNVERIFIED_FACTS'), '--help lists WRITE_UNVERIFIED_FACTS');
}

// ── CLI integration: error cases ─────────────────────────────────────────

console.log('\nCLI integration — error cases:');
{
  const noInput = run([]);
  assert(noInput.code === 2, 'no --input or --stdin exits 2');
  assert(noInput.stderr.includes('--input') || noInput.stderr.includes('--stdin'), 'error mentions required args');

  const missing = run(['--input', 'nonexistent.json']);
  assert(missing.code === 2, 'missing file exits 2');
  assert(missing.stderr.includes('not found'), 'error mentions file not found');

  const unknown = run(['--bogus']);
  assert(unknown.code === 2, 'unknown flag exits 2');
  assert(unknown.stderr.includes('Unknown argument'), 'unknown flag shows error');
}

// ── Pattern-specific tests ───────────────────────────────────────────────

console.log('\nPattern-specific — BYPASS_GATE:');
{
  const text = 'We should skip gate check for this hotfix.';
  const violations = scanForViolations(text);
  assert(violations.some((v) => v.code === 'BYPASS_GATE'), 'detects skip-gate keyword');
}

console.log('\nPattern-specific — LOWER_HUMAN_REQUIRED:');
{
  const text = 'We should remove human-required approval for faster throughput.';
  const violations = scanForViolations(text);
  assert(violations.some((v) => v.code === 'LOWER_HUMAN_REQUIRED'), 'detects lower human-required');
}

console.log('\nPattern-specific — multiple violations:');
{
  const text = 'Auto-merge all PRs and self-approve policy changes without human review.';
  const violations = scanForViolations(text);
  const codes = violations.map((v) => v.code);
  assert(codes.includes('AUTO_HIGH_RISK'), 'detects AUTO_HIGH_RISK in multi-violation text');
  assert(codes.includes('SELF_APPROVE'), 'detects SELF_APPROVE in multi-violation text');
  assert(violations.length >= 2, 'reports multiple violation categories');
}

// ── stdin integration ────────────────────────────────────────────────────

console.log('\nCLI integration — --stdin:');
{
  const validText = fixture('valid-proposal.json');
  let stdinResult;
  try {
    const out = execSync(`node "${SCRIPT}" --stdin --json`, {
      cwd: ROOT,
      input: validText,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    stdinResult = { code: 0, stdout: out.toString() };
  } catch (err) {
    stdinResult = { code: err.status || 1, stdout: err.stdout ? err.stdout.toString() : '' };
  }
  assert(stdinResult.code === 0, '--stdin with valid input exits 0');
  const parsed = JSON.parse(stdinResult.stdout);
  assert(parsed.pass === true, '--stdin JSON pass is true');
  assert(parsed.inputSource === 'stdin', '--stdin reports stdin as source');
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
