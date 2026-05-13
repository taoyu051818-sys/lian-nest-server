#!/usr/bin/env node

/**
 * emit-command-steward-brief.js
 *
 * Reads control-plane state projections from .github/ai-state/ and emits
 * a deterministic, sanitized Command Steward brief with status, blockers,
 * recommended next actions, and human-required items.
 *
 * All optional inputs produce safe conservative defaults when absent.
 * Default mode is dry-run. Pass --live to persist.
 *
 * Usage:
 *   node scripts/ai/emit-command-steward-brief.js [--live] [--stdout] [--self-test] [--help]
 *
 * Exit codes: 0 — brief produced, 2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, readJson, readNdjson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const STATE_DIR = process.env.COMMAND_STEWARD_STATE_DIR || path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'command-steward-brief.json');

const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  health:            'main-health.json',
  providerPool:      'provider-pool.json',
  localResource:     'local-resource.json',
  activeWorkers:     'active-workers.json',
  workerTrust:       'worker-trust.json',
  metaSignals:       'meta-signals.json',
  riskSignals:       'risk-signals.json',
  opportunitySignals: 'opportunity-signals.json',
  launchLocks:       'launch-locks.json',
  workerTelemetry:   'worker-telemetry-events.ndjson',
  lastCycle:         'self-cycle-run.json',
  launchCandidates:  'launch-candidates.json',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
emit-command-steward-brief.js — Command Steward brief emitter (v1)

USAGE
    node scripts/ai/emit-command-steward-brief.js [options]

OPTIONS
    --live          Write the brief to the output file (default: dry-run).
    --out <path>    Output path (default: .github/ai-state/command-steward-brief.json).
    --stdout        Print JSON to stdout without banner.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

INPUT FILES (all optional — absent files produce conservative defaults)
    main-health.json, provider-pool.json, local-resource.json,
    active-workers.json, worker-trust.json, meta-signals.json,
    risk-signals.json, opportunity-signals.json, launch-locks.json,
    worker-telemetry-events.ndjson, launch-candidates.json

BRIEF SECTIONS
    operatorBrief (top-of-page human UX: status badge, primary action, blocker summary),
    systemStatus, providerSummary, workerSummary, trustSummary,
    lockSummary, metaSignalsSummary, riskSignalsSummary,
    opportunitySignalsSummary, budgetSummary, parallelSummary,
    issueProductionSummary (ready issues, top-up gap, recommendation),
    blockers, recommendedNextActions, humanRequiredItems

EXIT CODES
    0   Brief produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    live: false,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
    selfTest: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--live') {
      args.live = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--self-test') {
      args.selfTest = true;
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
  /auth/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === 'string') {
    // Truncate long strings to prevent leaking log content
    if (value.length > 200) return value.slice(0, 200) + '…';
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Strip secret-shaped keys entirely
    if (SECRET_PATTERNS.some(p => p.test(key))) continue;
    result[key] = sanitizeValue(value);
  }
  return result;
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildSystemStatus(inputs) {
  const health = inputs.health;
  const resources = inputs.localResource;

  const healthState = health && health.state ? health.state : 'unknown';
  const healthCapturedAt = health && health.capturedAt ? health.capturedAt : null;
  const allowedWorkerClasses = health && health.allowedWorkerClasses
    ? health.allowedWorkerClasses
    : [];
  const failedChecks = health && health.failedChecks ? health.failedChecks : [];

  const resourceState = resources && resources.global
    ? resources.global.resourceState
    : 'unknown';

  // Overall status: worst of health and resource state
  // Unknown inputs are rank -1 (ignored unless all are unknown)
  const stateRank = { green: 0, healthy: 0, yellow: 1, constrained: 1, red: 2, critical: 2, black: 3 };
  const healthRank = stateRank[healthState] !== undefined ? stateRank[healthState] : -1;
  const resourceRank = stateRank[resourceState] !== undefined ? stateRank[resourceState] : -1;
  const maxRank = Math.max(healthRank, resourceRank);
  const rankToState = ['operational', 'degraded', 'critical', 'unrecoverable'];
  const overall = maxRank < 0 ? 'unknown' : rankToState[maxRank];

  return {
    overall,
    health: {
      state: healthState,
      capturedAt: healthCapturedAt,
      failedChecks,
      allowedWorkerClasses,
    },
    resources: {
      state: resourceState,
      capturedAt: resources && resources.global ? resources.global.capturedAt : null,
    },
  };
}

function buildProviderSummary(inputs) {
  const pool = inputs.providerPool;
  if (!pool) {
    return { loaded: false, available: 0, exhausted: 0, disabled: 0, totalCapacity: 0, activeWorkers: 0 };
  }

  const global = pool.global || {};

  return {
    loaded: true,
    available: global.availableProviders || 0,
    exhausted: global.exhaustedProviders || 0,
    disabled: global.disabledProviders || 0,
    totalCapacity: global.globalMaxWorkers || 0,
    activeWorkers: global.totalActiveWorkers || 0,
  };
}

function buildWorkerSummary(inputs) {
  const workers = inputs.activeWorkers;
  if (!workers || !Array.isArray(workers.workers)) {
    return { loaded: false, count: 0, workers: [] };
  }

  return {
    loaded: true,
    count: workers.workers.length,
  };
}

function buildParallelSummary(inputs) {
  const active = inputs.activeWorkers;
  const provider = buildProviderSummary(inputs);
  const locks = buildLockSummary(inputs);
  const workers = active && Array.isArray(active.workers) ? active.workers : [];
  const failed = workers.filter(w => w && w.status === 'failed').length;
  const stale = workers.filter(w => w && w.status === 'stale').length;
  const running = workers.filter(w => w && w.status === 'running').length;
  const planned = workers.filter(w => w && w.status === 'planned').length;
  const effective = active && typeof active.effectiveParallelism === 'number'
    ? active.effectiveParallelism
    : null;
  const requested = active && typeof active.requestedParallelism === 'number'
    ? active.requestedParallelism
    : null;
  const blockedReason = active && active.blockedParallelismReason
    ? active.blockedParallelismReason
    : null;

  // Task-surface independence analysis
  const taskSurfaces = analyzeTaskSurfaces(workers, inputs);

  let safeToIncrease = false;
  let recommendation = 'Parallel worker state unavailable.';
  if (active && Array.isArray(active.workers)) {
    if (failed > 0 || stale > 0) {
      recommendation = `Do not increase concurrency until ${failed} failed and ${stale} stale worker(s) are reconciled.`;
    } else if (provider.loaded && provider.available === 0) {
      recommendation = 'Do not increase concurrency; provider pool has no available providers.';
    } else if (effective !== null && requested !== null && effective < requested) {
      recommendation = `Do not increase yet; effective parallelism is reduced (${blockedReason || 'capacity gate'}).`;
    } else if (taskSurfaces.hasConflicts) {
      recommendation = `Task surfaces overlap: ${taskSurfaces.conflictSummary}. Serialize conflicting tasks before increasing concurrency.`;
    } else if (running === 0) {
      safeToIncrease = true;
      recommendation = taskSurfaces.independent
        ? `All ${taskSurfaces.uniqueGroups} task surface(s) are independent (no conflictGroup, allowedFiles, or lock overlap). Safe to increase concurrency.`
        : 'No active failed or stale workers; a small controlled increase can be previewed.';
    } else {
      recommendation = `${running} worker(s) in flight across ${taskSurfaces.uniqueGroups} independent task surface(s). Monitor completion before increasing concurrency.`;
    }
  }

  return {
    loaded: !!active,
    requestedParallelism: requested,
    effectiveParallelism: effective,
    activeWorkerCount: running,
    plannedWorkerCount: planned,
    failedWorkerCount: failed,
    staleWorkerCount: stale,
    blockedParallelismReason: blockedReason,
    safeToIncreaseConcurrency: safeToIncrease,
    recommendation,
    taskSurfaces,
  };
}

function analyzeTaskSurfaces(workers, inputs) {
  if (!workers || workers.length === 0) {
    return { independent: true, hasConflicts: false, uniqueGroups: 0, conflictSummary: 'no active workers' };
  }

  // Collect conflictGroups from active workers
  const conflictGroups = new Map();
  const fileScopes = new Map();

  for (const w of workers) {
    if (!w || w.status !== 'running') continue;
    const cg = w.conflictGroup || null;
    if (cg) {
      const key = cg.toLowerCase();
      conflictGroups.set(key, (conflictGroups.get(key) || 0) + 1);
    }
    // Track allowedFiles overlap if available
    if (Array.isArray(w.allowedFiles)) {
      for (const f of w.allowedFiles) {
        fileScopes.set(f, (fileScopes.get(f) || 0) + 1);
      }
    }
  }

  // Check for shared locks
  const lockGroups = new Set();
  if (inputs.launchLocks && Array.isArray(inputs.launchLocks.locks)) {
    for (const lock of inputs.launchLocks.locks) {
      if (lock.conflictGroup) lockGroups.add(lock.conflictGroup.toLowerCase());
    }
  }

  // Detect conflicts
  const conflictingGroups = [];
  for (const [group, count] of conflictGroups) {
    if (count > 1) conflictingGroups.push(`${group} (${count} workers)`);
  }

  // Detect lock conflicts
  const lockConflicts = [];
  for (const [group] of conflictGroups) {
    if (lockGroups.has(group)) lockConflicts.push(group);
  }

  // Detect file scope overlaps
  const overlappingFiles = [];
  for (const [file, count] of fileScopes) {
    if (count > 1) overlappingFiles.push(`${file} (${count} workers)`);
  }

  const hasConflicts = conflictingGroups.length > 0 || lockConflicts.length > 0 || overlappingFiles.length > 0;
  const conflictParts = [];
  if (conflictingGroups.length > 0) conflictParts.push(`conflictGroup: ${conflictingGroups.join(', ')}`);
  if (lockConflicts.length > 0) conflictParts.push(`lock: ${lockConflicts.join(', ')}`);
  if (overlappingFiles.length > 0) conflictParts.push(`file overlap: ${overlappingFiles.join(', ')}`);

  return {
    independent: !hasConflicts,
    hasConflicts,
    uniqueGroups: conflictGroups.size,
    conflictSummary: hasConflicts ? conflictParts.join('; ') : 'no conflicts detected',
    conflictingGroups,
    lockConflicts,
    overlappingFiles,
  };
}

function buildTrustSummary(inputs) {
  const trust = inputs.workerTrust;
  if (!trust) {
    return { loaded: false, classCount: 0, schedulingRules: 0, minTrustToLaunch: null };
  }

  const classes = trust.workerClasses || {};
  const scheduling = trust.scheduling || {};

  return {
    loaded: true,
    classCount: Object.keys(classes).length,
    schedulingRules: Array.isArray(scheduling.rules) ? scheduling.rules.length : 0,
    minTrustToLaunch: scheduling.minTrustToLaunch !== undefined ? scheduling.minTrustToLaunch : null,
    highTrustThreshold: scheduling.highTrustThreshold !== undefined ? scheduling.highTrustThreshold : null,
  };
}

function buildLockSummary(inputs) {
  const locks = inputs.launchLocks;
  if (!locks || !Array.isArray(locks.locks)) {
    return { loaded: false, activeLocks: 0, locks: [] };
  }

  return {
    loaded: true,
    activeLocks: locks.locks.length,
  };
}

function buildMetaSignalsSummary(inputs) {
  const meta = inputs.metaSignals;
  if (!meta || !meta.signals) {
    return { loaded: false, failureScore: null, frictionScore: null, riskScore: null, trust: null, topPain: null };
  }

  const sig = meta.signals;
  return {
    loaded: true,
    failureScore: typeof sig.failureScore === 'number' ? sig.failureScore : null,
    frictionScore: typeof sig.frictionScore === 'number' ? sig.frictionScore : null,
    riskScore: typeof sig.riskScore === 'number' ? sig.riskScore : null,
    cost: typeof sig.cost === 'number' ? sig.cost : null,
    trust: typeof sig.trust === 'number' ? sig.trust : null,
    topPain: sig.topPain || null,
  };
}

function buildRiskSignalsSummary(inputs) {
  const risk = inputs.riskSignals;
  if (!risk || !Array.isArray(risk.signals)) {
    return { loaded: false, count: 0, signals: [] };
  }

  return {
    loaded: true,
    count: risk.signals.length,
    signals: risk.signals.slice(0, 10).map(sanitizeValue),
  };
}

function buildOpportunitySignalsSummary(inputs) {
  const opp = inputs.opportunitySignals;
  if (!opp || !Array.isArray(opp.signals)) {
    return { loaded: false, count: 0, signals: [] };
  }

  return {
    loaded: true,
    count: opp.signals.length,
    signals: opp.signals.slice(0, 10).map(sanitizeValue),
  };
}

function buildBudgetSummary(inputs) {
  const events = inputs.workerTelemetry;
  if (!events || !Array.isArray(events)) {
    return {
      loaded: false,
      recentWorkerCount: 0,
      avgWallClockMs: null,
      slowestWallClockMs: null,
      tokenSummary: { high: { inputTokens: 0, outputTokens: 0 }, medium: { inputTokens: 0, outputTokens: 0 }, low: { inputTokens: 0, outputTokens: 0 }, unknown: { inputTokens: 0, outputTokens: 0 } },
      costEstimate: { totalCents: 0, pricingBasis: 'unknown' },
      budgetBlockers: [],
    };
  }

  // Filter to complete events only — those carry final telemetry
  const completeEvents = events.filter(e => e && e.eventType === 'complete');
  const recentWorkerCount = completeEvents.length;

  if (recentWorkerCount === 0) {
    return {
      loaded: true,
      recentWorkerCount: 0,
      avgWallClockMs: null,
      slowestWallClockMs: null,
      tokenSummary: { high: { inputTokens: 0, outputTokens: 0 }, medium: { inputTokens: 0, outputTokens: 0 }, low: { inputTokens: 0, outputTokens: 0 }, unknown: { inputTokens: 0, outputTokens: 0 } },
      costEstimate: { totalCents: 0, pricingBasis: 'unknown' },
      budgetBlockers: [],
    };
  }

  // Aggregate wall-clock time
  let totalElapsed = 0;
  let maxElapsed = 0;
  let timingCount = 0;

  // Aggregate tokens by confidence
  const tokenSummary = {
    high: { inputTokens: 0, outputTokens: 0 },
    medium: { inputTokens: 0, outputTokens: 0 },
    low: { inputTokens: 0, outputTokens: 0 },
    unknown: { inputTokens: 0, outputTokens: 0 },
  };

  // Aggregate cost
  let totalCostCents = 0;
  let pricingBasis = 'unknown';
  const pricingBasisRank = { api_list: 3, estimated: 2, unknown: 1 };

  // Collect budget blockers
  const budgetBlockers = [];

  for (const event of completeEvents) {
    // Timing
    if (event.timing && typeof event.timing.elapsedMs === 'number' && event.timing.elapsedMs >= 0) {
      totalElapsed += event.timing.elapsedMs;
      timingCount++;
      if (event.timing.elapsedMs > maxElapsed) maxElapsed = event.timing.elapsedMs;

      // Check hard time limit
      if (event.timing.hardTimeMinutes) {
        const hardLimitMs = event.timing.hardTimeMinutes * 60000;
        if (event.timing.elapsedMs >= hardLimitMs) {
          budgetBlockers.push({
            type: 'hard-time-limit',
            taskId: event.taskId || 'unknown',
            severity: 'high',
            message: `Task hit hard time limit (${event.timing.hardTimeMinutes}m)`,
          });
        }
      }

      // Check soft time limit
      if (event.timing.softTimeMinutes) {
        const softLimitMs = event.timing.softTimeMinutes * 60000;
        if (event.timing.elapsedMs >= softLimitMs * 1.5) {
          budgetBlockers.push({
            type: 'soft-time-exceeded',
            taskId: event.taskId || 'unknown',
            severity: 'medium',
            message: `Task exceeded soft time limit by >50% (${event.timing.softTimeMinutes}m)`,
          });
        }
      }
    }

    // Tokens — classify by confidence
    if (event.tokenUsage) {
      const confidence = event.tokenUsage.confidence || 'unknown';
      const bucket = tokenSummary[confidence] || tokenSummary.unknown;
      bucket.inputTokens += event.tokenUsage.inputTokens || 0;
      bucket.outputTokens += event.tokenUsage.outputTokens || 0;
    }

    // Cost
    if (event.estimatedCost && typeof event.estimatedCost.amountCents === 'number') {
      totalCostCents += event.estimatedCost.amountCents;
      const pb = event.estimatedCost.pricingBasis || 'unknown';
      if ((pricingBasisRank[pb] || 0) > (pricingBasisRank[pricingBasis] || 0)) {
        pricingBasis = pb;
      }
    }

    // Budget warning/critical events from fact event ledger
    if (event.eventType === 'worker.token-budget-critical' || event.eventType === 'worker.cost-budget-critical') {
      budgetBlockers.push({
        type: event.eventType,
        taskId: event.taskId || 'unknown',
        severity: 'critical',
        message: `Budget critical: ${event.eventType}`,
      });
    }
  }

  // Gate failure blocker
  const gateFailures = completeEvents.filter(e => e.gateOutcome && e.gateOutcome.passed === false);
  if (gateFailures.length > 0) {
    budgetBlockers.push({
      type: 'gate-failures',
      severity: 'high',
      count: gateFailures.length,
      message: `${gateFailures.length} worker(s) failed gate outcome`,
    });
  }

  return {
    loaded: true,
    recentWorkerCount,
    avgWallClockMs: timingCount > 0 ? Math.round(totalElapsed / timingCount) : null,
    slowestWallClockMs: timingCount > 0 ? maxElapsed : null,
    tokenSummary,
    costEstimate: { totalCents: totalCostCents, pricingBasis },
    budgetBlockers,
  };
}

function buildIssueProductionSummary(inputs) {
  const lc = inputs.launchCandidates;
  const active = inputs.activeWorkers;
  const lastCycle = inputs.lastCycle;

  const readyIssueCount = lc && lc.summary && typeof lc.summary.candidateCount === 'number'
    ? lc.summary.candidateCount
    : 0;
  const excludedCount = lc && lc.summary && typeof lc.summary.excludedCount === 'number'
    ? lc.summary.excludedCount
    : 0;
  const totalOpen = lc && lc.summary && typeof lc.summary.totalOpen === 'number'
    ? lc.summary.totalOpen
    : 0;

  const requestedParallelism = active && typeof active.requestedParallelism === 'number'
    ? active.requestedParallelism
    : null;
  const effectiveParallelism = active && typeof active.effectiveParallelism === 'number'
    ? active.effectiveParallelism
    : null;
  const runningWorkers = active && Array.isArray(active.workers)
    ? active.workers.filter(w => w && w.status === 'running').length
    : 0;

  const topUpGap = requestedParallelism !== null ? requestedParallelism - readyIssueCount : null;
  const topUpNeeded = topUpGap !== null && topUpGap > 0;

  // Risk breakdown of ready issues
  const candidates = lc && Array.isArray(lc.candidates) ? lc.candidates : [];
  const riskBreakdown = { low: 0, medium: 0, high: 0 };
  const classBreakdown = {};
  for (const c of candidates) {
    const risk = c.risk || 'medium';
    if (riskBreakdown[risk] !== undefined) riskBreakdown[risk]++;
    const cls = c.workerClass || 'unknown';
    classBreakdown[cls] = (classBreakdown[cls] || 0) + 1;
  }

  // Last cycle context
  const lastCycleSelected = lastCycle && Array.isArray(lastCycle.selectedCandidates)
    ? lastCycle.selectedCandidates.length
    : null;
  const lastCycleStatus = lastCycle ? lastCycle.finalStatus || null : null;

  // Recommendation — evidence-based: severity proportional to gap relative to capacity
  let recommendation;
  if (!lc) {
    recommendation = 'Launch candidate data unavailable. Run detect-launch-candidates to assess issue pool.';
  } else if (topUpNeeded && readyIssueCount === 0) {
    recommendation = `No ready issues for ${requestedParallelism} requested workers. Produce issues immediately — all worker slots would be idle.`;
  } else if (topUpNeeded) {
    const gapRatio = requestedParallelism > 0 ? topUpGap / requestedParallelism : 0;
    if (gapRatio > 0.5) {
      recommendation = `Critical gap: ${readyIssueCount} ready issues vs ${requestedParallelism} requested (${Math.round(gapRatio * 100)}% shortfall). Produce at least ${topUpGap} more issues to avoid idle workers.`;
    } else {
      recommendation = `Issue pool thin: ${readyIssueCount} ready for ${requestedParallelism} requested (${Math.round(gapRatio * 100)}% shortfall). Top up with ${topUpGap} more issues.`;
    }
  } else if (readyIssueCount > 0) {
    recommendation = `Issue pool sufficient: ${readyIssueCount} ready issues for ${requestedParallelism || 0} requested workers.`;
  } else {
    recommendation = 'No ready issues and no parallelism requested. Issue production not urgent.';
  }

  return {
    loaded: !!lc,
    readyIssueCount,
    totalOpen,
    excludedCount,
    requestedParallelism,
    effectiveParallelism,
    activeWorkerCount: runningWorkers,
    topUpGap,
    topUpNeeded,
    riskBreakdown,
    classBreakdown,
    lastCycle: lastCycleSelected !== null ? {
      selectedCandidates: lastCycleSelected,
      finalStatus: lastCycleStatus,
    } : null,
    recommendation,
  };
}

// ── Blockers ─────────────────────────────────────────────────────────────────

function collectBlockers(inputs, systemStatus) {
  const blockers = [];

  // Health blockers
  if (!inputs.health) {
    blockers.push({ source: 'health', severity: 'warning', message: 'main-health.json missing — health state unknown' });
  } else if (systemStatus.health.state === 'red' || systemStatus.health.state === 'black') {
    blockers.push({
      source: 'health',
      severity: systemStatus.health.state === 'black' ? 'critical' : 'high',
      message: `Main branch health is ${systemStatus.health.state}`,
      failedChecks: systemStatus.health.failedChecks,
    });
  }

  // Resource blockers
  if (!inputs.localResource) {
    blockers.push({ source: 'resources', severity: 'warning', message: 'local-resource.json missing — resource state unknown' });
  } else if (systemStatus.resources.state === 'critical') {
    blockers.push({ source: 'resources', severity: 'high', message: 'Local resources in critical state' });
  }

  // Provider blockers
  const providerSummary = buildProviderSummary(inputs);
  if (!providerSummary.loaded) {
    blockers.push({ source: 'providers', severity: 'warning', message: 'provider-pool.json missing — provider state unknown' });
  } else if (providerSummary.available === 0) {
    blockers.push({ source: 'providers', severity: 'high', message: 'No available providers — worker dispatch blocked' });
  } else if (providerSummary.exhausted > 0) {
    blockers.push({ source: 'providers', severity: 'medium', message: `${providerSummary.exhausted} provider(s) exhausted` });
  }

  // Worker trust blockers
  if (!inputs.workerTrust) {
    blockers.push({ source: 'trust', severity: 'warning', message: 'worker-trust.json missing — trust policy unknown' });
  }

  // Meta signal blockers — evidence-based: compare against trust and risk context
  const meta = buildMetaSignalsSummary(inputs);
  if (meta.loaded && meta.failureScore !== null) {
    // A failure score is concerning when it exceeds the trust score (if available)
    const trust = meta.trust !== null ? meta.trust : 50;
    if (meta.failureScore > trust) {
      blockers.push({
        source: 'meta-signals',
        severity: meta.failureScore > trust * 1.5 ? 'high' : 'medium',
        message: `Failure score ${meta.failureScore} exceeds trust score ${trust} — worker reliability degrading`,
      });
    }
  }
  if (meta.loaded && meta.frictionScore !== null) {
    // Friction is concerning when it exceeds half the trust score
    const trust = meta.trust !== null ? meta.trust : 50;
    if (meta.frictionScore > trust / 2) {
      blockers.push({
        source: 'meta-signals',
        severity: meta.frictionScore > trust ? 'high' : 'medium',
        message: `Friction score ${meta.frictionScore} relative to trust ${trust} indicates worker stalls`,
      });
    }
  }

  // Budget blockers from telemetry
  const budget = buildBudgetSummary(inputs);
  for (const bb of budget.budgetBlockers) {
    blockers.push({ source: 'budget', severity: bb.severity, message: bb.message });
  }

  // Issue-production blockers — evidence-based: severity proportional to gap relative to capacity
  const issueProd = buildIssueProductionSummary(inputs);
  if (issueProd.loaded && issueProd.topUpNeeded) {
    const gap = issueProd.topUpGap;
    const requested = issueProd.requestedParallelism || 1;
    // Severity is proportional: gap > 50% of requested is high, otherwise medium
    const gapRatio = gap / requested;
    if (gapRatio > 0.5) {
      blockers.push({
        source: 'issue-production',
        severity: 'high',
        message: `Issue pool critically low: ${issueProd.readyIssueCount} ready for ${requested} requested workers (gap: ${gap}, ${Math.round(gapRatio * 100)}% shortfall)`,
      });
    } else {
      blockers.push({
        source: 'issue-production',
        severity: 'medium',
        message: `Issue pool below requested parallelism: ${issueProd.readyIssueCount} ready for ${requested} requested (gap: ${gap}, ${Math.round(gapRatio * 100)}% shortfall)`,
      });
    }
  }

  return blockers;
}

// ── Recommended next actions ─────────────────────────────────────────────────

function buildRecommendedActions(inputs, systemStatus, blockers) {
  const actions = [];

  // Health-driven actions
  if (systemStatus.health.state === 'red' || systemStatus.health.state === 'black') {
    actions.push({
      priority: 'urgent',
      action: 'investigate-health-failure',
      description: `Main branch health is ${systemStatus.health.state}. Run health gate and investigate failed checks.`,
      humanRequired: true,
    });
  }

  if (systemStatus.health.state === 'yellow') {
    actions.push({
      priority: 'high',
      action: 'review-yellow-health',
      description: 'Main branch health is yellow. Review failed checks and decide if fix workers should be dispatched.',
      humanRequired: true,
    });
  }

  // Provider-driven actions
  const providerSummary = buildProviderSummary(inputs);
  if (providerSummary.loaded && providerSummary.exhausted > 0) {
    actions.push({
      priority: 'medium',
      action: 'review-exhausted-providers',
      description: `${providerSummary.exhausted} provider(s) exhausted. Review cooldown status or clear manually.`,
      humanRequired: false,
    });
  }

  if (providerSummary.loaded && providerSummary.disabled > 0) {
    actions.push({
      priority: 'high',
      action: 'review-disabled-providers',
      description: `${providerSummary.disabled} provider(s) disabled. Investigate auth or manual disable.`,
      humanRequired: true,
    });
  }

  // Worker-driven actions
  const workerSummary = buildWorkerSummary(inputs);
  if (workerSummary.loaded && workerSummary.count > 0) {
    actions.push({
      priority: 'low',
      action: 'monitor-active-workers',
      description: `${workerSummary.count} worker(s) in flight. Monitor heartbeat and progress.`,
      humanRequired: false,
    });
  }

  // Friction-driven actions — evidence-based: friction relative to trust
  const meta = buildMetaSignalsSummary(inputs);
  if (meta.loaded && meta.frictionScore !== null) {
    const trust = meta.trust !== null ? meta.trust : 50;
    if (meta.frictionScore > trust / 2) {
      actions.push({
        priority: meta.frictionScore > trust ? 'high' : 'medium',
        action: 'investigate-worker-friction',
        description: `Friction score ${meta.frictionScore} relative to trust ${trust} indicates worker stalls. Check heartbeat logs and recent telemetry events.`,
        humanRequired: false,
      });
    }
  }

  // Resource-driven actions
  if (systemStatus.resources.state === 'constrained') {
    actions.push({
      priority: 'medium',
      action: 'throttle-batch-size',
      description: 'Local resources constrained. Reduce batch size for new worker dispatch.',
      humanRequired: false,
    });
  }

  // Lock-driven actions
  const lockSummary = buildLockSummary(inputs);
  if (lockSummary.loaded && lockSummary.activeLocks > 0) {
    actions.push({
      priority: 'low',
      action: 'review-active-locks',
      description: `${lockSummary.activeLocks} launch lock(s) held. Check for stale locks.`,
      humanRequired: false,
    });
  }

  // Issue-production actions — evidence-based: gap ratio determines priority
  const issueProd = buildIssueProductionSummary(inputs);
  if (issueProd.loaded && issueProd.topUpNeeded && issueProd.readyIssueCount === 0) {
    actions.push({
      priority: 'urgent',
      action: 'produce-issues',
      description: `No ready issues for ${issueProd.requestedParallelism} requested workers. All worker slots would be idle. Run issue producer to create bounded task issues.`,
      humanRequired: true,
    });
  } else if (issueProd.loaded && issueProd.topUpNeeded) {
    const gapRatio = issueProd.requestedParallelism > 0 ? issueProd.topUpGap / issueProd.requestedParallelism : 0;
    if (gapRatio > 0.5) {
      actions.push({
        priority: 'high',
        action: 'produce-issues',
        description: `Critical issue shortage: ${issueProd.readyIssueCount} ready vs ${issueProd.requestedParallelism} requested (${Math.round(gapRatio * 100)}% shortfall). Produce at least ${issueProd.topUpGap} more issues.`,
        humanRequired: true,
      });
    } else {
      actions.push({
        priority: 'medium',
        action: 'top-up-issues',
        description: `Issue pool thin: ${issueProd.readyIssueCount} ready for ${issueProd.requestedParallelism} requested (${Math.round(gapRatio * 100)}% shortfall). Top up with ${issueProd.topUpGap} more issues.`,
        humanRequired: false,
      });
    }
  } else if (!issueProd.loaded) {
    actions.push({
      priority: 'low',
      action: 'run-launch-candidate-detection',
      description: 'Launch candidate data unavailable. Run detect-launch-candidates to assess issue pool.',
      humanRequired: false,
    });
  }

  // Default: no blockers and healthy → next wave decision
  if (blockers.length === 0 && systemStatus.overall === 'operational') {
    actions.push({
      priority: 'low',
      action: 'plan-next-wave',
      description: 'System is operational with no blockers. Plan next wave of issues.',
      humanRequired: true,
    });
  }

  return actions;
}

// ── Human-required items ─────────────────────────────────────────────────────

function buildHumanRequiredItems(inputs, systemStatus, blockers, actions) {
  const items = [];

  // Always human-owned decisions
  items.push({
    category: 'governance',
    item: 'next-wave-scoping',
    description: 'Decide scope and create next batch of issues.',
  });

  // Health-state human decisions
  if (systemStatus.health.state === 'red' || systemStatus.health.state === 'black') {
    items.push({
      category: 'health',
      item: 'health-override',
      description: `Main branch is ${systemStatus.health.state}. Decide whether to override gate or halt automation.`,
    });
  }

  // Provider human decisions
  const providerSummary = buildProviderSummary(inputs);
  if (providerSummary.loaded && providerSummary.disabled > 0) {
    items.push({
      category: 'providers',
      item: 'provider-re-enable',
      description: 'Disabled providers require manual investigation before re-enabling.',
    });
  }

  // Merge decisions for high-risk PRs
  if (systemStatus.health.state === 'green' || systemStatus.health.state === 'yellow') {
    items.push({
      category: 'merge',
      item: 'high-risk-pr-review',
      description: 'High-risk PRs (src/**, prisma/**, auth) require human review before merge.',
    });
  }

  // Actions that are human-required
  const humanActions = actions.filter(a => a.humanRequired);
  for (const action of humanActions) {
    items.push({
      category: 'action',
      item: action.action,
      description: action.description,
    });
  }

  // Deduplicate by item key
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.item)) return false;
    seen.add(item.item);
    return true;
  });
}

// ── Operator brief (top-of-page human UX) ────────────────────────────────────

function buildOperatorBrief(inputs, systemStatus, blockers, actions, humanRequiredItems) {
  const issueProd = buildIssueProductionSummary(inputs);
  // Status badge: maps overall status to a simple badge
  const badgeMap = {
    operational: { badge: 'green', label: 'OPERATIONAL' },
    degraded:    { badge: 'yellow', label: 'DEGRADED' },
    critical:    { badge: 'red', label: 'CRITICAL' },
    unrecoverable: { badge: 'red', label: 'UNRECOVERABLE' },
    unknown:     { badge: 'gray', label: 'UNKNOWN' },
  };
  const statusBadge = badgeMap[systemStatus.overall] || badgeMap.unknown;

  // Primary action: the single most important thing for the operator
  const urgentAction = actions.find(a => a.priority === 'urgent');
  const highAction = actions.find(a => a.priority === 'high');
  const primaryAction = urgentAction || highAction || (actions.length > 0 ? actions[0] : null);

  // Active blocker count by severity
  const blockerCounts = { critical: 0, high: 0, medium: 0, warning: 0 };
  for (const b of blockers) {
    if (blockerCounts[b.severity] !== undefined) blockerCounts[b.severity]++;
  }

  // Worker activity
  const workerSummary = buildWorkerSummary(inputs);
  const providerSummary = buildProviderSummary(inputs);

  // Last cycle hint — read from ai-state if available
  const lastCycle = inputs.lastCycle || null;
  const lastCycleStatus = lastCycle ? lastCycle.finalStatus : null;
  const lastCycleAt = lastCycle ? lastCycle.completedAt : null;

  // Build the plain-language status line
  let statusLine;
  if (systemStatus.overall === 'operational' && blockers.length === 0) {
    statusLine = 'System is healthy. No blockers. Ready for next wave.';
  } else if (systemStatus.overall === 'operational' && blockers.length > 0) {
    const hasUrgent = blockers.some(b => b.severity === 'critical' || b.severity === 'high');
    statusLine = hasUrgent
      ? `System operational but ${blockerCounts.critical + blockerCounts.high} urgent blocker(s) need attention.`
      : `System operational with ${blockers.length} minor issue(s).`;
  } else if (systemStatus.overall === 'degraded') {
    statusLine = `System degraded. ${blockers.length} blocker(s). Review before launching new workers.`;
  } else if (systemStatus.overall === 'critical' || systemStatus.overall === 'unrecoverable') {
    statusLine = `System ${systemStatus.overall}. Automated launches are blocked. Human intervention required.`;
  } else {
    statusLine = 'System status unknown — check inputs and state files.';
  }

  return {
    statusBadge,
    statusLine,
    primaryAction: primaryAction ? {
      action: primaryAction.action,
      description: primaryAction.description,
      humanRequired: primaryAction.humanRequired,
    } : null,
    blockerSummary: blockers.length === 0
      ? 'No active blockers.'
      : `${blockers.length} blocker(s): ${blockerCounts.critical} critical, ${blockerCounts.high} high, ${blockerCounts.medium} medium, ${blockerCounts.warning} warning.`,
    blockerCounts,
    workerActivity: workerSummary.loaded
      ? `${workerSummary.count} active worker(s).`
      : 'Worker state unknown.',
    providerHealth: providerSummary.loaded
      ? `${providerSummary.available} available, ${providerSummary.exhausted} exhausted, ${providerSummary.disabled} disabled.`
      : 'Provider state unknown.',
    lastCycle: lastCycleStatus ? {
      status: lastCycleStatus,
      completedAt: lastCycleAt,
    } : null,
    issueProduction: issueProd.loaded
      ? `${issueProd.readyIssueCount} ready issues. ${issueProd.topUpNeeded ? `Top-up needed: gap of ${issueProd.topUpGap}.` : 'Pool sufficient.'}`
      : 'Issue production data unavailable.',
    humanDecisionCount: humanRequiredItems.length,
  };
}

// ── Build brief ──────────────────────────────────────────────────────────────

function buildBrief(inputs) {
  const systemStatus = buildSystemStatus(inputs);
  const providerSummary = buildProviderSummary(inputs);
  const workerSummary = buildWorkerSummary(inputs);
  const trustSummary = buildTrustSummary(inputs);
  const lockSummary = buildLockSummary(inputs);
  const metaSignalsSummary = buildMetaSignalsSummary(inputs);
  const riskSignalsSummary = buildRiskSignalsSummary(inputs);
  const opportunitySignalsSummary = buildOpportunitySignalsSummary(inputs);
  const budgetSummary = buildBudgetSummary(inputs);
  const parallelSummary = buildParallelSummary(inputs);
  const issueProductionSummary = buildIssueProductionSummary(inputs);

  const blockers = collectBlockers(inputs, systemStatus);
  const recommendedNextActions = buildRecommendedActions(inputs, systemStatus, blockers);
  const humanRequiredItems = buildHumanRequiredItems(inputs, systemStatus, blockers, recommendedNextActions);

  const operatorBrief = buildOperatorBrief(inputs, systemStatus, blockers, recommendedNextActions, humanRequiredItems);

  const inputSources = {};
  for (const [key, filename] of Object.entries(INPUT_FILES)) {
    inputSources[`${key}Loaded`] = inputs[key] !== null;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    operatorBrief,
    systemStatus,
    providerSummary,
    workerSummary,
    trustSummary,
    lockSummary,
    metaSignalsSummary,
    riskSignalsSummary,
    opportunitySignalsSummary,
    budgetSummary,
    parallelSummary,
    issueProductionSummary,
    blockers,
    recommendedNextActions,
    humanRequiredItems,
    inputSources,
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (!condition) {
      failed++;
      console.error(`  FAIL: ${msg}`);
    } else {
      passed++;
    }
  }

  // Test: buildBrief with all null inputs
  const emptyInputs = {};
  for (const key of Object.keys(INPUT_FILES)) { emptyInputs[key] = null; }
  const empty = buildBrief(emptyInputs);
  assert(empty.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.systemStatus.overall === 'unknown', 'overall unknown with all null');
  assert(empty.operatorBrief.statusBadge.label === 'UNKNOWN', 'operatorBrief badge UNKNOWN with all null');
  assert(typeof empty.operatorBrief.statusLine === 'string', 'operatorBrief statusLine present with all null');
  assert(empty.blockers.length > 0, 'has blockers when all null');
  assert(empty.humanRequiredItems.length > 0, 'has human required items');
  assert(empty.budgetSummary.loaded === false, 'budgetSummary not loaded when null');
  assert(empty.budgetSummary.recentWorkerCount === 0, 'budgetSummary workerCount 0 when null');
  assert(empty.issueProductionSummary.loaded === false, 'issueProductionSummary not loaded when null');
  assert(empty.issueProductionSummary.readyIssueCount === 0, 'issueProductionSummary readyIssueCount 0 when null');
  assert(empty.issueProductionSummary.topUpNeeded === false, 'issueProductionSummary topUpNeeded false when null');
  for (const key of Object.keys(empty.inputSources)) {
    assert(empty.inputSources[key] === false, `inputSources.${key} is false`);
  }

  // Test: buildBrief with full healthy inputs
  const fullInputs = {
    health: { state: 'green', capturedAt: '2026-01-01T00:00:00.000Z', failedChecks: [], allowedWorkerClasses: ['all'] },
    providerPool: { global: { totalActiveWorkers: 0, globalMaxWorkers: 3, availableProviders: 1, exhaustedProviders: 0, disabledProviders: 0 } },
    localResource: { global: { resourceState: 'healthy', capturedAt: '2026-01-01T00:00:00.000Z' } },
    activeWorkers: { requestedParallelism: 30, effectiveParallelism: 3, blockedParallelismReason: 'provider slots=3', workers: [{ issue: 100, status: 'running' }] },
    workerTrust: { workerClasses: { 'runtime-feature': {} }, scheduling: { minTrustToLaunch: 0.3, highTrustThreshold: 0.7, rules: [{}] } },
    metaSignals: { signals: { failureScore: 0, frictionScore: 0, riskScore: 10, cost: 5, trust: 90, topPain: 'none' } },
    riskSignals: { signals: [{ id: 'r1' }] },
    opportunitySignals: { signals: [{ id: 'o1' }] },
    launchLocks: { locks: [{ conflictGroup: 'test' }] },
    workerTelemetry: [
      { eventType: 'complete', taskId: 'w1', capturedAt: '2026-01-01T01:00:00.000Z', timing: { elapsedMs: 120000, softTimeMinutes: 30, hardTimeMinutes: 60 }, tokenUsage: { inputTokens: 40000, outputTokens: 8000, source: 'api_response', confidence: 'high' }, estimatedCost: { amountCents: 20, currency: 'USD', model: 'claude-opus-4-7', pricingBasis: 'api_list' }, gateOutcome: { passed: true } },
      { eventType: 'complete', taskId: 'w2', capturedAt: '2026-01-01T02:00:00.000Z', timing: { elapsedMs: 180000, softTimeMinutes: 30, hardTimeMinutes: 60 }, tokenUsage: { inputTokens: 20000, outputTokens: 5000, source: 'log_parse', confidence: 'medium' }, estimatedCost: { amountCents: 10, currency: 'USD', model: 'claude-sonnet-4-6', pricingBasis: 'estimated' }, gateOutcome: { passed: true } },
    ],
    launchCandidates: { schemaVersion: 1, capturedAt: '2026-01-01T00:00:00.000Z', mode: 'dry-run', summary: { totalOpen: 10, candidateCount: 5, excludedCount: 5 }, candidates: [{ number: 200, title: 'Feature A', workerClass: 'runtime-feature', risk: 'medium', labels: [] }, { number: 300, title: 'Feature B', workerClass: 'docs', risk: 'low', labels: [] }], excluded: [] },
  };
  const full = buildBrief(fullInputs);
  assert(full.systemStatus.overall === 'operational', 'overall operational with green health');
  assert(full.providerSummary.loaded && full.providerSummary.available === 1, 'provider loaded');
  assert(full.workerSummary.loaded && full.workerSummary.count === 1, 'worker loaded');
  assert(full.trustSummary.loaded && full.trustSummary.classCount === 1, 'trust loaded');
  assert(full.lockSummary.loaded && full.lockSummary.activeLocks === 1, 'locks loaded');
  assert(full.metaSignalsSummary.loaded && full.metaSignalsSummary.failureScore === 0, 'meta loaded');
  assert(full.riskSignalsSummary.loaded && full.riskSignalsSummary.count === 1, 'risk loaded');
  assert(full.opportunitySignalsSummary.loaded && full.opportunitySignalsSummary.count === 1, 'opp loaded');
  assert(full.budgetSummary.loaded === true, 'budgetSummary loaded');
  assert(full.budgetSummary.recentWorkerCount === 2, 'budgetSummary workerCount 2');
  assert(full.budgetSummary.avgWallClockMs === 150000, 'budgetSummary avgWallClockMs');
  assert(full.budgetSummary.slowestWallClockMs === 180000, 'budgetSummary slowestWallClockMs');
  assert(full.budgetSummary.tokenSummary.high.inputTokens === 40000, 'budgetSummary high inputTokens');
  assert(full.budgetSummary.tokenSummary.medium.inputTokens === 20000, 'budgetSummary medium inputTokens');
  assert(full.budgetSummary.costEstimate.totalCents === 30, 'budgetSummary totalCost');
  assert(full.budgetSummary.costEstimate.pricingBasis === 'api_list', 'budgetSummary pricingBasis');
  assert(full.budgetSummary.budgetBlockers.length === 0, 'budgetSummary no blockers');
  assert(full.parallelSummary.loaded === true, 'parallelSummary loaded');
  assert(full.parallelSummary.requestedParallelism === 30, 'parallelSummary requestedParallelism');
  assert(full.parallelSummary.effectiveParallelism === 3, 'parallelSummary effectiveParallelism');
  assert(full.parallelSummary.activeWorkerCount === 1, 'parallelSummary activeWorkerCount');
  assert(full.parallelSummary.safeToIncreaseConcurrency === false, 'parallelSummary blocked while worker running');
  assert(full.issueProductionSummary.loaded === true, 'issueProductionSummary loaded');
  assert(full.issueProductionSummary.readyIssueCount === 5, 'issueProductionSummary readyIssueCount 5');
  assert(full.issueProductionSummary.totalOpen === 10, 'issueProductionSummary totalOpen 10');
  assert(full.issueProductionSummary.requestedParallelism === 30, 'issueProductionSummary requestedParallelism 30');
  assert(full.issueProductionSummary.topUpNeeded === true, 'issueProductionSummary topUpNeeded true');
  assert(full.issueProductionSummary.topUpGap === 25, 'issueProductionSummary topUpGap 25');
  assert(full.issueProductionSummary.riskBreakdown.medium === 1, 'issueProductionSummary riskBreakdown medium');
  assert(full.issueProductionSummary.riskBreakdown.low === 1, 'issueProductionSummary riskBreakdown low');
  assert(full.issueProductionSummary.classBreakdown['runtime-feature'] === 1, 'issueProductionSummary classBreakdown runtime-feature');
  assert(typeof full.issueProductionSummary.recommendation === 'string', 'issueProductionSummary recommendation is string');
  for (const key of Object.keys(full.inputSources)) {
    assert(full.inputSources[key] === true, `inputSources.${key} is true`);
  }

  // Test: operatorBrief structure
  assert(full.operatorBrief !== undefined, 'operatorBrief present');
  assert(full.operatorBrief.statusBadge.label === 'OPERATIONAL', 'operatorBrief badge OPERATIONAL');
  assert(typeof full.operatorBrief.statusLine === 'string', 'operatorBrief statusLine is string');
  assert(typeof full.operatorBrief.blockerSummary === 'string', 'operatorBrief blockerSummary is string');
  assert(typeof full.operatorBrief.workerActivity === 'string', 'operatorBrief workerActivity is string');
  assert(typeof full.operatorBrief.providerHealth === 'string', 'operatorBrief providerHealth is string');
  assert(typeof full.operatorBrief.issueProduction === 'string', 'operatorBrief issueProduction is string');
  assert(full.operatorBrief.issueProduction.includes('Top-up needed'), 'operatorBrief mentions top-up');
  assert(typeof full.operatorBrief.humanDecisionCount === 'number', 'operatorBrief humanDecisionCount is number');
  const expectedKeys = ['schemaVersion', 'capturedAt', 'operatorBrief', 'systemStatus', 'providerSummary',
    'workerSummary', 'trustSummary', 'lockSummary', 'metaSignalsSummary',
    'riskSignalsSummary', 'opportunitySignalsSummary', 'budgetSummary', 'parallelSummary',
    'issueProductionSummary', 'blockers',
    'recommendedNextActions', 'humanRequiredItems', 'inputSources'];
  for (const key of expectedKeys) { assert(key in full, `key ${key} present`); }

  // Test: red health
  const redInputs = { ...emptyInputs, health: { state: 'red', capturedAt: '2026-01-01T00:00:00.000Z', failedChecks: ['tsc'] } };
  const red = buildBrief(redInputs);
  assert(red.systemStatus.overall === 'critical', 'overall critical with red health');
  assert(red.blockers.find(b => b.source === 'health').severity === 'high', 'red blocker is high');
  assert(red.recommendedNextActions.some(a => a.action === 'investigate-health-failure'), 'has investigate action');
  assert(red.humanRequiredItems.some(i => i.item === 'health-override'), 'has health override');

  // Test: black health
  const blackInputs = { ...emptyInputs, health: { state: 'black', capturedAt: '2026-01-01T00:00:00.000Z' } };
  assert(buildBrief(blackInputs).blockers.find(b => b.source === 'health').severity === 'critical', 'black blocker is critical');

  // Test: degraded status
  const degradedInputs = { ...emptyInputs,
    health: { state: 'yellow', capturedAt: '2026-01-01T00:00:00.000Z', failedChecks: ['prisma'] },
    localResource: { global: { resourceState: 'constrained', capturedAt: '2026-01-01T00:00:00.000Z' } },
  };
  const degraded = buildBrief(degradedInputs);
  assert(degraded.systemStatus.overall === 'degraded', 'overall degraded');
  assert(degraded.recommendedNextActions.some(a => a.action === 'review-yellow-health'), 'has yellow action');
  assert(degraded.recommendedNextActions.some(a => a.action === 'throttle-batch-size'), 'has throttle action');

  // Test: no available providers
  const noProvInputs = { ...emptyInputs,
    providerPool: { global: { availableProviders: 0, exhaustedProviders: 1, disabledProviders: 0, globalMaxWorkers: 3, totalActiveWorkers: 0 } },
  };
  assert(buildBrief(noProvInputs).blockers.some(b => b.source === 'providers' && b.severity === 'high'), 'no provider blocker');

  // Test: high friction
  const frictionInputs = { ...emptyInputs, metaSignals: { signals: { failureScore: 0, frictionScore: 40, riskScore: 0, trust: 60, topPain: 'stale' } } };
  const friction = buildBrief(frictionInputs);
  assert(friction.blockers.some(b => b.source === 'meta-signals'), 'friction blocker');
  assert(friction.recommendedNextActions.some(a => a.action === 'investigate-worker-friction'), 'friction action');

  // Test: budget blockers from telemetry
  const budgetBlockInputs = { ...emptyInputs,
    workerTelemetry: [
      { eventType: 'complete', taskId: 'w-slow', timing: { elapsedMs: 4000000, softTimeMinutes: 30, hardTimeMinutes: 60 }, tokenUsage: { inputTokens: 10000, outputTokens: 2000, source: 'estimate', confidence: 'low' }, estimatedCost: { amountCents: 5, pricingBasis: 'unknown' }, gateOutcome: { passed: false, reason: 'tsc-fail' } },
    ],
  };
  const budgetBlock = buildBrief(budgetBlockInputs);
  assert(budgetBlock.budgetSummary.loaded === true, 'budgetBlock loaded');
  assert(budgetBlock.budgetSummary.recentWorkerCount === 1, 'budgetBlock workerCount 1');
  assert(budgetBlock.budgetSummary.tokenSummary.low.inputTokens === 10000, 'budgetBlock low tokens');
  assert(budgetBlock.budgetSummary.costEstimate.pricingBasis === 'unknown', 'budgetBlock pricingBasis unknown');
  assert(budgetBlock.budgetSummary.budgetBlockers.some(b => b.type === 'hard-time-limit'), 'budgetBlock has hard-time-limit');
  assert(budgetBlock.budgetSummary.budgetBlockers.some(b => b.type === 'gate-failures'), 'budgetBlock has gate-failures');
  assert(budgetBlock.blockers.some(b => b.source === 'budget'), 'blockers include budget source');

  // Test: issue-production — top-up needed (gap > 10 → high severity blocker)
  const topUpInputs = { ...emptyInputs,
    activeWorkers: { requestedParallelism: 30, effectiveParallelism: 3, workers: [{ status: 'running' }] },
    launchCandidates: { schemaVersion: 1, capturedAt: '2026-01-01T00:00:00.000Z', summary: { totalOpen: 5, candidateCount: 3, excludedCount: 2 }, candidates: [{ number: 100, title: 'A', workerClass: 'runtime-feature', risk: 'medium' }], excluded: [] },
  };
  const topUp = buildBrief(topUpInputs);
  assert(topUp.issueProductionSummary.loaded === true, 'topUp loaded');
  assert(topUp.issueProductionSummary.readyIssueCount === 3, 'topUp readyIssueCount 3');
  assert(topUp.issueProductionSummary.topUpNeeded === true, 'topUp topUpNeeded true');
  assert(topUp.issueProductionSummary.topUpGap === 27, 'topUp topUpGap 27');
  assert(topUp.blockers.some(b => b.source === 'issue-production' && b.severity === 'high'), 'topUp high blocker');
  assert(topUp.recommendedNextActions.some(a => a.action === 'produce-issues'), 'topUp has produce-issues action');

  // Test: issue-production — pool sufficient (no top-up blocker)
  const sufficientInputs = { ...emptyInputs,
    activeWorkers: { requestedParallelism: 5, effectiveParallelism: 3, workers: [{ status: 'running' }] },
    launchCandidates: { schemaVersion: 1, capturedAt: '2026-01-01T00:00:00.000Z', summary: { totalOpen: 20, candidateCount: 10, excludedCount: 10 }, candidates: [], excluded: [] },
  };
  const sufficient = buildBrief(sufficientInputs);
  assert(sufficient.issueProductionSummary.topUpNeeded === false, 'sufficient topUpNeeded false');
  assert(!sufficient.blockers.some(b => b.source === 'issue-production'), 'sufficient no issue-production blocker');

  // Test: issue-production — small gap (medium severity blocker)
  const smallGapInputs = { ...emptyInputs,
    activeWorkers: { requestedParallelism: 10, effectiveParallelism: 3, workers: [{ status: 'running' }] },
    launchCandidates: { schemaVersion: 1, capturedAt: '2026-01-01T00:00:00.000Z', summary: { totalOpen: 15, candidateCount: 8, excludedCount: 7 }, candidates: [], excluded: [] },
  };
  const smallGap = buildBrief(smallGapInputs);
  assert(smallGap.issueProductionSummary.topUpNeeded === true, 'smallGap topUpNeeded true');
  assert(smallGap.issueProductionSummary.topUpGap === 2, 'smallGap topUpGap 2');
  assert(smallGap.blockers.some(b => b.source === 'issue-production' && b.severity === 'medium'), 'smallGap medium blocker');
  assert(smallGap.recommendedNextActions.some(a => a.action === 'top-up-issues'), 'smallGap has top-up-issues action');

  // Report
  console.log(`\n  emit-command-steward-brief self-test`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\n  Some self-tests failed.\n`);
    process.exit(1);
  } else {
    console.log(`\n  All self-tests passed.\n`);
    process.exit(0);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  // Read all input files
  const inputs = {};
  for (const [key, filename] of Object.entries(INPUT_FILES)) {
    const filePath = path.join(STATE_DIR, filename);
    inputs[key] = filename.endsWith('.ndjson') ? readNdjson(filePath) : readJson(filePath);
  }

  const brief = buildBrief(inputs);
  const json = JSON.stringify(brief, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  if (!args.live) {
    // Dry-run mode
    const banner = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                     DRY RUN                                ║',
      '╚══════════════════════════════════════════════════════════════╝',
    ].join('\n');
    process.stdout.write(`${banner}\n`);
    process.stdout.write(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n\n`);
    process.stdout.write(json);
    return;
  }

  // Live mode — write the file
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Command Steward brief written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
