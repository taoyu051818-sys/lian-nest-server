#!/usr/bin/env node

/**
 * calculate-worker-telemetry.js
 *
 * Reads worker task contract and optional result/heartbeat files, then produces
 * a worker-telemetry record conforming to schemas/worker-telemetry.schema.json.
 *
 * Safe skeleton: when input files are missing, produces a zeroed-out default
 * record so downstream consumers never break on absent data.
 *
 * Token source handling:
 *   - api_response / high  — when API usage headers are available
 *   - log_parse   / medium — when parsed from worker output logs
 *   - estimate    / low    — when only heuristics are available (default)
 *
 * Usage:
 *   node scripts/ai/calculate-worker-telemetry.js --help
 *   node scripts/ai/calculate-worker-telemetry.js
 *   node scripts/ai/calculate-worker-telemetry.js --task task.json
 *   node scripts/ai/calculate-worker-telemetry.js --task task.json --heartbeat heartbeat.ndjson
 *   node scripts/ai/calculate-worker-telemetry.js --task task.json --result result.json
 *   node scripts/ai/calculate-worker-telemetry.js --task task.json --stdout
 *   node scripts/ai/calculate-worker-telemetry.js --task task.json --dry-run
 *
 * Exit codes:
 *   0 — telemetry produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'worker-telemetry.json');
const SCHEMA_VERSION = 1;

const PRICING = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
  currency: 'USD',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
calculate-worker-telemetry.js — Worker telemetry calculator skeleton

USAGE
    node scripts/ai/calculate-worker-telemetry.js [options]

OPTIONS
    --task <path>          Path to the task contract JSON file
                           (reads identity, budget, and policy fields)
    --heartbeat <path>     NDJSON file with heartbeat snapshots
                           (one JSON object per line; used for elapsedMs)
    --result <path>        Path to a worker result JSON file
                           (validation results, changed files, quality signals)
    --out <path>           Output path for the telemetry JSON
                           (default: .github/ai-state/worker-telemetry.json)
    --stdout               Print JSON to stdout instead of writing a file
    --dry-run              Print the telemetry JSON to stdout without writing
                           (implies --stdout; does NOT write any file)
    --help                 Show this help message and exit.

TOKEN SOURCE HANDLING
    api_response / high    Provider returned usage in API response headers
    log_parse   / medium   Parsed from worker output logs
    estimate    / low      Heuristic estimate (default when no source available)

EXIT CODES
    0   Telemetry produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines silently — non-destructive
    }
  }
  return entries;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Token / cost estimation ──────────────────────────────────────────────────

function estimateTokenCount(text) {
  if (!text) return 0;
  // Rough heuristic: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function calculateCostCents(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1_000_000) * PRICING.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * PRICING.outputPerMillion;
  return Math.max(0, Math.round((inputCost + outputCost) * 100));
}

// ── Builders ─────────────────────────────────────────────────────────────────

function buildTiming(heartbeatEntries, taskData) {
  const budget = taskData?.budget || taskData?.budgets || {};
  let elapsedMs = 0;

  if (heartbeatEntries.length > 0) {
    // Use the latest heartbeat elapsedMs
    const latest = heartbeatEntries[heartbeatEntries.length - 1];
    elapsedMs = latest.elapsedMs || 0;
  }

  return {
    elapsedMs,
    softTimeMinutes: budget.softTimeMinutes || null,
    hardTimeMinutes: budget.hardTimeMinutes || null,
    progressMilestones: [],
  };
}

function buildTokenUsage(resultData) {
  // If result contains actual token usage, surface it
  if (resultData?.tokenUsage) {
    const tu = resultData.tokenUsage;
    return {
      inputTokens: tu.inputTokens || 0,
      outputTokens: tu.outputTokens || 0,
      source: tu.source || 'log_parse',
      confidence: tu.confidence || 'medium',
      cachedInputTokens: tu.cachedInputTokens || null,
      apiCalls: tu.apiCalls || null,
    };
  }

  // Default: estimate with low confidence
  return {
    inputTokens: 0,
    outputTokens: 0,
    source: 'estimate',
    confidence: 'low',
    cachedInputTokens: null,
    apiCalls: null,
  };
}

function buildEstimatedCost(tokenUsage) {
  const amountCents = calculateCostCents(tokenUsage.inputTokens, tokenUsage.outputTokens);
  let pricingBasis = 'unknown';
  if (tokenUsage.source === 'api_response') {
    pricingBasis = 'api_list';
  } else if (tokenUsage.source === 'log_parse') {
    pricingBasis = 'estimated';
  }

  return {
    amountCents,
    currency: 'USD',
    model: 'claude-opus-4-7',
    pricingBasis,
  };
}

function buildChangedFiles(resultData, taskData) {
  const budget = taskData?.budget || taskData?.budgets || {};
  if (resultData?.changedFiles) {
    const cf = resultData.changedFiles;
    return {
      count: cf.count || 0,
      maxBudget: cf.maxBudget || budget.maxFiles || null,
      linesAdded: cf.linesAdded || 0,
      linesRemoved: cf.linesRemoved || 0,
      maxLinesBudget: cf.maxLinesBudget || budget.maxLinesChanged || null,
    };
  }

  return {
    count: 0,
    maxBudget: budget.maxFiles || null,
    linesAdded: 0,
    linesRemoved: 0,
    maxLinesBudget: budget.maxLinesChanged || null,
  };
}

function buildValidationResults(resultData) {
  if (resultData?.validationResults && Array.isArray(resultData.validationResults)) {
    return resultData.validationResults.map((vr) => ({
      command: vr.command || 'unknown',
      exitCode: vr.exitCode ?? 0,
      durationMs: vr.durationMs || null,
    }));
  }
  return [];
}

function buildQualitySignals(resultData) {
  if (resultData?.qualitySignals && Array.isArray(resultData.qualitySignals)) {
    return resultData.qualitySignals.map((qs) => ({
      category: qs.category || 'unknown',
      severity: qs.severity || 'yellow',
      confidence: qs.confidence || 'low',
      message: qs.message || null,
    }));
  }
  return null;
}

function buildGateOutcome(resultData, taskData) {
  if (resultData?.gateOutcome) {
    const go = resultData.gateOutcome;
    return {
      passed: go.passed ?? false,
      reason: go.reason || null,
      mainHealthPolicy: go.mainHealthPolicy || taskData?.mainHealthPolicy || null,
      generatedCodePolicy: go.generatedCodePolicy || taskData?.generatedCodePolicy || null,
    };
  }

  return {
    passed: false,
    reason: null,
    mainHealthPolicy: taskData?.mainHealthPolicy || null,
    generatedCodePolicy: taskData?.generatedCodePolicy || null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    task: null,
    heartbeat: null,
    result: null,
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
    } else if (arg === '--task') {
      i++;
      if (i >= argv.length) { console.error('Error: --task requires a path'); process.exit(2); }
      args.task = argv[i];
    } else if (arg === '--heartbeat') {
      i++;
      if (i >= argv.length) { console.error('Error: --heartbeat requires a path'); process.exit(2); }
      args.heartbeat = argv[i];
    } else if (arg === '--result') {
      i++;
      if (i >= argv.length) { console.error('Error: --result requires a path'); process.exit(2); }
      args.result = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.stdout = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const taskData = readJson(args.task);
  const heartbeatEntries = readNdjson(args.heartbeat);
  const resultData = readJson(args.result);

  // Derive identity from task contract or fallback
  const taskId = taskData?.taskId
    || resultData?.taskId
    || `unknown-${Date.now()}`;
  const taskType = taskData?.taskType || null;
  const actorRole = taskData?.actorRole
    || taskData?.rolePacket?.actorRole
    || null;
  const pmPhase = taskData?.pmPhase || null;
  const issueNumber = taskData?.targetIssue || null;
  const prNumber = taskData?.targetPR || null;

  // Build record sections
  const timing = buildTiming(heartbeatEntries, taskData);
  const tokenUsage = buildTokenUsage(resultData);
  const estimatedCost = buildEstimatedCost(tokenUsage);
  const changedFiles = buildChangedFiles(resultData, taskData);
  const validationResults = buildValidationResults(resultData);
  const qualitySignals = buildQualitySignals(resultData);
  const gateOutcome = buildGateOutcome(resultData, taskData);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    taskId,
    capturedAt: new Date().toISOString(),
    issueNumber,
    prNumber,
    taskType,
    actorRole,
    pmPhase,
    timing,
    tokenUsage,
    estimatedCost,
    changedFiles,
    validationResults,
    qualitySignals,
    gateOutcome,
  };

  const json = JSON.stringify(record, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    if (args.dryRun) {
      process.stdout.write('[dry-run] Telemetry printed to stdout. No file written.\n');
    }
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Worker telemetry written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

main();
