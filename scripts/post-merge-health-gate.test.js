/**
 * post-merge-health-gate.test.js
 *
 * Tests for the post-merge health gate script.
 * Run: node scripts/post-merge-health-gate.test.js
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'post-merge-health-gate.js');
const ROOT = path.join(__dirname, '..');

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
      timeout: 180_000,
      env: { ...process.env, NODE_ENV: 'test' },
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

// --- Tests ---

console.log('post-merge-health-gate.js tests');
console.log('='.repeat(50));

// Help output
console.log('\n--help flag');
{
  const res = run(['--help']);
  assert(res.code === 0, '--help exits 0');
  assert(res.stdout.includes('--quick'), 'help mentions --quick');
  assert(res.stdout.includes('--full'), 'help mentions --full');
  assert(res.stdout.includes('EXIT CODES'), 'help shows exit codes');
  assert(res.stdout.includes('FAILURE CATEGORIES'), 'help shows failure categories');
  assert(res.stdout.includes('database foundation'), 'help mentions database foundation category');
  assert(res.stdout.includes('dependency/generate'), 'help mentions dependency/generate category');
}

// Invalid args
console.log('\ninvalid arguments');
{
  const res = run(['--bogus']);
  assert(res.code === 2, 'unknown flag exits 2');
}

// Combined flags
console.log('\ncombined --quick --full');
{
  const res = run(['--quick', '--full']);
  assert(res.code === 2, 'combined flags exits 2');
}

// Quick mode
console.log('\n--quick mode');
{
  const res = run(['--quick']);
  assert(res.stdout.includes('Post-merge health gate [quick]'), 'shows quick mode header');
  assert(res.stdout.includes('npm run check'), 'runs tsc check');
  assert(res.stdout.includes('npm run build'), 'runs build');
}

// Default (no args) behaves like --quick
console.log('\ndefault mode (no args)');
{
  const res = run([]);
  assert(res.stdout.includes('Post-merge health gate [quick]'), 'default is quick mode');
}

// --- Prisma client error classification (unit tests) ---
console.log('\nPrisma client error classification');
{
  const { categorize, refineCategory } = require(SCRIPT);

  // Label-based categorization still works
  assert(categorize('npm run check') === 'conflict refresh', 'tsc label → conflict refresh');
  assert(categorize('npm run build') === 'runtime compile', 'build label → runtime compile');
  assert(categorize('npm run test:boundary') === 'boundary guard', 'boundary label → boundary guard');

  // Prisma error patterns re-classify to dependency/generate
  const prismaOutputs = [
    'error TS2305: Module "@prisma/client" has no exported member PrismaClient',
    "Cannot find module '@prisma/client' from 'src/database'",
    "Cannot find module 'prisma/config' from 'node_modules/@prisma/client'",
    "Property '$connect' does not exist on type 'PrismaClient'",
    "Property '$disconnect' does not exist on type 'typeof PrismaClient'",
  ];

  for (const output of prismaOutputs) {
    const result = refineCategory('runtime compile', output);
    assert(result === 'dependency/generate',
      `Prisma pattern re-classified: "${output.substring(0, 60)}..." → dependency/generate`);
  }

  // Non-Prisma errors are not re-classified
  assert(refineCategory('runtime compile', 'error TS2322: Type string is not assignable') === 'runtime compile',
    'non-Prisma TS error stays runtime compile');
  assert(refineCategory('conflict refresh', 'src/app.ts(10,5): error TS1005') === 'conflict refresh',
    'non-Prisma conflict stays conflict refresh');

  // Empty/undefined output returns original category
  assert(refineCategory('test env', '') === 'test env', 'empty output returns original');
  assert(refineCategory('test env', undefined) === 'test env', 'undefined output returns original');
}

// --- Guard integration tests ---
console.log('\nGuard integration');
{
  const { GUARD_SCRIPTS, detectAvailableGuards } = require(SCRIPT);

  // GUARD_SCRIPTS defines the expected guards
  assert(typeof GUARD_SCRIPTS === 'object', 'GUARD_SCRIPTS is an object');
  assert('task boundary' in GUARD_SCRIPTS, 'defines task boundary guard');
  assert('pr handoff' in GUARD_SCRIPTS, 'defines pr handoff guard');
  assert('docs authority' in GUARD_SCRIPTS, 'defines docs authority guard');

  // Each guard has required properties
  for (const [name, guard] of Object.entries(GUARD_SCRIPTS)) {
    assert(typeof guard.script === 'string', `${name} has script path`);
    assert(typeof guard.hasInputs === 'function', `${name} has hasInputs function`);
    assert(typeof guard.buildArgs === 'function', `${name} has buildArgs function`);
    assert(Array.isArray(guard.buildArgs()), `${name} buildArgs returns array`);
  }

  // detectAvailableGuards returns an array
  const available = detectAvailableGuards();
  assert(Array.isArray(available), 'detectAvailableGuards returns array');

  // docs authority guard should be available (docs/ directory exists)
  assert(available.some(g => g.name === 'docs authority'),
    'docs authority guard is available when docs/ exists');
}

// Help mentions guard warnings
console.log('\n--help flag (guard section)');
{
  const res = run(['--help']);
  assert(res.code === 0, '--help exits 0');
  assert(res.stdout.includes('GUARD WARNINGS'), 'help mentions GUARD WARNINGS section');
  assert(res.stdout.includes('task boundary'), 'help mentions task boundary guard');
  assert(res.stdout.includes('pr handoff'), 'help mentions pr handoff guard');
  assert(res.stdout.includes('docs authority'), 'help mentions docs authority guard');
  assert(res.stdout.includes('non-blocking'), 'help states guards are non-blocking');
}

// --- Summary ---
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
