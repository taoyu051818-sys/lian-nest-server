#!/usr/bin/env node

/**
 * suggest-entropy-reduction-tasks.js
 *
 * Reads an entropy summary snapshot and generates bounded meta-task
 * suggestions that reduce operational entropy. Each suggestion includes
 * risk level, workerClass, allowedFiles hints, and evidence.
 *
 * This is a dry-run / preview-only tool. It NEVER creates GitHub issues or
 * mutates any external state. Output is machine-readable JSON for the
 * planning console or Command Steward consumption.
 *
 * Entropy dimensions:
 *   mainRed        — frequency/severity of main branch red-state episodes
 *   prHandoff      — stalled or failed PR handoff events
 *   workerFriction — stale or silent worker occurrences
 *   mergeConflict  — merge conflict or queue failure events
 *
 * Usage:
 *   node scripts/ai/suggest-entropy-reduction-tasks.js --help
 *   node scripts/ai/suggest-entropy-reduction-tasks.js
 *   node scripts/ai/suggest-entropy-reduction-tasks.js --entropy path/to/entropy-summary.json
 *   node scripts/ai/suggest-entropy-reduction-tasks.js --stdout
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
const DEFAULT_ENTROPY_PATH = path.join(REPO_ROOT, '.github', 'ai-state', 'entropy-summary.json');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'entropy-reduction-tasks.json');

const SCHEMA_VERSION = 1;

// Thresholds for triggering suggestions (0-100 scale)
const THRESHOLDS = {
  mainRed: 30,
  prHandoff: 25,
  workerFriction: 30,
  mergeConflict: 20,
};

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
suggest-entropy-reduction-tasks.js — Entropy reduction task suggester

USAGE
    node scripts/ai/suggest-entropy-reduction-tasks.js [options]

OPTIONS
    --entropy <path>  Path to entropy-summary.json
                      (default: .github/ai-state/entropy-summary.json)
    --out <path>      Output path for suggestions JSON
                      (default: .github/ai-state/entropy-reduction-tasks.json)
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

function suggestFromMainRed(entropy) {
  if (entropy.mainRed <= THRESHOLDS.mainRed) return [];

  const confidence = clamp(Math.round(40 + (entropy.mainRed / 100) * 55), 40, 95);
  const priority = entropy.mainRed >= 70 ? 'critical' : entropy.mainRed >= 50 ? 'high' : 'medium';

  return [{
    id: 'health-gate-stabilize',
    category: 'mainRed',
    title: 'Stabilize main branch health gate',
    reason: `mainRed entropy is ${entropy.mainRed} (threshold ${THRESHOLDS.mainRed}). Frequent red-state episodes indicate systemic health issues.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'foundation-fix',
    allowedFiles: [
      'scripts/ai/write-main-health-state.ps1',
      'scripts/post-merge-health-gate.js',
      '.github/ai-state/main-health.json',
    ],
    evidence: {
      mainRed: entropy.mainRed,
      threshold: THRESHOLDS.mainRed,
      signal: 'main-branch-health',
    },
    actionHint: 'Run health gate, diagnose root cause of red-state, and dispatch a foundation-fix worker to repair.',
  }];
}

function suggestFromPrHandoff(entropy) {
  if (entropy.prHandoff <= THRESHOLDS.prHandoff) return [];

  const confidence = clamp(Math.round(35 + (entropy.prHandoff / 100) * 55), 35, 90);
  const priority = entropy.prHandoff >= 60 ? 'high' : entropy.prHandoff >= 40 ? 'medium' : 'low';

  return [{
    id: 'handoff-guard-check',
    category: 'prHandoff',
    title: 'Add handoff guard checks for stalled PRs',
    reason: `prHandoff entropy is ${entropy.prHandoff} (threshold ${THRESHOLDS.prHandoff}). Stalled or failed handoffs block downstream work.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'docs/ai-native/pr-handoff-template.md',
      'docs/ai-native/command-steward-handoff-examples.md',
      'scripts/ai/state-reconciler.ps1',
    ],
    evidence: {
      prHandoff: entropy.prHandoff,
      threshold: THRESHOLDS.prHandoff,
      signal: 'pr-handoff-stall',
    },
    actionHint: 'Review stalled PR handoffs, update handoff template if needed, and run state reconciler to clear drift.',
  }];
}

function suggestFromWorkerFriction(entropy) {
  if (entropy.workerFriction <= THRESHOLDS.workerFriction) return [];

  const confidence = clamp(Math.round(30 + (entropy.workerFriction / 100) * 60), 30, 90);
  const priority = entropy.workerFriction >= 60 ? 'high' : entropy.workerFriction >= 40 ? 'medium' : 'low';

  return [{
    id: 'worker-friction-reduce',
    category: 'workerFriction',
    title: 'Reduce worker friction from stale or silent workers',
    reason: `workerFriction entropy is ${entropy.workerFriction} (threshold ${THRESHOLDS.workerFriction}). Stale workers consume resources without progress.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'foundation-fix',
    allowedFiles: [
      'scripts/ai/worktree-janitor.ps1',
      '.github/ai-state/active-workers.json',
      '.claude/worktrees/',
    ],
    evidence: {
      workerFriction: entropy.workerFriction,
      threshold: THRESHOLDS.workerFriction,
      signal: 'worker-stale-or-silent',
    },
    actionHint: 'Run worktree janitor in dry-run mode, review stale workers, and terminate or restart unresponsive tasks.',
  }];
}

function suggestFromMergeConflict(entropy) {
  if (entropy.mergeConflict <= THRESHOLDS.mergeConflict) return [];

  const confidence = clamp(Math.round(25 + (entropy.mergeConflict / 100) * 55), 25, 80);
  const priority = entropy.mergeConflict >= 50 ? 'high' : entropy.mergeConflict >= 30 ? 'medium' : 'low';

  return [{
    id: 'merge-queue-stabilize',
    category: 'mergeConflict',
    title: 'Stabilize merge queue and reduce conflict rate',
    reason: `mergeConflict entropy is ${entropy.mergeConflict} (threshold ${THRESHOLDS.mergeConflict}). Queue failures or conflicts block batch progress.`,
    confidence,
    priority,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      '.ai/merge-queue.json',
      '.ai/merge-queue-state.json',
      'scripts/ai/merge-clean-pr-batch.ps1',
    ],
    evidence: {
      mergeConflict: entropy.mergeConflict,
      threshold: THRESHOLDS.mergeConflict,
      signal: 'merge-queue-failure',
    },
    actionHint: 'Review merge queue state, resolve conflicts, and consider rebasing stalled PRs before re-queuing.',
  }];
}

function suggestAllHealthy(entropy) {
  if (
    entropy.mainRed > THRESHOLDS.mainRed ||
    entropy.prHandoff > THRESHOLDS.prHandoff ||
    entropy.workerFriction > THRESHOLDS.workerFriction ||
    entropy.mergeConflict > THRESHOLDS.mergeConflict
  ) {
    return [];
  }

  return [{
    id: 'entropy-low-no-action',
    category: 'health',
    title: 'Entropy is low — no reduction tasks needed',
    reason: `All entropy dimensions are within safe bounds (mainRed=${entropy.mainRed}, prHandoff=${entropy.prHandoff}, workerFriction=${entropy.workerFriction}, mergeConflict=${entropy.mergeConflict}).`,
    confidence: 85,
    priority: 'info',
    risk: 'none',
    workerClass: null,
    allowedFiles: [],
    evidence: {
      mainRed: entropy.mainRed,
      prHandoff: entropy.prHandoff,
      workerFriction: entropy.workerFriction,
      mergeConflict: entropy.mergeConflict,
    },
    actionHint: 'System entropy is low. Safe to proceed with normal operations.',
  }];
}

// ── Core logic ───────────────────────────────────────────────────────────────

function generateSuggestions(entropy) {
  const raw = [
    ...suggestFromMainRed(entropy),
    ...suggestFromPrHandoff(entropy),
    ...suggestFromWorkerFriction(entropy),
    ...suggestFromMergeConflict(entropy),
    ...suggestAllHealthy(entropy),
  ];

  raw.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });

  return raw;
}

function buildOutput(entropy, suggestions) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    entropy: {
      mainRed: entropy.mainRed,
      prHandoff: entropy.prHandoff,
      workerFriction: entropy.workerFriction,
      mergeConflict: entropy.mergeConflict,
    },
    suggestionCount: suggestions.length,
    suggestions,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    entropy: DEFAULT_ENTROPY_PATH,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--entropy') {
      i++;
      if (i >= argv.length) { console.error('Error: --entropy requires a path'); process.exit(2); }
      args.entropy = argv[i];
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

  const snapshot = readJson(args.entropy);

  // Safe skeleton: when entropy summary is missing, use zeroed defaults
  const entropy = snapshot && snapshot.entropy
    ? {
        mainRed: snapshot.entropy.mainRed || 0,
        prHandoff: snapshot.entropy.prHandoff || 0,
        workerFriction: snapshot.entropy.workerFriction || 0,
        mergeConflict: snapshot.entropy.mergeConflict || 0,
      }
    : { mainRed: 0, prHandoff: 0, workerFriction: 0, mergeConflict: 0 };

  const suggestions = generateSuggestions(entropy);
  const output = buildOutput(entropy, suggestions);

  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Entropy reduction tasks written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

main();
