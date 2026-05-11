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

const { checkBoundary, matchesAny, globToRegex, SHARED_LOCK_MAP } = require('./check-task-boundary');

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

// ---- SHARED_LOCK_MAP keys ---------------------------------------------------
console.log('\n-- SHARED_LOCK_MAP');

{
  const keys = Object.keys(SHARED_LOCK_MAP);
  assert(keys.includes('package'), 'SHARED_LOCK_MAP has "package" lock');
  assert(keys.includes('prisma-schema'), 'SHARED_LOCK_MAP has "prisma-schema" lock');
  assert(keys.includes('app-module'), 'SHARED_LOCK_MAP has "app-module" lock');
  assert(keys.includes('docs-index'), 'SHARED_LOCK_MAP has "docs-index" lock');
}

// ---- checkBoundary: sharedLocks allows normally-forbidden file ---------------
console.log('\n-- checkBoundary: sharedLocks allows forbidden file');

{
  const changed = ['package.json'];
  const allowed = ['scripts/**'];
  const forbidden = ['package.json', 'package-lock.json'];

  // Without sharedLocks → forbidden
  const noLock = checkBoundary(changed, allowed, forbidden);
  assert(noLock.pass === false, 'package.json forbidden without sharedLocks');

  // With sharedLocks → allowed
  const withLock = checkBoundary(changed, allowed, forbidden, { sharedLocks: ['package'] });
  assert(withLock.pass === true, 'package.json allowed with "package" sharedLock');
  assertEq(withLock.sharedLocks, ['package'], 'sharedLocks echoed in result');
}

// ---- checkBoundary: undeclared lock does not exempt -------------------------
console.log('\n-- checkBoundary: undeclared lock does not exempt');

{
  const changed = ['prisma/schema.prisma'];
  const allowed = ['scripts/**'];
  const forbidden = ['prisma/**'];

  const result = checkBoundary(changed, allowed, forbidden, { sharedLocks: ['package'] });
  assert(result.pass === false, 'prisma file still forbidden when only "package" lock declared');
  assertEq(result.violations[0].reason, 'forbidden', 'reason is forbidden');
}

// ---- checkBoundary: multiple sharedLocks ------------------------------------
console.log('\n-- checkBoundary: multiple sharedLocks');

{
  const changed = ['package.json', 'prisma/schema.prisma'];
  const allowed = ['scripts/**'];
  const forbidden = ['package.json', 'prisma/**'];

  const result = checkBoundary(changed, allowed, forbidden, { sharedLocks: ['package', 'prisma-schema'] });
  assert(result.pass === true, 'both files allowed with two sharedLocks');
  assertEq(result.sharedLocks, ['package', 'prisma-schema'], 'both locks in result');
}

// ---- checkBoundary: sharedLocks absent (backward compat) --------------------
console.log('\n-- checkBoundary: sharedLocks absent');

{
  const changed = ['scripts/guards/check-task-boundary.js'];
  const allowed = ['scripts/guards/**'];
  const forbidden = ['src/**'];

  // Call with 3 args (no options) — must not throw
  const result = checkBoundary(changed, allowed, forbidden);
  assert(result.pass === true, 'works without options argument');
  assertEq(result.sharedLocks, [], 'sharedLocks defaults to empty array');
}

// ---- checkBoundary: sharedLocks empty array ---------------------------------
console.log('\n-- checkBoundary: sharedLocks empty array');

{
  const changed = ['package.json'];
  const allowed = ['scripts/**'];
  const forbidden = ['package.json'];

  const result = checkBoundary(changed, allowed, forbidden, { sharedLocks: [] });
  assert(result.pass === false, 'empty sharedLocks does not exempt forbidden files');
  assertEq(result.sharedLocks, [], 'sharedLocks is empty array');
}

// ---- checkBoundary: app-module lock allows app.module.ts ---------------------
console.log('\n-- checkBoundary: app-module lock');

{
  const changed = ['src/app.module.ts'];
  const allowed = ['scripts/**'];
  const forbidden = ['src/**'];

  const result = checkBoundary(changed, allowed, forbidden, { sharedLocks: ['app-module'] });
  assert(result.pass === true, 'app.module.ts allowed with "app-module" sharedLock');
}

// ---- checkBoundary: docs-index lock allows docs markdown --------------------
console.log('\n-- checkBoundary: docs-index lock');

{
  const changed = ['docs/ai-native/parallel-work-policy.md'];
  const allowed = ['scripts/**'];
  const forbidden = ['docs/**'];

  const result = checkBoundary(changed, allowed, forbidden, { sharedLocks: ['docs-index'] });
  assert(result.pass === true, 'docs md allowed with "docs-index" sharedLock');
}

// ---- checkBoundary: unknown lock name has no effect -------------------------
console.log('\n-- checkBoundary: unknown lock name');

{
  const changed = ['package.json'];
  const allowed = ['scripts/**'];
  const forbidden = ['package.json'];

  const result = checkBoundary(changed, allowed, forbidden, { sharedLocks: ['nonexistent-lock'] });
  assert(result.pass === false, 'unknown lock name does not exempt forbidden files');
}

// ---- Summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
