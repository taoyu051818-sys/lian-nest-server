#!/usr/bin/env node

/**
 * aggregate-self-cycle-candidates.js
 *
 * Aggregates status bundle, task-board, entropy suggestions, launch/merge/close
 * candidates into a single self-cycle plan. Read-only — produces no side effects.
 *
 * High-risk and human-required items are always blocked. The output is sanitized
 * JSON suitable for planning console or Command Steward consumption.
 *
 * Usage:
 *   node scripts/ai/aggregate-self-cycle-candidates.js --help
 *   node scripts/ai/aggregate-self-cycle-candidates.js --input <path>
 *   node scripts/ai/aggregate-self-cycle-candidates.js --input <path> --stdout
 *
 * Exit codes:
 *   0 — plan produced
 *   2 — invalid arguments or missing input
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, readJson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'self-cycle-plan.json');

const SCHEMA_VERSION = 1;

const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const PRIORITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
aggregate-self-cycle-candidates.js — Self-cycle candidate aggregator (v${SCHEMA_VERSION})

USAGE
    node scripts/ai/aggregate-self-cycle-candidates.js [options]

OPTIONS
    --input <path>  Path to input JSON file (required; fixture-driven, no network).
    --out <path>    Output path (default: .github/ai-state/self-cycle-plan.json).
    --stdout        Print JSON to stdout instead of writing file.
    --help          Show this help message and exit.

INPUT SCHEMA
    {
      "statusBundle": { ... },
      "taskBoard": { "tasks": [...] },
      "entropyReductionTasks": { "suggestions": [...] },
      "launchCandidates": { "candidates": [...] },
      "mergeCandidates": { "mergeable": [...], "blocked": [...], "humanRequired": [...] },
      "closeCandidates": { "candidates": [...] }
    }

    All sections are optional — absent inputs produce empty plan sections.

OUTPUT
    Sanitized JSON self-cycle plan with prioritized actions and explicit blockers.

EXIT CODES
    0   Plan produced
    2   Invalid arguments / missing input
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    input: null,
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

// ── Sanitization ─────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === 'string') {
    if (value.length > 500) return value.slice(0, 500) + '…';
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some(p => p.test(key))) continue;
    result[key] = sanitizeValue(value);
  }
  return result;
}

// ── Status bundle extraction ─────────────────────────────────────────────────

function extractStatusSummary(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return { loaded: false, healthState: 'unknown', blockerCount: 0, blockers: [] };
  }
  const blockers = Array.isArray(bundle.blockers) ? bundle.blockers : [];
  return {
    loaded: true,
    healthState: bundle.health && bundle.health.state ? bundle.health.state : 'unknown',
    blockerCount: blockers.length,
    blockers: blockers.map(b => ({
      source: b.source || 'unknown',
      severity: b.severity || 'info',
      message: typeof b.message === 'string' ? b.message.slice(0, 200) : '',
    })),
  };
}

// ── Task board extraction ────────────────────────────────────────────────────

function extractTaskBoardSummary(board) {
  if (!board || !Array.isArray(board.tasks)) {
    return { loaded: false, totalCount: 0, open: 0, running: 0, blocked: 0, done: 0, ready: 0 };
  }
  const tasks = board.tasks;
  return {
    loaded: true,
    totalCount: tasks.length,
    open: tasks.filter(t => t.state === 'open').length,
    running: tasks.filter(t => t.state === 'running').length,
    blocked: tasks.filter(t => t.state === 'blocked').length,
    done: tasks.filter(t => t.state === 'done').length,
    ready: tasks.filter(t => t.state === 'ready').length,
  };
}

// ── Entropy suggestions extraction ───────────────────────────────────────────

function extractEntropySuggestions(entropy) {
  if (!entropy || !Array.isArray(entropy.suggestions)) {
    return { loaded: false, count: 0, suggestions: [] };
  }
  return {
    loaded: true,
    count: entropy.suggestions.length,
    suggestions: entropy.suggestions.map(s => ({
      id: s.id || '',
      title: typeof s.title === 'string' ? s.title.slice(0, 200) : '',
      priority: s.priority || 'info',
      risk: s.risk || 'none',
      category: s.category || '',
      actionHint: typeof s.actionHint === 'string' ? s.actionHint.slice(0, 300) : '',
    })),
  };
}

// ── Launch candidates extraction ─────────────────────────────────────────────

function extractLaunchCandidates(launch) {
  if (!launch || !Array.isArray(launch.candidates)) {
    return { loaded: false, count: 0, candidates: [] };
  }
  return {
    loaded: true,
    count: launch.candidates.length,
    candidates: launch.candidates.map(c => ({
      number: c.number,
      title: typeof c.title === 'string' ? c.title.slice(0, 200) : '',
      workerClass: c.workerClass || 'unknown',
      risk: c.risk || 'medium',
    })),
  };
}

// ── Merge candidates extraction ──────────────────────────────────────────────

function extractMergeCandidates(merge) {
  if (!merge) {
    return { loaded: false, mergeable: 0, blocked: 0, humanRequired: 0, items: [] };
  }
  const mergeable = Array.isArray(merge.mergeable) ? merge.mergeable : [];
  const blocked = Array.isArray(merge.blocked) ? merge.blocked : [];
  const humanRequired = Array.isArray(merge.humanRequired) ? merge.humanRequired : [];

  return {
    loaded: true,
    mergeable: mergeable.length,
    blocked: blocked.length,
    humanRequired: humanRequired.length,
    items: [
      ...mergeable.map(pr => ({ number: pr.number, title: typeof pr.title === 'string' ? pr.title.slice(0, 200) : '', classification: 'mergeable' })),
      ...blocked.map(pr => ({ number: pr.number, title: typeof pr.title === 'string' ? pr.title.slice(0, 200) : '', classification: 'blocked' })),
      ...humanRequired.map(pr => ({ number: pr.number, title: typeof pr.title === 'string' ? pr.title.slice(0, 200) : '', classification: 'humanRequired' })),
    ],
  };
}

// ── Close candidates extraction ──────────────────────────────────────────────

function extractCloseCandidates(close) {
  if (!close || !Array.isArray(close.candidates)) {
    return { loaded: false, count: 0, candidates: [] };
  }
  return {
    loaded: true,
    count: close.candidates.length,
    candidates: close.candidates.map(c => ({
      issueNumber: c.issueNumber,
      title: typeof c.title === 'string' ? c.title.slice(0, 200) : '',
      mergedPR: c.mergedPR || null,
    })),
  };
}

// ── Blocking logic ───────────────────────────────────────────────────────────

function buildBlockers(statusSummary, mergeSummary, launchSummary, closeSummary) {
  const blockers = [];

  // Status bundle blockers (health, telemetry)
  for (const b of statusSummary.blockers) {
    blockers.push({ ...b, source: 'statusBundle' });
  }

  // High-risk launch candidates are blocked
  if (launchSummary.loaded) {
    for (const c of launchSummary.candidates) {
      if (c.risk === 'high' || c.risk === 'critical') {
        blockers.push({
          source: 'launchCandidates',
          severity: c.risk === 'critical' ? 'critical' : 'high',
          message: `Launch candidate #${c.number} is ${c.risk}-risk — requires human approval`,
          candidate: c.number,
        });
      }
    }
  }

  // Blocked and humanRequired merge candidates
  if (mergeSummary.loaded) {
    for (const item of mergeSummary.items) {
      if (item.classification === 'blocked') {
        blockers.push({
          source: 'mergeCandidates',
          severity: 'high',
          message: `PR #${item.number} has dirty/unknown merge state — blocked`,
          pr: item.number,
        });
      } else if (item.classification === 'humanRequired') {
        blockers.push({
          source: 'mergeCandidates',
          severity: 'medium',
          message: `PR #${item.number} requires human review — blocked`,
          pr: item.number,
        });
      }
    }
  }

  // Close candidates with discussion/umbrella issues are blocked
  if (closeSummary.loaded) {
    for (const c of closeSummary.candidates) {
      const title = (c.title || '').toLowerCase();
      if (/\b(discussion|umbrella|epic|tracking)\b/i.test(title)) {
        blockers.push({
          source: 'closeCandidates',
          severity: 'high',
          message: `Issue #${c.issueNumber} appears to be a discussion/umbrella — must not be auto-closed`,
          issue: c.issueNumber,
        });
      }
    }
  }

  return blockers;
}

// ── Action generation ────────────────────────────────────────────────────────

function generateActions(input) {
  const actions = [];

  // Launch actions from low/medium-risk candidates
  const launch = input.launchCandidates;
  if (launch && Array.isArray(launch.candidates)) {
    for (const c of launch.candidates) {
      if (c.risk !== 'high' && c.risk !== 'critical') {
        actions.push({
          type: 'launch',
          issue: c.number,
          title: typeof c.title === 'string' ? c.title.slice(0, 200) : '',
          workerClass: c.workerClass || 'runtime-feature',
          risk: c.risk || 'medium',
          priority: c.risk === 'low' ? 'low' : 'medium',
        });
      }
    }
  }

  // Merge actions from mergeable PRs
  const merge = input.mergeCandidates;
  if (merge && Array.isArray(merge.mergeable)) {
    for (const pr of merge.mergeable) {
      actions.push({
        type: 'merge',
        pr: pr.number,
        title: typeof pr.title === 'string' ? pr.title.slice(0, 200) : '',
        risk: 'low',
        priority: 'medium',
      });
    }
  }

  // Close actions from close candidates
  const close = input.closeCandidates;
  if (close && Array.isArray(close.candidates)) {
    for (const c of close.candidates) {
      const title = (c.title || '').toLowerCase();
      // Skip discussion/umbrella — they are blocked above
      if (/\b(discussion|umbrella|epic|tracking)\b/i.test(title)) continue;
      actions.push({
        type: 'close',
        issue: c.issueNumber,
        title: typeof c.title === 'string' ? c.title.slice(0, 200) : '',
        mergedPR: c.mergedPR || null,
        risk: 'low',
        priority: 'low',
      });
    }
  }

  // Entropy reduction actions
  const entropy = input.entropyReductionTasks;
  if (entropy && Array.isArray(entropy.suggestions)) {
    for (const s of entropy.suggestions) {
      if (s.priority === 'info') continue; // skip no-action suggestions
      actions.push({
        type: 'entropyReduction',
        id: s.id || '',
        title: typeof s.title === 'string' ? s.title.slice(0, 200) : '',
        category: s.category || '',
        risk: s.risk || 'low',
        priority: s.priority || 'low',
        actionHint: typeof s.actionHint === 'string' ? s.actionHint.slice(0, 300) : '',
      });
    }
  }

  // Sort by priority descending, then risk descending
  actions.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    const ra = RISK_RANK[a.risk] || 0;
    const rb = RISK_RANK[b.risk] || 0;
    return rb - ra;
  });

  return actions;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

function aggregate(input) {
  const statusSummary = extractStatusSummary(input.statusBundle);
  const taskBoardSummary = extractTaskBoardSummary(input.taskBoard);
  const entropySummary = extractEntropySuggestions(input.entropyReductionTasks);
  const launchSummary = extractLaunchCandidates(input.launchCandidates);
  const mergeSummary = extractMergeCandidates(input.mergeCandidates);
  const closeSummary = extractCloseCandidates(input.closeCandidates);

  const blockers = buildBlockers(statusSummary, mergeSummary, launchSummary, closeSummary);
  const actions = generateActions(input);

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    mode: 'dry-run',
    summary: {
      statusBundle: statusSummary,
      taskBoard: taskBoardSummary,
      entropyReduction: { loaded: entropySummary.loaded, count: entropySummary.count },
      launchCandidates: { loaded: launchSummary.loaded, count: launchSummary.count },
      mergeCandidates: { loaded: mergeSummary.loaded, mergeable: mergeSummary.mergeable, blocked: mergeSummary.blocked, humanRequired: mergeSummary.humanRequired },
      closeCandidates: { loaded: closeSummary.loaded, count: closeSummary.count },
      actionCount: actions.length,
      blockerCount: blockers.length,
    },
    blockers,
    actions,
    details: {
      entropySuggestions: entropySummary.suggestions,
      launchCandidates: launchSummary.candidates,
      mergeItems: mergeSummary.items,
      closeCandidates: closeSummary.candidates,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.input) {
    console.error('Error: --input <path> is required.');
    process.exit(2);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: input file not found: ${inputPath}`);
    process.exit(2);
  }

  const raw = readJson(inputPath);
  if (!raw || typeof raw !== 'object') {
    console.error('Error: input is not valid JSON.');
    process.exit(2);
  }

  const result = aggregate(raw);
  const json = JSON.stringify(sanitizeObject(result), null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Self-cycle plan written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(2);
  });
}

// ── Exports for testing ─────────────────────────────────────────────────────

module.exports = {
  extractStatusSummary,
  extractTaskBoardSummary,
  extractEntropySuggestions,
  extractLaunchCandidates,
  extractMergeCandidates,
  extractCloseCandidates,
  buildBlockers,
  generateActions,
  aggregate,
  SCHEMA_VERSION,
};
