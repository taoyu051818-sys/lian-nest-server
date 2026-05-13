#!/usr/bin/env node

/**
 * check-constitution-health.js
 *
 * Standalone CLI wrapper around the reusable constitution-checks library.
 * All check logic lives in scripts/ai/lib/constitution-checks.js and is
 * also called directly by the self-cycle runner as a pre-flight phase.
 *
 * Usage:
 *   node scripts/ai/check-constitution-health.js --help
 *   node scripts/ai/check-constitution-health.js [--stdout] [--out path]
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more violations detected
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const checks = require('./lib/constitution-checks');

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_OUT = path.join(checks.AI_STATE_DIR, 'constitution-health-result.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
check-constitution-health.js — Three Laws and Seed Constitution compliance checker

USAGE
    node scripts/ai/check-constitution-health.js [options]

OPTIONS
    --out <path>     Output path for check result JSON
                     (default: .github/ai-state/constitution-health-result.json)
    --stdout         Print JSON to stdout instead of writing a file
    --help, -h       Show this help message and exit.

CHECKS PERFORMED
    Three Laws:
      1. Reality before judgment — policy changes cite evidence
      2. Selection before memory — invariants preserved
      3. Governed recursion — no self-approval mechanisms

    Seed Constitution:
      Rule 1 — high-risk files unmodified by automation
      Rule 2 — no scope expansion in active workers
      Rule 3 — main-red launch stop enforced
      Rule 5 — worker scope boundaries respected

    SOP Hard Rules:
      No direct storage access outside repositories
      No silent fallback without diagnostics

    Runtime Health:
      State file staleness, meta signals, build health,
      worker lifecycle, conflict contention, PR queue,
      autonomous loop, resource pressure

EXIT CODES
    0 — all checks pass
    1 — one or more violations detected
    2 — invalid arguments
`;
  process.stdout.write(help);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let outPath = DEFAULT_OUT;
  let stdout = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--stdout') {
      stdout = true;
    } else if (arg === '--out') {
      i++;
      outPath = args[i];
    }
  }

  // Run all checks via the shared library
  const result = checks.runAllChecks();
  const json = JSON.stringify(result, null, 2);

  if (stdout) {
    process.stdout.write(json + '\n');
  } else {
    const outDir = path.dirname(outPath);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    process.stdout.write(`constitution health result written to ${checks.relPath(outPath)}\n`);
  }

  // Summary
  const { violations, warnings, passes } = result.summary;
  process.stdout.write(`\nConstitution Health: ${result.overallDecision.toUpperCase()}\n`);
  process.stdout.write(`  Pass: ${passes}  Warning: ${warnings}  Violation: ${violations}\n`);

  if (result.findings) {
    const v = result.findings.filter(f => f.decision === checks.DECISIONS.VIOLATION);
    if (v.length > 0) {
      process.stdout.write('\nViolations:\n');
      for (const finding of v) {
        process.stdout.write(`  - [${finding.rule || finding.law}] ${finding.message}\n`);
      }
    }
  }

  process.exit(violations > 0 ? 1 : 0);
}

main();
