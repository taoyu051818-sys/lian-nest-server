#!/usr/bin/env node

/**
 * validate-task-board.js
 *
 * Validates .github/ai-state/task-board.json for schema compliance.
 * Currently checks that every task entry has a non-empty conflictGroup.
 *
 * Usage:
 *   node scripts/ai/validate-task-board.js [options]
 *
 * Options:
 *   --input <path>   Path to task-board.json (default: .github/ai-state/task-board.json)
 *   --fix            Backfill missing conflictGroups using inferConflictGroup
 *   --self-test      Run built-in assertions and exit
 *   --help           Show usage
 *
 * Exit codes:
 *   0 — valid (or fixed)
 *   1 — validation failures found
 *   2 — invalid arguments / file error
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_INPUT = path.join(STATE_DIR, 'task-board.json');

const { inferConflictGroup } = require('./project-task-board.js');

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
validate-task-board.js — Task board schema validator

USAGE
    node scripts/ai/validate-task-board.js [options]

OPTIONS
    --input <path>   Path to task-board.json (default: .github/ai-state/task-board.json).
    --fix            Backfill missing conflictGroups using inferConflictGroup.
    --self-test      Run built-in assertions and exit.
    --help           Show this help message and exit.

EXIT CODES
    0   Valid (or fixed)
    1   Validation failures found
    2   Invalid arguments / file error
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    fix: false,
    selfTest: false,
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
    } else if (arg === '--fix') {
      args.fix = true;
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

function validateConflictGroups(projection, fix) {
  const tasks = projection.tasks || [];
  const failures = [];
  let fixed = 0;

  for (const task of tasks) {
    if (!task.conflictGroup || typeof task.conflictGroup !== 'string' || task.conflictGroup.length === 0) {
      if (fix) {
        task.conflictGroup = inferConflictGroup(task);
        fixed++;
      } else {
        failures.push({
          issue: task.issue,
          state: task.state,
          reason: 'missing or empty conflictGroup',
        });
      }
    }
  }

  return { failures, fixed };
}

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (!condition) {
      failed++;
      console.error(`  FAIL: ${msg}`);
    } else {
      passed++;
    }
  }

  // Test: valid projection passes
  const valid = {
    markerVersion: 1,
    capturedAt: new Date().toISOString(),
    tasks: [
      { issue: 100, state: 'open', conflictGroup: 'general', worker: null, blockedReason: null, linkedPR: null },
      { issue: 200, state: 'running', conflictGroup: 'auth', worker: null, blockedReason: null, linkedPR: null },
    ],
  };
  const r1 = validateConflictGroups(valid, false);
  assert(r1.failures.length === 0, 'valid projection has no failures');
  assert(r1.fixed === 0, 'valid projection has no fixes');

  // Test: missing conflictGroup detected
  const invalid = {
    markerVersion: 1,
    capturedAt: new Date().toISOString(),
    tasks: [
      { issue: 300, state: 'open', conflictGroup: null, worker: null, blockedReason: null, linkedPR: null },
    ],
  };
  const r2 = validateConflictGroups(invalid, false);
  assert(r2.failures.length === 1, 'invalid projection has 1 failure');
  assert(r2.failures[0].issue === 300, 'failure is for issue 300');

  // Test: empty string conflictGroup detected
  const empty = {
    markerVersion: 1,
    capturedAt: new Date().toISOString(),
    tasks: [
      { issue: 400, state: 'open', conflictGroup: '', worker: null, blockedReason: null, linkedPR: null },
    ],
  };
  const r3 = validateConflictGroups(empty, false);
  assert(r3.failures.length === 1, 'empty string conflictGroup detected');

  // Test: fix mode backfills missing conflictGroup
  const fixable = {
    markerVersion: 1,
    capturedAt: new Date().toISOString(),
    tasks: [
      { issue: 500, state: 'open', conflictGroup: null, worker: null, blockedReason: null, linkedPR: null },
      { issue: 600, state: 'open', conflictGroup: 'auth', worker: null, blockedReason: null, linkedPR: null },
    ],
  };
  const r4 = validateConflictGroups(fixable, true);
  assert(r4.failures.length === 0, 'fix mode has no failures');
  assert(r4.fixed === 1, 'fix mode fixed 1 entry');
  assert(typeof fixable.tasks[0].conflictGroup === 'string', 'fixed entry has string conflictGroup');
  assert(fixable.tasks[0].conflictGroup.length > 0, 'fixed entry has non-empty conflictGroup');
  assert(fixable.tasks[1].conflictGroup === 'auth', 'existing conflictGroup preserved');

  // Test: fix mode with empty string
  const fixableEmpty = {
    markerVersion: 1,
    capturedAt: new Date().toISOString(),
    tasks: [
      { issue: 700, state: 'open', conflictGroup: '', worker: null, blockedReason: null, linkedPR: null },
    ],
  };
  const r5 = validateConflictGroups(fixableEmpty, true);
  assert(r5.fixed === 1, 'fix mode fixes empty string');
  assert(fixableEmpty.tasks[0].conflictGroup.length > 0, 'empty string replaced');

  // Test: empty tasks array
  const emptyTasks = {
    markerVersion: 1,
    capturedAt: new Date().toISOString(),
    tasks: [],
  };
  const r6 = validateConflictGroups(emptyTasks, false);
  assert(r6.failures.length === 0, 'empty tasks has no failures');

  // Report
  console.log(`\n  validate-task-board self-test`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\n  Some self-tests failed.\n`);
    process.exit(1);
  } else {
    console.log(`\n  All self-tests passed.\n`);
    process.exit(0);
  }
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const projection = readJsonFile(args.input);
  if (!projection || !Array.isArray(projection.tasks)) {
    console.error(`Error: could not read valid task-board from ${args.input}`);
    process.exit(2);
  }

  const { failures, fixed } = validateConflictGroups(projection, args.fix);

  if (args.fix && fixed > 0) {
    fs.writeFileSync(args.input, JSON.stringify(projection, null, 2) + '\n', 'utf8');
    console.log(`Backfilled ${fixed} task(s) missing conflictGroup.`);
  }

  if (failures.length > 0) {
    console.error(`Validation failed: ${failures.length} task(s) missing conflictGroup:`);
    for (const f of failures) {
      console.error(`  - issue #${f.issue} (state: ${f.state}): ${f.reason}`);
    }
    process.exit(1);
  }

  console.log(`Task board valid: ${projection.tasks.length} task(s), all have conflictGroup.`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { validateConflictGroups };
