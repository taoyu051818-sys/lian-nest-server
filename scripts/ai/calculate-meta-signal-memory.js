#!/usr/bin/env node

/**
 * calculate-meta-signal-memory.js
 *
 * Reads a directory of historical meta-signals snapshots and produces a
 * structured memory retrieval layer following MemGPT-style tiered memory:
 *   - Working memory: recent, high-impact signals for immediate decisions
 *   - Archival memory: compressed patterns and trends from history
 *   - Episodic memory: notable events and state transitions
 *   - Relevance ranking: cross-tier ranking for issue production focus
 *
 * Safe skeleton: when input directory is missing or empty, produces a
 * valid zeroed-out snapshot so downstream consumers never break.
 *
 * Usage:
 *   node scripts/ai/calculate-meta-signal-memory.js --help
 *   node scripts/ai/calculate-meta-signal-memory.js
 *   node scripts/ai/calculate-meta-signal-memory.js --historyDir path/
 *   node scripts/ai/calculate-meta-signal-memory.js --out .github/ai-state/meta-signal-memory.json
 *   node scripts/ai/calculate-meta-signal-memory.js --stdout
 *
 * Exit codes:
 *   0 — snapshot produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_HISTORY_DIR = path.join(REPO_ROOT, '.github', 'ai-state', 'meta-signals-history');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'meta-signal-memory.json');

const SCHEMA_VERSION = 1;
const DEFAULT_WORKING_WINDOW = 5;
const DEFAULT_TOP_GAPS = 10;

// Relevance weights
const RECENCY_WEIGHT = 0.4;
const SEVERITY_WEIGHT = 0.35;
const FREQUENCY_WEIGHT = 0.25;

// Episode detection thresholds
const TRUST_DROP_THRESHOLD = 15;
const FAILURE_SPIKE_THRESHOLD = 20;
const FRICTION_SURGE_THRESHOLD = 25;

// Decay half-life in hours (signals older than this lose half their relevance)
const DECAY_HALF_LIFE_HOURS = 72;

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
calculate-meta-signal-memory.js — Structured memory retrieval layer for meta-signals

USAGE
    node scripts/ai/calculate-meta-signal-memory.js [options]

OPTIONS
    --historyDir <path>    Directory containing historical meta-signals JSON snapshots
                           (default: .github/ai-state/meta-signals-history/)
    --workingWindow <n>    Number of recent snapshots for working memory (default: 5)
    --topGaps <n>          Number of top gaps in relevance ranking (default: 10)
    --out <path>           Output path for the memory JSON
                           (default: .github/ai-state/meta-signal-memory.json)
    --stdout               Print JSON to stdout instead of writing a file
    --help                 Show this help message and exit.

MEMORY TIERS
    working    Recent, high-impact signals for immediate decision-making
    archival   Compressed historical patterns and trends
    episodic   Notable events: trust drops, failure spikes, recoveries

EXIT CODES
    0   Snapshot produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function shortUuid() {
  return crypto.randomBytes(4).toString('hex');
}

function shortHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Snapshot loading ─────────────────────────────────────────────────────────

function loadSnapshots(historyDir) {
  if (!historyDir || !fs.existsSync(historyDir)) return [];

  const files = fs.readdirSync(historyDir)
    .filter((f) => f.endsWith('.json'))
    .sort(); // lexicographic sort — works if filenames include timestamps

  const snapshots = [];
  for (const file of files) {
    const filePath = path.join(historyDir, file);
    const data = readJson(filePath);
    if (data && data.signals && data.calculatedAt) {
      snapshots.push({
        file,
        ...data,
      });
    }
  }
  return snapshots;
}

// ── Relevance scoring ────────────────────────────────────────────────────────

function computeDecayFactor(capturedAt, now) {
  if (!capturedAt) return 0.5;
  const ageHours = (now - new Date(capturedAt).getTime()) / (1000 * 60 * 60);
  return Math.pow(0.5, ageHours / DECAY_HALF_LIFE_HOURS);
}

function computeRelevanceScore(signals, decayFactor) {
  const failureNorm = (signals.failureScore || 0) / 100;
  const frictionNorm = (signals.frictionScore || 0) / 100;
  const riskNorm = (signals.riskScore || 0) / 100;
  const trustNorm = (100 - (signals.trust || 100)) / 100; // invert: low trust = high relevance

  const severityComponent = (failureNorm * 0.3 + frictionNorm * 0.2 + riskNorm * 0.3 + trustNorm * 0.2);
  const recencyComponent = decayFactor;

  // Frequency component is 1.0 for individual signals (boosted later for patterns)
  const frequencyComponent = 1.0;

  const raw = (RECENCY_WEIGHT * recencyComponent + SEVERITY_WEIGHT * severityComponent + FREQUENCY_WEIGHT * frequencyComponent) * 100;
  return clamp(Math.round(raw * 10) / 10, 0, 100);
}

// ── Working memory ───────────────────────────────────────────────────────────

function buildWorkingMemory(snapshots, windowSize, now) {
  // Take the most recent N snapshots
  const recent = snapshots.slice(-windowSize);
  const signals = recent.map((snap) => {
    const decayFactor = computeDecayFactor(snap.calculatedAt, now);
    const relevanceScore = computeRelevanceScore(snap.signals, decayFactor);
    return {
      signalId: `mem-${shortUuid()}`,
      tier: 'working',
      relevanceScore,
      capturedAt: snap.calculatedAt,
      signals: { ...snap.signals },
      decayFactor: Math.round(decayFactor * 1000) / 1000,
    };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);

  const summary = computeTierSummary(recent);

  return { signals, windowSize: recent.length, summary };
}

// ── Archival memory ──────────────────────────────────────────────────────────

function buildArchivalMemory(snapshots, now) {
  if (snapshots.length === 0) {
    return { patterns: [], windowSize: 0, summary: emptyTierSummary() };
  }

  // Aggregate by category
  const categoryMap = new Map();

  for (const snap of snapshots) {
    const topPain = snap.signals?.topPain;
    if (!topPain || topPain === 'none') continue;

    if (!categoryMap.has(topPain)) {
      categoryMap.set(topPain, {
        category: topPain,
        frequency: 0,
        totalSeverity: 0,
        firstSeen: snap.calculatedAt,
        lastSeen: snap.calculatedAt,
        snapshots: [],
      });
    }
    const entry = categoryMap.get(topPain);
    entry.frequency++;
    entry.totalSeverity += snap.signals.failureScore || 0;
    if (snap.calculatedAt < entry.firstSeen) entry.firstSeen = snap.calculatedAt;
    if (snap.calculatedAt > entry.lastSeen) entry.lastSeen = snap.calculatedAt;
    entry.snapshots.push(snap);
  }

  // Detect trends: compare first half vs second half frequency
  const patterns = [];
  for (const [category, data] of categoryMap) {
    const mid = Math.floor(data.snapshots.length / 2);
    const firstHalfCount = data.snapshots.slice(0, Math.max(mid, 1)).length;
    const secondHalfCount = data.snapshots.slice(mid).length;
    const ratio = secondHalfCount / Math.max(firstHalfCount, 1);

    let trend = 'stable';
    if (ratio > 1.3) trend = 'increasing';
    else if (ratio < 0.7) trend = 'decreasing';

    patterns.push({
      patternId: `pat-${shortHash(category)}`,
      category,
      trend,
      frequency: data.frequency,
      avgSeverity: Math.round((data.totalSeverity / data.frequency) * 10) / 10,
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
    });
  }

  // Sort by frequency descending
  patterns.sort((a, b) => b.frequency - a.frequency);

  const summary = computeTierSummary(snapshots);

  return { patterns, windowSize: snapshots.length, summary };
}

// ── Episodic memory ──────────────────────────────────────────────────────────

function detectEpisodes(snapshots) {
  if (snapshots.length < 2) return [];

  const episodes = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const pSignals = prev.signals || {};
    const cSignals = curr.signals || {};

    // Trust drop
    const trustDelta = (pSignals.trust || 100) - (cSignals.trust || 100);
    if (trustDelta >= TRUST_DROP_THRESHOLD) {
      episodes.push({
        episodeId: `ep-${shortUuid()}`,
        type: 'trust-drop',
        description: `Trust dropped ${trustDelta} points (from ${pSignals.trust} to ${cSignals.trust}). Top pain: ${cSignals.topPain || 'none'}.`,
        detectedAt: curr.calculatedAt,
        signals: { ...cSignals },
        significance: clamp(Math.round(trustDelta * 1.5), 0, 100),
      });
    }

    // Failure spike
    const failureDelta = (cSignals.failureScore || 0) - (pSignals.failureScore || 0);
    if (failureDelta >= FAILURE_SPIKE_THRESHOLD) {
      episodes.push({
        episodeId: `ep-${shortUuid()}`,
        type: 'failure-spike',
        description: `Failure score spiked ${failureDelta} points (from ${pSignals.failureScore} to ${cSignals.failureScore}). Category: ${cSignals.topPain || 'unknown'}.`,
        detectedAt: curr.calculatedAt,
        signals: { ...cSignals },
        significance: clamp(Math.round(failureDelta * 1.2), 0, 100),
      });
    }

    // Friction surge
    const frictionDelta = (cSignals.frictionScore || 0) - (pSignals.frictionScore || 0);
    if (frictionDelta >= FRICTION_SURGE_THRESHOLD) {
      episodes.push({
        episodeId: `ep-${shortUuid()}`,
        type: 'friction-surge',
        description: `Friction score surged ${frictionDelta} points (from ${pSignals.frictionScore} to ${cSignals.frictionScore}).`,
        detectedAt: curr.calculatedAt,
        signals: { ...cSignals },
        significance: clamp(Math.round(frictionDelta * 1.2), 0, 100),
      });
    }

    // Recovery: trust increased significantly after a low
    const trustIncrease = (cSignals.trust || 0) - (pSignals.trust || 0);
    if (trustIncrease >= TRUST_DROP_THRESHOLD && (pSignals.trust || 100) < 50) {
      episodes.push({
        episodeId: `ep-${shortUuid()}`,
        type: 'recovery',
        description: `System recovered: trust increased ${trustIncrease} points (from ${pSignals.trust} to ${cSignals.trust}).`,
        detectedAt: curr.calculatedAt,
        signals: { ...cSignals },
        significance: clamp(Math.round(trustIncrease), 0, 100),
      });
    }

    // Anomaly: high cost with low failure (unusual)
    if ((cSignals.cost || 0) > 60 && (cSignals.failureScore || 0) < 10 && (cSignals.frictionScore || 0) < 10) {
      episodes.push({
        episodeId: `ep-${shortUuid()}`,
        type: 'anomaly',
        description: `High cost (${cSignals.cost} worker-minutes) with low failure (${cSignals.failureScore}) and low friction (${cSignals.frictionScore}). Possible idle work.`,
        detectedAt: curr.calculatedAt,
        signals: { ...cSignals },
        significance: 30,
      });
    }
  }

  // Sort by significance descending
  episodes.sort((a, b) => b.significance - a.significance);
  return episodes;
}

// ── Relevance ranking ────────────────────────────────────────────────────────

function buildRelevanceRanking(working, archival, episodic, topGaps, now) {
  const entries = [];

  // From working memory
  for (const sig of working.signals) {
    const topPain = sig.signals.topPain || 'none';
    if (topPain !== 'none') {
      entries.push({
        relevanceScore: sig.relevanceScore,
        sourceTier: 'working',
        category: topPain,
        description: `Active failure in category "${topPain}" — failureScore=${sig.signals.failureScore}, trust=${sig.signals.trust}.`,
        signalRef: sig.signalId,
      });
    }
  }

  // From archival memory — increasing trends are more relevant
  for (const pattern of archival.patterns) {
    const trendBoost = pattern.trend === 'increasing' ? 1.3 : pattern.trend === 'decreasing' ? 0.7 : 1.0;
    const baseScore = computeArchivalRelevance(pattern, now);
    entries.push({
      relevanceScore: Math.round(clamp(baseScore * trendBoost, 0, 100) * 10) / 10,
      sourceTier: 'archival',
      category: pattern.category,
      description: `Historical pattern: "${pattern.category}" seen ${pattern.frequency}x, trend=${pattern.trend}, avgSeverity=${pattern.avgSeverity}.`,
      signalRef: pattern.patternId,
    });
  }

  // From episodic memory
  for (const ep of episodic) {
    entries.push({
      relevanceScore: ep.significance,
      sourceTier: 'episodic',
      category: ep.type,
      description: ep.description,
      signalRef: ep.episodeId,
    });
  }

  // Deduplicate by category, keeping highest relevance
  const deduped = new Map();
  for (const entry of entries) {
    const key = `${entry.sourceTier}:${entry.category}`;
    if (!deduped.has(key) || deduped.get(key).relevanceScore < entry.relevanceScore) {
      deduped.set(key, entry);
    }
  }

  // Sort by relevance descending and take top N
  const sorted = Array.from(deduped.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const topGapsList = sorted.slice(0, topGaps).map((entry, i) => ({
    rank: i + 1,
    ...entry,
    signalRef: entry.signalRef || null,
  }));

  return { topGaps: topGapsList, totalRanked: sorted.length };
}

function computeArchivalRelevance(pattern, now) {
  const recencyDecay = computeDecayFactor(pattern.lastSeen, now);
  const frequencyNorm = Math.min(pattern.frequency / 10, 1); // normalize: 10+ appearances = max
  const severityNorm = pattern.avgSeverity / 100;

  return (RECENCY_WEIGHT * recencyDecay + SEVERITY_WEIGHT * severityNorm + FREQUENCY_WEIGHT * frequencyNorm) * 100;
}

// ── Summary helpers ──────────────────────────────────────────────────────────

function emptyTierSummary() {
  return {
    avgFailureScore: 0,
    avgFrictionScore: 0,
    avgTrust: 100,
    topPain: 'none',
    dominantCategory: 'none',
  };
}

function computeTierSummary(snapshots) {
  if (snapshots.length === 0) return emptyTierSummary();

  let totalFailure = 0;
  let totalFriction = 0;
  let totalTrust = 0;
  const painCounts = {};

  for (const snap of snapshots) {
    const s = snap.signals || {};
    totalFailure += s.failureScore || 0;
    totalFriction += s.frictionScore || 0;
    totalTrust += s.trust || 100;
    const pain = s.topPain || 'none';
    if (pain !== 'none') {
      painCounts[pain] = (painCounts[pain] || 0) + 1;
    }
  }

  const n = snapshots.length;
  let topPain = 'none';
  let dominantCategory = 'none';
  let maxCount = 0;
  for (const [cat, count] of Object.entries(painCounts)) {
    if (count > maxCount) {
      topPain = cat;
      dominantCategory = cat;
      maxCount = count;
    }
  }

  return {
    avgFailureScore: Math.round((totalFailure / n) * 10) / 10,
    avgFrictionScore: Math.round((totalFriction / n) * 10) / 10,
    avgTrust: Math.round((totalTrust / n) * 10) / 10,
    topPain,
    dominantCategory,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    historyDir: DEFAULT_HISTORY_DIR,
    workingWindow: DEFAULT_WORKING_WINDOW,
    topGaps: DEFAULT_TOP_GAPS,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--historyDir') {
      i++;
      if (i >= argv.length) { console.error('Error: --historyDir requires a path'); process.exit(2); }
      args.historyDir = argv[i];
    } else if (arg === '--workingWindow') {
      i++;
      if (i >= argv.length) { console.error('Error: --workingWindow requires a number'); process.exit(2); }
      args.workingWindow = parseInt(argv[i], 10);
      if (isNaN(args.workingWindow) || args.workingWindow < 1) {
        console.error('Error: --workingWindow must be a positive integer');
        process.exit(2);
      }
    } else if (arg === '--topGaps') {
      i++;
      if (i >= argv.length) { console.error('Error: --topGaps requires a number'); process.exit(2); }
      args.topGaps = parseInt(argv[i], 10);
      if (isNaN(args.topGaps) || args.topGaps < 1) {
        console.error('Error: --topGaps must be a positive integer');
        process.exit(2);
      }
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

  const now = Date.now();
  const snapshots = loadSnapshots(args.historyDir);

  const working = buildWorkingMemory(snapshots, args.workingWindow, now);
  const archival = buildArchivalMemory(snapshots, now);
  const episodic = detectEpisodes(snapshots);
  const relevanceRanking = buildRelevanceRanking(working, archival, episodic, args.topGaps, now);

  const memory = {
    schemaVersion: SCHEMA_VERSION,
    calculatedAt: new Date(now).toISOString(),
    inputSources: {
      snapshotCount: snapshots.length,
      snapshotPaths: snapshots.map((s) => s.file),
    },
    working,
    archival,
    episodic,
    relevanceRanking,
  };

  const json = JSON.stringify(memory, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Meta signal memory written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

// ── Exports for testing ──────────────────────────────────────────────────────

if (require.main === module) {
  main();
} else {
  module.exports = {
    computeDecayFactor,
    computeRelevanceScore,
    buildWorkingMemory,
    buildArchivalMemory,
    detectEpisodes,
    buildRelevanceRanking,
    computeTierSummary,
    emptyTierSummary,
    loadSnapshots,
    clamp,
    TRUST_DROP_THRESHOLD,
    FAILURE_SPIKE_THRESHOLD,
    FRICTION_SURGE_THRESHOLD,
    DECAY_HALF_LIFE_HOURS,
    RECENCY_WEIGHT,
    SEVERITY_WEIGHT,
    FREQUENCY_WEIGHT,
  };
}
