#!/usr/bin/env node

/**
 * check-task-boundary.test.js
 *
 * Self-contained tests for the task boundary guard.
 * Run: node scripts/guards/check-task-boundary.test.js
 *
 * No network required.  Uses only the exported checkBoundary / matchesAny
 * functions — no child_process spawn of the CLI.
 */

const { checkBoundary, matchesAny, globToRegex } = require('./check-task-boundary');

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

function assertEq(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
  assert(ok, message);
}

// ---------------------------------------------------------------------------
console.log('check-task-boundary.js tests');
console.log('='.repeat(60));

// ---- globToRegex unit tests ------------------------------------------------
console.log('\n-- globToRegex');

{
  const re = globToRegex('src/**');
  assert(re.test('src/app.ts'), 'src/** matches src/app.ts');
  assert(re.test('src/deep/nested/file.ts'), 'src/** matches src/deep/nested/file.ts');
  assert(!re.test('other/file.ts'), 'src/** does not match other/file.ts');
}

{
  const re = globToRegex('*.json');
  assert(re.test('package.json'), '*.json matches package.json');
  assert(!re.test('src/package.json'), '*.json does not match src/package.json');
}

{
  const re = globToRegex('scripts/guards/check-task-boundary.js');
  assert(re.test('scripts/guards/check-task-boundary.js'), 'exact match works');
  assert(!re.test('scripts/guards/check-task-boundary.test.js'), 'exact match rejects similar');
}

{
  const re = globToRegex('src/**/*.spec.ts');
  assert(re.test('src/app.spec.ts'), 'src/**/*.spec.ts matches src/app.spec.ts');
  assert(re.test('src/deep/app.spec.ts'), 'src/**/*.spec.ts matches src/deep/app.spec.ts');
  assert(!re.test('src/app.ts'), 'src/**/*.spec.ts does not match src/app.ts');
}

// ---- matchesAny unit tests -------------------------------------------------
console.log('\n-- matchesAny');

{
  const patterns = ['src/**', 'prisma/**'];
  assert(matchesAny('src/app.ts', patterns), 'matchesAny hits src/**');
  assert(matchesAny('prisma/schema.prisma', patterns), 'matchesAny hits prisma/**');
  assert(!matchesAny('package.json', patterns), 'matchesAny misses package.json');
}

// ---- checkBoundary: all files allowed (PASS) -------------------------------
console.log('\n-- checkBoundary: all files allowed');

{
  const changed = ['scripts/guards/check-task-boundary.js', 'scripts/guards/check-task-boundary.test.js'];
  const allowed = ['scripts/guards/check-task-boundary.js', 'scripts/guards/check-task-boundary.test.js'];
  const forbidden = ['src/**', 'prisma/**', 'package.json'];

  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === true, 'pass is true when only allowed files changed');
  assertEq(result.violations, [], 'no violations when only allowed files changed');
}

// ---- checkBoundary: forbidden file touched (FAIL) --------------------------
console.log('\n-- checkBoundary: forbidden file touched');

{
  const changed = ['scripts/guards/check-task-boundary.js', 'src/app.ts'];
  const allowed = ['scripts/guards/**'];
  const forbidden = ['src/**'];

  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === false, 'pass is false when forbidden file touched');
  assert(result.violations.length === 1, 'one violation reported');
  assertEq(result.violations[0].file, 'src/app.ts', 'violation file is src/app.ts');
  assertEq(result.violations[0].reason, 'forbidden', 'reason is forbidden');
}

// ---- checkBoundary: file outside allowed (FAIL) ----------------------------
console.log('\n-- checkBoundary: file outside allowed');

{
  const changed = ['scripts/guards/check-task-boundary.js', 'docs/README.md'];
  const allowed = ['scripts/guards/check-task-boundary.js'];
  const forbidden = ['src/**'];

  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === false, 'pass is false when file outside allowed');
  assert(result.violations.length === 1, 'one violation for outside-allowed');
  assertEq(result.violations[0].file, 'docs/README.md', 'violation file is docs/README.md');
  assertEq(result.violations[0].reason, 'outside-allowed', 'reason is outside-allowed');
}

// ---- checkBoundary: empty changed list (PASS) ------------------------------
console.log('\n-- checkBoundary: empty changed list');

{
  const result = checkBoundary([], ['src/**'], ['prisma/**']);
  assert(result.pass === true, 'pass is true with no changed files');
  assertEq(result.violations, [], 'no violations with no changed files');
}

// ---- checkBoundary: multiple violations ------------------------------------
console.log('\n-- checkBoundary: multiple violations');

{
  const changed = ['src/app.ts', 'prisma/schema.prisma', 'package.json'];
  const allowed = ['scripts/**'];
  const forbidden = ['src/**', 'prisma/**', 'package.json'];

  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === false, 'pass is false with multiple violations');
  assert(result.violations.length === 3, 'three violations reported');
  assert(result.violations.every((v) => v.reason === 'forbidden'), 'all violations are forbidden');
}

// ---- checkBoundary: OS path normalisation ----------------------------------
console.log('\n-- checkBoundary: backslash paths');

{
  const changed = ['scripts\\guards\\check-task-boundary.js'];
  const allowed = ['scripts/guards/check-task-boundary.js'];
  const forbidden = ['src/**'];

  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === true, 'backslash paths normalised to forward-slash');
}

// ---- checkBoundary: wildcard in allowed works correctly --------------------
console.log('\n-- checkBoundary: wildcard allowed');

{
  const changed = ['scripts/guards/check-task-boundary.js', 'scripts/guards/check-task-boundary.test.js'];
  const allowed = ['scripts/guards/**'];
  const forbidden = ['src/**', 'prisma/**', 'package.json'];

  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === true, 'wildcard allowed matches both guard files');
}

// ---- Summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
