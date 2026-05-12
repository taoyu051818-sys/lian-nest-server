#!/usr/bin/env node

/**
 * write-spending-ledger.js
 *
 * Append-only spending ledger writer for .github/ai-state/spending-ledger.ndjson.
 * Records worker token, time, cost, provider, and budget events.
 *
 * Safe skeleton: defaults to dry-run mode. No file is modified unless
 * --live is explicitly passed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'spending-ledger.ndjson');
const SCHEMA_VERSION = 1;

const EVENT_TYPES = ['start', 'checkpoint', 'complete', 'budget-warning', 'budget-critical'];
const SOURCE_VALUES = ['actual', 'estimated', 'unknown'];
const PRICING_BASIS = ['api-list', 'estimated', 'unknown'];
const BUDGET_KINDS = ['token', 'time', 'cost'];
const BUDGET_UNITS = ['tokens', 'ms', 'cents'];
const BUDGET_STATES = ['nominal', 'warning', 'critical', 'exceeded'];

function printHelp() {
  const help = `
write-spending-ledger.js — Append-only spending ledger writer

USAGE
    node scripts/ai/write-spending-ledger.js [OPTIONS]

REQUIRED
    --task-id <string>          Worker task identifier
    --issue <number>            GitHub issue number
    --agent-id <string>         Agent identifier
    --provider <string>         Provider alias or routing identity
    --event <type>              One of: start, checkpoint, complete, budget-warning, budget-critical
    --desc <string>             Human-readable description

OPTIONAL IDENTITY
    --pr <number>               GitHub pull request number
    --role <string>             Worker role from task contract
    --model <string>            Model identifier

OPTIONAL TELEMETRY
    --elapsed-ms <number>       Measured wall-clock elapsed milliseconds
    --input-tokens <number>     Input token count
    --output-tokens <number>    Output token count
    --token-source <value>      Token source: actual, estimated, unknown
    --token-confidence <value>  Token confidence: actual, estimated, unknown
    --cost-cents <number>       Estimated cost in cents
    --pricing-basis <value>     Pricing basis: api-list, estimated, unknown

OPTIONAL BUDGET SNAPSHOT
    --budget-kind <kind>        Budget kind: token, time, cost
    --budget-limit <number>     Budget ceiling
    --budget-used <number>      Budget consumed so far
    --budget-unit <unit>        Budget unit: tokens, ms, cents
    --budget-state <state>      Budget state: nominal, warning, critical, exceeded
    --budget-percent <number>   Percent used for the current budget

GENERAL
    --meta <json>               JSON string for extra metadata
    --out <path>                Output NDJSON path
    --dry-run                   Preview only (default)
    --live                      Append entry to ledger
    --self-test                 Run built-in validation and exit
    --help, -h                  Show help
`.trimStart();
  process.stdout.write(help);
}

function parseInteger(flag, value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    console.error(`Error: ${flag} must be a number`);
    process.exit(2);
  }
  return parsed;
}

function parseNumber(flag, value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    console.error(`Error: ${flag} must be a number`);
    process.exit(2);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    taskId: null,
    issue: null,
    pr: null,
    agentId: null,
    provider: null,
    role: null,
    model: null,
    eventType: null,
    desc: null,
    elapsedMs: null,
    inputTokens: null,
    outputTokens: null,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    pricingBasis: null,
    budgetKind: null,
    budgetLimit: null,
    budgetUsed: null,
    budgetUnit: null,
    budgetState: null,
    budgetPercent: null,
    meta: null,
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
    } else if (arg === '--task-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --task-id requires a value'); process.exit(2); }
      args.taskId = argv[i];
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a number'); process.exit(2); }
      args.issue = parseInteger('--issue', argv[i]);
    } else if (arg === '--pr') {
      i++;
      if (i >= argv.length) { console.error('Error: --pr requires a number'); process.exit(2); }
      args.pr = parseInteger('--pr', argv[i]);
    } else if (arg === '--agent-id') {
      i++;
      if (i >= argv.length) { console.error('Error: --agent-id requires a value'); process.exit(2); }
      args.agentId = argv[i];
    } else if (arg === '--provider') {
      i++;
      if (i >= argv.length) { console.error('Error: --provider requires a value'); process.exit(2); }
      args.provider = argv[i];
    } else if (arg === '--role') {
      i++;
      if (i >= argv.length) { console.error('Error: --role requires a value'); process.exit(2); }
      args.role = argv[i];
    } else if (arg === '--model') {
      i++;
      if (i >= argv.length) { console.error('Error: --model requires a value'); process.exit(2); }
      args.model = argv[i];
    } else if (arg === '--event') {
      i++;
      if (i >= argv.length) { console.error('Error: --event requires a value'); process.exit(2); }
      args.eventType = argv[i];
    } else if (arg === '--desc') {
      i++;
      if (i >= argv.length) { console.error('Error: --desc requires a value'); process.exit(2); }
      args.desc = argv[i];
    } else if (arg === '--elapsed-ms') {
      i++;
      if (i >= argv.length) { console.error('Error: --elapsed-ms requires a number'); process.exit(2); }
      args.elapsedMs = parseInteger('--elapsed-ms', argv[i]);
    } else if (arg === '--input-tokens') {
      i++;
      if (i >= argv.length) { console.error('Error: --input-tokens requires a number'); process.exit(2); }
      args.inputTokens = parseInteger('--input-tokens', argv[i]);
    } else if (arg === '--output-tokens') {
      i++;
      if (i >= argv.length) { console.error('Error: --output-tokens requires a number'); process.exit(2); }
      args.outputTokens = parseInteger('--output-tokens', argv[i]);
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
      if (i >= argv.length) { console.error('Error: --cost-cents requires a number'); process.exit(2); }
      args.costCents = parseInteger('--cost-cents', argv[i]);
    } else if (arg === '--pricing-basis') {
      i++;
      if (i >= argv.length) { console.error('Error: --pricing-basis requires a value'); process.exit(2); }
      args.pricingBasis = argv[i];
    } else if (arg === '--budget-kind') {
      i++;
      if (i >= argv.length) { console.error('Error: --budget-kind requires a value'); process.exit(2); }
      args.budgetKind = argv[i];
    } else if (arg === '--budget-limit') {
      i++;
      if (i >= argv.length) { console.error('Error: --budget-limit requires a number'); process.exit(2); }
      args.budgetLimit = parseInteger('--budget-limit', argv[i]);
    } else if (arg === '--budget-used') {
      i++;
      if (i >= argv.length) { console.error('Error: --budget-used requires a number'); process.exit(2); }
      args.budgetUsed = parseInteger('--budget-used', argv[i]);
    } else if (arg === '--budget-unit') {
      i++;
      if (i >= argv.length) { console.error('Error: --budget-unit requires a value'); process.exit(2); }
      args.budgetUnit = argv[i];
    } else if (arg === '--budget-state') {
      i++;
      if (i >= argv.length) { console.error('Error: --budget-state requires a value'); process.exit(2); }
      args.budgetState = argv[i];
    } else if (arg === '--budget-percent') {
      i++;
      if (i >= argv.length) { console.error('Error: --budget-percent requires a number'); process.exit(2); }
      args.budgetPercent = parseNumber('--budget-percent', argv[i]);
    } else if (arg === '--meta') {
      i++;
      if (i >= argv.length) { console.error('Error: --meta requires a JSON string'); process.exit(2); }
      try {
        args.meta = JSON.parse(argv[i]);
      } catch {
        console.error('Error: --meta must be valid JSON');
        process.exit(2);
      }
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

function collectValidationErrors(args) {
  const errors = [];

  if (!args.taskId) errors.push('--task-id is required');
  if (args.issue == null) errors.push('--issue is required');
  if (!args.agentId) errors.push('--agent-id is required');
  if (!args.provider) errors.push('--provider is required');
  if (!args.eventType) errors.push('--event is required');
  if (!args.desc) errors.push('--desc is required');

  if (args.eventType && !EVENT_TYPES.includes(args.eventType)) {
    errors.push(`--event must be one of: ${EVENT_TYPES.join(', ')}`);
  }

  if (args.tokenSource && !SOURCE_VALUES.includes(args.tokenSource)) {
    errors.push(`--token-source must be one of: ${SOURCE_VALUES.join(', ')}`);
  }

  if (args.tokenConfidence && !SOURCE_VALUES.includes(args.tokenConfidence)) {
    errors.push(`--token-confidence must be one of: ${SOURCE_VALUES.join(', ')}`);
  }

  if (args.pricingBasis && !PRICING_BASIS.includes(args.pricingBasis)) {
    errors.push(`--pricing-basis must be one of: ${PRICING_BASIS.join(', ')}`);
  }

  if (args.budgetKind && !BUDGET_KINDS.includes(args.budgetKind)) {
    errors.push(`--budget-kind must be one of: ${BUDGET_KINDS.join(', ')}`);
  }

  if (args.budgetUnit && !BUDGET_UNITS.includes(args.budgetUnit)) {
    errors.push(`--budget-unit must be one of: ${BUDGET_UNITS.join(', ')}`);
  }

  if (args.budgetState && !BUDGET_STATES.includes(args.budgetState)) {
    errors.push(`--budget-state must be one of: ${BUDGET_STATES.join(', ')}`);
  }

  if ((args.inputTokens != null || args.outputTokens != null) && (!args.tokenSource || !args.tokenConfidence)) {
    errors.push('--token-source and --token-confidence are required when token counts are provided');
  }

  if (args.costCents != null && !args.pricingBasis) {
    errors.push('--pricing-basis is required when --cost-cents is provided');
  }

  const budgetFields = [args.budgetKind, args.budgetLimit, args.budgetUsed, args.budgetUnit, args.budgetState];
  const someBudget = budgetFields.some((value) => value != null) || args.budgetPercent != null;
  const allBudget = budgetFields.every((value) => value != null);
  if (someBudget && !allBudget) {
    errors.push('--budget-kind, --budget-limit, --budget-used, --budget-unit, and --budget-state must be provided together');
  }

  if ((args.eventType === 'budget-warning' || args.eventType === 'budget-critical') && !allBudget) {
    errors.push('budget events require a full budget snapshot');
  }

  if (args.elapsedMs != null && args.elapsedMs < 0) {
    errors.push('--elapsed-ms must be non-negative');
  }

  if (args.inputTokens != null && args.inputTokens < 0) {
    errors.push('--input-tokens must be non-negative');
  }

  if (args.outputTokens != null && args.outputTokens < 0) {
    errors.push('--output-tokens must be non-negative');
  }

  if (args.costCents != null && args.costCents < 0) {
    errors.push('--cost-cents must be non-negative');
  }

  if (args.budgetLimit != null && args.budgetLimit < 0) {
    errors.push('--budget-limit must be non-negative');
  }

  if (args.budgetUsed != null && args.budgetUsed < 0) {
    errors.push('--budget-used must be non-negative');
  }

  if (args.budgetPercent != null && args.budgetPercent < 0) {
    errors.push('--budget-percent must be non-negative');
  }

  return errors;
}

function validate(args) {
  const errors = collectValidationErrors(args);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Error: ${error}`);
    }
    process.exit(2);
  }
}

function buildEntry(args) {
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    entryId: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    taskId: args.taskId,
    issueNumber: args.issue,
    prNumber: args.pr != null ? args.pr : null,
    agentId: args.agentId,
    role: args.role || null,
    providerAlias: args.provider,
    model: args.model || null,
    eventType: args.eventType,
    elapsedMs: args.elapsedMs != null ? args.elapsedMs : null,
    tokenUsage: null,
    estimatedCost: null,
    budget: null,
    description: args.desc,
    meta: args.meta || null,
  };

  if (args.inputTokens != null || args.outputTokens != null) {
    entry.tokenUsage = {
      inputTokens: args.inputTokens != null ? args.inputTokens : 0,
      outputTokens: args.outputTokens != null ? args.outputTokens : 0,
      source: args.tokenSource || 'unknown',
      confidence: args.tokenConfidence || 'unknown',
    };
  }

  if (args.costCents != null) {
    entry.estimatedCost = {
      amountCents: args.costCents,
      currency: 'USD',
      pricingBasis: args.pricingBasis || 'unknown',
      model: args.model || null,
    };
  }

  if (args.budgetKind != null) {
    entry.budget = {
      kind: args.budgetKind,
      limit: args.budgetLimit,
      used: args.budgetUsed,
      unit: args.budgetUnit,
      state: args.budgetState,
      percentUsed: args.budgetPercent != null ? args.budgetPercent : null,
    };
  }

  return entry;
}

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

  function assertEq(actual, expected, label) {
    const ok = actual === expected;
    if (!ok) {
      console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    assert(ok, label);
  }

  console.log('write-spending-ledger.js — self-test');
  console.log('='.repeat(40));

  const complete = buildEntry({
    taskId: 'wave16-issue-1294-worker-001',
    issue: 1294,
    pr: 1305,
    agentId: 'claude-sonnet-4-6',
    provider: 'anthropic-primary',
    role: 'telemetry-budget-worker',
    model: 'claude-sonnet-4-6',
    eventType: 'complete',
    desc: 'worker completed with final spend snapshot',
    elapsedMs: 300000,
    inputTokens: 5000,
    outputTokens: 2000,
    tokenSource: 'actual',
    tokenConfidence: 'actual',
    costCents: 12,
    pricingBasis: 'api-list',
    budgetKind: 'cost',
    budgetLimit: 20,
    budgetUsed: 12,
    budgetUnit: 'cents',
    budgetState: 'nominal',
    budgetPercent: 60,
    meta: { wave: 'wave16' },
  });

  assertEq(complete.schemaVersion, 1, 'schemaVersion pinned');
  assert(typeof complete.entryId === 'string' && complete.entryId.length > 0, 'entryId present');
  assert(typeof complete.recordedAt === 'string' && complete.recordedAt.includes('T'), 'recordedAt is ISO-8601');
  assertEq(complete.taskId, 'wave16-issue-1294-worker-001', 'taskId preserved');
  assertEq(complete.issueNumber, 1294, 'issueNumber preserved');
  assertEq(complete.prNumber, 1305, 'prNumber preserved');
  assertEq(complete.providerAlias, 'anthropic-primary', 'provider preserved');
  assertEq(complete.eventType, 'complete', 'eventType preserved');
  assertEq(complete.tokenUsage.inputTokens, 5000, 'input tokens preserved');
  assertEq(complete.tokenUsage.outputTokens, 2000, 'output tokens preserved');
  assertEq(complete.tokenUsage.source, 'actual', 'token source preserved');
  assertEq(complete.estimatedCost.amountCents, 12, 'cost preserved');
  assertEq(complete.estimatedCost.pricingBasis, 'api-list', 'pricing basis preserved');
  assertEq(complete.budget.kind, 'cost', 'budget kind preserved');
  assertEq(complete.budget.percentUsed, 60, 'budget percent preserved');

  const minimal = buildEntry({
    taskId: 'min-001',
    issue: 1,
    agentId: 'agent-1',
    provider: 'router-a',
    eventType: 'start',
    desc: 'minimal entry',
  });

  assertEq(minimal.prNumber, null, 'minimal pr null');
  assertEq(minimal.role, null, 'minimal role null');
  assertEq(minimal.model, null, 'minimal model null');
  assertEq(minimal.elapsedMs, null, 'minimal elapsed null');
  assertEq(minimal.tokenUsage, null, 'minimal tokenUsage null');
  assertEq(minimal.estimatedCost, null, 'minimal cost null');
  assertEq(minimal.budget, null, 'minimal budget null');

  for (const eventType of EVENT_TYPES) {
    const entry = buildEntry({
      taskId: 't',
      issue: 1,
      agentId: 'a',
      provider: 'p',
      eventType,
      desc: 'event test',
    });
    assertEq(entry.eventType, eventType, `event type ${eventType} preserved`);
  }

  const budgetErrors = collectValidationErrors({
    taskId: 't',
    issue: 1,
    agentId: 'a',
    provider: 'p',
    eventType: 'budget-warning',
    desc: 'missing budget',
    inputTokens: null,
    outputTokens: null,
    tokenSource: null,
    tokenConfidence: null,
    costCents: null,
    pricingBasis: null,
    budgetKind: null,
    budgetLimit: null,
    budgetUsed: null,
    budgetUnit: null,
    budgetState: null,
    budgetPercent: null,
    elapsedMs: null,
  });
  assert(budgetErrors.includes('budget events require a full budget snapshot'), 'budget event validation detected');

  const one = buildEntry({
    taskId: 't',
    issue: 1,
    agentId: 'a',
    provider: 'p',
    eventType: 'checkpoint',
    desc: 'first',
  });
  const two = buildEntry({
    taskId: 't',
    issue: 1,
    agentId: 'a',
    provider: 'p',
    eventType: 'checkpoint',
    desc: 'second',
  });
  assert(one.entryId !== two.entryId, 'entry ids are unique');

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  validate(args);

  const entry = buildEntry(args);
  const line = JSON.stringify(entry);

  if (args.dryRun) {
    console.log('='.repeat(50));
    console.log('SPENDING LEDGER WRITER — DRY RUN');
    console.log('='.repeat(50));
    console.log();
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log();
    console.log('Entry:');
    console.log(line);
    console.log();
    console.log('-'.repeat(50));
    console.log('DRY RUN — No file was modified.');
    console.log('Use --live to append the entry to the ledger.');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.appendFileSync(args.out, line + '\n', 'utf8');

  console.log(`Spending entry appended to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  console.log(`  taskId: ${entry.taskId}`);
  console.log(`  eventType: ${entry.eventType}`);
  console.log(`  provider: ${entry.providerAlias}`);
}

main();
