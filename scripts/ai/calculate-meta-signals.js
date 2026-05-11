#!/usr/bin/env node

/**
 * calculate-meta-signals.js
 *
 * Reads planning feedback NDJSON (health checks, heartbeats, PR outcomes)
 * and produces a meta-signals snapshot for the AI-native control plane.
 *
 * Safe skeleton: when input files are missing, produces a zeroed-out default
 * snapshot so downstream consumers never break on absent data.
 *
 * Metrics:
 *   failureScore   — aggregated failure severity (0-100)
 *   frictionScore  — friction from stale workers, no-output episodes (0-100)
 *   riskScore      — unresolved high-risk slices (0-100)
 *   cost           — elapsed worker-minutes in the current batch window
 *   trust          — inverse of failure+friction (0-100, 100 = full trust)
 *   topPain        — category with the highest recent failure count
 *
 * Usage:
 *   node scripts/ai/calculate-meta-signals.js --help
 *   node scripts/ai/calculate-meta-signals.js
 *   node scripts/ai/calculate-meta-signals.js --healthLog path.ndjson --heartbeatLog path.ndjson
 *   node scripts/ai/calculate-meta-signals.js --out .github/ai-state/meta-signals.json
 *
 * Exit codes:
 *   0 — snapshot produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'meta-signals.json');

const FAILURE_WEIGHTS = {
  'dependency/generate': 30,
  'runtime compile': 25,
  'boundary guard': 15,
  'docs guard': 10,
  unknown: 20,
};

const FRICTION_THRESHOLD_SILENT_MS = 60_000;   // running:no-output
const FRICTION_THRESHOLD_STALE_MS = 300_000;   // stale

const SNAPSHOT_VERSION = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
calculate-meta-signals.js — Meta signals calculator for planning feedback

USAGE
    node scripts/ai/calculate-meta-signals.js [options]

OPTIONS
    --healthLog <path>     NDJSON file with health check entries
                           (one JSON object per line)
    --heartbeatLog <path>  NDJSON file with heartbeat snapshots
                           (one JSON object per line)
    --out <path>           Output path for the meta-signals JSON
                           (default: .github/ai-state/meta-signals.json)
    --stdout               Print JSON to stdout instead of writing a file
    --help                 Show this help message and exit.

METRICS
    failureScore   Aggregated failure severity (0-100)
    frictionScore  Friction from stale/silent workers (0-100)
    riskScore      Unresolved high-risk slices (0-100)
    cost           Elapsed worker-minutes in the batch window
    trust          Inverse of failure+friction (0-100, 100=full trust)
    topPain        Category with the highest recent failure count

EXIT CODES
    0   Snapshot produced
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

function calculateFailureScore(healthEntries) {
  if (healthEntries.length === 0) return { score: 0, categoryCounts: {} };
  let total = 0;
  const categoryCounts = {};
  for (const entry of healthEntries) {
    if (entry.state && entry.state !== 'red') continue;
    const cat = entry.category || 'unknown';
    const weight = FAILURE_WEIGHTS[cat] || FAILURE_WEIGHTS.unknown;
    total += weight;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }
  // Normalize: cap at 100
  const raw = Math.min(total, 100);
  return { score: raw, categoryCounts };
}

function calculateFrictionScore(heartbeatEntries) {
  if (heartbeatEntries.length === 0) return 0;
  let frictionPoints = 0;
  for (const entry of heartbeatEntries) {
    if (entry.state === 'stale') {
      frictionPoints += 30;
    } else if (entry.state === 'running:no-output') {
      frictionPoints += 10;
    }
    if (entry.noOutputMs && entry.noOutputMs > FRICTION_THRESHOLD_STALE_MS) {
      frictionPoints += 20;
    } else if (entry.noOutputMs && entry.noOutputMs > FRICTION_THRESHOLD_SILENT_MS) {
      frictionPoints += 5;
    }
  }
  return clamp(frictionPoints, 0, 100);
}

function calculateRiskScore(healthEntries) {
  if (healthEntries.length === 0) return 0;
  let risk = 0;
  for (const entry of healthEntries) {
    if (entry.severity === 'high' || entry.severity === 'Red') {
      risk += 20;
    } else if (entry.severity === 'medium' || entry.severity === 'Yellow') {
      risk += 10;
    }
  }
  return clamp(risk, 0, 100);
}

function calculateCost(heartbeatEntries) {
  if (heartbeatEntries.length === 0) return 0;
  let totalMs = 0;
  for (const entry of heartbeatEntries) {
    if (entry.elapsedMs && entry.elapsedMs > 0) {
      totalMs += entry.elapsedMs;
    }
  }
  // Convert to worker-minutes
  return Math.round(totalMs / 60_000);
}

function calculateTrust(failureScore, frictionScore) {
  const combined = (failureScore * 0.6) + (frictionScore * 0.4);
  return clamp(Math.round(100 - combined), 0, 100);
}

function findTopPain(categoryCounts) {
  if (!categoryCounts || Object.keys(categoryCounts).length === 0) return 'none';
  let topCat = 'none';
  let topCount = 0;
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > topCount) {
      topCat = cat;
      topCount = count;
    }
  }
  return topCat;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    healthLog: null,
    heartbeatLog: null,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--healthLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --healthLog requires a path'); process.exit(2); }
      args.healthLog = argv[i];
    } else if (arg === '--heartbeatLog') {
      i++;
      if (i >= argv.length) { console.error('Error: --heartbeatLog requires a path'); process.exit(2); }
      args.heartbeatLog = argv[i];
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

  const healthEntries = readNdjson(args.healthLog);
  const heartbeatEntries = readNdjson(args.heartbeatLog);

  const { score: failureScore, categoryCounts } = calculateFailureScore(healthEntries);
  const frictionScore = calculateFrictionScore(heartbeatEntries);
  const riskScore = calculateRiskScore(healthEntries);
  const cost = calculateCost(heartbeatEntries);
  const trust = calculateTrust(failureScore, frictionScore);
  const topPain = findTopPain(categoryCounts);

  const snapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    calculatedAt: new Date().toISOString(),
    inputSources: {
      healthLog: args.healthLog || null,
      heartbeatLog: args.heartbeatLog || null,
      healthEntryCount: healthEntries.length,
      heartbeatEntryCount: heartbeatEntries.length,
    },
    signals: {
      failureScore,
      frictionScore,
      riskScore,
      cost,
      trust,
      topPain,
    },
  };

  const json = JSON.stringify(snapshot, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Meta signals written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

main();
