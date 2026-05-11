#!/usr/bin/env node

/**
 * suggest-next-tasks-from-meta-signals.js
 *
 * Reads a meta-signals snapshot (produced by calculate-meta-signals.js) and
 * generates deterministic next-task suggestions for the planning console.
 *
 * This is a dry-run / preview-only tool. It NEVER creates GitHub issues or
 * mutates any external state. Output is machine-readable JSON for WebUI
 * consumption or human-readable console text.
 *
 * Each suggestion includes a category, title, reason, confidence (0-100),
 * priority level, and the signal values that triggered it.
 *
 * Usage:
 *   node scripts/ai/suggest-next-tasks-from-meta-signals.js --help
 *   node scripts/ai/suggest-next-tasks-from-meta-signals.js
 *   node scripts/ai/suggest-next-tasks-from-meta-signals.js --signals path/to/meta-signals.json
 *   node scripts/ai/suggest-next-tasks-from-meta-signals.js --stdout
 *
 * Exit codes:
 *   0 — suggestions produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SIGNALS_PATH = path.join(REPO_ROOT, '.github', 'ai-state', 'meta-signals.json');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'next-task-suggestions.json');

const SCHEMA_VERSION = 1;

// Thresholds for triggering suggestions
const THRESHOLDS = {
  failureScore: 0,      // any failure is worth addressing
  frictionScore: 30,    // significant friction
  riskScore: 40,        // elevated risk
  trust: 50,            // low trust (inverted — below this triggers)
  cost: 30,             // accumulating worker-minutes
};

// Priority weights for sorting
const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
suggest-next-tasks-from-meta-signals.js — Next-task suggestions from meta-signals

USAGE
    node scripts/ai/suggest-next-tasks-from-meta-signals.js [options]

OPTIONS
    --signals <path>  Path to meta-signals.json
                      (default: .github/ai-state/meta-signals.json)
    --out <path>      Output path for suggestions JSON
                      (default: .github/ai-state/next-task-suggestions.json)
    --stdout          Print JSON to stdout instead of writing a file
    --help            Show this help message and exit.

DRY-RUN SAFETY
    This script NEVER creates GitHub issues or mutates external state.
    All output is preview-only for planning console consumption.

EXIT CODES
    0   Suggestions produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

// ── Suggestion generators ────────────────────────────────────────────────────

/**
 * Each generator receives the parsed signals object and returns an array of
 * suggestion objects (may be empty). Generators are pure functions — they
 * only read signal values and return structured suggestions.
 */

function suggestFromFailure(signals) {
  if (signals.failureScore <= THRESHOLDS.failureScore) return [];
  const topPain = signals.topPain || 'none';
  const painLabel = topPain !== 'none' ? topPain : 'unknown category';

  // Confidence scales with failure severity: 40 at score=1, 95 at score=100
  const confidence = clamp(Math.round(40 + (signals.failureScore / 100) * 55), 40, 95);

  const priority = signals.failureScore >= 60 ? 'critical' : signals.failureScore >= 30 ? 'high' : 'medium';

  return [{
    id: 'fix-top-pain-area',
    category: 'failure',
    title: `Investigate and fix failures in ${painLabel}`,
    reason: `failureScore is ${signals.failureScore} with topPain="${topPain}". Recent health checks report red-state entries in this area.`,
    confidence,
    priority,
    signalValues: { failureScore: signals.failureScore, topPain: signals.topPain },
    actionHint: 'Review recent health check logs for red-state entries and address root causes.',
  }];
}

function suggestFromFriction(signals) {
  if (signals.frictionScore <= THRESHOLDS.frictionScore) return [];

  const confidence = clamp(Math.round(35 + (signals.frictionScore / 100) * 55), 35, 90);
  const priority = signals.frictionScore >= 60 ? 'high' : signals.frictionScore >= 30 ? 'medium' : 'low';

  return [{
    id: 'reduce-worker-friction',
    category: 'friction',
    title: 'Reduce worker friction from stale or silent workers',
    reason: `frictionScore is ${signals.frictionScore}. Workers may be stuck in stale or running:no-output states.`,
    confidence,
    priority,
    signalValues: { frictionScore: signals.frictionScore },
    actionHint: 'Check heartbeat logs for stale workers and restart or terminate unresponsive tasks.',
  }];
}

function suggestFromRisk(signals) {
  if (signals.riskScore <= THRESHOLDS.riskScore) return [];

  const confidence = clamp(Math.round(30 + (signals.riskScore / 100) * 60), 30, 90);
  const priority = signals.riskScore >= 70 ? 'critical' : signals.riskScore >= 40 ? 'high' : 'medium';

  return [{
    id: 'de-risk-high-slices',
    category: 'risk',
    title: 'Mitigate high-risk slices before proceeding',
    reason: `riskScore is ${signals.riskScore}. Unresolved high-severity slices remain in the current batch.`,
    confidence,
    priority,
    signalValues: { riskScore: signals.riskScore },
    actionHint: 'Prioritize low-risk tasks or resolve blocking high-severity slices first.',
  }];
}

function suggestFromTrust(signals) {
  if (signals.trust >= THRESHOLDS.trust) return [];

  const confidence = clamp(Math.round(35 + ((100 - signals.trust) / 100) * 55), 35, 90);
  const priority = signals.trust <= 20 ? 'critical' : signals.trust <= 50 ? 'high' : 'medium';

  return [{
    id: 'rebuild-trust',
    category: 'trust',
    title: 'Rebuild system trust before launching new workers',
    reason: `trust is ${signals.trust} (below ${THRESHOLDS.trust}). Combined failure and friction are eroding confidence.`,
    confidence,
    priority,
    signalValues: { trust: signals.trust, failureScore: signals.failureScore, frictionScore: signals.frictionScore },
    actionHint: 'Address top failure and friction sources before expanding the batch.',
  }];
}

function suggestFromCost(signals) {
  if (signals.cost <= THRESHOLDS.cost) return [];

  const confidence = clamp(Math.round(25 + Math.min(signals.cost / 100, 1) * 50), 25, 75);
  const priority = signals.cost >= 120 ? 'medium' : 'low';

  return [{
    id: 'optimize-cost',
    category: 'cost',
    title: 'Review worker cost accumulation',
    reason: `cost is ${signals.cost} worker-minutes. Extended batch windows may indicate inefficient task distribution.`,
    confidence,
    priority,
    signalValues: { cost: signals.cost },
    actionHint: 'Review task sizing and consider splitting long-running tasks.',
  }];
}

function suggestProceed(signals) {
  // Only suggest "proceed" when ALL signals are healthy
  if (
    signals.failureScore > THRESHOLDS.failureScore ||
    signals.frictionScore > THRESHOLDS.frictionScore ||
    signals.riskScore > THRESHOLDS.riskScore ||
    signals.trust < THRESHOLDS.trust
  ) {
    return [];
  }

  return [{
    id: 'proceed-with-next-batch',
    category: 'health',
    title: 'System is healthy — proceed with next batch',
    reason: `All signals are within safe bounds (trust=${signals.trust}, failure=${signals.failureScore}, friction=${signals.frictionScore}, risk=${signals.riskScore}).`,
    confidence: 85,
    priority: 'info',
    signalValues: {
      trust: signals.trust,
      failureScore: signals.failureScore,
      frictionScore: signals.frictionScore,
      riskScore: signals.riskScore,
    },
    actionHint: 'Safe to launch the next planned batch of workers.',
  }];
}

// ── Core logic ───────────────────────────────────────────────────────────────

function generateSuggestions(signals) {
  const raw = [
    ...suggestFromFailure(signals),
    ...suggestFromFriction(signals),
    ...suggestFromRisk(signals),
    ...suggestFromTrust(signals),
    ...suggestFromCost(signals),
    ...suggestProceed(signals),
  ];

  // Sort: critical first, then high, medium, low, info; within same priority, higher confidence first
  raw.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });

  return raw;
}

function buildOutput(signals, suggestions) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    signals: {
      failureScore: signals.failureScore,
      frictionScore: signals.frictionScore,
      riskScore: signals.riskScore,
      cost: signals.cost,
      trust: signals.trust,
      topPain: signals.topPain,
    },
    suggestionCount: suggestions.length,
    suggestions,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    signals: DEFAULT_SIGNALS_PATH,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--signals') {
      i++;
      if (i >= argv.length) { console.error('Error: --signals requires a path'); process.exit(2); }
      args.signals = argv[i];
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

  const snapshot = readJson(args.signals);

  // Safe skeleton: when meta-signals are missing, use zeroed defaults
  const signals = snapshot && snapshot.signals
    ? {
        failureScore: snapshot.signals.failureScore || 0,
        frictionScore: snapshot.signals.frictionScore || 0,
        riskScore: snapshot.signals.riskScore || 0,
        cost: snapshot.signals.cost || 0,
        trust: snapshot.signals.trust != null ? snapshot.signals.trust : 100,
        topPain: snapshot.signals.topPain || 'none',
      }
    : { failureScore: 0, frictionScore: 0, riskScore: 0, cost: 0, trust: 100, topPain: 'none' };

  const suggestions = generateSuggestions(signals);
  const output = buildOutput(signals, suggestions);

  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Next-task suggestions written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

main();
