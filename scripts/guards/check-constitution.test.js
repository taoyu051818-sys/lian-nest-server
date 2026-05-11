/**
 * check-constitution.test.js
 *
 * Self-contained tests for the constitution guard.
 * Run: node scripts/guards/check-constitution.test.js
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'check-constitution.js');
const ROOT = path.join(__dirname, '..', '..');

const {
  parseArgs,
  extractH2Headings,
  checkSections,
  checkSectionSync,
  runGuard,
  REQUIRED_SECTIONS,
  AUTHORITATIVE_PATH,
  DOCS_MIRROR_PATH,
} = require('./check-constitution');

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

// --- parseArgs tests ---

console.log('\nparseArgs:');
{
  let a = parseArgs(['node', 's']);
  assert(a.json === false, 'default json is false');
  assert(a.dryRun === false, 'default dryRun is false');
  assert(a.help === false, 'default help is false');

  a = parseArgs(['node', 's', '--json']);
  assert(a.json === true, '--json sets flag');

  a = parseArgs(['node', 's', '--dry-run']);
  assert(a.dryRun === true, '--dry-run sets flag');

  a = parseArgs(['node', 's', '--help']);
  assert(a.help === true, '--help sets flag');

  a = parseArgs(['node', 's', '-h']);
  assert(a.help === true, '-h sets flag');

  a = parseArgs(['node', 's', '--bogus']);
  assert(a._unknown === '--bogus', 'unknown arg recorded');
}

// --- extractH2Headings tests ---

console.log('\nextractH2Headings:');
{
  const content = [
    '# Title',
    '## Section One',
    'Some text',
    '## Section Two',
    '### Subsection',
    '## Section Three',
  ].join('\n');

  const headings = extractH2Headings(content);
  assert(headings.length === 3, 'finds 3 H2 headings');
  assert(headings[0] === 'Section One', 'first heading correct');
  assert(headings[1] === 'Section Two', 'second heading correct');
  assert(headings[2] === 'Section Three', 'third heading correct');

  const empty = extractH2Headings('no headings here');
  assert(empty.length === 0, 'returns empty for no headings');

  const crlf = extractH2Headings('# Title\r\n## CRLF Section\r\n');
  assert(crlf.length === 1, 'handles CRLF line endings');
  assert(crlf[0] === 'CRLF Section', 'CRLF heading correct');

  const numbered = extractH2Headings('## 1. First Section\n## 2. Second Section\n## 10. Tenth Section');
  assert(numbered.length === 3, 'finds numbered headings');
  assert(numbered[0] === 'First Section', 'strips single-digit number prefix');
  assert(numbered[1] === 'Second Section', 'strips second number prefix');
  assert(numbered[2] === 'Tenth Section', 'strips double-digit number prefix');
}

// --- checkSections tests ---

console.log('\ncheckSections:');
{
  const validContent = [
    '# Seed Constitution',
    '## High-Risk Human-Required Boundaries',
    'Content',
    '## Explicit Merge Allowlists',
    'Content',
    '## Main-Red Launch Stop',
    'Content',
    '## Legacy Backend Read-Only Policy',
    'Content',
    '## No Worker Scope Expansion',
    'Content',
  ].join('\n');

  const result = checkSections(validContent, AUTHORITATIVE_PATH);
  assert(result.pass === true, 'passes with all 5 sections');
  assert(result.missing.length === 0, 'no missing sections');

  const partialContent = [
    '# Seed Constitution',
    '## High-Risk Human-Required Boundaries',
    'Content',
    '## Explicit Merge Allowlists',
    'Content',
  ].join('\n');

  const partial = checkSections(partialContent, AUTHORITATIVE_PATH);
  assert(partial.pass === false, 'fails with missing sections');
  assert(partial.missing.length === 3, 'reports 3 missing sections');
  assert(partial.missing.includes('Main-Red Launch Stop'), 'lists Main-Red Launch Stop as missing');
  assert(partial.missing.includes('Legacy Backend Read-Only Policy'), 'lists Legacy Backend Read-Only Policy as missing');
  assert(partial.missing.includes('No Worker Scope Expansion'), 'lists No Worker Scope Expansion as missing');

  const empty = checkSections('# No sections', AUTHORITATIVE_PATH);
  assert(empty.pass === false, 'fails with no sections at all');
  assert(empty.missing.length === REQUIRED_SECTIONS.length, 'reports all sections as missing');

  const numberedContent = [
    '# Seed Constitution',
    '## 1. High-Risk Human-Required Boundaries',
    'Content',
    '## 2. Explicit Merge Allowlists',
    'Content',
    '## 3. Main-Red Launch Stop',
    'Content',
    '## 4. Legacy Backend Read-Only Policy',
    'Content',
    '## 5. No Worker Scope Expansion',
    'Content',
  ].join('\n');

  const numbered = checkSections(numberedContent, AUTHORITATIVE_PATH);
  assert(numbered.pass === true, 'passes with numbered section headings');
  assert(numbered.missing.length === 0, 'no missing sections with numbered headings');
}

// --- checkSectionSync tests ---

console.log('\ncheckSectionSync:');
{
  const authContent = [
    '## High-Risk Human-Required Boundaries',
    '## Explicit Merge Allowlists',
    '## Main-Red Launch Stop',
    '## Legacy Backend Read-Only Policy',
    '## No Worker Scope Expansion',
  ].join('\n');

  const mirrorContent = [
    '## High-Risk Human-Required Boundaries',
    '## Explicit Merge Allowlists',
    '## Main-Red Launch Stop',
    '## Legacy Backend Read-Only Policy',
    '## No Worker Scope Expansion',
  ].join('\n');

  const sync = checkSectionSync(authContent, mirrorContent);
  assert(sync.pass === true, 'passes when sections are identical');

  const diffMirror = [
    '## High-Risk Human-Required Boundaries',
    '## Explicit Merge Allowlists',
    '## Main-Red Launch Stop',
    '## Extra Section',
  ].join('\n');

  const diff = checkSectionSync(authContent, diffMirror);
  assert(diff.pass === false, 'fails when sections differ');
  assert(diff.message.toLowerCase().includes('legacy backend read-only policy'), 'reports missing section in mirror');
  assert(diff.message.toLowerCase().includes('extra section'), 'reports extra section in mirror');
}

// --- runGuard with real files ---

console.log('\nrunGuard (real files):');
{
  const result = runGuard();
  assert(result.status === 'pass', 'passes with real constitution files');
  assert(result.summary.authoritativeExists === true, 'authoritative file exists');
  assert(result.summary.mirrorExists === true, 'mirror file exists');
  assert(result.summary.requiredSections === 5, 'reports 5 required sections');
  assert(result.summary.violationCount === 0, 'no violations');
}

// --- runGuard with JSON output ---

console.log('\nrunGuard (JSON output):');
{
  // Capture JSON output by temporarily redirecting console.log
  const origLog = console.log;
  let jsonOutput = '';
  console.log = (msg) => { jsonOutput += msg; };
  const result = runGuard({ json: true });
  console.log = origLog;

  const parsed = JSON.parse(jsonOutput);
  assert(parsed.status === 'pass', 'JSON output has pass status');
  assert(Array.isArray(parsed.checks), 'JSON output has checks array');
  assert(parsed.checks.length >= 4, 'JSON output has at least 4 checks');
  assert(parsed.summary.authoritativeExists === true, 'JSON output reports authoritative exists');
}

// --- CLI integration tests ---

console.log('\nCLI integration:');
{
  const help = run(['--help']);
  assert(help.code === 0, '--help exits 0');
  assert(help.stdout.includes('Usage:'), '--help shows usage');
  assert(help.stdout.includes('--dry-run'), '--help mentions --dry-run');
  assert(help.stdout.includes('--json'), '--help mentions --json');

  const unknown = run(['--unknown-flag']);
  assert(unknown.code === 2, 'unknown flag exits 2');
  assert(unknown.stderr.includes('Unknown argument'), 'unknown flag shows error');

  const jsonRun = run(['--json']);
  assert(jsonRun.code === 0, '--json exits 0 on pass');
  const parsed = JSON.parse(jsonRun.stdout);
  assert(parsed.status === 'pass', '--json output has pass status');
  assert(parsed.checks.length >= 4, '--json output has checks');
}

// --- CLI dry-run test ---

console.log('\nCLI dry-run:');
{
  const dryRun = run(['--dry-run']);
  assert(dryRun.code === 0, '--dry-run exits 0 even on violations');
  assert(dryRun.stdout.includes('PASS') || dryRun.stdout.includes('dry-run'), '--dry-run reports results');

  const dryRunJson = run(['--dry-run', '--json']);
  assert(dryRunJson.code === 0, '--dry-run --json exits 0');
  const parsed = JSON.parse(dryRunJson.stdout);
  assert(parsed.summary.mode === 'dry-run', 'JSON reports dry-run mode');
}

// --- Summary ---

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
