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
});
