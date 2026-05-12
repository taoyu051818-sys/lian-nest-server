#!/usr/bin/env node

/**
 * calculate-risk-signals.js
 *
 * Reads the external risk signal snapshot (.github/ai-state/risk-signals.json)
 * and produces a deterministic risk score summary for the AI-native control
 * plane planning loop.
 *
 * Safe skeleton: when the input file is missing or empty, produces a
 * zeroed-out default summary so downstream consumers never break on
 * absent data.
 *
 * Usage:
 *   node scripts/ai/calculate-risk-signals.js --help
 *   node scripts/ai/calculate-risk-signals.js
 *   node scripts/ai/calculate-risk-signals.js --input path/to/risk-signals.json
 *   node scripts/ai/calculate-risk-signals.js --out path/to/output.json
 *   node scripts/ai/calculate-risk-signals.js --stdout
 *
 * Exit codes:
 *   0 — summary produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, '.github', 'ai-state', 'risk-signals.json');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'risk-signal-summary.json');

const SUMMARY_VERSION = 1;

const SEVERITY_WEIGHTS = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 3,
  info: 0,
};

const DOMAIN_MULTIPLIERS = {
  security: 1.5,
  compliance: 1.3,
  runtime: 1.2,
  product: 1.0,
  market: 0.8,
};

const ACTIVE_STATUSES = new Set(['open', 'acknowledged']);
const REDUCED_STATUSES = new Set(['mitigated']);
const INERT_STATUSES = new Set(['accepted', 'expired']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
calculate-risk-signals.js — External risk signal calculator

USAGE
    node scripts/ai/calculate-risk-signals.js [options]

OPTIONS
    --input <path>   Path to risk-signals.json
                     (default: .github/ai-state/risk-signals.json)
    --out <path>     Output path for the risk summary JSON
                     (default: .github/ai-state/risk-signal-summary.json)
    --stdout         Print JSON to stdout instead of writing a file
    --help           Show this help message and exit.

METRICS
    riskScore        Composite external risk (0-100, capped)
    signalCount      Total signals in the snapshot
    activeCount      Signals with open or acknowledged status
    criticalCount    Signals with critical severity and active status
    domainScores     Per-domain breakdown of risk contribution

EXIT CODES
    0   Summary produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Calculator ───────────────────────────────────────────────────────────────

function calculateRiskSummary(signals) {
  let totalScore = 0;
  const domainScores = {};
  let activeCount = 0;
  let criticalCount = 0;

  for (const signal of signals) {
    const severity = signal.severity || 'info';
    const domain = signal.domain || 'product';
    const status = signal.status || 'open';

    const severityWeight = SEVERITY_WEIGHTS[severity] || 0;
    const domainMultiplier = DOMAIN_MULTIPLIERS[domain] || 1.0;

    let contribution = severityWeight * domainMultiplier;

    if (INERT_STATUSES.has(status)) {
      contribution = 0;
    } else if (REDUCED_STATUSES.has(status)) {
      contribution *= 0.25;
    } else {
      activeCount++;
    }

    if (severity === 'critical' && ACTIVE_STATUSES.has(status)) {
      criticalCount++;
    }

    totalScore += contribution;
    domainScores[domain] = (domainScores[domain] || 0) + contribution;
  }

  // Round domain scores
  for (const domain of Object.keys(domainScores)) {
    domainScores[domain] = Math.round(domainScores[domain] * 100) / 100;
  }

  return {
    riskScore: clamp(Math.round(totalScore), 0, 100),
    signalCount: signals.length,
    activeCount,
    criticalCount,
    domainScores,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUT,
    stdout: false,
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

  // Safe skeleton: missing input → zeroed defaults
  let signals = [];
  if (fs.existsSync(args.input)) {
    try {
      const raw = JSON.parse(fs.readFileSync(args.input, 'utf8'));
      signals = Array.isArray(raw.signals) ? raw.signals : [];
    } catch {
      // Malformed JSON → treat as empty (safe skeleton)
      signals = [];
    }
  }

  const summary = calculateRiskSummary(signals);

  const snapshot = {
    signalVersion: SUMMARY_VERSION,
    calculatedAt: new Date().toISOString(),
    inputPath: path.relative(REPO_ROOT, args.input).replace(/\\/g, '/'),
    ...summary,
  };

  const json = JSON.stringify(snapshot, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Risk signal summary written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

main();
