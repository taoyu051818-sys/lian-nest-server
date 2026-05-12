#!/usr/bin/env node

/**
 * calculate-opportunity-signals.js
 *
 * Reads fact events (evidence records) and meta-signals, then applies
 * deterministic rules to produce opportunity signal candidates in draft
 * status. No network access, no secrets — pure local computation.
 *
 * Safe skeleton: when input files are missing or empty, produces zero
 * candidates so downstream consumers never break on absent data.
 *
 * Rules:
 *   1. Filter fact events to evidence.intake entries only.
 *   2. Score each fact by reliability tier and freshness.
 *   3. Group related facts into candidate signals.
 *   4. Assign draft status and default acceptance gate.
 *
 * Usage:
 *   node scripts/ai/calculate-opportunity-signals.js --help
 *   node scripts/ai/calculate-opportunity-signals.js
 *   node scripts/ai/calculate-opportunity-signals.js --factEvents path.ndjson
 *   node scripts/ai/calculate-opportunity-signals.js --out .github/ai-state/opportunity-signals/
 *   node scripts/ai/calculate-opportunity-signals.js --stdout
 *
 * Exit codes:
 *   0 — signals produced (may be zero)
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FACT_EVENTS = path.join(REPO_ROOT, '.github', 'ai-state', 'fact-events.ndjson');
const DEFAULT_META_SIGNALS = path.join(REPO_ROOT, '.github', 'ai-state', 'meta-signals.json');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, '.github', 'ai-state', 'opportunity-signals');

const SIGNAL_VERSION = 1;
const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours

const RELIABILITY_SCORES = {
  authoritative: 100,
  high: 80,
  medium: 50,
  low: 20,
  untrusted: 0,
};

const SOURCE_CLASS_TIER = {
  'human-instruction': 'authoritative',
  'github-issue': 'high',
  'github-pr': 'high',
  'ci-result': 'high',
  'external-doc': 'medium',
  'web-scan': 'medium',
  'user-paste': 'low',
  'opaque-external': 'untrusted',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
calculate-opportunity-signals.js — Opportunity signal calculator skeleton

USAGE
    node scripts/ai/calculate-opportunity-signals.js [options]

OPTIONS
    --factEvents <path>    NDJSON file with fact event entries
                           (default: .github/ai-state/fact-events.ndjson)
    --metaSignals <path>   JSON file with meta-signals snapshot
                           (default: .github/ai-state/meta-signals.json)
    --out <path>           Output directory for opportunity signal JSON files
                           (default: .github/ai-state/opportunity-signals/)
    --stdout               Print JSON array to stdout instead of writing files
    --dryRun               Show what would be produced without writing
    --help                 Show this help message and exit.

RULES
    1. Filter fact events to evidence.intake entries.
    2. Score each fact by reliability tier and freshness.
    3. Group related facts into candidate signals.
    4. Assign draft status and default acceptance gate.

EXIT CODES
    0   Signals produced (may be zero)
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

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function shortUuid() {
  return crypto.randomBytes(4).toString('hex');
}

function markerHash(title) {
  return crypto.createHash('sha256').update(title).digest('hex').slice(0, 8);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function isStale(capturedAt) {
  if (!capturedAt) return false;
  const age = Date.now() - new Date(capturedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

function scoreFact(event) {
  const facts = event.facts || {};
  const sourceClass = facts.sourceClass || 'opaque-external';
  const tier = facts.reliabilityTier || SOURCE_CLASS_TIER[sourceClass] || 'untrusted';
  const baseScore = RELIABILITY_SCORES[tier] || 0;
  const stale = isStale(event.capturedAt);
  const stalePenalty = stale ? 30 : 0;
  return Math.max(0, baseScore - stalePenalty);
}

// ── Signal builder ───────────────────────────────────────────────────────────

function buildSignal(factEvents, metaSignals) {
  const signalId = `opp-${shortUuid()}`;
  const now = new Date().toISOString();

  const sourceFacts = factEvents.map((ev) => {
    const facts = ev.facts || {};
    return {
      factId: `fact:${facts.sourceClass || 'unknown'}:${markerHash(ev.subject || 'unnamed')}`,
      description: ev.subject || 'External evidence intake event',
      source: facts.sourceUrl || ev.actor || 'unknown',
      observedAt: ev.capturedAt || now,
      confidence: facts.reliabilityTier === 'high' ? 'high'
        : facts.reliabilityTier === 'authoritative' ? 'high'
        : facts.reliabilityTier === 'medium' ? 'medium'
        : 'low',
    };
  });

  const topPain = metaSignals?.signals?.topPain || 'none';
  const failureScore = metaSignals?.signals?.failureScore || 0;

  return {
    schemaVersion: SIGNAL_VERSION,
    signalId,
    createdAt: now,
    status: 'draft',
    tags: [],
    sourceFacts,
    hypothesis: {
      claim: `External evidence suggests an opportunity related to ${topPain !== 'none' ? topPain : 'system health'}.`,
      reasoning: `${sourceFacts.length} fact(s) with aggregate score above threshold. ` +
        `Meta-signal failureScore=${failureScore}, topPain=${topPain}.`,
      alternativesConsidered: [],
    },
    expectedImpact: {
      metric: 'system health',
      currentValue: `failureScore=${failureScore}`,
      targetValue: 'failureScore=0',
      timeToImpact: 'unknown',
      confidence: 'low',
    },
    experiment: {
      type: 'data-collection',
      description: 'Collect additional evidence to validate or reject this hypothesis.',
      scope: 'analysis only — no code changes',
      successCriteria: [
        'Source facts verified against primary data source',
        'Hypothesis narrowed to a single falsifiable claim',
      ],
    },
    risk: {
      level: 'low',
      concerns: ['Signal is auto-generated and may be noisy.'],
      mitigations: ['Human review required before promotion.'],
    },
    acceptanceGate: {
      requiredReviewRoles: ['architect'],
      acceptanceOwner: 'codex orchestrator',
      criteria: [
        'Source facts verified against primary data source',
        'Hypothesis is falsifiable with a concrete experiment',
        'Experiment scope does not touch forbidden files',
      ],
      healthGate: 'gate-all',
    },
    promotedTaskId: null,
    rejectionReason: null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    factEvents: DEFAULT_FACT_EVENTS,
    metaSignals: DEFAULT_META_SIGNALS,
    outDir: DEFAULT_OUT_DIR,
    stdout: false,
    dryRun: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--factEvents') {
      i++;
      if (i >= argv.length) { console.error('Error: --factEvents requires a path'); process.exit(2); }
      args.factEvents = argv[i];
    } else if (arg === '--metaSignals') {
      i++;
      if (i >= argv.length) { console.error('Error: --metaSignals requires a path'); process.exit(2); }
      args.metaSignals = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.outDir = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--dryRun') {
      args.dryRun = true;
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

  const allEvents = readNdjson(args.factEvents);
  const metaSignals = readJson(args.metaSignals);

  // Filter to evidence.intake events only
  const intakeEvents = allEvents.filter((ev) => ev.eventType === 'evidence.intake');

  // Score and filter: only facts above threshold become signal candidates
  const SCORE_THRESHOLD = 40;
  const scored = intakeEvents
    .map((ev) => ({ event: ev, score: scoreFact(ev) }))
    .filter((s) => s.score >= SCORE_THRESHOLD);

  // Build signal — group all qualifying facts into one candidate
  const signals = [];
  if (scored.length > 0) {
    const signal = buildSignal(
      scored.map((s) => s.event),
      metaSignals,
    );
    signals.push(signal);
  }

  const summary = {
    calculatedAt: new Date().toISOString(),
    inputSources: {
      factEvents: args.factEvents,
      metaSignals: args.metaSignals,
      totalEvents: allEvents.length,
      intakeEvents: intakeEvents.length,
      qualifyingFacts: scored.length,
    },
    signalCount: signals.length,
    signals,
  };

  const json = JSON.stringify(summary, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else if (args.dryRun) {
    process.stdout.write(`[dry-run] Would produce ${signals.length} signal(s)\n`);
    for (const sig of signals) {
      process.stdout.write(`  ${sig.signalId}: ${sig.sourceFacts.length} fact(s), status=${sig.status}\n`);
    }
  } else {
    fs.mkdirSync(args.outDir, { recursive: true });
    const outFile = path.join(args.outDir, 'opportunity-signals-summary.json');
    fs.writeFileSync(outFile, json, 'utf8');
    process.stdout.write(`Opportunity signals written to ${path.relative(REPO_ROOT, outFile).replace(/\\/g, '/')}\n`);
    process.stdout.write(`  Total events: ${allEvents.length}, Intake events: ${intakeEvents.length}, Signals: ${signals.length}\n`);
  }
}

main();
