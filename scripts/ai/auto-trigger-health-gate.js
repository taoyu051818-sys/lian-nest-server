#!/usr/bin/env node

/**
 * auto-trigger-health-gate.js
 *
 * Auto-triggers the self-cycle safety gate check based on current health state.
 * Reads main-health.json and produces a gate trigger event when health transitions
 * to a degraded or critical state. Idempotent — skips if a recent trigger exists.
 *
 * This script fulfills the "Health gate auto-trigger" duty (duty-3) from the
 * Command Steward handoff checklist.
 *
 * Usage:
 *   node scripts/ai/auto-trigger-health-gate.js [--state-dir <path>] [--stdout]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO_ROOT, readJson } = require('./lib');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(DEFAULT_STATE_DIR, 'health-gate-trigger.json');
const TRIGGER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function parseArgs(argv) {
  const args = { stateDir: DEFAULT_STATE_DIR, out: DEFAULT_OUT, stdout: false, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--state-dir') { i++; args.stateDir = path.resolve(argv[i]); }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
    else if (arg === '--stdout') { args.stdout = true; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('auto-trigger-health-gate.js — Auto-trigger health gate on degraded state');
    console.log('Usage: node scripts/ai/auto-trigger-health-gate.js [--state-dir <path>] [--stdout]');
    process.exit(0);
  }

  const health = readJson(path.join(args.stateDir, 'main-health.json'));
  if (!health) {
    console.log('No main-health.json found. Skipping health gate trigger.');
    process.exit(0);
  }

  const healthState = (health.state || 'unknown').toLowerCase();
  const needsTrigger = ['yellow', 'red', 'black'].includes(healthState);

  // Check cooldown
  const existing = readJson(args.out);
  if (existing && existing.lastTriggerAt) {
    const elapsed = Date.now() - new Date(existing.lastTriggerAt).getTime();
    if (elapsed < TRIGGER_COOLDOWN_MS) {
      console.log(`Health gate trigger in cooldown (${Math.round((TRIGGER_COOLDOWN_MS - elapsed) / 1000)}s remaining). Skipping.`);
      process.exit(0);
    }
  }

  const trigger = {
    schemaVersion: 1,
    triggerId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    healthState,
    needsTrigger,
    reason: needsTrigger
      ? `Health state is "${healthState}". Safety gate check should be triggered.`
      : `Health state is "${healthState}". No trigger needed.`,
    commitSha: health.commitSha || null,
    lastTriggerAt: needsTrigger ? new Date().toISOString() : (existing && existing.lastTriggerAt) || null,
  };

  if (args.stdout) {
    console.log(JSON.stringify(trigger, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(trigger, null, 2) + '\n', 'utf8');

  if (needsTrigger) {
    console.log(`Health gate triggered: state=${healthState}, commit=${trigger.commitSha || 'unknown'}`);
  } else {
    console.log(`Health state is "${healthState}". No trigger needed.`);
  }
}

main();
