#!/usr/bin/env node

/**
 * check-provider-quota.js
 *
 * Detects provider quota exhaustion markers and blocks additional assignment
 * for exhausted aliases. Complements check-provider-pool by focusing on the
 * quota dimension: which providers have hit quota limits, whether cooldowns
 * are active, and whether recovery has stalled.
 *
 * Exit codes:
 *   0 — pass (no exhausted providers blocking assignment)
 *   1 — violation (exhausted provider blocking assignment, or state invalid)
 *   2 — usage error (bad args or missing files)
 *
 * Usage:
 *   node scripts/guards/check-provider-quota.js
 *   node scripts/guards/check-provider-quota.js --json
 *   node scripts/guards/check-provider-quota.js --dry-run
 *   node scripts/guards/check-provider-quota.js --warn-only
 *   node scripts/guards/check-provider-quota.js --help
 *   node scripts/guards/check-provider-quota.js --state .github/ai-state/provider-pool.json
 *   node scripts/guards/check-provider-quota.js --policy .github/ai-policy/provider-pool-policy.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_PATH = path.join(ROOT, '.github', 'ai-state', 'provider-pool.json');
const DEFAULT_POLICY_PATH = path.join(ROOT, '.github', 'ai-policy', 'provider-pool-policy.json');

const VALID_STATUSES = ['available', 'exhausted', 'disabled'];
const VALID_FAILURE_CLASSES = ['exhaustion', 'auth', 'runtime', null];

const EXHAUSTION_FAILURE_CLASS = 'exhaustion';
const HIGH_CONSECUTIVE_FAILURES = 3;
const HIGH_QUOTA_EVENTS = 5;

function loadJson(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `File not found: ${resolved}` };
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `Invalid JSON in ${resolved}: ${err.message}` };
  }
}

function validateQuotaState(state) {
  const violations = [];
  if (!Array.isArray(state.providers)) {
    violations.push('state.providers is not an array');
    return violations;
  }
  for (const p of state.providers) {
    if (!p.id) violations.push('state provider missing id');
    if (!VALID_STATUSES.includes(p.status)) {
      violations.push(`provider "${p.id || '?'}" has invalid status "${p.status}"`);
    }
    if (typeof p.currentConcurrency !== 'number') {
      violations.push(`provider "${p.id || '?'}" missing numeric currentConcurrency`);
    }
    if (typeof p.maxConcurrency !== 'number') {
      violations.push(`provider "${p.id || '?'}" missing numeric maxConcurrency`);
    }
    if (typeof p.totalQuotaEvents !== 'number') {
      violations.push(`provider "${p.id || '?'}" missing numeric totalQuotaEvents`);
    }
    if (typeof p.consecutiveFailures !== 'number') {
      violations.push(`provider "${p.id || '?'}" missing numeric consecutiveFailures`);
    }
    if (p.lastFailureClass !== undefined && p.lastFailureClass !== null && !VALID_FAILURE_CLASSES.includes(p.lastFailureClass)) {
      violations.push(`provider "${p.id || '?'}" has invalid lastFailureClass "${p.lastFailureClass}"`);
    }
  }
  return violations;
}

function validatePolicyExhaustionConfig(policy) {
  const violations = [];
  if (!policy.exhaustion) return violations;
  if (!Array.isArray(policy.exhaustion.triggers)) {
    violations.push('policy.exhaustion.triggers is not an array');
    return violations;
  }
  for (const trigger of policy.exhaustion.triggers) {
    if (!trigger.condition) {
      violations.push('exhaustion trigger missing condition');
    }
    if (!trigger.action) {
      violations.push('exhaustion trigger missing action');
    }
    if (trigger.action === 'mark-exhausted' && typeof trigger.cooldownMinutes !== 'number') {
      violations.push(`exhaustion trigger "${trigger.condition}" mark-exhausted without numeric cooldownMinutes`);
    }
  }
  return violations;
}

function detectExhaustedProviders(state) {
  const now = new Date();
  const blocked = [];
  const recovered = [];
  const stalled = [];

  for (const p of state.providers || []) {
    if (p.status !== 'exhausted') continue;

    const entry = {
      id: p.id,
      totalQuotaEvents: p.totalQuotaEvents,
      consecutiveFailures: p.consecutiveFailures,
      lastFailureClass: p.lastFailureClass,
      cooldownExpiresAt: p.cooldownExpiresAt,
    };

    if (p.cooldownExpiresAt) {
      const expires = new Date(p.cooldownExpiresAt);
      if (isNaN(expires.getTime())) {
        entry.reason = 'invalid cooldownExpiresAt';
        stalled.push(entry);
      } else if (expires <= now) {
        entry.reason = 'cooldown expired but still exhausted';
        entry.cooldownExpiredAt = p.cooldownExpiresAt;
        recovered.push(entry);
      } else {
        entry.reason = 'cooldown active';
        entry.cooldownRemainingMs = expires.getTime() - now.getTime();
        blocked.push(entry);
      }
    } else {
      entry.reason = 'no cooldown set';
      stalled.push(entry);
    }
  }

  return { blocked, recovered, stalled };
}

function detectQuotaTrends(state) {
  const warnings = [];

  for (const p of state.providers || []) {
    if (p.consecutiveFailures >= HIGH_CONSECUTIVE_FAILURES) {
      warnings.push(`provider "${p.id}" has ${p.consecutiveFailures} consecutive failures`);
    }
    if (p.totalQuotaEvents >= HIGH_QUOTA_EVENTS) {
      warnings.push(`provider "${p.id}" has ${p.totalQuotaEvents} total quota events (threshold: ${HIGH_QUOTA_EVENTS})`);
    }
    if (p.lastFailureClass === EXHAUSTION_FAILURE_CLASS && p.status !== 'exhausted') {
      warnings.push(`provider "${p.id}" last failure was exhaustion but status is "${p.status}" (may need manual review)`);
    }
  }

  return warnings;
}

function computeQuotaReadiness(state) {
  const providers = state.providers || [];
  const available = providers.filter((p) => p.status === 'available');
  const exhausted = providers.filter((p) => p.status === 'exhausted');
  const disabled = providers.filter((p) => p.status === 'disabled');

  const hasAssignable = available.some(
    (p) => typeof p.currentConcurrency === 'number' && typeof p.maxConcurrency === 'number' && p.currentConcurrency < p.maxConcurrency
  );

  let assignable = true;
  const reasons = [];

  if (available.length === 0) {
    assignable = false;
    reasons.push('all providers exhausted or disabled — no alias available for assignment');
  }

  if (available.length > 0 && !hasAssignable) {
    assignable = false;
    reasons.push('available providers are at max concurrency — no capacity for new assignment');
  }

  return {
    assignable,
    reasons,
    summary: {
      totalProviders: providers.length,
      available: available.length,
      exhausted: exhausted.length,
      disabled: disabled.length,
    },
  };
}

function checkProviderQuota({ statePath, policyPath, dryRun } = {}) {
  const sPath = statePath || DEFAULT_STATE_PATH;
  const pPath = policyPath || DEFAULT_POLICY_PATH;

  const stateResult = loadJson(sPath);
  if (!stateResult.ok) {
    return { ok: false, tool: 'check-provider-quota', violations: [stateResult.error], warnings: [], quota: null };
  }

  const state = stateResult.data;
  const violations = [...validateQuotaState(state)];
  const warnings = [];

  const policyResult = loadJson(pPath);
  if (policyResult.ok) {
    const policyViolations = validatePolicyExhaustionConfig(policyResult.data);
    violations.push(...policyViolations);
  }

  const exhaustion = detectExhaustedProviders(state);
  for (const p of exhaustion.blocked) {
    violations.push(`provider "${p.id}" is exhausted with active cooldown — assignment blocked`);
  }
  for (const p of exhaustion.stalled) {
    violations.push(`provider "${p.id}" is exhausted with ${p.reason} — recovery stalled`);
  }
  for (const p of exhaustion.recovered) {
    warnings.push(`provider "${p.id}" cooldown expired at ${p.cooldownExpiredAt} but still marked exhausted`);
  }

  const trendWarnings = detectQuotaTrends(state);
  warnings.push(...trendWarnings);

  const readiness = computeQuotaReadiness(state);
  if (!readiness.assignable) {
    for (const reason of readiness.reasons) {
      violations.push(`quota guard: ${reason}`);
    }
  }

  return {
    ok: violations.length === 0,
    tool: 'check-provider-quota',
    dryRun: !!dryRun,
    violations,
    warnings,
    exhaustion: {
      blocked: exhaustion.blocked.length,
      recovered: exhaustion.recovered.length,
      stalled: exhaustion.stalled.length,
      details: exhaustion,
    },
    readiness,
  };
}

function parseArgs(argv) {
  const args = { json: false, warnOnly: false, dryRun: false, help: false, state: null, policy: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--warn-only') {
      args.warnOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--state' && i + 1 < argv.length) {
      args.state = argv[++i];
    } else if (arg === '--policy' && i + 1 < argv.length) {
      args.policy = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  const help = `
check-provider-quota.js — Provider quota exhaustion guard

Detects provider quota exhaustion markers and blocks additional assignment
for exhausted aliases. Reports cooldown status, recovery stalls, and quota
event trends.

Usage:
  node scripts/guards/check-provider-quota.js [options]

Options:
  --json              Output machine-readable JSON
  --dry-run           Show what would be checked without enforcing exit code
  --warn-only         Exit 0 even when violations are found (report only)
  --state  <path>     Path to provider-pool.json (default: .github/ai-state/)
  --policy <path>     Path to provider-pool-policy.json (default: .github/ai-policy/)
  --help, -h          Show this help message

Exit codes:
  0  Pass — no exhausted providers blocking assignment
  1  Violation — exhausted provider blocking assignment or state invalid
  2  Usage error — bad arguments or missing files

Checks performed:
  1. State file is valid JSON
  2. Quota-specific state structure (totalQuotaEvents, consecutiveFailures)
  3. Policy exhaustion trigger config (if policy file present)
  4. Exhausted providers: active cooldowns block assignment
  5. Stalled recovery: exhausted without valid cooldown
  6. Expired cooldowns: still marked exhausted past cooldown window
  7. Quota trends: high consecutive failures or quota event counts
  8. Overall assignment readiness
`.trim();
  console.log(help);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = checkProviderQuota({
    statePath: args.state,
    policyPath: args.policy,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('Provider quota guard passed.');
    console.log(`  Providers: ${result.readiness.summary.available}/${result.readiness.summary.totalProviders} available`);
    console.log(`  Exhausted: ${result.exhaustion.blocked} blocked, ${result.exhaustion.recovered} pending recovery, ${result.exhaustion.stalled} stalled`);
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ! ' + w);
      }
    }
  } else {
    console.error('Provider quota guard FAILED.');
    for (const v of result.violations) {
      console.error('  - ' + v);
    }
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ! ' + w);
      }
    }
  }

  const exitCode = result.ok ? 0 : (args.warnOnly ? 0 : 1);
  process.exit(exitCode);
}

module.exports = {
  checkProviderQuota,
  loadJson,
  validateQuotaState,
  validatePolicyExhaustionConfig,
  detectExhaustedProviders,
  detectQuotaTrends,
  computeQuotaReadiness,
  VALID_STATUSES,
  VALID_FAILURE_CLASSES,
  EXHAUSTION_FAILURE_CLASS,
  HIGH_CONSECUTIVE_FAILURES,
  HIGH_QUOTA_EVENTS,
};

if (require.main === module) {
  main();
}
