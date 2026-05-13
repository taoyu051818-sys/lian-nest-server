#!/usr/bin/env node

/**
 * seed-contribution-ledger.js
 *
 * Seeds .github/ai-state/contribution-ledger.ndjson with a system genesis entry
 * when the file is empty or missing. Idempotent — skips if entries exist.
 *
 * Usage:
 *   node scripts/ai/seed-contribution-ledger.js [--live] [--out <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'contribution-ledger.ndjson');

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, dryRun: true, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
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
    console.log('seed-contribution-ledger.js — Seed contribution ledger with genesis entry');
    console.log('Usage: node scripts/ai/seed-contribution-ledger.js [--live] [--out <path>]');
    process.exit(0);
  }

  // Check if ledger already has entries
  if (fs.existsSync(args.out)) {
    const content = fs.readFileSync(args.out, 'utf8').trim();
    if (content.length > 0) {
      console.log('Contribution ledger already has entries. Skipping seed.');
      process.exit(0);
    }
  }

  const entry = {
    schemaVersion: 1,
    entryId: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    taskId: 'system-genesis',
    issueNumber: 0,
    prNumber: null,
    agentId: 'system',
    role: 'system',
    contributionType: 'config-change',
    status: 'accepted',
    validated: true,
    reused: null,
    rollbackOf: null,
    branch: null,
    commit: null,
    conflictGroup: null,
    description: 'Genesis entry: contribution ledger initialized by self-cycle seed script.',
    meta: { genesis: true, seededBy: 'seed-contribution-ledger.js' },
  };

  const line = JSON.stringify(entry);

  if (args.dryRun) {
    console.log('CONTRIBUTION LEDGER SEED — DRY RUN');
    console.log(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    console.log('Entry:');
    console.log(line);
    console.log('DRY RUN — No file was modified. Use --live to write.');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, line + '\n', 'utf8');
  console.log(`Contribution ledger seeded at ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
}

main();
