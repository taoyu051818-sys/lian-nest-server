#!/usr/bin/env node

/**
 * check-telemetry-budget.js
 *
 * Validates a worker telemetry record against the telemetry budget policy.
 * Checks wall-clock limits, token budgets, and cost-overrun thresholds.
 *
 * Usage:
 *   node scripts/guards/check-telemetry-budget.js [options]
 *
 * Options:
 *   --file <path>          Path to a worker telemetry JSON record
 *   --task-type <type>     Override task type: docs, execution, review (default: from record)
 *   --max-cost-usd <n>     Per-task cost cap in USD (default: from policy thresholds)
 *   --json                 Print JSON summary to stdout
 *   --warn-only            Downgrade failures to warnings
 *   --dry-run              Validate input record shape only, skip budget checks
 *   --help, -h             Show help
 *
 * Exit codes:
 *   0 — pass (all budget checks OK)
 *   1 — violation (budget exceeded or record invalid)
 *   2 — usage error
 *
 * Reads from --file or stdin.
 */

const fs = require('fs');
const path = require('path');

// --- Policy defaults (from .github/ai-policy/telemetry-budget-policy.json) ---

const POLICY = {
  wallClock: {
    softLimitMinutes: { docs: 15, execution: 45, review: 20, default: 30 },
    hardLimitMinutes: { docs: 30, execution: 90, review: 40, default: 60 },
  },
  tokenBudget: {
    docs: { maxInputTokens: 200000, maxOutputTokens: 50000 },
    execution: { maxInputTokens: 500000, maxOutputTokens: 150000 },
    review: { maxInputTokens: 300000, maxOutputTokens: 80000 },
  },
  costOverrun: {
    warningAtPercent: 80,
    criticalAtPercent: 100,
    hardStopAtPercent: 150,
  },
  pricing: {
    inputPerMillionTokens: 3.0,
    outputPerMillionTokens: 15.0,
  },
};

const TASK_TYPES = ['docs', 'execution', 'review'];
const REQUIRED_FIELDS = [
  'schemaVersion', 'taskId', 'capturedAt', 'timing',
  'tokenUsage', 'estimatedCost', 'changedFiles',
  'validationResults', 'gateOutcome',
];

// --- Exports for testing ---

function parseArgs(argv) {
  const args = {
    file: null,
    taskType: null,
    maxCostUsd: null,
    json: false,
    warnOnly: false,
    dryRun: false,
    help: false,
  };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--file':
        i++;
        args.file = raw[i] || null;
        break;
      case '--task-type':
        i++;
        args.taskType = raw[i] || null;
        break;
      case '--max-cost-usd':
        i++;
        args.maxCostUsd = raw[i] != null ? Number(raw[i]) : null;
        break;
      case '--json':
        args.json = true;
        break;
      case '--warn-only':
        args.warnOnly = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (!args._unknown) args._unknown = raw[i];
        break;
    }
  }
  return args;
}

function loadRecord(filePath) {
  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { error: `File not found: ${resolved}` };
    }
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      return { record: JSON.parse(content) };
    } catch (e) {
      return { error: `Failed to parse JSON: ${e.message}` };
    }
  }
  // Read from stdin
  try {
    const content = fs.readFileSync(0, 'utf-8').trim();
    if (!content) return { error: 'No input provided (empty stdin)' };
    return { record: JSON.parse(content) };
  } catch (e) {
    return { error: `Failed to read stdin: ${e.message}` };
  }
}

function validateRecord(record) {
  const violations = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, violations: ['Record is not a JSON object'] };
  }
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      violations.push(`Missing required field: ${field}`);
    }
  }
  if (record.schemaVersion !== undefined && record.schemaVersion !== 1) {
    violations.push(`Unsupported schemaVersion: ${record.schemaVersion} (expected 1)`);
  }
  return { valid: violations.length === 0, violations };
}

function resolveTaskType(record, override) {
  if (override && TASK_TYPES.includes(override)) return override;
  if (record.taskType && TASK_TYPES.includes(record.taskType)) return record.taskType;
  return 'default';
}

function checkWallClock(record, taskType) {
  const warnings = [];
  const violations = [];
  const elapsedMs = record.timing && record.timing.elapsedMs;
  if (elapsedMs == null || typeof elapsedMs !== 'number') {
    warnings.push('timing.elapsedMs missing or non-numeric — wall-clock check skipped');
    return { warnings, violations };
  }

  const elapsedMin = elapsedMs / 60000;
  const soft = POLICY.wallClock.softLimitMinutes[taskType]
    || POLICY.wallClock.softLimitMinutes.default;
  const hard = POLICY.wallClock.hardLimitMinutes[taskType]
    || POLICY.wallClock.hardLimitMinutes.default;

  const softPct = Math.round((elapsedMin / soft) * 100);
  const hardPct = Math.round((elapsedMin / hard) * 100);

  if (elapsedMin > hard) {
    violations.push(
      `Wall-clock hard limit exceeded: ${elapsedMin.toFixed(1)}min > ${hard}min (${hardPct}%)`
    );
  } else if (elapsedMin > soft) {
    warnings.push(
      `Wall-clock soft limit exceeded: ${elapsedMin.toFixed(1)}min > ${soft}min (${softPct}%)`
    );
  }

  return { warnings, violations, elapsedMin: +elapsedMin.toFixed(1), softLimit: soft, hardLimit: hard, softPct, hardPct };
}

function checkTokenBudget(record, taskType) {
  const warnings = [];
  const violations = [];
  const usage = record.tokenUsage;
  if (!usage || typeof usage !== 'object') {
    warnings.push('tokenUsage missing — token budget check skipped');
    return { warnings, violations };
  }

  const budget = POLICY.tokenBudget[taskType];
  if (!budget) {
    return { warnings, violations };
  }

  const inputPct = budget.maxInputTokens > 0
    ? Math.round((usage.inputTokens / budget.maxInputTokens) * 100) : 0;
  const outputPct = budget.maxOutputTokens > 0
    ? Math.round((usage.outputTokens / budget.maxOutputTokens) * 100) : 0;

  if (usage.inputTokens > budget.maxInputTokens) {
    violations.push(
      `Input token budget exceeded: ${usage.inputTokens} > ${budget.maxInputTokens} (${inputPct}%)`
    );
  } else if (inputPct >= POLICY.costOverrun.warningAtPercent) {
    warnings.push(
      `Input token budget at ${inputPct}%: ${usage.inputTokens} / ${budget.maxInputTokens}`
    );
  }

  if (usage.outputTokens > budget.maxOutputTokens) {
    violations.push(
      `Output token budget exceeded: ${usage.outputTokens} > ${budget.maxOutputTokens} (${outputPct}%)`
    );
  } else if (outputPct >= POLICY.costOverrun.warningAtPercent) {
    warnings.push(
      `Output token budget at ${outputPct}%: ${usage.outputTokens} / ${budget.maxOutputTokens}`
    );
  }

  return {
    warnings, violations,
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    maxInputTokens: budget.maxInputTokens, maxOutputTokens: budget.maxOutputTokens,
    inputPct, outputPct,
  };
}

function checkCostOverrun(record, maxCostUsdOverride) {
  const warnings = [];
  const violations = [];
  const cost = record.estimatedCost;
  if (!cost || typeof cost !== 'object') {
    warnings.push('estimatedCost missing — cost overrun check skipped');
    return { warnings, violations };
  }

  const amountCents = cost.amountCents;
  if (typeof amountCents !== 'number' || amountCents < 0) {
    warnings.push('estimatedCost.amountCents missing or invalid — cost overrun check skipped');
    return { warnings, violations };
  }

  const costUsd = amountCents / 100;
  let maxCostUsd = maxCostUsdOverride;

  // If no explicit cap, estimate from token usage + pricing
  if (maxCostUsd == null && record.tokenUsage) {
    const input = record.tokenUsage.inputTokens || 0;
    const output = record.tokenUsage.outputTokens || 0;
    maxCostUsd = (input / 1e6) * POLICY.pricing.inputPerMillionTokens
      + (output / 1e6) * POLICY.pricing.outputPerMillionTokens;
  }

  if (maxCostUsd == null || maxCostUsd <= 0) {
    warnings.push('No cost budget available — cost overrun check skipped');
    return { warnings, violations, costUsd };
  }

  const pct = Math.round((costUsd / maxCostUsd) * 100);
  const { warningAtPercent, criticalAtPercent, hardStopAtPercent } = POLICY.costOverrun;

  if (pct >= hardStopAtPercent) {
    violations.push(
      `Cost hard-stop exceeded: $${costUsd.toFixed(4)} / $${maxCostUsd.toFixed(4)} (${pct}% >= ${hardStopAtPercent}%)`
    );
  } else if (pct >= criticalAtPercent) {
    violations.push(
      `Cost critical threshold: $${costUsd.toFixed(4)} / $${maxCostUsd.toFixed(4)} (${pct}% >= ${criticalAtPercent}%)`
    );
  } else if (pct >= warningAtPercent) {
    warnings.push(
      `Cost warning threshold: $${costUsd.toFixed(4)} / $${maxCostUsd.toFixed(4)} (${pct}% >= ${warningAtPercent}%)`
    );
  }

  return { warnings, violations, costUsd, maxCostUsd: +maxCostUsd.toFixed(4), pct };
}

function checkBudget(record, options) {
  const { taskType: taskTypeOverride, maxCostUsd, dryRun } = options || {};
  const violations = [];
  const warnings = [];

  // Validate record shape
  const validation = validateRecord(record);
  if (!validation.valid) {
    return {
      status: 'fail',
      violations: validation.violations,
      warnings,
      summary: { recordValid: false },
    };
  }

  if (dryRun) {
    return {
      status: 'pass',
      violations,
      warnings: ['Dry-run: record shape valid, budget checks skipped'],
      summary: { recordValid: true, dryRun: true },
    };
  }

  const taskType = resolveTaskType(record, taskTypeOverride);

  // Wall-clock check
  const wc = checkWallClock(record, taskType);
  warnings.push(...wc.warnings);
  violations.push(...wc.violations);

  // Token budget check
  const tb = checkTokenBudget(record, taskType);
  warnings.push(...tb.warnings);
  violations.push(...tb.violations);

  // Cost overrun check
  const co = checkCostOverrun(record, maxCostUsd);
  warnings.push(...co.warnings);
  violations.push(...co.violations);

  const status = violations.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

  return {
    status,
    violations,
    warnings,
    summary: {
      recordValid: true,
      taskType,
      wallClock: {
        elapsedMin: wc.elapsedMin,
        softLimit: wc.softLimit,
        hardLimit: wc.hardLimit,
        softPct: wc.softPct,
        hardPct: wc.hardPct,
      },
      tokenBudget: {
        inputTokens: tb.inputTokens,
        outputTokens: tb.outputTokens,
        maxInputTokens: tb.maxInputTokens,
        maxOutputTokens: tb.maxOutputTokens,
        inputPct: tb.inputPct,
        outputPct: tb.outputPct,
      },
      cost: {
        costUsd: co.costUsd,
        maxCostUsd: co.maxCostUsd,
        pct: co.pct,
      },
    },
  };
}

function printHelp() {
  console.log(`Usage: node scripts/guards/check-telemetry-budget.js [options]

Validates a worker telemetry record against the telemetry budget policy.
Checks wall-clock limits, token budgets, and cost-overrun thresholds.

Options:
  --file <path>          Path to a worker telemetry JSON record
  --task-type <type>     Override task type: docs, execution, review
  --max-cost-usd <n>     Per-task cost cap in USD
  --json                 Print JSON summary to stdout
  --warn-only            Downgrade failures to warnings
  --dry-run              Validate input record shape only, skip budget checks
  --help, -h             Show help

Exit codes:
  0  pass (all budget checks OK)
  1  violation (budget exceeded or record invalid)
  2  usage error

Policy source:
  .github/ai-policy/telemetry-budget-policy.json

Examples:
  # Check a telemetry record file
  node scripts/guards/check-telemetry-budget.js --file telemetry.json

  # Pipe from stdin
  cat telemetry.json | node scripts/guards/check-telemetry-budget.js

  # Dry-run (shape validation only)
  node scripts/guards/check-telemetry-budget.js --file telemetry.json --dry-run

  # Machine-readable output
  node scripts/guards/check-telemetry-budget.js --file telemetry.json --json`);
}

// --- Main ---

if (require.main === module) {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args._unknown) {
    console.error(`Unknown argument: ${args._unknown}`);
    process.exit(2);
  }

  if (args.taskType && !TASK_TYPES.includes(args.taskType)) {
    console.error(`Invalid --task-type: ${args.taskType} (expected: ${TASK_TYPES.join(', ')})`);
    process.exit(2);
  }

  if (args.maxCostUsd != null && (typeof args.maxCostUsd !== 'number' || args.maxCostUsd < 0)) {
    console.error('Invalid --max-cost-usd: must be a non-negative number');
    process.exit(2);
  }

  const loaded = loadRecord(args.file);
  if (loaded.error) {
    console.error(`Error: ${loaded.error}`);
    process.exit(2);
  }

  const result = checkBudget(loaded.record, {
    taskType: args.taskType,
    maxCostUsd: args.maxCostUsd,
    dryRun: args.dryRun,
  });

  // Apply warn-only downgrade
  if (args.warnOnly && result.status === 'fail') {
    result.warnings.push(...result.violations.map((v) => `[downgraded] ${v}`));
    result.violations = [];
    result.status = 'warn';
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'fail' ? 1 : 0);
  }

  if (result.status === 'fail') {
    console.error('Telemetry budget guard FAILED:');
    for (const v of result.violations) console.error('  - ' + v);
    process.exit(1);
  }

  if (result.status === 'warn') {
    console.warn('Telemetry budget guard WARNINGS:');
    for (const w of result.warnings) console.warn('  - ' + w);
  }

  console.log('Telemetry budget guard passed.');
  process.exit(0);
}

module.exports = {
  parseArgs,
  loadRecord,
  validateRecord,
  resolveTaskType,
  checkWallClock,
  checkTokenBudget,
  checkCostOverrun,
  checkBudget,
  POLICY,
  TASK_TYPES,
  REQUIRED_FIELDS,
};
