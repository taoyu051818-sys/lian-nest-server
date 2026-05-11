#!/usr/bin/env node

/**
 * check-task-boundary.js
 *
 * Verifies that worker PR diffs stay inside task allowedFiles
 * and do not touch forbiddenFiles.  Produces a JSON summary.
 *
 * Usage:
 *   node scripts/guards/check-task-boundary.js \
 *     --manifest task.json \
 *     --files changed.txt
 *
 * Or pipe changed-file list via stdin:
 *   cat changed.txt | node scripts/guards/check-task-boundary.js -m task.json
 *
 * Exit codes:
 *   0 – all changed files are within allowedFiles and none touch forbiddenFiles
 *   1 – boundary violation detected
 *   2 – bad arguments or missing manifest
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal deterministic glob matcher (no external dependencies)
// ---------------------------------------------------------------------------

/**
 * Convert a glob pattern to a RegExp.
 * Supports: ** (any path), * (single segment), ? (single char).
 * Paths are normalised to forward-slash before matching.
 */
function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // ** matches anything including /
      re += '.*';
      i += 2;
      // skip trailing / after **
      if (pattern[i] === '/') i++;
    } else if (c === '*') {
      // * matches anything except /
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else if (c === '{') {
      // brace expansion: {a,b,c}
      let end = pattern.indexOf('}', i);
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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalise(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Test whether `filePath` matches any pattern in `patterns`.
 * Each pattern is a glob string (e.g. "src/**", "package.json").
 */
function matchesAny(filePath, patterns) {
  const normed = normalise(filePath);
  return patterns.some((pat) => globToRegex(pat).test(normed));
}

// ---------------------------------------------------------------------------
// Shared lock definitions
// ---------------------------------------------------------------------------

/**
 * Map of shared lock names to the file patterns they protect.
 * A task that declares a sharedLock is permitted to touch the corresponding
 * files even when they appear in forbiddenFiles.
 */
const SHARED_LOCK_MAP = {
  'package': ['package.json', 'package-lock.json'],
  'prisma-schema': ['prisma/**'],
  'app-module': ['src/app.module.ts'],
  'docs-index': ['docs/**/*.md'],
};

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Check changed files against allowed/forbidden boundaries.
 *
 * @param {string[]} changedFiles   – list of changed file paths (posix or OS)
 * @param {string[]} allowedFiles   – glob patterns; file must match at least one
 * @param {string[]} forbiddenFiles – glob patterns; file must match none
 * @param {object}   [options]
 * @param {string[]} [options.sharedLocks] – lock names declared by this task
 * @returns {{ pass: boolean, violations: object[], sharedLocks: string[] }}
 */
function checkBoundary(changedFiles, allowedFiles, forbiddenFiles, options = {}) {
  const violations = [];
  const declaredLocks = Array.isArray(options.sharedLocks) ? options.sharedLocks : [];

  // Build the set of file patterns unlocked by declared sharedLocks
  const unlockedPatterns = [];
  for (const lock of declaredLocks) {
    const patterns = SHARED_LOCK_MAP[lock];
    if (patterns) {
      unlockedPatterns.push(...patterns);
    }
  }

  for (const file of changedFiles) {
    const normed = normalise(file);

    const forbiddenHit = matchesAny(normed, forbiddenFiles);
    const allowedHit = matchesAny(normed, allowedFiles);
    const unlocked = unlockedPatterns.length > 0 && matchesAny(normed, unlockedPatterns);

    if (forbiddenHit && !unlocked) {
      violations.push({ file: normed, reason: 'forbidden', matched: forbiddenFiles.filter((p) => globToRegex(p).test(normed)) });
    } else if (!allowedHit && !unlocked) {
      violations.push({ file: normed, reason: 'outside-allowed' });
    }
  }

  return { pass: violations.length === 0, violations, sharedLocks: declaredLocks };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage: node check-task-boundary.js [options]

Options:
  -m, --manifest <path>   Path to task manifest JSON (required).
                           Shape: { "allowedFiles": [...], "forbiddenFiles": [...],
                           "sharedLocks": [...] }
  -f, --files <path>      Path to file containing changed files (one per line).
                           If omitted, reads from stdin.
  -h, --help              Show this help.

Exit codes:
  0  All files within boundary
  1  Boundary violation
  2  Bad arguments / missing manifest`);
}

function parseArgs(argv) {
  const args = { manifest: null, files: null };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '-m' || arg === '--manifest') {
      i++;
      if (i >= argv.length) { console.error('Error: --manifest requires a path'); process.exit(2); }
      args.manifest = argv[i];
    } else if (arg === '-f' || arg === '--files') {
      i++;
      if (i >= argv.length) { console.error('Error: --files requires a path'); process.exit(2); }
      args.files = argv[i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
    i++;
  }
  return args;
}

function readChangedFiles(filesPath) {
  if (filesPath) {
    return fs.readFileSync(filesPath, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
  }
  // Read from stdin
  const chunks = [];
  const fd = fs.openSync('/dev/stdin', 'r');
  const buf = Buffer.alloc(65536);
  let bytesRead;
  while ((bytesRead = fs.readSync(fd, buf)) > 0) {
    chunks.push(buf.slice(0, bytesRead).toString());
  }
  fs.closeSync(fd);
  return chunks.join('').split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.manifest) {
    console.error('Error: --manifest is required.');
    usage();
    process.exit(2);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf-8'));
  } catch (err) {
    console.error(`Error reading manifest: ${err.message}`);
    process.exit(2);
  }

  if (!Array.isArray(manifest.allowedFiles) || !Array.isArray(manifest.forbiddenFiles)) {
    console.error('Error: manifest must contain "allowedFiles" and "forbiddenFiles" arrays.');
    process.exit(2);
  }

  const changedFiles = readChangedFiles(args.files);

  const sharedLocks = Array.isArray(manifest.sharedLocks) ? manifest.sharedLocks : [];
  const result = checkBoundary(changedFiles, manifest.allowedFiles, manifest.forbiddenFiles, { sharedLocks });

  const summary = {
    tool: 'check-task-boundary',
    pass: result.pass,
    totalChanged: changedFiles.length,
    violations: result.violations,
    sharedLocks: result.sharedLocks,
  };

  console.log(JSON.stringify(summary, null, 2));

  process.exit(result.pass ? 0 : 1);
}

// Export for testing
module.exports = { checkBoundary, matchesAny, globToRegex, SHARED_LOCK_MAP };

if (require.main === module) {
  main();
}
