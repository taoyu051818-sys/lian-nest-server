/**
 * check-generated-prisma.test.js
 *
 * Self-contained tests for the generated Prisma guard.
 * Run: node scripts/guards/check-generated-prisma.test.js
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'check-generated-prisma.js');
const ROOT = path.join(__dirname, '..', '..');

const {
  parseArgs,
  classifyChangedFiles,
  runGuard,
} = require('./check-generated-prisma');

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
  assert(a.base === 'main', 'default base is main');
  assert(a.allowGenerated === false, 'default allowGenerated is false');
  assert(a.json === false, 'default json is false');
  assert(a.help === false, 'default help is false');

  a = parseArgs(['node', 's', '--base', 'develop']);
  assert(a.base === 'develop', '--base sets base ref');

  a = parseArgs(['node', 's', '--allow-generated']);
  assert(a.allowGenerated === true, '--allow-generated sets flag');

  a = parseArgs(['node', 's', '--json']);
  assert(a.json === true, '--json sets flag');

  a = parseArgs(['node', 's', '--help']);
  assert(a.help === true, '--help sets flag');

  a = parseArgs(['node', 's', '-h']);
  assert(a.help === true, '-h sets flag');

  a = parseArgs(['node', 's', '--bogus']);
  assert(a._unknown === '--bogus', 'unknown arg recorded');
}

// --- classifyChangedFiles tests ---

console.log('\nclassifyChangedFiles:');
{
  let r = classifyChangedFiles([]);
  assert(r.generated.length === 0, 'empty input → no generated');
  assert(r.schema.length === 0, 'empty input → no schema');

  r = classifyChangedFiles(['src/app.ts', 'README.md']);
  assert(r.generated.length === 0, 'non-prisma files ignored');
  assert(r.schema.length === 0, 'no schema in non-prisma files');

  r = classifyChangedFiles([
    'src/generated/prisma/client.ts',
    'src/generated/prisma/models/User.ts',
  ]);
  assert(r.generated.length === 2, 'detects generated files');
  assert(r.schema.length === 0, 'no schema from generated-only');

  r = classifyChangedFiles(['prisma/schema.prisma']);
  assert(r.generated.length === 0, 'no generated from schema-only');
  assert(r.schema.length === 1, 'detects schema change');
  assert(r.schema[0] === 'prisma/schema.prisma', 'schema path correct');

  r = classifyChangedFiles([
    'src/generated/prisma/client.ts',
    'prisma/schema.prisma',
    'src/app.ts',
  ]);
  assert(r.generated.length === 1, 'mixed: one generated');
  assert(r.schema.length === 1, 'mixed: one schema');
}

// --- runGuard tests ---

console.log('\nrunGuard — no changes:');
{
  let code = runGuard({ files: [], base: 'main' });
  assert(code === 0, 'no changes → exit 0');
}

console.log('\nrunGuard — schema + generated → pass:');
{
  let code = runGuard({
    files: ['prisma/schema.prisma', 'src/generated/prisma/client.ts'],
    base: 'main',
  });
  assert(code === 0, 'both changed → exit 0');
}

console.log('\nrunGuard — only generated → fail:');
{
  let code = runGuard({
    files: ['src/generated/prisma/client.ts'],
    base: 'main',
  });
  assert(code === 1, 'generated without schema → exit 1');
}

console.log('\nrunGuard — only generated + allow → pass:');
{
  let code = runGuard({
    files: ['src/generated/prisma/client.ts'],
    base: 'main',
    allowGenerated: true,
  });
  assert(code === 0, 'generated with allow → exit 0');
}

console.log('\nrunGuard — only schema → warn but exit 0:');
{
  let code = runGuard({
    files: ['prisma/schema.prisma'],
    base: 'main',
  });
  assert(code === 0, 'schema only → exit 0 (warn)');
}

console.log('\nrunGuard — multiple generated files → fail:');
{
  let code = runGuard({
    files: [
      'src/generated/prisma/client.ts',
      'src/generated/prisma/models/User.ts',
      'src/generated/prisma/enums.ts',
    ],
    base: 'main',
  });
  assert(code === 1, 'multiple generated without schema → exit 1');
}

console.log('\nrunGuard — unrelated files only → pass:');
{
  let code = runGuard({
    files: ['src/app.ts', 'package.json', 'README.md'],
    base: 'main',
  });
  assert(code === 0, 'unrelated files → exit 0');
}

// --- JSON output test ---

console.log('\nJSON output:');
{
  const { runGuard: rg } = require('./check-generated-prisma');

  // Capture console.log for JSON mode
  let captured = '';
  const origLog = console.log;
  console.log = (msg) => { captured += msg; };

  rg({
    files: ['src/generated/prisma/client.ts'],
    base: 'main',
    json: true,
  });

  console.log = origLog;

  const parsed = JSON.parse(captured);
  assert(parsed.status === 'fail', 'JSON status is fail');
  assert(Array.isArray(parsed.violations), 'JSON has violations array');
  assert(parsed.violations.length === 1, 'JSON has one violation');
  assert(parsed.summary.generatedChanged === 1, 'JSON summary generatedChanged');
  assert(parsed.summary.schemaChanged === 0, 'JSON summary schemaChanged');
  assert(parsed.summary.allowGenerated === false, 'JSON summary allowGenerated');
  assert(Array.isArray(parsed.generated), 'JSON has generated array');
  assert(Array.isArray(parsed.schema), 'JSON has schema array');
}

// --- JSON schema+generated → pass output ---

console.log('\nJSON schema+generated:');
{
  const { runGuard: rg } = require('./check-generated-prisma');
  let captured = '';
  const origLog = console.log;
  console.log = (msg) => { captured += msg; };

  rg({
    files: ['prisma/schema.prisma', 'src/generated/prisma/client.ts'],
    base: 'main',
    json: true,
  });

  console.log = origLog;
  const parsed = JSON.parse(captured);
  assert(parsed.status === 'pass', 'JSON schema+generated status pass');
  assert(parsed.violations.length === 0, 'JSON schema+generated no violations');
  assert(parsed.warnings.length === 0, 'JSON schema+generated no warnings');
}

// --- JSON warn output ---

console.log('\nJSON schema-only warn:');
{
  const { runGuard: rg } = require('./check-generated-prisma');
  let captured = '';
  const origLog = console.log;
  console.log = (msg) => { captured += msg; };

  rg({
    files: ['prisma/schema.prisma'],
    base: 'main',
    json: true,
  });

  console.log = origLog;
  const parsed = JSON.parse(captured);
  assert(parsed.status === 'warn', 'JSON schema-only status warn');
  assert(parsed.warnings.length === 1, 'JSON schema-only has warning');
}

// --- CLI integration tests ---

console.log('\nCLI --help:');
{
  const res = run(['--help']);
  assert(res.code === 0, '--help exits 0');
  assert(res.stdout.includes('--base'), 'help mentions --base');
  assert(res.stdout.includes('--allow-generated'), 'help mentions --allow-generated');
  assert(res.stdout.includes('--json'), 'help mentions --json');
  assert(res.stdout.includes('Exit codes'), 'help shows exit codes');
}

console.log('\nCLI unknown arg:');
{
  const res = run(['--bogus']);
  assert(res.code === 2, 'unknown arg exits 2');
  assert(res.stderr.includes('Unknown argument'), 'stderr shows unknown arg');
}

console.log('\nCLI -h:');
{
  const res = run(['-h']);
  assert(res.code === 0, '-h exits 0');
  assert(res.stdout.includes('Usage'), '-h shows usage');
}

// --- Summary ---

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
