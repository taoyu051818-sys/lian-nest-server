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

// Feature slices: business modules that must use repository interfaces,
// never data-store drivers directly. Keep this list in sync with
// docs/ai-native/backend-worker-layers.md § Feature Slices.
const FEATURE_SLICES = [
  'auth',
  'categories',
  'feed',
  'messages',
  'posts',
  'profile',
  'tags',
  'topics',
  'users',
];

// Narrow infrastructure allowlist: specific packages permitted in specific directories.
// Business modules remain forbidden from importing these directly.
const INFRA_ALLOWLIST = [
  { dir: path.join(SRC_ROOT, 'database'), packages: ['@prisma/client', 'prisma'] },
  { dir: path.join(SRC_ROOT, 'redis'), packages: ['ioredis', 'redis'] },
];

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

function isAllowedByInfraAllowlist(filePath, pkg) {
  return INFRA_ALLOWLIST.some(
    (entry) => entry.packages.includes(pkg) && filePath.startsWith(entry.dir + path.sep)
  );
}

function featureSliceFor(filePath) {
  const rel = path.relative(SRC_ROOT, filePath);
  const topDir = rel.split(path.sep)[0];
  return FEATURE_SLICES.includes(topDir) ? topDir : null;
}

// Matches any import from a path ending in repositories/providers/...
const REPOSITORY_PROVIDER_IMPORT = /(?:from\s+|import\s+|require\s*\()\s*['"][^'"]*\/repositories\/providers\/[^'"]*['"]/;

function checkProviderDirectImport(filePath, content) {
  const rel = path.relative(SRC_ROOT, filePath);
  const topDir = rel.split(path.sep)[0];
  // Only flag feature slices and other business modules (not infrastructure wrappers)
  if (['database', 'redis', 'repositories', 'nodebb', 'common'].includes(topDir)) return null;
  if (!REPOSITORY_PROVIDER_IMPORT.test(content)) return null;
  const label = FEATURE_SLICES.includes(topDir)
    ? 'feature-slice/' + topDir + '/' + path.basename(filePath)
    : rel;
  return label + ' imports repository provider directly — use @Inject(REPOSITORY_TOKENS.*)';
}

function check() {
  const exclude = new Set([REPOSITORIES_DIR]);
  const files = collectTsFiles(SRC_ROOT, exclude);
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Check 1: forbidden data-store driver packages
    for (const pkg of [...FORBIDDEN_PACKAGES, ...FORBIDDEN_NODE_MODULES]) {
      if (packageImportPattern(pkg).test(content)) {
        if (!isAllowedByInfraAllowlist(file, pkg)) {
          const slice = featureSliceFor(file);
          const label = slice
            ? 'feature-slice/' + slice + '/' + path.basename(file)
            : path.relative(ROOT, file);
          violations.push(label + ' imports ' + pkg);
        }
      }
    }

    // Check 2: direct repository provider imports (module-import regression)
    const providerViolation = checkProviderDirectImport(file, content);
    if (providerViolation) violations.push(providerViolation);
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
  '\nStorage drivers must be imported only inside src/repositories/,\n' +
  'src/database/ (Prisma), or src/redis/ (ioredis).\n' +
  'Feature slices (' + FEATURE_SLICES.join(', ') + ') must use repository interfaces.\n' +
  'Feature modules must not import repository providers directly — use @Inject(REPOSITORY_TOKENS.*).\n' +
  'See docs/architecture/repository-boundary-guard.md'
);
process.exit(1);
