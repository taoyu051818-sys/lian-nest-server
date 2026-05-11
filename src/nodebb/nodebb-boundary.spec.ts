import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

// Patterns that signal a direct HTTP call to NodeBB from outside the module.
const FORBIDDEN_MODULES = ['http', 'https', 'node-fetch', 'axios', 'got'];
const FORBIDDEN_IMPORT_RE = new RegExp(
  `(?:require\\s*\\(\\s*['"](${FORBIDDEN_MODULES.join('|')})['"]\\s*\\)|from\\s+['"](${FORBIDDEN_MODULES.join('|')})['"])`,
  'g',
);

function walkTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function isInsideNodebb(filePath: string): boolean {
  const relative = path.relative(SRC_ROOT, filePath).replace(/\\/g, '/');
  return relative.startsWith('nodebb/') || relative.startsWith('nodebb\\');
}

function isTestFile(filePath: string): boolean {
  return filePath.endsWith('.spec.ts');
}

describe('NodeBB module boundary', () => {
  it('should have no direct NodeBB HTTP calls outside src/nodebb/**', () => {
    const allFiles = walkTsFiles(SRC_ROOT);
    const violations: string[] = [];

    for (const file of allFiles) {
      if (isInsideNodebb(file) || isTestFile(file)) continue;

      const content = fs.readFileSync(file, 'utf-8');
      FORBIDDEN_IMPORT_RE.lastIndex = 0;
      const match = FORBIDDEN_IMPORT_RE.exec(content);
      if (match) {
        violations.push(
          `${path.relative(SRC_ROOT, file)}: forbidden import of "${match[1] ?? match[2]}"`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
