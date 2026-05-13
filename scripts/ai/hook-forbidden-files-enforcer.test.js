#!/usr/bin/env node

/**
 * hook-forbidden-files-enforcer.test.js
 *
 * Self-tests for the Claude Code PreToolUse hook that blocks
 * Write/Edit/NotebookEdit calls targeting forbidden files.
 *
 * Tests the pure matching logic (globToRegex, matchesAny) and
 * pattern loading without requiring stdin or process.exit mocks.
 *
 * Usage:
 *   node scripts/ai/hook-forbidden-files-enforcer.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

// ── Inline the matching logic for testing ────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i++;
      } else {
        const alternatives = pattern.slice(i + 1, end).split(',');
        re += '(?:' + alternatives.map(escapeRegex).join('|') + ')';
        i = end + 1;
      }
    } else {
      re += escapeRegex(c);
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesAny(filePath, patterns) {
  const normed = filePath.replace(/\\/g, '/');
  return patterns.some((pat) => globToRegex(pat).test(normed));
}

// ── Test harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`    ✓ ${label}`);
  } else {
    failed++;
    console.error(`    ✗ ${label}`);
  }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`    ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  assert(ok, label);
}

// ── Tests ────────────────────────────────────────────────────────────────

console.log('hook-forbidden-files-enforcer.test.js');
console.log('='.repeat(50));

// ── Suite 1: globToRegex basic patterns ──────────────────────────────────

suite('globToRegex: basic patterns');

assertEq(globToRegex('.env').test('.env'), true, '.env matches .env');
assertEq(globToRegex('.env').test('.env.local'), false, '.env does not match .env.local');
assertEq(globToRegex('.env.*').test('.env.local'), true, '.env.* matches .env.local');
assertEq(globToRegex('.env.*').test('.env'), false, '.env.* does not match .env');
assertEq(globToRegex('.env.*').test('.env.production'), true, '.env.* matches .env.production');

// ── Suite 2: globToRegex double-star patterns ────────────────────────────

suite('globToregex: double-star patterns');

assertEq(globToRegex('src/**').test('src/foo.ts'), true, 'src/** matches src/foo.ts');
assertEq(globToRegex('src/**').test('src/modules/auth/auth.service.ts'), true, 'src/** matches nested path');
assertEq(globToRegex('src/**').test('src/'), true, 'src/** matches src/');
assertEq(globToRegex('src/**').test('other/foo.ts'), false, 'src/** does not match other/foo.ts');
assertEq(globToRegex('node_modules/**').test('node_modules/foo/bar.js'), true, 'node_modules/** matches nested');
assertEq(globToRegex('dist/**').test('dist/build/output.js'), true, 'dist/** matches nested');

// ── Suite 3: globToRegex single-star patterns ────────────────────────────

suite('globToRegex: single-star patterns');

assertEq(globToRegex('*.ts').test('foo.ts'), true, '*.ts matches foo.ts');
assertEq(globToRegex('*.ts').test('foo.js'), false, '*.ts does not match foo.js');
assertEq(globToRegex('*.ts').test('dir/foo.ts'), false, '*.ts does not match dir/foo.ts');

// ── Suite 4: globToRegex dot files ───────────────────────────────────────

suite('globToRegex: dot files');

assertEq(globToRegex('.git/**').test('.git/config'), true, '.git/** matches .git/config');
assertEq(globToRegex('.git/**').test('.git/objects/abc'), true, '.git/** matches nested .git');
assertEq(globToRegex('.github/**').test('.github/workflows/ci.yml'), true, '.github/** matches');

// ── Suite 5: matchesAny with default forbidden patterns ──────────────────

suite('matchesAny: default forbidden patterns');

const defaults = ['.env', '.env.*', 'node_modules/**', 'dist/**', '.git/**'];

assertEq(matchesAny('.env', defaults), true, '.env is forbidden');
assertEq(matchesAny('.env.local', defaults), true, '.env.local is forbidden');
assertEq(matchesAny('.env.production', defaults), true, '.env.production is forbidden');
assertEq(matchesAny('src/app.ts', defaults), false, 'src/app.ts is not forbidden');
assertEq(matchesAny('node_modules/lodash/index.js', defaults), true, 'node_modules is forbidden');
assertEq(matchesAny('dist/bundle.js', defaults), true, 'dist is forbidden');
assertEq(matchesAny('.git/config', defaults), true, '.git is forbidden');
assertEq(matchesAny('docs/readme.md', defaults), false, 'docs is not forbidden');
assertEq(matchesAny('package.json', defaults), false, 'package.json is not in defaults');

// ── Suite 6: matchesAny with task-specific patterns ──────────────────────

suite('matchesAny: task-specific patterns');

const taskForbidden = ['src/**', 'prisma/**', '.env', '.env.*'];

assertEq(matchesAny('src/app.module.ts', taskForbidden), true, 'src/** blocks src files');
assertEq(matchesAny('src/modules/auth/auth.service.ts', taskForbidden), true, 'src/** blocks nested src');
assertEq(matchesAny('prisma/schema.prisma', taskForbidden), true, 'prisma/** blocks prisma files');
assertEq(matchesAny('prisma/migrations/20260101_init/migration.sql', taskForbidden), true, 'prisma/** blocks migrations');
assertEq(matchesAny('docs/ai-native/SOP.md', taskForbidden), false, 'docs is not forbidden');
assertEq(matchesAny('.env', taskForbidden), true, '.env is forbidden');
assertEq(matchesAny('.env.local', taskForbidden), true, '.env.local is forbidden');

// ── Suite 7: matchesAny with Windows-style paths ─────────────────────────

suite('matchesAny: Windows-style paths');

assertEq(matchesAny('src\\app.module.ts', ['src/**']), true, 'backslash path matches src/**');
assertEq(matchesAny('.env', ['.env']), true, 'dotfile matches');
assertEq(matchesAny('node_modules\\lodash\\index.js', ['node_modules/**']), true, 'backslash node_modules matches');

// ── Suite 8: matchesAny with brace expansion ─────────────────────────────

suite('matchesAny: brace expansion');

assertEq(matchesAny('src/foo.ts', ['{src,lib}/**']), true, '{src,lib}/** matches src');
assertEq(matchesAny('lib/foo.ts', ['{src,lib}/**']), true, '{src,lib}/** matches lib');
assertEq(matchesAny('dist/foo.ts', ['{src,lib}/**']), false, '{src,lib}/** does not match dist');

// ── Suite 9: matchesAny with empty patterns ──────────────────────────────

suite('matchesAny: empty patterns');

assertEq(matchesAny('src/foo.ts', []), false, 'empty patterns matches nothing');
assertEq(matchesAny('.env', []), false, 'empty patterns does not match .env');

// ── Suite 10: matchesAny with question mark ──────────────────────────────

suite('matchesAny: question mark wildcard');

assertEq(matchesAny('.env', ['.?*']), true, '.?* matches .env');
assertEq(matchesAny('.git', ['.?*']), true, '.?* matches .git');
assertEq(matchesAny('foo', ['.?*']), false, '.?* does not match foo');

// ── Suite 11: extractFilePath logic ──────────────────────────────────────

suite('extractFilePath: tool input parsing');

function extractFilePath(input) {
  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};
  if (toolName === 'Write' || toolName === 'Edit') {
    return toolInput.file_path || null;
  }
  if (toolName === 'NotebookEdit') {
    return toolInput.notebook_path || null;
  }
  return null;
}

assertEq(
  extractFilePath({ tool_name: 'Write', tool_input: { file_path: 'src/foo.ts' } }),
  'src/foo.ts',
  'Write extracts file_path'
);
assertEq(
  extractFilePath({ tool_name: 'Edit', tool_input: { file_path: 'src/bar.ts' } }),
  'src/bar.ts',
  'Edit extracts file_path'
);
assertEq(
  extractFilePath({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'notebook.ipynb' } }),
  'notebook.ipynb',
  'NotebookEdit extracts notebook_path'
);
assertEq(
  extractFilePath({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
  null,
  'Bash returns null'
);
assertEq(
  extractFilePath({ tool_name: 'Read', tool_input: { file_path: 'src/foo.ts' } }),
  null,
  'Read returns null'
);
assertEq(
  extractFilePath({ tool_name: 'Write', tool_input: {} }),
  null,
  'Write without file_path returns null'
);
assertEq(
  extractFilePath({ tool_name: 'Write' }),
  null,
  'Write without tool_input returns null'
);

// ── Suite 12: Full scenario — forbidden file blocked ─────────────────────

suite('full scenario: forbidden file detection');

{
  const patterns = ['src/**', 'prisma/**', '.env', '.env.*'];
  const testCases = [
    { file: 'src/app.module.ts', expected: true, label: 'src file blocked' },
    { file: 'prisma/schema.prisma', expected: true, label: 'prisma file blocked' },
    { file: '.env', expected: true, label: '.env blocked' },
    { file: '.env.local', expected: true, label: '.env.local blocked' },
    { file: 'docs/ai-native/SOP.md', expected: false, label: 'docs file allowed' },
    { file: 'scripts/ai/my-script.js', expected: false, label: 'scripts file allowed' },
    { file: 'README.md', expected: false, label: 'README allowed' },
  ];

  for (const tc of testCases) {
    assertEq(matchesAny(tc.file, patterns), tc.expected, tc.label);
  }
}

// ── Results ──────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
