#!/usr/bin/env node

/**
 * dispatch-recovery-worker.js
 *
 * Detects failed or stale workers and generates recovery dispatch proposals.
 * Reads active-workers.json and worker-trust.json to identify workers that
 * need recovery, then produces dispatch recommendations for the Command Steward.
 *
 * This script fulfills the "Recovery worker auto-dispatch" duty (duty-4) from
 * the Command Steward handoff checklist.
 *
 * Dry-run by default. Pass --live to write the recovery dispatch file.
 *
 * Usage:
 *   node scripts/ai/dispatch-recovery-worker.js [--state-dir <path>] [--live] [--stdout]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(DEFAULT_STATE_DIR, 'recovery-dispatch.json');

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const HEARTBEAT_STALE_MS = 10 * 60 * 1000; // 10 minutes

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function parseArgs(argv) {
  const args = { stateDir: DEFAULT_STATE_DIR, out: DEFAULT_OUT, stdout: false, dryRun: true, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--state-dir') { i++; args.stateDir = path.resolve(argv[i]); }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
    else if (arg === '--stdout') { args.stdout = true; }
    else if (arg === '--dry-run') { args.dryRun = true; }
    else if (arg === '--live') { args.dryRun = false; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('dispatch-recovery-worker.js — Detect and propose recovery for failed/stale workers');
    console.log('Usage: node scripts/ai/dispatch-recovery-worker.js [--state-dir <path>] [--live] [--stdout]');
    process.exit(0);
  }

  const activeWorkers = readJsonFile(path.join(args.stateDir, 'active-workers.json'));
  if (!activeWorkers || !Array.isArray(activeWorkers.workers) || activeWorkers.workers.length === 0) {
    console.log('No active workers found. Nothing to recover.');
    process.exit(0);
  }

  const now = Date.now();
  const workers = activeWorkers.workers;
  const recoveryNeeded = [];

  for (const worker of workers) {
    const status = worker.status || 'unknown';
    const issueNum = worker.issueNumber || worker.issue || '?';
    const startedAt = worker.startedAt ? new Date(worker.startedAt).getTime() : null;
    const endedAt = worker.endedAt;

    // Already finished — no recovery needed
    if (status === 'completed' || status === 'failed' || endedAt) continue;

    // Stale running worker
    if (status === 'running' && startedAt && (now - startedAt) > STALE_THRESHOLD_MS) {
      recoveryNeeded.push({
        issueNumber: issueNum,
        reason: 'stale-running',
        ageMinutes: Math.round((now - startedAt) / 60000),
        branch: worker.branch || null,
        conflictGroup: worker.conflictGroup || null,
        action: 're-dispatch',
      });
      continue;
    }

    // Planned but never started
    if (status === 'planned' && startedAt && (now - startedAt) > STALE_THRESHOLD_MS) {
      recoveryNeeded.push({
        issueNumber: issueNum,
        reason: 'stale-planned',
        ageMinutes: Math.round((now - startedAt) / 60000),
        branch: worker.branch || null,
        conflictGroup: worker.conflictGroup || null,
        action: 're-queue',
      });
    }
  }

  const dispatch = {
    schemaVersion: 1,
    dispatchId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    totalWorkers: workers.length,
    recoveryNeeded: recoveryNeeded.length,
    recommendations: recoveryNeeded,
  };

  if (args.stdout) {
    console.log(JSON.stringify(dispatch, null, 2));
    return;
  }

  if (args.dryRun) {
    console.log('RECOVERY DISPATCH — DRY RUN');
    console.log(`Workers: ${workers.length}, Recovery needed: ${recoveryNeeded.length}`);
    for (const r of recoveryNeeded) {
      console.log(`  Issue #${r.issueNumber}: ${r.reason} (${r.ageMinutes}min) -> ${r.action}`);
    }
    console.log('DRY RUN — No file was modified. Use --live to write.');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(dispatch, null, 2) + '\n', 'utf8');
  console.log(`Recovery dispatch: ${recoveryNeeded.length}/${workers.length} workers need recovery`);
  console.log(`Written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
}

main();
