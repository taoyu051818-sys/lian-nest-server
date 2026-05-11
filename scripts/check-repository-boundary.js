#!/usr/bin/env node

/**
 * check-repository-boundary.js
 *
 * Scans .ts source files outside src/repositories/ and fails if any import
 * a forbidden data-store driver or Node fs module.
 *
 * Run standalone: node scripts/check-repository-boundary.js
 * Run via npm:    npm run test:boundary
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'src');
const REPOSITORIES_DIR = path.join(SRC_ROOT, 'repositories');

const FORBIDDEN_PACKAGES = [
  '@prisma/client',
  'prisma',
  'ioredis',
  'redis',
  'pg',
  'mysql2',
  'better-sqlite3',
];

const FORBIDDEN_NODE_MODULES = ['fs', 'fs/promises'];

function packageImportPattern(pkg) {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(
    '(?:from\\s+|import\\s+|require\\s*\\()\\s*[\'"]' + escaped + '[\'"]'
  );
}

function collectTsFiles(dir, excludeDirs) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludeDirs.has(fullPath)) {
        results.push(...collectTsFiles(fullPath, excludeDirs));
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function check() {
  const exclude = new Set([REPOSITORIES_DIR]);
  const files = collectTsFiles(SRC_ROOT, exclude);
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const pkg of [...FORBIDDEN_PACKAGES, ...FORBIDDEN_NODE_MODULES]) {
      if (packageImportPattern(pkg).test(content)) {
        violations.push(path.relative(ROOT, file) + ' imports ' + pkg);
      }
    }
  }

  return violations;
}

// --- Main ---

const violations = check();

if (violations.length === 0) {
  console.log('Repository boundary check passed.');
  process.exit(0);
}

console.error('Repository boundary violations found:\n');
for (const v of violations) {
  console.error('  - ' + v);
}
console.error(
  '\nStorage drivers must be imported only inside src/repositories/.\n' +
  'See docs/architecture/repository-boundary-guard.md'
);
process.exit(1);
