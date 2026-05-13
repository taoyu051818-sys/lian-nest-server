import * as fs from 'fs';
import * as path from 'path';

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

const SRC_ROOT = path.resolve(__dirname, '..');
const REPOSITORIES_DIR = path.resolve(__dirname);

// Feature slices: business modules that must use repository interfaces.
// Keep in sync with scripts/check-repository-boundary.js and
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
const INFRA_ALLOWLIST: { dir: string; packages: string[] }[] = [
  { dir: path.join(SRC_ROOT, 'database'), packages: ['@prisma/client', 'prisma'] },
  { dir: path.join(SRC_ROOT, 'redis'), packages: ['ioredis', 'redis'] },
];

function isAllowedByInfraAllowlist(filePath: string, pkg: string): boolean {
  return INFRA_ALLOWLIST.some(
    (entry) => entry.packages.includes(pkg) && filePath.startsWith(entry.dir + path.sep),
  );
}

function featureSliceFor(filePath: string): string | null {
  const rel = path.relative(SRC_ROOT, filePath);
  const topDir = rel.split(path.sep)[0];
  return FEATURE_SLICES.includes(topDir) ? topDir : null;
}

function packageImportPattern(pkg: string): RegExp {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  return new RegExp(`(?:from\\s+|import\\s+|require\\s*\\()\\s*['"]${escaped}['"]`);
}

function collectTsFiles(dir: string, excludeDirs: Set<string>): string[] {
  const results: string[] = [];
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

describe('repository boundary', () => {
  let outsideFiles: string[];

  beforeAll(() => {
    const exclude = new Set([REPOSITORIES_DIR]);
    outsideFiles = collectTsFiles(SRC_ROOT, exclude);
  });

  it('no file outside src/repositories imports a data-store driver', () => {
    const violations: string[] = [];
    for (const file of outsideFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pkg of FORBIDDEN_PACKAGES) {
        if (packageImportPattern(pkg).test(content) && !isAllowedByInfraAllowlist(file, pkg)) {
          violations.push(`${path.relative(SRC_ROOT, file)} imports ${pkg}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no file outside src/repositories imports Node fs modules', () => {
    const violations: string[] = [];
    for (const file of outsideFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const mod of FORBIDDEN_NODE_MODULES) {
        if (packageImportPattern(mod).test(content) && !isAllowedByInfraAllowlist(file, mod)) {
          violations.push(`${path.relative(SRC_ROOT, file)} imports ${mod}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('files inside src/repositories may import any package', () => {
    const repoFiles = collectTsFiles(REPOSITORIES_DIR, new Set());
    expect(repoFiles.length).toBeGreaterThan(0);
  });

  it.each(FEATURE_SLICES)(
    'feature slice "%s" does not import data-store drivers directly',
    (slice) => {
      const sliceDir = path.join(SRC_ROOT, slice);
      if (!fs.existsSync(sliceDir)) return; // slice not yet created

      const sliceFiles = collectTsFiles(sliceDir, new Set());
      const violations: string[] = [];

      for (const file of sliceFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const pkg of [...FORBIDDEN_PACKAGES, ...FORBIDDEN_NODE_MODULES]) {
          if (packageImportPattern(pkg).test(content) && !isAllowedByInfraAllowlist(file, pkg)) {
            violations.push(`${path.basename(file)} imports ${pkg}`);
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );

  it('feature slice list is non-empty', () => {
    expect(FEATURE_SLICES.length).toBeGreaterThan(0);
  });
});
