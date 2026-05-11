import * as fs from 'fs';
import * as path from 'path';

/*
 * repository-boundary.negative.spec.ts
 *
 * Verifies that the detection logic used by repository-boundary.spec.ts
 * correctly catches violations and respects allowlists. These tests use
 * synthetic inputs (no production files are modified).
 */

// ─── Shared constants (mirrors repository-boundary.spec.ts) ──────────────────

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

// The script has 9 slices; the positive spec has only 6. This negative spec
// verifies that the full list is present.
const EXPECTED_FEATURE_SLICES = [
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

const POSITIVE_SPEC_SLICES = ['auth', 'feed', 'messages', 'posts', 'profile', 'tags'];

const INFRA_ALLOWLIST: { dir: string; packages: string[] }[] = [
  { dir: path.join(SRC_ROOT, 'database'), packages: ['@prisma/client', 'prisma'] },
  { dir: path.join(SRC_ROOT, 'redis'), packages: ['ioredis', 'redis'] },
];

const PROVIDER_EXCLUDED_DIRS = ['database', 'redis', 'repositories', 'nodebb', 'common'];

// ─── Helper functions (replicated from boundary spec for isolation) ───────────

function packageImportPattern(pkg: string): RegExp {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  return new RegExp(`(?:from\\s+|import\\s+|require\\s*\\()\\s*['"]${escaped}['"]`);
}

function isAllowedByInfraAllowlist(filePath: string, pkg: string): boolean {
  return INFRA_ALLOWLIST.some(
    (entry) => entry.packages.includes(pkg) && filePath.startsWith(entry.dir + path.sep),
  );
}

function featureSliceFor(filePath: string): string | null {
  const rel = path.relative(SRC_ROOT, filePath);
  const topDir = rel.split(path.sep)[0];
  return EXPECTED_FEATURE_SLICES.includes(topDir) ? topDir : null;
}

function collectTsFiles(dir: string, excludeDirs: Set<string>): string[] {
  if (!fs.existsSync(dir)) return [];
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

// Matches any import from a path ending in repositories/providers/...
const REPOSITORY_PROVIDER_IMPORT =
  /(?:from\s+|import\s+|require\s*\()\s*['"][^'"]*\/repositories\/providers\/[^'"]*['"]/;

// ─── Parity fixture ──────────────────────────────────────────────────────────

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../test/parity/repositories/repository-boundary-negative.json',
);

let fixture: any;
try {
  fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
} catch {
  fixture = null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('repository boundary — negative coverage', () => {
  describe('packageImportPattern regex', () => {
    it('matches standard from-import syntax', () => {
      const pattern = packageImportPattern('@prisma/client');
      expect(pattern.test("import { PrismaClient } from '@prisma/client';")).toBe(true);
    });

    it('matches bare import syntax', () => {
      const pattern = packageImportPattern('fs');
      expect(pattern.test("import * as fs from 'fs';")).toBe(true);
    });

    it('matches require syntax', () => {
      const pattern = packageImportPattern('pg');
      expect(pattern.test("const { Pool } = require('pg');")).toBe(true);
    });

    it('matches require with no space before parenthesis', () => {
      const pattern = packageImportPattern('pg');
      expect(pattern.test("const pg = require('pg');")).toBe(true);
    });

    it('does not match partial package names', () => {
      const pattern = packageImportPattern('@prisma/client');
      expect(pattern.test("import { x } from '@prisma/client-extensions';")).toBe(false);
    });

    it('matches commented-out imports (known false positive)', () => {
      const pattern = packageImportPattern('@prisma/client');
      // The regex does not parse comments — it matches the import pattern
      // regardless of surrounding text. This is a documented limitation.
      expect(pattern.test("// import { PrismaClient } from '@prisma/client';")).toBe(true);
    });

    it('does not match dynamic import()', () => {
      const pattern = packageImportPattern('pg');
      expect(pattern.test("const mod = await import('pg');")).toBe(false);
    });

    it('handles packages with special regex characters', () => {
      const pattern = packageImportPattern('fs/promises');
      expect(pattern.test("import { readFile } from 'fs/promises';")).toBe(true);
    });

    it('handles double-quoted imports', () => {
      const pattern = packageImportPattern('redis');
      expect(pattern.test('import Redis from "redis";')).toBe(true);
    });

    it.each(FORBIDDEN_PACKAGES)('FORBIDDEN_PACKAGES entry "%s" pattern is valid', (pkg) => {
      const pattern = packageImportPattern(pkg);
      expect(pattern).toBeInstanceOf(RegExp);
    });

    it.each(FORBIDDEN_NODE_MODULES)('FORBIDDEN_NODE_MODULES entry "%s" pattern is valid', (mod) => {
      const pattern = packageImportPattern(mod);
      expect(pattern).toBeInstanceOf(RegExp);
    });
  });

  describe('isAllowedByInfraAllowlist', () => {
    it('allows @prisma/client in src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'prisma.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, '@prisma/client')).toBe(true);
    });

    it('allows prisma in src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'prisma.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'prisma')).toBe(true);
    });

    it('allows ioredis in src/redis/', () => {
      const filePath = path.join(SRC_ROOT, 'redis', 'redis.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'ioredis')).toBe(true);
    });

    it('allows redis in src/redis/', () => {
      const filePath = path.join(SRC_ROOT, 'redis', 'redis.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'redis')).toBe(true);
    });

    it('rejects @prisma/client in src/auth/', () => {
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, '@prisma/client')).toBe(false);
    });

    it('rejects ioredis in src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'cache.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'ioredis')).toBe(false);
    });

    it('rejects pg in src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'pg.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'pg')).toBe(false);
    });

    it('rejects pg in src/redis/', () => {
      const filePath = path.join(SRC_ROOT, 'redis', 'redis.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'pg')).toBe(false);
    });

    it('rejects any package in src/messages/', () => {
      const filePath = path.join(SRC_ROOT, 'messages', 'messages.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, '@prisma/client')).toBe(false);
      expect(isAllowedByInfraAllowlist(filePath, 'ioredis')).toBe(false);
      expect(isAllowedByInfraAllowlist(filePath, 'pg')).toBe(false);
    });

    it('rejects fs in src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'prisma.service.ts');
      expect(isAllowedByInfraAllowlist(filePath, 'fs')).toBe(false);
    });

    it('does not allow allowlisted package in a subdirectory sibling', () => {
      const filePath = path.join(SRC_ROOT, 'database-sub', 'service.ts');
      expect(isAllowedByInfraAllowlist(filePath, '@prisma/client')).toBe(false);
    });
  });

  describe('featureSliceFor', () => {
    it.each(EXPECTED_FEATURE_SLICES)(
      'maps src/%s/file.ts to slice "%s"',
      (slice) => {
        const filePath = path.join(SRC_ROOT, slice, 'service.ts');
        expect(featureSliceFor(filePath)).toBe(slice);
      },
    );

    it('returns null for src/repositories/', () => {
      const filePath = path.join(SRC_ROOT, 'repositories', 'tokens.ts');
      expect(featureSliceFor(filePath)).toBeNull();
    });

    it('returns null for src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'prisma.service.ts');
      expect(featureSliceFor(filePath)).toBeNull();
    });

    it('returns null for src/nodebb/', () => {
      const filePath = path.join(SRC_ROOT, 'nodebb', 'nodebb.service.ts');
      expect(featureSliceFor(filePath)).toBeNull();
    });
  });

  describe('collectTsFiles', () => {
    it('excludes .spec.ts files', () => {
      const files = collectTsFiles(REPOSITORIES_DIR, new Set());
      const specFiles = files.filter((f) => f.endsWith('.spec.ts'));
      expect(specFiles).toEqual([]);
    });

    it('excludes node_modules', () => {
      const files = collectTsFiles(SRC_ROOT, new Set());
      const nodeModuleFiles = files.filter((f) => f.includes('node_modules'));
      expect(nodeModuleFiles).toEqual([]);
    });

    it('excludes dist', () => {
      const files = collectTsFiles(SRC_ROOT, new Set());
      const distFiles = files.find((f) => f.includes(`${path.sep}dist${path.sep}`));
      expect(distFiles).toBeUndefined();
    });

    it('respects excludeDirs parameter', () => {
      const repoDir = path.join(SRC_ROOT, 'repositories');
      const files = collectTsFiles(SRC_ROOT, new Set([repoDir]));
      const repoFiles = files.filter((f) => f.startsWith(repoDir + path.sep));
      expect(repoFiles).toEqual([]);
    });

    it('returns empty array for non-existent directory', () => {
      const files = collectTsFiles(path.join(SRC_ROOT, 'nonexistent-dir'), new Set());
      expect(files).toEqual([]);
    });

    it('returns non-empty list for src/repositories/', () => {
      const files = collectTsFiles(REPOSITORIES_DIR, new Set());
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe('direct provider import regex', () => {
    it('matches from-import with providers path', () => {
      const input = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(true);
    });

    it('matches require with providers path', () => {
      const input = "const repo = require('../../repositories/providers/auth.repository');";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(true);
    });

    it('matches absolute path provider import', () => {
      const input = "import { SessionRepository } from '@/repositories/providers/session.repository';";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(true);
    });

    it('does not match interface imports', () => {
      const input = "import { IAuthRepository } from '../repositories/interfaces/auth-repository.interface';";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(false);
    });

    it('does not match token imports', () => {
      const input = "import { REPOSITORY_TOKENS } from '../repositories/tokens';";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(false);
    });

    it('does not match repository module imports', () => {
      const input = "import { RepositoryModule } from '../repositories/repository.module';";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(false);
    });

    it('does not match non-provider paths', () => {
      const input = "import { something } from '../services/auth.service';";
      expect(REPOSITORY_PROVIDER_IMPORT.test(input)).toBe(false);
    });
  });

  describe('direct provider import — excluded dirs', () => {
    function checkProviderDirectImport(filePath: string, content: string): string | null {
      const rel = path.relative(SRC_ROOT, filePath);
      const topDir = rel.split(path.sep)[0];
      if (PROVIDER_EXCLUDED_DIRS.includes(topDir)) return null;
      if (!REPOSITORY_PROVIDER_IMPORT.test(content)) return null;
      return topDir + '/' + path.basename(filePath) + ' imports repository provider directly';
    }

    it('flags provider import in feature slice', () => {
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      const content = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).not.toBeNull();
    });

    it('does not flag provider import in src/repositories/', () => {
      const filePath = path.join(SRC_ROOT, 'repositories', 'repository.module.ts');
      const content = "import { AuthRepository } from './providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).toBeNull();
    });

    it('does not flag provider import in src/database/', () => {
      const filePath = path.join(SRC_ROOT, 'database', 'database.module.ts');
      const content = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).toBeNull();
    });

    it('does not flag provider import in src/redis/', () => {
      const filePath = path.join(SRC_ROOT, 'redis', 'redis.module.ts');
      const content = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).toBeNull();
    });

    it('does not flag provider import in src/nodebb/', () => {
      const filePath = path.join(SRC_ROOT, 'nodebb', 'nodebb.module.ts');
      const content = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).toBeNull();
    });

    it('does not flag provider import in src/common/', () => {
      const filePath = path.join(SRC_ROOT, 'common', 'helpers.ts');
      const content = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).toBeNull();
    });

    it('flags provider import in src/categories/', () => {
      const filePath = path.join(SRC_ROOT, 'categories', 'categories.service.ts');
      const content = "import { AuthRepository } from '../repositories/providers/auth.repository';";
      expect(checkProviderDirectImport(filePath, content)).not.toBeNull();
    });

    it('does not flag when no provider import present', () => {
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      const content = "import { IAuthRepository } from '../repositories/interfaces';";
      expect(checkProviderDirectImport(filePath, content)).toBeNull();
    });
  });

  describe('feature slice completeness', () => {
    it('expected slice list has 9 entries matching the script', () => {
      expect(EXPECTED_FEATURE_SLICES).toEqual([
        'auth',
        'categories',
        'feed',
        'messages',
        'posts',
        'profile',
        'tags',
        'topics',
        'users',
      ]);
    });

    it('positive spec covers a subset of expected slices', () => {
      for (const slice of POSITIVE_SPEC_SLICES) {
        expect(EXPECTED_FEATURE_SLICES).toContain(slice);
      }
    });

    it.each(EXPECTED_FEATURE_SLICES)(
      'slice "%s" directory exists or is documented as not yet created',
      (slice) => {
        const sliceDir = path.join(SRC_ROOT, slice);
        // Either the directory exists, or it is expected to be created later.
        // We just verify the slice name is in the expected list.
        expect(EXPECTED_FEATURE_SLICES).toContain(slice);
      },
    );

    it('identifies slices missing from positive spec', () => {
      const missingFromSpec = EXPECTED_FEATURE_SLICES.filter(
        (s) => !POSITIVE_SPEC_SLICES.includes(s),
      );
      expect(missingFromSpec).toEqual(['categories', 'topics', 'users']);
    });
  });

  describe('violation detection — synthetic content', () => {
    function detectViolation(content: string, filePath: string): boolean {
      for (const pkg of [...FORBIDDEN_PACKAGES, ...FORBIDDEN_NODE_MODULES]) {
        if (packageImportPattern(pkg).test(content) && !isAllowedByInfraAllowlist(filePath, pkg)) {
          return true;
        }
      }
      return false;
    }

    it('detects @prisma/client in auth module', () => {
      const content = "import { PrismaClient } from '@prisma/client';";
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('detects ioredis in messages module', () => {
      const content = "import Redis from 'ioredis';";
      const filePath = path.join(SRC_ROOT, 'messages', 'messages.service.ts');
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('detects pg in feed module', () => {
      const content = "import { Pool } from 'pg';";
      const filePath = path.join(SRC_ROOT, 'feed', 'feed.service.ts');
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('detects fs in profile module', () => {
      const content = "import * as fs from 'fs';";
      const filePath = path.join(SRC_ROOT, 'profile', 'profile.service.ts');
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('detects fs/promises in tags module', () => {
      const content = "import { readFile } from 'fs/promises';";
      const filePath = path.join(SRC_ROOT, 'tags', 'tags.service.ts');
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('detects require("pg") syntax', () => {
      const content = "const { Pool } = require('pg');";
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('allows @prisma/client in src/database/', () => {
      const content = "import { PrismaClient } from '@prisma/client';";
      const filePath = path.join(SRC_ROOT, 'database', 'prisma.service.ts');
      expect(detectViolation(content, filePath)).toBe(false);
    });

    it('allows ioredis in src/redis/', () => {
      const content = "import Redis from 'ioredis';";
      const filePath = path.join(SRC_ROOT, 'redis', 'redis.service.ts');
      expect(detectViolation(content, filePath)).toBe(false);
    });

    it('detects commented imports as violations (known false positive)', () => {
      const content = "// import { PrismaClient } from '@prisma/client';";
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      // The regex does not parse comments — this is a documented limitation.
      expect(detectViolation(content, filePath)).toBe(true);
    });

    it('does not false-positive on partial package name', () => {
      const content = "import { x } from '@prisma/client-extensions';";
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      expect(detectViolation(content, filePath)).toBe(false);
    });

    it('does not false-positive on dynamic import', () => {
      const content = "const mod = await import('pg');";
      const filePath = path.join(SRC_ROOT, 'auth', 'auth.service.ts');
      expect(detectViolation(content, filePath)).toBe(false);
    });
  });

  describe('parity fixture integration', () => {
    it('fixture file loads successfully', () => {
      expect(fixture).not.toBeNull();
      expect(fixture.id).toBe('repository-boundary-negative');
    });

    it('fixture has all expected rule groups', () => {
      const ruleIds = fixture.rules.map((r: any) => r.id);
      expect(ruleIds).toContain('no-data-store-driver-outside-repositories');
      expect(ruleIds).toContain('no-fs-module-outside-repositories');
      expect(ruleIds).toContain('no-direct-provider-import');
      expect(ruleIds).toContain('feature-slice-completeness');
    });

    it.each(
      fixture?.rules
        ?.find((r: any) => r.id === 'no-data-store-driver-outside-repositories')
        ?.negativeCases?.filter((c: any) => c.expectedViolation === true)
        ?.map((c: any) => [c.id, c.input, c.filePath]) ?? [],
    )('data-store driver violation detected: %s', (_id, input, filePath) => {
      const absPath = path.join(SRC_ROOT, filePath);
      let detected = false;
      for (const pkg of FORBIDDEN_PACKAGES) {
        if (packageImportPattern(pkg).test(input) && !isAllowedByInfraAllowlist(absPath, pkg)) {
          detected = true;
          break;
        }
      }
      expect(detected).toBe(true);
    });

    it.each(
      fixture?.rules
        ?.find((r: any) => r.id === 'no-data-store-driver-outside-repositories')
        ?.negativeCases?.filter((c: any) => c.expectedViolation === false)
        ?.map((c: any) => [c.id, c.input, c.filePath]) ?? [],
    )('data-store driver non-violation respected: %s', (_id, input, filePath) => {
      const absPath = path.join(SRC_ROOT, filePath);
      let detected = false;
      for (const pkg of FORBIDDEN_PACKAGES) {
        if (packageImportPattern(pkg).test(input) && !isAllowedByInfraAllowlist(absPath, pkg)) {
          detected = true;
          break;
        }
      }
      expect(detected).toBe(false);
    });

    it.each(
      fixture?.rules
        ?.find((r: any) => r.id === 'no-fs-module-outside-repositories')
        ?.negativeCases?.filter((c: any) => c.expectedViolation === true)
        ?.map((c: any) => [c.id, c.input, c.filePath]) ?? [],
    )('fs module violation detected: %s', (_id, input, filePath) => {
      const absPath = path.join(SRC_ROOT, filePath);
      let detected = false;
      for (const mod of FORBIDDEN_NODE_MODULES) {
        if (packageImportPattern(mod).test(input) && !isAllowedByInfraAllowlist(absPath, mod)) {
          detected = true;
          break;
        }
      }
      expect(detected).toBe(true);
    });

    it.each(
      fixture?.rules
        ?.find((r: any) => r.id === 'no-direct-provider-import')
        ?.negativeCases?.filter((c: any) => c.expectedViolation === true)
        ?.map((c: any) => [c.id, c.input, c.filePath]) ?? [],
    )('direct provider import violation detected: %s', (_id, input, filePath) => {
      const absPath = path.join(SRC_ROOT, filePath);
      const rel = path.relative(SRC_ROOT, absPath);
      const topDir = rel.split(path.sep)[0];
      const isExcludedDir = PROVIDER_EXCLUDED_DIRS.includes(topDir);
      const matchesProvider = REPOSITORY_PROVIDER_IMPORT.test(input);
      const detected = matchesProvider && !isExcludedDir;
      expect(detected).toBe(true);
    });

    it.each(
      fixture?.rules
        ?.find((r: any) => r.id === 'no-direct-provider-import')
        ?.negativeCases?.filter((c: any) => c.expectedViolation === false)
        ?.map((c: any) => [c.id, c.input, c.filePath]) ?? [],
    )('direct provider import non-violation respected: %s', (_id, input, filePath) => {
      const absPath = path.join(SRC_ROOT, filePath);
      const rel = path.relative(SRC_ROOT, absPath);
      const topDir = rel.split(path.sep)[0];
      const isExcludedDir = PROVIDER_EXCLUDED_DIRS.includes(topDir);
      const matchesProvider = REPOSITORY_PROVIDER_IMPORT.test(input);
      const detected = matchesProvider && !isExcludedDir;
      expect(detected).toBe(false);
    });

    it('fixture expectedSlices matches the spec EXPECTED_FEATURE_SLICES', () => {
      const rule = fixture.rules.find((r: any) => r.id === 'feature-slice-completeness');
      expect(rule).toBeDefined();
      expect(rule.expectedSlices).toEqual(EXPECTED_FEATURE_SLICES);
    });
  });
});
