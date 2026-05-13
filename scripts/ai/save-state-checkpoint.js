#!/usr/bin/env node

/**
 * save-state-checkpoint.js
 *
 * Structured state checkpoint writer for LIAN self-cycle workers.
 * Captures a worker's decision context, recent reflections, and pending
 * actions — enabling continuity across context boundaries and recovery
 * from interruptions.
 *
 * Inspired by the Hermes context compressor's structured checkpoint template.
 * Includes anti-thrashing (skip compression if < 10% new content in last 2
 * checkpoints) and sanitization (no secrets in output).
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/save-state-checkpoint.js --help
 *   node scripts/ai/save-state-checkpoint.js --task-id issue-1414 --active-task "Add checkpoint" --goal "..." --active-state implementing
 *   node scripts/ai/save-state-checkpoint.js --task-id issue-1414 --active-task "..." --goal "..." --active-state implementing --live
 *   node scripts/ai/save-state-checkpoint.js --self-test
 *
 * Exit codes:
 *   0 — Checkpoint processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'state-checkpoints.ndjson');
const CHECKPOINT_VERSION = 1;

const ACTIVE_STATES = ['exploring', 'implementing', 'testing', 'blocked', 'reviewing'];
const ANTI_THRASH_THRESHOLD = 0.10;
const ANTI_THRASH_WINDOW = 2;

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted-token]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-gh-token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function sanitizeArray(arr) {
  if (!arr) return [];
  if (!Array.isArray(arr)) return arr;
  return arr.map(function (item) {
    return typeof item === 'string' ? sanitize(item) : item;
  });
}

// ── Anti-Thrashing ───────────────────────────────────────────────────────────

function computeNewContentRatio(prev, curr) {
  if (!prev || !curr) return 1.0;

  var compared = ['completedActions', 'keyDecisions', 'remainingWork'];
  var totalNew = 0;
  var totalItems = 0;

  for (var i = 0; i < compared.length; i++) {
    var field = compared[i];
    var prevArr = Array.isArray(prev[field]) ? prev[field] : [];
    var currArr = Array.isArray(curr[field]) ? curr[field] : [];
    var prevSet = {};
    for (var j = 0; j < prevArr.length; j++) {
      prevSet[prevArr[j]] = true;
    }
    var newCount = 0;
    for (var k = 0; k < currArr.length; k++) {
      if (!prevSet[currArr[k]]) {
        newCount++;
      }
    }
    totalNew += newCount;
    totalItems += currArr.length;
  }

  if (totalItems === 0) return 0;
  return totalNew / totalItems;
}

function checkAntiThrashing(previousCheckpoints, currentCheckpoint) {
  if (previousCheckpoints.length < ANTI_THRASH_WINDOW) {
    return { skipped: false, reason: null };
  }

  var recentPrev = previousCheckpoints.slice(-ANTI_THRASH_WINDOW);
  for (var i = 0; i < recentPrev.length; i++) {
    var ratio = computeNewContentRatio(
      i > 0 ? recentPrev[i - 1] : (previousCheckpoints.length > ANTI_THRASH_WINDOW ? previousCheckpoints[previousCheckpoints.length - ANTI_THRASH_WINDOW - 1] : null),
      recentPrev[i]
    );
    if (ratio >= ANTI_THRASH_THRESHOLD) {
      return { skipped: false, reason: null };
    }
  }

  var currentRatio = computeNewContentRatio(recentPrev[recentPrev.length - 1], currentCheckpoint);
  if (currentRatio < ANTI_THRASH_THRESHOLD) {
    return {
      skipped: true,
      reason: 'anti-thrash: < 10% new content in last ' + ANTI_THRASH_WINDOW + ' checkpoints',
    };
  }

  return { skipped: false, reason: null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  var help = [
    'save-state-checkpoint.js — Structured state checkpoint writer',
    '',
    'USAGE',
    '    node scripts/ai/save-state-checkpoint.js [OPTIONS]',
    '',
    'OPTIONS (required)',
    '    --task-id <string>          Worker task identifier',
    '    --active-task <string>      One-line description of current task',
    '    --goal <string>             What the worker is trying to achieve',
    '    --active-state <state>      Current phase: exploring, implementing,',
    '                                testing, blocked, reviewing',
    '',
    'OPTIONS (optional — arrays, repeatable or JSON)',
    '    --issue <number>            GitHub issue number',
    '    --constraints <json>        JSON array of constraint strings',
    '    --completed-actions <json>  JSON array of completed step strings',
    '    --in-progress <json>        JSON array of in-progress strings',
    '    --blocked <json>            JSON array of blocker strings',
    '    --key-decisions <json>      JSON array of decision strings',
    '    --resolved-questions <json> JSON array of resolved question strings',
    '    --pending-asks <json>       JSON array of pending ask strings',
    '    --relevant-files <json>     JSON array of relevant file paths',
    '    --remaining-work <json>     JSON array of remaining step strings',
    '',
    'OPTIONS (optional — strings)',
    '    --critical-context <string> Non-obvious context for next iteration',
    '',
    'OPTIONS (general)',
    '    --out <path>                Output NDJSON file path',
    '                                (default: .github/ai-state/state-checkpoints.ndjson)',
    '    --previous <path>           Path to existing checkpoint file for',
    '                                anti-thrashing comparison',
    '    --dry-run                   Preview checkpoint without writing (default)',
    '    --live                      Append checkpoint to ledger file',
    '    --self-test                 Run built-in validation and exit',
    '    --help, -h                  Show this help message',
    '',
    'EXIT CODES',
    '    0   Checkpoint processed (dry-run preview or live write)',
    '    1   Self-test failure',
    '    2   Invalid arguments',
    '',
    'EXAMPLES',
    '    # Dry-run preview',
    '    node scripts/ai/save-state-checkpoint.js \\',
    '      --task-id issue-1414-worker \\',
    '      --active-task "Add state checkpoint" \\',
    '      --goal "Enable worker state persistence" \\',
    '      --active-state implementing',
    '',
    '    # Live write with full context',
    '    node scripts/ai/save-state-checkpoint.js \\',
    '      --task-id issue-1414-worker \\',
    '      --issue 1414 \\',
    '      --active-task "Add state checkpoint" \\',
    '      --goal "Enable worker state persistence" \\',
    '      --active-state implementing \\',
    '      --completed-actions \'["Read docs","Designed schema"]\' \\',
    '      --remaining-work \'["Write test","Run validation"]\' \\',
    '      --live',
    '',
    '    # Run self-test',
    '    node scripts/ai/save-state-checkpoint.js --self-test',
  ].join('\n');
  process.stdout.write(help);
}

function parseArgs(argv) {
  var args = {
    taskId: null,
    issueNumber: null,
    activeTask: null,
    goal: null,
    activeState: null,
    constraints: [],
    completedActions: [],
    inProgress: [],
    blocked: [],
    keyDecisions: [],
    resolvedQuestions: [],
    pendingAsks: [],
    relevantFiles: [],
    remainingWork: [],
    criticalContext: null,
    out: DEFAULT_OUT,
    previousPath: null,
    dryRun: true,
    selfTest: false,
    help: false,
  };

  var i = 2;
  while (i < argv.length) {
    var arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--task-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --task-id requires a value'); process.exit(2); }
      args.taskId = argv[i];
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a number'); process.exit(2); }
      var issueNum = parseInt(argv[i], 10);
      if (isNaN(issueNum)) { console.error('Error: --issue must be a number'); process.exit(2); }
      args.issueNumber = issueNum;
    } else if (arg === '--active-task') {
      i++;
      if (i >= argv.length) { console.error('Error: --active-task requires a value'); process.exit(2); }
      args.activeTask = argv[i];
    } else if (arg === '--goal') {
      i++;
      if (i >= argv.length) { console.error('Error: --goal requires a value'); process.exit(2); }
      args.goal = argv[i];
    } else if (arg === '--active-state') {
      i++;
      if (i >= argv.length) { console.error('Error: --active-state requires a value'); process.exit(2); }
      args.activeState = argv[i];
    } else if (arg === '--constraints') {
      i++;
      if (i >= argv.length) { console.error('Error: --constraints requires a JSON string'); process.exit(2); }
      try { args.constraints = JSON.parse(argv[i]); } catch (e) { console.error('Error: --constraints must be valid JSON'); process.exit(2); }
    } else if (arg === '--completed-actions') {
      i++;
      if (i >= argv.length) { console.error('Error: --completed-actions requires a JSON string'); process.exit(2); }
      try { args.completedActions = JSON.parse(argv[i]); } catch (e) { console.error('Error: --completed-actions must be valid JSON'); process.exit(2); }
    } else if (arg === '--in-progress') {
      i++;
      if (i >= argv.length) { console.error('Error: --in-progress requires a JSON string'); process.exit(2); }
      try { args.inProgress = JSON.parse(argv[i]); } catch (e) { console.error('Error: --in-progress must be valid JSON'); process.exit(2); }
    } else if (arg === '--blocked') {
      i++;
      if (i >= argv.length) { console.error('Error: --blocked requires a JSON string'); process.exit(2); }
      try { args.blocked = JSON.parse(argv[i]); } catch (e) { console.error('Error: --blocked must be valid JSON'); process.exit(2); }
    } else if (arg === '--key-decisions') {
      i++;
      if (i >= argv.length) { console.error('Error: --key-decisions requires a JSON string'); process.exit(2); }
      try { args.keyDecisions = JSON.parse(argv[i]); } catch (e) { console.error('Error: --key-decisions must be valid JSON'); process.exit(2); }
    } else if (arg === '--resolved-questions') {
      i++;
      if (i >= argv.length) { console.error('Error: --resolved-questions requires a JSON string'); process.exit(2); }
      try { args.resolvedQuestions = JSON.parse(argv[i]); } catch (e) { console.error('Error: --resolved-questions must be valid JSON'); process.exit(2); }
    } else if (arg === '--pending-asks') {
      i++;
      if (i >= argv.length) { console.error('Error: --pending-asks requires a JSON string'); process.exit(2); }
      try { args.pendingAsks = JSON.parse(argv[i]); } catch (e) { console.error('Error: --pending-asks must be valid JSON'); process.exit(2); }
    } else if (arg === '--relevant-files') {
      i++;
      if (i >= argv.length) { console.error('Error: --relevant-files requires a JSON string'); process.exit(2); }
      try { args.relevantFiles = JSON.parse(argv[i]); } catch (e) { console.error('Error: --relevant-files must be valid JSON'); process.exit(2); }
    } else if (arg === '--remaining-work') {
      i++;
      if (i >= argv.length) { console.error('Error: --remaining-work requires a JSON string'); process.exit(2); }
      try { args.remainingWork = JSON.parse(argv[i]); } catch (e) { console.error('Error: --remaining-work must be valid JSON'); process.exit(2); }
    } else if (arg === '--critical-context') {
      i++;
      if (i >= argv.length) { console.error('Error: --critical-context requires a value'); process.exit(2); }
      args.criticalContext = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = path.resolve(argv[i]);
    } else if (arg === '--previous') {
      i++;
      if (i >= argv.length) { console.error('Error: --previous requires a path'); process.exit(2); }
      args.previousPath = path.resolve(argv[i]);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--live') {
      args.dryRun = false;
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error('Unknown argument: ' + arg);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate(args) {
  var errors = [];

  if (!args.taskId) {
    errors.push('--task-id is required');
  }

  if (!args.activeTask) {
    errors.push('--active-task is required');
  }

  if (!args.goal) {
    errors.push('--goal is required');
  }

  if (!args.activeState) {
    errors.push('--active-state is required');
  } else if (ACTIVE_STATES.indexOf(args.activeState) === -1) {
    errors.push('--active-state must be one of: ' + ACTIVE_STATES.join(', ') + '. Got: "' + args.activeState + '"');
  }

  if (args.constraints && !Array.isArray(args.constraints)) {
    errors.push('--constraints must be a JSON array');
  }

  if (errors.length > 0) {
    for (var e = 0; e < errors.length; e++) {
      console.error('Error: ' + errors[e]);
    }
    process.exit(2);
  }
}

// ── Checkpoint building ──────────────────────────────────────────────────────

function buildCheckpoint(args) {
  return {
    checkpointVersion: CHECKPOINT_VERSION,
    taskId: sanitize(args.taskId),
    issueNumber: args.issueNumber || null,
    activeTask: sanitize(args.activeTask),
    goal: sanitize(args.goal),
    constraints: sanitizeArray(args.constraints),
    completedActions: sanitizeArray(args.completedActions),
    activeState: args.activeState,
    inProgress: sanitizeArray(args.inProgress),
    blocked: sanitizeArray(args.blocked),
    keyDecisions: sanitizeArray(args.keyDecisions),
    resolvedQuestions: sanitizeArray(args.resolvedQuestions),
    pendingAsks: sanitizeArray(args.pendingAsks),
    relevantFiles: sanitizeArray(args.relevantFiles),
    remainingWork: sanitizeArray(args.remainingWork),
    criticalContext: args.criticalContext ? sanitize(args.criticalContext) : null,
    previousCheckpointHash: null,
    compressionSkipped: false,
    compressionSkipReason: null,
    capturedAt: new Date().toISOString(),
  };
}

// ── Previous checkpoint loading ──────────────────────────────────────────────

function loadPreviousCheckpoints(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  var content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  var lines = content.split('\n');
  var checkpoints = [];
  for (var i = 0; i < lines.length; i++) {
    try {
      checkpoints.push(JSON.parse(lines[i]));
    } catch (e) {
      // skip malformed lines
    }
  }
  return checkpoints;
}

// ── Hash computation ─────────────────────────────────────────────────────────

function computeHash(checkpoint) {
  var copy = {};
  for (var key in checkpoint) {
    if (key !== 'previousCheckpointHash' && key !== 'capturedAt' && key !== 'compressionSkipped' && key !== 'compressionSkipReason') {
      copy[key] = checkpoint[key];
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex').slice(0, 16);
}

// ── Write logic ──────────────────────────────────────────────────────────────

function appendCheckpoint(outPath, checkpoint) {
  var dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  var line = JSON.stringify(checkpoint) + '\n';
  fs.appendFileSync(outPath, line, 'utf8');
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  var passed = 0;
  var failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error('  FAIL: ' + label);
    }
  }

  function assertEq(actual, expected, label) {
    var ok = actual === expected;
    if (!ok) {
      console.error('  FAIL: ' + label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
    assert(ok, label);
  }

  console.log('save-state-checkpoint.js — self-test');
  console.log('='.repeat(40));

  // Test 1: buildCheckpoint produces correct shape
  var c = buildCheckpoint({
    taskId: 'test-001',
    issueNumber: 100,
    activeTask: 'Test task',
    goal: 'Test goal',
    activeState: 'implementing',
    constraints: ['allowedFiles: docs/**'],
    completedActions: ['Read docs'],
    inProgress: ['Writing code'],
    blocked: [],
    keyDecisions: ['Use NDJSON'],
    resolvedQuestions: ['Where to store'],
    pendingAsks: [],
    relevantFiles: ['docs/ai-native/test.md'],
    remainingWork: ['Write test'],
    criticalContext: 'Important context',
  });
  assertEq(c.checkpointVersion, 1, 'checkpointVersion is 1');
  assertEq(c.taskId, 'test-001', 'taskId preserved');
  assertEq(c.issueNumber, 100, 'issueNumber preserved');
  assertEq(c.activeTask, 'Test task', 'activeTask preserved');
  assertEq(c.goal, 'Test goal', 'goal preserved');
  assertEq(c.activeState, 'implementing', 'activeState preserved');
  assert(c.constraints.length === 1, 'constraints preserved');
  assertEq(c.constraints[0], 'allowedFiles: docs/**', 'constraint value preserved');
  assert(c.completedActions.length === 1, 'completedActions preserved');
  assert(c.inProgress.length === 1, 'inProgress preserved');
  assert(c.blocked.length === 0, 'blocked empty');
  assert(c.keyDecisions.length === 1, 'keyDecisions preserved');
  assert(c.resolvedQuestions.length === 1, 'resolvedQuestions preserved');
  assert(c.pendingAsks.length === 0, 'pendingAsks empty');
  assert(c.relevantFiles.length === 1, 'relevantFiles preserved');
  assert(c.remainingWork.length === 1, 'remainingWork preserved');
  assertEq(c.criticalContext, 'Important context', 'criticalContext preserved');
  assertEq(c.previousCheckpointHash, null, 'previousCheckpointHash null by default');
  assertEq(c.compressionSkipped, false, 'compressionSkipped false by default');
  assertEq(c.compressionSkipReason, null, 'compressionSkipReason null by default');
  assert(typeof c.capturedAt === 'string' && c.capturedAt.indexOf('T') !== -1, 'capturedAt is ISO-8601');

  // Test 2: null optional fields
  var minimal = buildCheckpoint({
    taskId: 'min',
    activeTask: 'Task',
    goal: 'Goal',
    activeState: 'exploring',
  });
  assertEq(minimal.issueNumber, null, 'null issueNumber');
  assertEq(minimal.criticalContext, null, 'null criticalContext');
  assert(minimal.constraints.length === 0, 'empty constraints');
  assert(minimal.completedActions.length === 0, 'empty completedActions');

  // Test 3: sanitize strips tokens
  assertEq(sanitize('ghp_abc123xyz'), '[redacted-gh-token]', 'ghp_ token redacted');
  assertEq(sanitize('Bearer mytoken123'), 'Bearer [redacted]', 'Bearer token redacted');

  // Test 4: sanitizeArray sanitizes each item
  var arr = sanitizeArray(['ghp_leaked', 'safe', 'Bearer bad']);
  assertEq(arr[0], '[redacted-gh-token]', 'sanitizeArray redacts first');
  assertEq(arr[1], 'safe', 'sanitizeArray preserves safe');
  assertEq(arr[2], 'Bearer [redacted]', 'sanitizeArray redacts third');

  // Test 5: computeNewContentRatio with no previous
  assertEq(computeNewContentRatio(null, c), 1.0, 'no previous returns 1.0');

  // Test 6: computeNewContentRatio with identical content
  var ratio = computeNewContentRatio(c, c);
  assertEq(ratio, 0, 'identical content ratio is 0');

  // Test 7: computeNewContentRatio with new content
  var c2 = buildCheckpoint({
    taskId: 'test-002',
    activeTask: 'Task',
    goal: 'Goal',
    activeState: 'implementing',
    completedActions: ['Read docs', 'New action'],
    keyDecisions: ['Use NDJSON', 'New decision'],
    remainingWork: ['Write test', 'New work'],
  });
  var ratio2 = computeNewContentRatio(c, c2);
  assert(ratio2 > 0, 'new content ratio > 0');
  assertEq(ratio2, 0.5, 'ratio is 3 new / 6 total = 0.5');

  // Test 8: checkAntiThrashing with insufficient history
  var thrash = checkAntiThrashing([], c);
  assertEq(thrash.skipped, false, 'no history: not skipped');

  // Test 9: checkAntiThrashing with low-change history
  var history = [c, c, c];
  var thrash2 = checkAntiThrashing(history, c);
  assertEq(thrash2.skipped, true, 'low-change history: skipped');
  assert(thrash2.reason !== null, 'skip reason provided');

  // Test 10: computeHash produces consistent output
  var hash1 = computeHash(c);
  var hash2 = computeHash(c);
  assertEq(hash1, hash2, 'computeHash is deterministic');
  assert(hash1.length === 16, 'hash is 16 chars');

  // Test 11: buildCheckpoint sanitizes dirty fields
  var dirty = buildCheckpoint({
    taskId: 'ghp_leaked',
    activeTask: 'Bearer secret',
    goal: 'password=hunter2',
    activeState: 'exploring',
    criticalContext: 'ghp_ctx',
  });
  assertEq(dirty.taskId, '[redacted-gh-token]', 'taskId sanitized');
  assertEq(dirty.activeTask, 'Bearer [redacted]', 'activeTask sanitized');
  assertEq(dirty.goal, 'password=[redacted]', 'goal sanitized');
  assertEq(dirty.criticalContext, '[redacted-gh-token]', 'criticalContext sanitized');

  // Test 12: all active states accepted
  for (var s = 0; s < ACTIVE_STATES.length; s++) {
    var cp = buildCheckpoint({
      taskId: 'state-' + s,
      activeTask: 'T',
      goal: 'G',
      activeState: ACTIVE_STATES[s],
    });
    assertEq(cp.activeState, ACTIVE_STATES[s], 'state ' + ACTIVE_STATES[s] + ' accepted');
  }

  // Test 13: NDJSON round-trip
  var line = JSON.stringify(c);
  var parsed = JSON.parse(line);
  assertEq(parsed.taskId, 'test-001', 'NDJSON round-trip preserves taskId');
  assertEq(parsed.activeState, 'implementing', 'NDJSON round-trip preserves activeState');

  console.log();
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  var args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  validate(args);

  var checkpoint = buildCheckpoint(args);

  // Anti-thrashing: load previous checkpoints and check
  var previousPath = args.previousPath || args.out;
  var previousCheckpoints = loadPreviousCheckpoints(previousPath);
  var thrashResult = checkAntiThrashing(previousCheckpoints, checkpoint);
  checkpoint.compressionSkipped = thrashResult.skipped;
  checkpoint.compressionSkipReason = thrashResult.reason;

  // Chain hash: link to previous checkpoint
  if (previousCheckpoints.length > 0) {
    var last = previousCheckpoints[previousCheckpoints.length - 1];
    checkpoint.previousCheckpointHash = computeHash(last);
  }

  var line = JSON.stringify(checkpoint);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('STATE CHECKPOINT WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log('Target: ' + path.relative(REPO_ROOT, args.out).replace(/\\/g, '/'));
    if (thrashResult.skipped) {
      console.log('Anti-thrash: COMPRESSION SKIPPED — ' + thrashResult.reason);
    }
    console.log();
    console.log('Checkpoint:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the checkpoint to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendCheckpoint(args.out, checkpoint);
  console.log('State checkpoint appended to ' + path.relative(REPO_ROOT, args.out).replace(/\\/g, '/'));
  console.log('  taskId: ' + checkpoint.taskId);
  console.log('  activeState: ' + checkpoint.activeState);
  console.log('  capturedAt: ' + checkpoint.capturedAt);
  if (checkpoint.compressionSkipped) {
    console.log('  anti-thrash: compression skipped');
  }
}

main();
