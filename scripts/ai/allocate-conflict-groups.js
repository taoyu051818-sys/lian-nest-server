#!/usr/bin/env node

/**
 * allocate-conflict-groups.js
 *
 * Assigns stable unique conflict groups and shared locks to generated issues
 * so parallel scheduling is not accidentally serialized.
 *
 * Reads an input JSON file containing an array of task descriptors, analyzes
 * allowedFiles overlap and shared-lock patterns, then outputs each task with
 * an assigned conflictGroup and sharedLocks array.
 *
 * This script is read-only on GitHub state — it never creates or modifies issues.
 *
 * Usage:
 *   node scripts/ai/allocate-conflict-groups.js --help
 *   node scripts/ai/allocate-conflict-groups.js --input <path>
 *   node scripts/ai/allocate-conflict-groups.js --input <path> --stdout
 *   node scripts/ai/allocate-conflict-groups.js --input <path> --dry-run
 *
 * Input JSON:
 *   { "tasks": [ { "id": "issue-1328", "allowedFiles": [...], "forbiddenFiles": [...], ... } ] }
 *
 * Exit codes:
 *   0 — allocation complete
 *   2 — invalid arguments or missing input
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const { REPO_ROOT } = require('./lib');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'conflict-group-allocation.json');

const SCHEMA_VERSION = 1;

/** Shared lock definitions: lock name → file patterns that claim the lock. */
const SHARED_LOCKS = {
  'package': ['package.json', 'package-lock.json'],
  'prisma-schema': ['prisma/**'],
  'app-module': ['src/app.module.ts'],
  'docs-index': ['docs/**/*.md'],
};

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
allocate-conflict-groups.js — Conflict group allocator for generated issues (v${SCHEMA_VERSION})

USAGE
    node scripts/ai/allocate-conflict-groups.js [options]

OPTIONS
    --input <path>  Path to input JSON file (required).
    --out <path>    Output path (default: .github/ai-state/conflict-group-allocation.json).
    --stdout        Print JSON to stdout instead of writing file.
    --dry-run       Print summary without writing output.
    --help          Show this help message and exit.

INPUT SCHEMA
    {
      "tasks": [
        {
          "id": "issue-1328",
          "allowedFiles": ["scripts/ai/allocate-conflict-groups.js"],
          "forbiddenFiles": ["src/**"],
          "title": "feat(ai): add conflict group allocator"
        }
      ]
    }

    Each task must have at least an id and allowedFiles array.

OUTPUT
    JSON with schemaVersion, capturedAt, summary, and tasks array where each
    task includes assigned conflictGroup and sharedLocks.

EXIT CODES
    0   Allocation complete
    2   Invalid arguments / missing input
`.trimStart();
  process.stdout.write(help);
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    input: null,
    out: DEFAULT_OUT,
    stdout: false,
    dryRun: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--input') {
      i++;
      if (i >= argv.length) { console.error('Error: --input requires a path'); process.exit(2); }
      args.input = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Intermediate directory names that are organizational, not semantic.
 * Skipped during route extraction to avoid false overlap.
 */
const SKIP_SEGMENTS = new Set([
  '**', '*', 'src', 'docs', 'scripts', 'test', 'tests', '__tests__',
  'modules', 'features', 'lib', 'common', 'shared', 'utils', 'helpers',
]);

/**
 * Normalize a glob/path pattern to forward slashes and extract route segments.
 * E.g. "src/modules/auth/**" → ["auth"], "scripts/ai/foo.js" → ["ai"]
 */
function extractRouteSegments(allowedFiles) {
  const routes = new Set();
  for (const pattern of allowedFiles) {
    const normed = pattern.replace(/\\/g, '/');
    // Skip very broad patterns
    if (normed === '**' || normed === 'src/**' || normed === 'docs/**') continue;

    const segments = normed.split('/').filter(s => !SKIP_SEGMENTS.has(s));
    for (const seg of segments) {
      const clean = seg.replace(/\.(ts|js|vue|md|json|ps1)$/, '');
      if (clean && !SKIP_SEGMENTS.has(clean)) {
        routes.add(clean);
      }
    }
  }
  return routes;
}

/**
 * Check if two route sets overlap (share at least one segment).
 */
function routesOverlap(routesA, routesB) {
  for (const r of routesA) {
    if (routesB.has(r)) return true;
  }
  return false;
}

/**
 * Check if an allowedFiles pattern claims a specific shared lock.
 */
function claimsLock(allowedFiles, lockPatterns) {
  for (const filePattern of allowedFiles) {
    const normed = filePattern.replace(/\\/g, '/');
    for (const lockPat of lockPatterns) {
      const lockNormed = lockPat.replace(/\\/g, '/');
      if (normed === lockNormed) return true;
      // Handle glob prefix: "prisma/**" matches "prisma/schema.prisma"
      if (lockNormed.endsWith('/**')) {
        const prefix = lockNormed.slice(0, -3);
        if (normed.startsWith(prefix + '/') || normed === prefix) return true;
      }
      // Handle glob: "docs/**/*.md" matches "docs/foo/bar.md"
      if (lockNormed.includes('**')) {
        const prefix = lockNormed.split('**')[0];
        if (normed.startsWith(prefix)) return true;
      }
    }
  }
  return false;
}

/**
 * Detect which shared locks a task should claim.
 */
function detectSharedLocks(allowedFiles) {
  const locks = [];
  for (const [lockName, lockPatterns] of Object.entries(SHARED_LOCKS)) {
    if (claimsLock(allowedFiles, lockPatterns)) {
      locks.push(lockName);
    }
  }
  return locks.sort();
}

/**
 * Build a conflict group name from a set of route segments.
 * Uses the most specific shared segment, or falls back to a hash-based name.
 */
function buildGroupName(task) {
  const routes = extractRouteSegments(task.allowedFiles);
  if (routes.size === 0) {
    return `generic-${task.id}`;
  }
  // Use sorted route segments joined as group name, capped at 2 segments
  const sorted = [...routes].sort();
  if (sorted.length <= 2) {
    return sorted.join('-');
  }
  return sorted.slice(0, 2).join('-');
}

/**
 * Union-Find (Disjoint Set) for grouping overlapping tasks.
 */
class UnionFind {
  constructor(elements) {
    this.parent = new Map();
    this.rank = new Map();
    for (const el of elements) {
      this.parent.set(el, el);
      this.rank.set(el, 0);
    }
  }

  find(x) {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));
    }
    return this.parent.get(x);
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra);
    const rankB = this.rank.get(rb);
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  groups() {
    const map = new Map();
    for (const [el] of this.parent) {
      const root = this.find(el);
      if (!map.has(root)) map.set(root, []);
      map.get(root).push(el);
    }
    return map;
  }
}

// ── Core allocator ───────────────────────────────────────────────────────────

/**
 * Allocate conflict groups and shared locks for a set of tasks.
 *
 * @param {Array} tasks - Array of task objects with at least { id, allowedFiles }
 * @returns {Object} Allocation result with summary and annotated tasks
 */
function allocateConflictGroups(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      summary: { taskCount: 0, groupCount: 0, groups: {} },
      tasks: [],
    };
  }

  // Extract routes and detect shared locks for each task
  const taskData = tasks.map(task => ({
    ...task,
    routes: extractRouteSegments(task.allowedFiles || []),
    sharedLocks: detectSharedLocks(task.allowedFiles || []),
  }));

  // Build union-find over tasks with overlapping routes
  const ids = taskData.map(t => t.id);
  const uf = new UnionFind(ids);

  for (let i = 0; i < taskData.length; i++) {
    for (let j = i + 1; j < taskData.length; j++) {
      if (routesOverlap(taskData[i].routes, taskData[j].routes)) {
        uf.union(taskData[i].id, taskData[j].id);
      }
    }
  }

  // Assign conflict groups
  const groupMap = uf.groups();
  const groupNames = new Map(); // root → group name
  const usedNames = new Set();

  for (const [root, members] of groupMap) {
    // Collect all routes in this group
    const allRoutes = new Set();
    for (const id of members) {
      const td = taskData.find(t => t.id === id);
      if (td) {
        for (const r of td.routes) allRoutes.add(r);
      }
    }

    // Build group name from combined routes
    let groupName;
    if (allRoutes.size === 0) {
      groupName = `generic-${root}`;
    } else {
      const sorted = [...allRoutes].sort();
      groupName = sorted.length <= 2 ? sorted.join('-') : sorted.slice(0, 2).join('-');
    }

    // Deduplicate names
    let candidate = groupName;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${groupName}-${suffix}`;
      suffix++;
    }
    usedNames.add(candidate);
    groupNames.set(root, candidate);
  }

  // Build output tasks
  const outputTasks = taskData.map(task => {
    const root = uf.find(task.id);
    const result = {
      id: task.id,
      conflictGroup: groupNames.get(root),
      sharedLocks: task.sharedLocks,
    };
    if (task.title) result.title = task.title;
    if (task.allowedFiles) result.allowedFiles = task.allowedFiles;
    if (task.forbiddenFiles) result.forbiddenFiles = task.forbiddenFiles;
    return result;
  });

  // Build group summary
  const groupSummary = {};
  for (const [, members] of groupMap) {
    const groupName = groupNames.get(members[0] ? uf.find(members[0]) : members[0]);
    if (groupName) {
      groupSummary[groupName] = members.length;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    summary: {
      taskCount: tasks.length,
      groupCount: groupMap.size,
      groups: groupSummary,
    },
    tasks: outputTasks,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.input) {
    console.error('Error: --input <path> is required.');
    process.exit(2);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: input file not found: ${inputPath}`);
    process.exit(2);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch {
    console.error('Error: input is not valid JSON.');
    process.exit(2);
  }

  if (!raw || !Array.isArray(raw.tasks)) {
    console.error('Error: input must contain a "tasks" array.');
    process.exit(2);
  }

  // Validate each task has at least id and allowedFiles
  for (let i = 0; i < raw.tasks.length; i++) {
    const t = raw.tasks[i];
    if (!t.id) {
      console.error(`Error: task at index ${i} is missing required "id" field.`);
      process.exit(2);
    }
    if (!Array.isArray(t.allowedFiles)) {
      console.error(`Error: task "${t.id}" is missing required "allowedFiles" array.`);
      process.exit(2);
    }
  }

  const result = allocateConflictGroups(raw.tasks);
  const json = JSON.stringify(result, null, 2) + '\n';

  if (args.dryRun) {
    process.stdout.write('[dry-run] Conflict group allocation summary:\n');
    process.stdout.write(`  Tasks: ${result.summary.taskCount}\n`);
    process.stdout.write(`  Groups: ${result.summary.groupCount}\n`);
    for (const [group, count] of Object.entries(result.summary.groups)) {
      process.stdout.write(`    ${group}: ${count} task(s)\n`);
    }
    process.stdout.write(`[dry-run] Would write to: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
    process.exit(0);
  }

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Conflict group allocation written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

// ── Exports for testing ─────────────────────────────────────────────────────

module.exports = {
  extractRouteSegments,
  routesOverlap,
  claimsLock,
  detectSharedLocks,
  buildGroupName,
  allocateConflictGroups,
  SHARED_LOCKS,
  SCHEMA_VERSION,
};
