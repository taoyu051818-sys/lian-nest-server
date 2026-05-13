#!/usr/bin/env node

/**
 * check-constitution-health.js
 *
 * Thin CLI wrapper around scripts/ai/lib/constitution-checks.js.
 * See that module for the reusable check functions.
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

const {
  REPO_ROOT,
  AI_STATE_DIR,
  DECISIONS,
  relPath,
  checkRealityBeforeJudgment,
  checkSelectionBeforeMemory,
  checkGovernedRecursion,
  checkHighRiskBoundaries,
  checkMainRedLaunchStop,
  checkWorkerScopeExpansion,
  checkRepositoryBoundary,
  checkStateFileStaleness,
  checkMetaSignalsVitality,
  checkBuildVitality,
  checkWorkerLifecycleHealth,
  checkConflictGroupContention,
  checkPRQueueHealth,
  checkAutonomousLoopHealth,
  checkResourcePressure,
} = require('./lib/constitution-checks');

const SCHEMA_VERSION = 1;
const CHECK_TYPE = 'constitution-health';
const DEFAULT_OUT = path.join(AI_STATE_DIR, 'constitution-health-result.json');

// ── CLI ──────────────────────────────────────────────────────────────────────

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
      Rule 3 — main-red launch stop enforced
      Rule 5 — worker scope boundaries respected

    SOP Hard Rules:
      No direct storage access outside repositories

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

  // Run all checks
  const allFindings = [];

  // Static compliance
  const law1 = checkRealityBeforeJudgment();
  const law2 = checkSelectionBeforeMemory();
  const law3 = checkGovernedRecursion();
  const rule1 = checkHighRiskBoundaries();
  const rule3 = checkMainRedLaunchStop();
  const rule5 = checkWorkerScopeExpansion();
  const sop = checkRepositoryBoundary();

  // Runtime health
  const rtStaleness = checkStateFileStaleness();
  const rtMeta = checkMetaSignalsVitality();
  const rtBuild = checkBuildVitality();
  const rtWorker = checkWorkerLifecycleHealth();
  const rtConflict = checkConflictGroupContention();
  const rtPR = checkPRQueueHealth();
  const rtLoop = checkAutonomousLoopHealth();
  const rtResource = checkResourcePressure();

  allFindings.push(
    ...law1, ...law2, ...law3, ...rule1, ...rule3, ...rule5, ...sop,
    ...rtStaleness, ...rtMeta, ...rtBuild, ...rtWorker, ...rtConflict, ...rtPR, ...rtLoop, ...rtResource,
  );

  // Aggregate
  const violations = allFindings.filter(f => f.decision === DECISIONS.VIOLATION);
  const warnings = allFindings.filter(f => f.decision === DECISIONS.WARNING);
  const passes = allFindings.filter(f => f.decision === DECISIONS.PASS);

  const overallDecision = violations.length > 0 ? DECISIONS.VIOLATION
    : warnings.length > 0 ? DECISIONS.WARNING
    : DECISIONS.PASS;

  const result = {
    schemaVersion: SCHEMA_VERSION,
    checkType: CHECK_TYPE,
    capturedAt: new Date().toISOString(),
    overallDecision,
    summary: {
      total: allFindings.length,
      pass: passes.length,
      warning: warnings.length,
      violation: violations.length,
    },
    threeLaws: {
      realityBeforeJudgment: {
        decision: law1.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: law1,
      },
      selectionBeforeMemory: {
        decision: law2.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: law2,
      },
      governedRecursion: {
        decision: law3.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: law3,
      },
    },
    seedConstitution: {
      rule1HighRiskBoundaries: {
        decision: rule1.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: rule1,
      },
      rule3MainRedLaunchStop: {
        decision: rule3.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: rule3,
      },
      rule5NoScopeExpansion: {
        decision: rule5.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: rule5,
      },
    },
    sop: {
      repositoryBoundary: {
        decision: sop.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: sop,
      },
    },
    runtimeHealth: {
      stateStaleness: { decision: rtStaleness.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtStaleness.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtStaleness },
      metaSignals: { decision: rtMeta.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtMeta.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtMeta },
      buildHealth: { decision: rtBuild.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS, findings: rtBuild },
      workerLifecycle: { decision: rtWorker.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtWorker.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtWorker },
      conflictContention: { decision: rtConflict.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtConflict },
      prQueue: { decision: rtPR.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtPR },
      autonomousLoop: { decision: rtLoop.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtLoop },
      resourcePressure: { decision: rtResource.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtResource.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtResource },
    },
    findings: allFindings,
  };

  const json = JSON.stringify(result, null, 2);

  if (stdout) {
    process.stdout.write(json + '\n');
  } else {
    const outDir = path.dirname(outPath);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    process.stdout.write(`constitution health result written to ${relPath(outPath)}\n`);
  }

  // Summary
  process.stdout.write(`\nConstitution Health: ${overallDecision.toUpperCase()}\n`);
  process.stdout.write(`  Pass: ${passes.length}  Warning: ${warnings.length}  Violation: ${violations.length}\n`);

  if (violations.length > 0) {
    process.stdout.write('\nViolations:\n');
    for (const v of violations) {
      process.stdout.write(`  - [${v.rule || v.law}] ${v.message}\n`);
    }
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

main();
