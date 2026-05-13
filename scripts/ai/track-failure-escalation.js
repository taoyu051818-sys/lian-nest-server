#!/usr/bin/env node

/**
 * track-failure-escalation.js
 *
 * Tracks per-issue failure counts and determines escalation level.
 * Uses a rolling 24-hour window to prune stale failures.
 *
 * Escalation levels:
 *   L0 (Retry)          — 1 failure: standard defer/relaunch
 *   L1 (Rescope)        — 2 failures: narrow allowedFiles scope
 *   L2 (Reduce Autonomy) — 3 failures: add human review gate
 *   L3 (Halt)           — 5 failures: stop task, create escalation issue
 *
 * Usage:
 *   node scripts/ai/track-failure-escalation.js --record --issue 1413 --error-class PROVIDER_UNAVAILABLE --step batch-launch --worker-type execution
 *   node scripts/ai/track-failure-escalation.js --status 1413
 *   node scripts/ai/track-failure-escalation.js --reset 1413
 *   node scripts/ai/track-failure-escalation.js --set-level L0 --issue 1413
 *   node scripts/ai/track-failure-escalation.js --prune
 *   node scripts/ai/track-failure-escalation.js --help
 *
 * Exit codes:
 *   0 — operation completed
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_FILE = path.join(REPO_ROOT, '.github', 'ai-state', 'escalation-tracker.json');
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const SCHEMA_VERSION = 1;

// ── Escalation thresholds ────────────────────────────────────────────────────

const THRESHOLDS = [
  { level: 'L3', minFailures: 5, label: 'escalation:halted' },
  { level: 'L2', minFailures: 3, label: 'escalation:reduced-autonomy' },
  { level: 'L1', minFailures: 2, label: 'escalation:rescoped' },
  { level: 'L0', minFailures: 1, label: null },
];

function getEscalationLevel(failureCount) {
  for (const t of THRESHOLDS) {
    if (failureCount >= t.minFailures) return t;
  }
  return { level: 'L0', minFailures: 0, label: null };
}

// ── State file I/O ───────────────────────────────────────────────────────────

function loadState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: SCHEMA_VERSION, entries: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: SCHEMA_VERSION, entries: {} };
  }
}

function saveState(filePath, state) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── Failure window pruning ───────────────────────────────────────────────────

function pruneOldFailures(entry, now) {
  const cutoff = now - WINDOW_MS;
  entry.history = (entry.history || []).filter(h => new Date(h.failureAt).getTime() >= cutoff);
  entry.failureCount = entry.history.length;

  if (entry.failureCount === 0) {
    entry.currentLevel = 'L0';
    entry.lastErrorClass = null;
    entry.lastFailureAt = null;
  } else {
    const levelInfo = getEscalationLevel(entry.failureCount);
    entry.currentLevel = levelInfo.level;
    entry.lastFailureAt = entry.history[entry.history.length - 1].failureAt;
    entry.lastErrorClass = entry.history[entry.history.length - 1].errorClass;
  }
}

function pruneAllEntries(state, now) {
  for (const [key, entry] of Object.entries(state.entries)) {
    pruneOldFailures(entry, now);
    if (entry.failureCount === 0) {
      delete state.entries[key];
    }
  }
}

// ── Record a failure ─────────────────────────────────────────────────────────

function recordFailure(state, issueNumber, errorClass, step, workerType, now) {
  const key = String(issueNumber);
  if (!state.entries[key]) {
    state.entries[key] = {
      issueNumber,
      failureCount: 0,
      currentLevel: 'L0',
      lastFailureAt: null,
      lastErrorClass: null,
      history: [],
    };
  }

  const entry = state.entries[key];
  entry.history.push({
    failureAt: new Date(now).toISOString(),
    errorClass: errorClass || 'UNKNOWN',
    step: step || 'unknown',
    workerType: workerType || 'unknown',
  });

  pruneOldFailures(entry, now);
  return entry;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
track-failure-escalation.js — Per-issue failure escalation tracker (v1)

Usage:
  node scripts/ai/track-failure-escalation.js [options]

Options:
  --record              Record a failure for an issue
  --status <number>     Show escalation status for an issue
  --reset <number>      Reset failure count for an issue
  --set-level <level>   Override escalation level (L0-L3) for an issue
  --prune               Remove expired failures from all entries
  --state-file <path>   Override state file path
  --issue <number>      Issue number (required with --record, --set-level)
  --error-class <name>  Error class from classify-self-cycle-failure.js
  --step <name>         Pipeline step that failed
  --worker-type <type>  Worker type that failed
  --json                Output as JSON (with --status)
  --help                Show this help message

Escalation levels:
  L0 (Retry)           1 failure  — standard defer/relaunch
  L1 (Rescope)         2 failures — narrow allowedFiles scope
  L2 (Reduce Autonomy) 3 failures — add human review gate
  L3 (Halt)            5 failures — stop task, escalate to human

Exit codes:
  0  Operation completed
  2  Invalid arguments
`.trim();
  console.log(help);
}

function parseArgs(args) {
  const opts = {
    action: null,
    issue: null,
    errorClass: null,
    step: null,
    workerType: null,
    level: null,
    stateFile: DEFAULT_STATE_FILE,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--record':
        opts.action = 'record';
        break;
      case '--status':
        opts.action = 'status';
        opts.issue = parseInt(args[++i], 10);
        break;
      case '--reset':
        opts.action = 'reset';
        opts.issue = parseInt(args[++i], 10);
        break;
      case '--set-level':
        opts.action = 'set-level';
        opts.level = args[++i];
        break;
      case '--prune':
        opts.action = 'prune';
        break;
      case '--issue':
        opts.issue = parseInt(args[++i], 10);
        break;
      case '--error-class':
        opts.errorClass = args[++i];
        break;
      case '--step':
        opts.step = args[++i];
        break;
      case '--worker-type':
        opts.workerType = args[++i];
        break;
      case '--state-file':
        opts.stateFile = args[++i];
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return opts;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const opts = parseArgs(args);
  const now = Date.now();

  if (!opts.action) {
    console.error('Error: no action specified. Use --record, --status, --reset, --set-level, or --prune.');
    process.exit(2);
  }

  const state = loadState(opts.stateFile);

  switch (opts.action) {
    case 'record': {
      if (!opts.issue) {
        console.error('Error: --issue is required with --record.');
        process.exit(2);
      }
      const entry = recordFailure(state, opts.issue, opts.errorClass, opts.step, opts.workerType, now);
      saveState(opts.stateFile, state);
      const levelInfo = getEscalationLevel(entry.failureCount);
      console.log(JSON.stringify({
        issueNumber: opts.issue,
        failureCount: entry.failureCount,
        currentLevel: entry.currentLevel,
        label: levelInfo.label,
        lastErrorClass: entry.lastErrorClass,
        action: entry.currentLevel === 'L3' ? 'halt' :
                entry.currentLevel === 'L2' ? 'reduce-autonomy' :
                entry.currentLevel === 'L1' ? 'rescope' : 'retry',
      }, null, 2));
      break;
    }

    case 'status': {
      if (!opts.issue) {
        console.error('Error: --issue number required with --status.');
        process.exit(2);
      }
      const key = String(opts.issue);
      const entry = state.entries[key];
      if (!entry) {
        if (opts.json) {
          console.log(JSON.stringify({ issueNumber: opts.issue, failureCount: 0, currentLevel: 'L0', history: [] }, null, 2));
        } else {
          console.log(`Issue #${opts.issue}: no failures tracked (L0)`);
        }
      } else {
        pruneOldFailures(entry, now);
        if (opts.json) {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          const levelInfo = getEscalationLevel(entry.failureCount);
          console.log(`Issue #${entry.issueNumber}: ${entry.failureCount} failures, level ${entry.currentLevel}`);
          if (levelInfo.label) console.log(`  Label: ${levelInfo.label}`);
          console.log(`  Last failure: ${entry.lastFailureAt} (${entry.lastErrorClass})`);
          console.log(`  History (last 24h):`);
          for (const h of entry.history) {
            console.log(`    ${h.failureAt} — ${h.errorClass} @ ${h.step} (${h.workerType})`);
          }
        }
      }
      break;
    }

    case 'reset': {
      if (!opts.issue) {
        console.error('Error: --issue number required with --reset.');
        process.exit(2);
      }
      const key = String(opts.issue);
      if (state.entries[key]) {
        delete state.entries[key];
        saveState(opts.stateFile, state);
        console.log(`Issue #${opts.issue}: escalation reset to L0.`);
      } else {
        console.log(`Issue #${opts.issue}: no escalation data found.`);
      }
      break;
    }

    case 'set-level': {
      if (!opts.issue || !opts.level) {
        console.error('Error: --issue and --level are required with --set-level.');
        process.exit(2);
      }
      const validLevels = ['L0', 'L1', 'L2', 'L3'];
      if (!validLevels.includes(opts.level)) {
        console.error(`Error: invalid level "${opts.level}". Must be one of: ${validLevels.join(', ')}`);
        process.exit(2);
      }
      const key = String(opts.issue);
      if (!state.entries[key]) {
        state.entries[key] = {
          issueNumber: opts.issue,
          failureCount: 0,
          currentLevel: 'L0',
          lastFailureAt: null,
          lastErrorClass: null,
          history: [],
        };
      }
      state.entries[key].currentLevel = opts.level;
      if (opts.level === 'L0') {
        state.entries[key].failureCount = 0;
        state.entries[key].history = [];
        state.entries[key].lastFailureAt = null;
        state.entries[key].lastErrorClass = null;
      }
      saveState(opts.stateFile, state);
      console.log(`Issue #${opts.issue}: escalation level set to ${opts.level}.`);
      break;
    }

    case 'prune': {
      const before = Object.keys(state.entries).length;
      pruneAllEntries(state, now);
      const after = Object.keys(state.entries).length;
      saveState(opts.stateFile, state);
      console.log(`Pruned ${before - after} expired entries. ${after} entries remain.`);
      break;
    }
  }
}

main();
