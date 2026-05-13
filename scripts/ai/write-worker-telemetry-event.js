#!/usr/bin/env node

/**
 * write-worker-telemetry-event.js
 *
 * Append-only writer for worker telemetry lifecycle events.
 * Writes sanitized NDJSON events to .github/ai-state/worker-telemetry-events.ndjson.
 *
 * Supports start, heartbeat, and complete event types.
 * Token source/confidence can be actual, estimated, or unknown.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed. Includes built-in self-test via --self-test.
 *
 * Usage:
 *   node scripts/ai/write-worker-telemetry-event.js --help
 *   node scripts/ai/write-worker-telemetry-event.js --event start --task-id "w36tk-1173"
 *   node scripts/ai/write-worker-telemetry-event.js --event heartbeat --task-id "w36tk-1173" --elapsed-ms 120000
 *   node scripts/ai/write-worker-telemetry-event.js --event complete --task-id "w36tk-1173" --live
 *   node scripts/ai/write-worker-telemetry-event.js --self-test
 *
 * Exit codes:
 *   0 — Event processed (dry-run preview or live write succeeded)
 *   1 — Self-test failure
 *   2 — Invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, sanitize, appendNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'worker-telemetry-events.ndjson');
const EVENT_VERSION = 1;
const VALID_EVENTS = ['start', 'heartbeat', 'complete'];
const VALID_SOURCES = ['actual', 'estimated', 'unknown'];

// ── Validation ───────────────────────────────────────────────────────────────

function validateArgs(args) {
  const errors = [];

  if (!args.eventType) {
    errors.push('--event is required (start, heartbeat, complete)');
  } else if (!VALID_EVENTS.includes(args.eventType)) {
    errors.push(`--event must be one of: ${VALID_EVENTS.join(', ')}`);
  }

  if (!args.taskId) {
    errors.push('--task-id is required');
  }

  if (args.tokenSource && !VALID_SOURCES.includes(args.tokenSource)) {
    errors.push(`--token-source must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  if (args.tokenConfidence && !VALID_SOURCES.includes(args.tokenConfidence)) {
    errors.push(`--token-confidence must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  if (args.inputTokens != null && (typeof args.inputTokens !== 'number' || args.inputTokens < 0)) {
    errors.push('--input-tokens must be a non-negative integer');
  }

  if (args.outputTokens != null && (typeof args.outputTokens !== 'number' || args.outputTokens < 0)) {
    errors.push('--output-tokens must be a non-negative integer');
  }

  if (args.costCents != null && (typeof args.costCents !== 'number' || args.costCents < 0)) {
    errors.push('--cost-cents must be a non-negative integer');
  }

  return errors;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
write-worker-telemetry-event.js — Append-only worker telemetry event writer

USAGE
    node scripts/ai/write-worker-telemetry-event.js [OPTIONS]

OPTIONS
    --event <string>           Event type (required): start, heartbeat, complete
    --task-id <string>         Task identifier (required)
    --issue-number <int>       GitHub issue number (optional)
    --pr-number <int>          GitHub pull request number (optional)
    --actor-role <string>      Worker role (optional)
    --elapsed-ms <int>         Elapsed wall-clock time in ms (optional)
    --input-tokens <int>       Input tokens consumed (optional)
    --output-tokens <int>      Output tokens consumed (optional)
    --token-source <string>    Token source: actual, estimated, unknown (optional)
    --token-confidence <string> Token confidence: actual, estimated, unknown (optional)
    --cost-cents <int>         Estimated cost in cents (optional)
    --cost-model <string>      LLM model for cost estimate (optional)
    --out <path>               Output NDJSON file path
                               (default: .github/ai-state/worker-telemetry-events.ndjson)
    --dry-run                  Preview the event without writing (default)
    --live                     Append the event to the ledger file
    --self-test                Run built-in validation and exit
    --help, -h                 Show this help message

DESCRIPTION
    Appends a single sanitized worker telemetry event as one NDJSON line.
    Each event is timestamped, versioned, and scrubbed of potential secrets.

    In dry-run mode (default), prints the event JSON to stdout without
    modifying any file.

EVENT TYPES
    start       Worker task started
    heartbeat   Worker task progress update
    complete    Worker task finished

EXIT CODES
    0   Event processed (dry-run preview or live write)
    1   Self-test failure
    2   Invalid arguments

EXAMPLES
    # Record task start
    node scripts/ai/write-worker-telemetry-event.js --event start --task-id "w36tk-1173"

    # Heartbeat with token usage
    node scripts/ai/write-worker-telemetry-event.js --event heartbeat --task-id "w36tk-1173" \\
      --elapsed-ms 60000 --input-tokens 1500 --output-tokens 400 --token-source actual

    # Complete event (live write)
    node scripts/ai/write-worker-telemetry-event.js --event complete --task-id "w36tk-1173" \\
      --elapsed-ms 300000 --input-tokens 5000 --output-tokens 2000 --token-source actual \\
      --cost-cents 12 --cost-model claude-sonnet-4-6 --live

    # Run self-test
    node scripts/ai/write-worker-telemetry-event.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseIntOrNull(str) {
  if (str === undefined || str === null) return null;
  const n = parseInt(str, 10);
  return Number.isNaN(n) ? null : n;
}

function parseArgs(argv) {
  const args = {
    eventType: null,
    taskId: null,
    issueNumber: null,
    prNumber: null,
    actorRole: null,
    elapsedMs: null,
    inputTokens: null,
    outputTokens: null,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    costModel: null,
    out: DEFAULT_OUT,
    dryRun: true,
    selfTest: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--event') {
      i++;
      if (i >= argv.length) { console.error('Error: --event requires a value'); process.exit(2); }
      args.eventType = argv[i];
    } else if (arg === '--task-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --task-id requires a value'); process.exit(2); }
      args.taskId = argv[i];
    } else if (arg === '--issue-number') {
      i++;
      args.issueNumber = parseIntOrNull(argv[i]);
    } else if (arg === '--pr-number') {
      i++;
      args.prNumber = parseIntOrNull(argv[i]);
    } else if (arg === '--actor-role') {
      i++;
      if (i >= argv.length) { console.error('Error: --actor-role requires a value'); process.exit(2); }
      args.actorRole = argv[i];
    } else if (arg === '--elapsed-ms') {
      i++;
      args.elapsedMs = parseIntOrNull(argv[i]);
    } else if (arg === '--input-tokens') {
      i++;
      args.inputTokens = parseIntOrNull(argv[i]);
    } else if (arg === '--output-tokens') {
      i++;
      args.outputTokens = parseIntOrNull(argv[i]);
    } else if (arg === '--token-source') {
      i++;
      if (i >= argv.length) { console.error('Error: --token-source requires a value'); process.exit(2); }
      args.tokenSource = argv[i];
    } else if (arg === '--token-confidence') {
      i++;
      if (i >= argv.length) { console.error('Error: --token-confidence requires a value'); process.exit(2); }
      args.tokenConfidence = argv[i];
    } else if (arg === '--cost-cents') {
      i++;
      args.costCents = parseIntOrNull(argv[i]);
    } else if (arg === '--cost-model') {
      i++;
      if (i >= argv.length) { console.error('Error: --cost-model requires a value'); process.exit(2); }
      args.costModel = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = path.resolve(argv[i]);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--live') {
      args.dryRun = false;
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

// ── Event building ───────────────────────────────────────────────────────────

function buildEvent(args) {
  const event = {
    eventVersion: EVENT_VERSION,
    eventType: args.eventType,
    taskId: sanitize(args.taskId),
    capturedAt: new Date().toISOString(),
  };

  if (args.issueNumber !== null) event.issueNumber = args.issueNumber;
  if (args.prNumber !== null) event.prNumber = args.prNumber;
  if (args.actorRole) event.actorRole = sanitize(args.actorRole);
  if (args.elapsedMs !== null) event.elapsedMs = args.elapsedMs;

  // Token usage — only included when at least token counts are provided
  if (args.inputTokens !== null || args.outputTokens !== null) {
    event.tokenUsage = {
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
      source: args.tokenSource ?? 'unknown',
      confidence: args.tokenConfidence ?? 'unknown',
    };
  }

  // Cost — only included when cost cents are provided
  if (args.costCents !== null) {
    event.estimatedCost = {
      amountCents: args.costCents,
      currency: 'USD',
    };
    if (args.costModel) event.estimatedCost.model = sanitize(args.costModel);
  }

  return event;
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${label}`);
    }
  }

  console.log('write-worker-telemetry-event.js — self-test');
  console.log('='.repeat(50));

  // Test 1: buildEvent produces correct shape for start
  const startEvent = buildEvent({
    eventType: 'start',
    taskId: 'w36tk-001',
    issueNumber: 1173,
    actorRole: 'tooling-worker',
    elapsedMs: null,
    inputTokens: null,
    outputTokens: null,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    costModel: null,
  });
  assert(startEvent.eventVersion === 1, 'eventVersion is 1');
  assert(startEvent.eventType === 'start', 'eventType is start');
  assert(startEvent.taskId === 'w36tk-001', 'taskId preserved');
  assert(startEvent.issueNumber === 1173, 'issueNumber preserved');
  assert(startEvent.actorRole === 'tooling-worker', 'actorRole preserved');
  assert(typeof startEvent.capturedAt === 'string', 'capturedAt is string');
  assert(startEvent.tokenUsage === undefined, 'no tokenUsage when no tokens provided');
  assert(startEvent.estimatedCost === undefined, 'no estimatedCost when no cost provided');

  // Test 2: heartbeat with token usage
  const heartbeatEvent = buildEvent({
    eventType: 'heartbeat',
    taskId: 'w36tk-001',
    issueNumber: null,
    prNumber: null,
    actorRole: null,
    elapsedMs: 60000,
    inputTokens: 1500,
    outputTokens: 400,
    tokenSource: 'actual',
    tokenConfidence: 'actual',
    costCents: null,
    costModel: null,
  });
  assert(heartbeatEvent.eventType === 'heartbeat', 'heartbeat eventType');
  assert(heartbeatEvent.elapsedMs === 60000, 'elapsedMs preserved');
  assert(heartbeatEvent.tokenUsage.inputTokens === 1500, 'inputTokens preserved');
  assert(heartbeatEvent.tokenUsage.outputTokens === 400, 'outputTokens preserved');
  assert(heartbeatEvent.tokenUsage.source === 'actual', 'token source is actual');
  assert(heartbeatEvent.tokenUsage.confidence === 'actual', 'token confidence is actual');
  assert(heartbeatEvent.issueNumber === undefined, 'null issueNumber omitted');

  // Test 3: complete with cost
  const completeEvent = buildEvent({
    eventType: 'complete',
    taskId: 'w36tk-001',
    issueNumber: 1173,
    prNumber: 1180,
    actorRole: 'tooling-worker',
    elapsedMs: 300000,
    inputTokens: 5000,
    outputTokens: 2000,
    tokenSource: 'actual',
    tokenConfidence: 'actual',
    costCents: 12,
    costModel: 'claude-sonnet-4-6',
  });
  assert(completeEvent.eventType === 'complete', 'complete eventType');
  assert(completeEvent.prNumber === 1180, 'prNumber preserved');
  assert(completeEvent.estimatedCost.amountCents === 12, 'cost amountCents');
  assert(completeEvent.estimatedCost.currency === 'USD', 'cost currency is USD');
  assert(completeEvent.estimatedCost.model === 'claude-sonnet-4-6', 'cost model preserved');

  // Test 4: sanitize strips secrets
  const dirtyEvent = buildEvent({
    eventType: 'start',
    taskId: 'ghp_leaked_token_here',
    actorRole: 'Bearer secrettoken123',
    inputTokens: null,
    outputTokens: null,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    costModel: null,
  });
  assert(dirtyEvent.taskId === '[redacted-gh-token]_token_here', 'taskId sanitized');
  assert(dirtyEvent.actorRole === 'Bearer [redacted]', 'actorRole sanitized');

  // Test 5: default token source/confidence is unknown
  const unknownSrcEvent = buildEvent({
    eventType: 'heartbeat',
    taskId: 't1',
    inputTokens: 100,
    outputTokens: 50,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    costModel: null,
  });
  assert(unknownSrcEvent.tokenUsage.source === 'unknown', 'default source is unknown');
  assert(unknownSrcEvent.tokenUsage.confidence === 'unknown', 'default confidence is unknown');

  // Test 6: NDJSON serialization round-trip
  const line = JSON.stringify(completeEvent);
  const parsed = JSON.parse(line);
  assert(parsed.eventType === 'complete', 'NDJSON round-trip preserves eventType');
  assert(parsed.taskId === 'w36tk-001', 'NDJSON round-trip preserves taskId');
  assert(parsed.tokenUsage.source === 'actual', 'NDJSON round-trip preserves token source');

  // Test 7: validation rejects invalid event type
  const errors = validateArgs({ eventType: 'invalid', taskId: 't1' });
  assert(errors.length === 1, 'invalid event type produces error');
  assert(errors[0].includes('start, heartbeat, complete'), 'error lists valid events');

  // Test 8: validation rejects missing task-id
  const errors2 = validateArgs({ eventType: 'start', taskId: null });
  assert(errors2.length === 1, 'missing task-id produces error');

  // Test 9: validation accepts valid args
  const errors3 = validateArgs({ eventType: 'start', taskId: 't1', tokenSource: 'actual', tokenConfidence: 'actual' });
  assert(errors3.length === 0, 'valid args produce no errors');

  // Test 10: sanitize truncates long strings
  const longId = 'x'.repeat(600);
  const longEvent = buildEvent({
    eventType: 'start',
    taskId: longId,
    inputTokens: null,
    outputTokens: null,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    costModel: null,
  });
  assert(longEvent.taskId.length <= 500, 'taskId truncated to 500 chars');

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  const errors = validateArgs(args);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`Error: ${err}`);
    }
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  const event = buildEvent(args);
  const line = JSON.stringify(event);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('WORKER TELEMETRY EVENT — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log();
    console.log('Event:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the event to the ledger.');
    process.exit(0);
  }

  // Live mode
  appendNdjson(args.out, event);
  console.log(`Worker telemetry event appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  type: ${event.eventType}`);
  console.log(`  taskId: ${event.taskId}`);
  console.log(`  capturedAt: ${event.capturedAt}`);
}

main();
