#!/usr/bin/env node

/**
 * calculate-operational-entropy.js
 *
 * Reads fixture/fact inputs for five friction sources (state drift, PR
 * rejection, main red, docs conflict, token overrun) and produces a
 * normalized operational entropy summary for the AI-native control plane.
 *
 * Safe skeleton: when input files are missing or empty, produces a
 * zeroed-out default summary so downstream consumers never break on
 * absent data.
 *
 * Entropy sources:
 *   stateDrift    — reconciliation drift detections (weight 25)
 *   prRejection   — PR rejection events (weight 20)
 *   mainRed       — main branch health red events (weight 30)
 *   docsConflict  — documentation conflict detections (weight 10)
 *   tokenOverrun  — token budget overrun events (weight 15)
 *
 * Usage:
 *   node scripts/ai/calculate-operational-entropy.js --help
 *   node scripts/ai/calculate-operational-entropy.js
 *   node scripts/ai/calculate-operational-entropy.js --stateDriftLog path.ndjson
 *   node scripts/ai/calculate-operational-entropy.js --out .github/ai-state/operational-entropy.json
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
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'operational-entropy.json');

const SNAPSHOT_VERSION = 1;

const SOURCE_WEIGHTS = {
  stateDrift: 25,
  prRejection: 20,
  mainRed: 30,
  docsConflict: 10,
  tokenOverrun: 15,
};

const SEVERITY_MULTIPLIERS = {
  critical: 2.0,
  high: 1.5,
  medium: 1.0,
  low: 0.5,
  info: 0.1,
};

const SOURCE_KEYS = [
  'stateDrift',
  'prRejection',
  'mainRed',
  'docsConflict',
  'tokenOverrun',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
calculate-operational-entropy.js — Operational entropy calculator

USAGE
    node scripts/ai/calculate-operational-entropy.js [options]

OPTIONS
    --stateDriftLog <path>    NDJSON with state drift entries
    --prRejectionLog <path>   NDJSON with PR rejection entries
    --mainRedLog <path>       NDJSON with main-red health entries
    --docsConflictLog <path>  NDJSON with docs conflict entries
    --tokenOverrunLog <path>  NDJSON with token overrun entries
    --out <path>              Output path (default: .github/ai-state/operational-entropy.json)
    --stdout                  Print JSON to stdout instead of writing a file
    --help                    Show this help message and exit.

ENTROPY SOURCES
    stateDrift     Reconciliation drift detections  (weight 25)
    prRejection    PR rejection events              (weight 20)
    mainRed        Main branch health red events     (weight 30)
    docsConflict   Documentation conflict detections (weight 10)
    tokenOverrun   Token budget overrun events       (weight 15)

EXIT CODES
    0   Summary produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
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

// ── Metric calculators ───────────────────────────────────────────────────────

function calculateSourceScore(entries, sourceKey) {
  if (entries.length === 0) return 0;
  const weight = SOURCE_WEIGHTS[sourceKey] || 10;
  let total = 0;
  for (const entry of entries) {
    const severity = entry.severity || 'medium';
    const multiplier = SEVERITY_MULTIPLIERS[severity] || 1.0;
    total += weight * multiplier;
  }
  return clamp(Math.round(total), 0, 100);
}

function calculateEntropy(sourceScores) {
  const values = Object.values(sourceScores);
  if (values.length === 0) return 0;
  const total = values.reduce((sum, v) => sum + v, 0);
  // Normalize: each source caps at 100, total caps at 100
  const maxPossible = SOURCE_KEYS.length * 100;
  return clamp(Math.round((total / maxPossible) * 100), 0, 100);
}

function findTopSources(sourceScores) {
  const entries = Object.entries(sourceScores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return [];
  return entries.slice(0, 3).map(([source, score]) => ({ source, score }));
}

function calculateBreakdown(sourceScores) {
  const total = Object.values(sourceScores).reduce((sum, v) => sum + v, 0);
  if (total === 0) return {};
  const breakdown = {};
  for (const [key, score] of Object.entries(sourceScores)) {
    breakdown[key] = Math.round((score / total) * 100);
  }
  return breakdown;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    stateDriftLog: null,
    prRejectionLog: null,
    mainRedLog: null,
    docsConflictLog: null,
    tokenOverrunLog: null,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--stateDriftLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --stateDriftLog requires a path'); process.exit(2); }
      args.stateDriftLog = argv[i];
    } else if (arg === '--prRejectionLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --prRejectionLog requires a path'); process.exit(2); }
      args.prRejectionLog = argv[i];
    } else if (arg === '--mainRedLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --mainRedLog requires a path'); process.exit(2); }
      args.mainRedLog = argv[i];
    } else if (arg === '--docsConflictLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --docsConflictLog requires a path'); process.exit(2); }
      args.docsConflictLog = argv[i];
    } else if (arg === '--tokenOverrunLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --tokenOverrunLog requires a path'); process.exit(2); }
      args.tokenOverrunLog = argv[i];
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

  const inputs = {
    stateDrift: readNdjson(args.stateDriftLog),
    prRejection: readNdjson(args.prRejectionLog),
    mainRed: readNdjson(args.mainRedLog),
    docsConflict: readNdjson(args.docsConflictLog),
    tokenOverrun: readNdjson(args.tokenOverrunLog),
  };

  const sourceScores = {};
  for (const key of SOURCE_KEYS) {
    sourceScores[key] = calculateSourceScore(inputs[key], key);
  }

  const entropy = calculateEntropy(sourceScores);
  const topSources = findTopSources(sourceScores);
  const breakdown = calculateBreakdown(sourceScores);

  const snapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    calculatedAt: new Date().toISOString(),
    inputSources: {
      stateDriftLog: args.stateDriftLog || null,
      prRejectionLog: args.prRejectionLog || null,
      mainRedLog: args.mainRedLog || null,
      docsConflictLog: args.docsConflictLog || null,
      tokenOverrunLog: args.tokenOverrunLog || null,
      entryCounts: {
        stateDrift: inputs.stateDrift.length,
        prRejection: inputs.prRejection.length,
        mainRed: inputs.mainRed.length,
        docsConflict: inputs.docsConflict.length,
        tokenOverrun: inputs.tokenOverrun.length,
      },
    },
    entropy,
    sourceScores,
    topSources,
    breakdown,
  };

  const json = JSON.stringify(snapshot, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Operational entropy written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

main();
