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

// --- Summary ---
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
