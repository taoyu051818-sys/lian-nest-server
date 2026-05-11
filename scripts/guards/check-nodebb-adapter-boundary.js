#!/usr/bin/env node

/**
 * check-nodebb-adapter-boundary.js
 *
 * Detects direct NodeBB fetch/client usage outside approved adapter/provider
 * files under src/nodebb/**.  Business modules must consume NodeBB only via
 * the provider barrel (src/nodebb/index.ts).
 *
 * Violations detected:
 *   1. Imports of nodebb-client or NODEBB_CLIENT outside src/nodebb/**
 *   2. HTTP library imports (http, https, node-fetch, axios, got) outside
 *      src/nodebb/** — these signal a bypass of the adapter boundary
 *   3. Direct fetch() calls to NodeBB API paths (/api/v3/) outside src/nodebb/**
 *
 * Usage:
 *   node scripts/guards/check-nodebb-adapter-boundary.js [options]
 *
 * Options:
 *   --src-root <path>   Root to scan (default: ./src)
 *   --warn-only         Print warnings but exit 0 even on violations
 *   --json              Output machine-readable JSON
 *   -h, --help          Show help
 *
 * Exit codes:
 *   0 – no violations (or --warn-only)
 *   1 – violations detected
 *   2 – bad arguments / usage error
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files under src/nodebb/** are the approved adapter boundary. */
const ADAPTER_DIR = 'nodebb';

/** HTTP modules that must not appear outside the adapter. */
const FORBIDDEN_HTTP_MODULES = ['http', 'https', 'node-fetch', 'axios', 'got'];

/** Internal adapter symbols that must not be imported from outside. */
const FORBIDDEN_ADAPTER_SYMBOLS = [
  'nodebb-client',
  './nodebb-client',
  '../nodebb-client',
];

// Match require("...") or from "..." for forbidden HTTP modules.
const HTTP_IMPORT_RE = new RegExp(
  `(?:require\\s*\\(\\s*['"](${FORBIDDEN_HTTP_MODULES.join('|')})['"]\\s*\\)|from\\s+['"](${FORBIDDEN_HTTP_MODULES.join('|')})['"])`,
  'g',
);

// Match imports of the NodebbClient or its injection token.
const ADAPTER_IMPORT_RE = new RegExp(
  `(?:require\\s*\\(\\s*['"](?:${FORBIDDEN_ADAPTER_SYMBOLS.map(escapeRegExp).join('|')})['"]\\s*\\)|from\\s+['"](?:${FORBIDDEN_ADAPTER_SYMBOLS.map(escapeRegExp).join('|')})['"])`,
  'g',
);

// Match NODEBB_CLIENT injection-token imports (e.g. import { NODEBB_CLIENT }).
const TOKEN_IMPORT_RE = /\bNODEBB_CLIENT\b/g;

// Match direct fetch() to NodeBB API paths.
const DIRECT_FETCH_RE = /fetch\s*\(\s*[`'"]\s*(?:.*?\/api\/v3\/|.*?\$\{.*?NODEBB)/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalise(p) {
  return p.replace(/\\/g, '/');
}

function walkTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
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

function isInsideAdapter(filePath, srcRoot) {
  const relative = normalise(path.relative(srcRoot, filePath));
  return relative.startsWith(`${ADAPTER_DIR}/`) || relative === ADAPTER_DIR;
}

function isTestFile(filePath) {
  return filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts');
}

function stripComments(content) {
  // Remove single-line comments
  let result = content.replace(/\/\/.*$/gm, '');
  // Remove block comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Scan a file for adapter boundary violations.
 * @returns {{ file: string, violations: Array<{ rule: string, detail: string }> }}
 */
function scanFile(filePath, srcRoot) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const content = stripComments(raw);
  const violations = [];
  const relPath = normalise(path.relative(srcRoot, filePath));

  // Rule 1: HTTP library imports outside adapter
  HTTP_IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = HTTP_IMPORT_RE.exec(content)) !== null) {
    const mod = match[1] || match[2];
    violations.push({
      rule: 'no-http-import',
      detail: `forbidden import of "${mod}"`,
    });
  }

  // Rule 2: Direct adapter file imports (nodebb-client)
  ADAPTER_IMPORT_RE.lastIndex = 0;
  while ((match = ADAPTER_IMPORT_RE.exec(content)) !== null) {
    violations.push({
      rule: 'no-direct-adapter-import',
      detail: `direct import of adapter internal "${match[0].trim()}"`,
    });
  }

  // Rule 3: NODEBB_CLIENT token import
  TOKEN_IMPORT_RE.lastIndex = 0;
  // Only flag if the file actually imports it (not just mentions it)
  if (/import\s+.*\bNODEBB_CLIENT\b/.test(content) || /require\s*\(.*NODEBB_CLIENT/.test(content)) {
    violations.push({
      rule: 'no-direct-token-import',
      detail: 'imports NODEBB_CLIENT injection token directly (use provider barrel instead)',
    });
  }

  // Rule 4: Direct fetch() to NodeBB API paths
  DIRECT_FETCH_RE.lastIndex = 0;
  while ((match = DIRECT_FETCH_RE.exec(content)) !== null) {
    violations.push({
      rule: 'no-direct-fetch',
      detail: `direct fetch() to NodeBB API path: "${match[0].trim()}"`,
    });
  }

  return { file: relPath, violations };
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Check all src/ files for NodeBB adapter boundary violations.
 *
 * @param {object} [options]
 * @param {string} [options.srcRoot]   – path to src/ directory
 * @param {boolean} [options.warnOnly] – exit 0 even on violations
 * @returns {{ pass: boolean, totalScanned: number, violations: object[] }}
 */
function checkAdapterBoundary(options = {}) {
  const srcRoot = options.srcRoot || path.resolve(process.cwd(), 'src');

  if (!fs.existsSync(srcRoot)) {
    throw new Error(`src root not found: ${srcRoot}`);
  }

  const allFiles = walkTsFiles(srcRoot);
  const violations = [];

  for (const file of allFiles) {
    if (isInsideAdapter(file, srcRoot)) continue;
    if (isTestFile(file)) continue;

    const result = scanFile(file, srcRoot);
    if (result.violations.length > 0) {
      violations.push(result);
    }
  }

  return {
    pass: violations.length === 0,
    totalScanned: allFiles.length,
    violations,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage: node check-nodebb-adapter-boundary.js [options]

Detects direct NodeBB fetch/client usage outside approved adapter/provider
files (src/nodebb/**).

Options:
  --src-root <path>   Root directory to scan (default: ./src)
  --warn-only         Print warnings but exit 0 even on violations
  --json              Output machine-readable JSON
  -h, --help          Show this help

Exit codes:
  0  No violations (or --warn-only)
  1  Violations detected
  2  Bad arguments / src root not found`);
}

function parseArgs(argv) {
  const args = { srcRoot: null, warnOnly: false, json: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '--src-root') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --src-root requires a path');
        process.exit(2);
      }
      args.srcRoot = argv[i];
    } else if (arg === '--warn-only') {
      args.warnOnly = true;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
    i++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  let result;
  try {
    result = checkAdapterBoundary({ srcRoot: args.srcRoot });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify({
      tool: 'check-nodebb-adapter-boundary',
      pass: result.pass || args.warnOnly,
      totalScanned: result.totalScanned,
      violations: result.violations,
      warnOnly: args.warnOnly,
    }, null, 2));
  } else if (result.violations.length === 0) {
    console.log(`PASS: No NodeBB adapter boundary violations in ${result.totalScanned} files.`);
  } else {
    const prefix = args.warnOnly ? 'WARN' : 'FAIL';
    console.log(`${prefix}: ${result.violations.length} file(s) with NodeBB adapter boundary violations:\n`);
    for (const entry of result.violations) {
      for (const v of entry.violations) {
        console.log(`  ${entry.file}: [${v.rule}] ${v.detail}`);
      }
    }
    console.log(`\n${result.totalScanned} files scanned.`);
  }

  process.exit(result.pass || args.warnOnly ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

module.exports = {
  checkAdapterBoundary,
  scanFile,
  isInsideAdapter,
  isTestFile,
  stripComments,
  FORBIDDEN_HTTP_MODULES,
  FORBIDDEN_ADAPTER_SYMBOLS,
};

if (require.main === module) {
  main();
}
