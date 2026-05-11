#!/usr/bin/env node

/**
 * check-provider-pool.js
 *
 * Reads provider-pool policy and state files, validates consistency, and
 * reports whether enough providers are available for launch readiness.
 *
 * Exit codes:
 *   0 — pass (providers available, state consistent)
 *   1 — violation (no providers available or state inconsistent)
 *   2 — usage error (bad args or missing files)
 *
 * Usage:
 *   node scripts/guards/check-provider-pool.js
 *   node scripts/guards/check-provider-pool.js --json
 *   node scripts/guards/check-provider-pool.js --dry-run
 *   node scripts/guards/check-provider-pool.js --warn-only
 *   node scripts/guards/check-provider-pool.js --help
 *   node scripts/guards/check-provider-pool.js --policy .github/ai-policy/provider-pool-policy.json --state .github/ai-state/provider-pool.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_POLICY_PATH = path.join(ROOT, '.github', 'ai-policy', 'provider-pool-policy.json');
const DEFAULT_STATE_PATH = path.join(ROOT, '.github', 'ai-state', 'provider-pool.json');

const VALID_STATUSES = ['available', 'exhausted', 'disabled'];
const VALID_FAILURE_CLASSES = ['exhaustion', 'auth', 'runtime'];

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

function validatePolicyStructure(policy) {
  const violations = [];
  if (!Array.isArray(policy.providers)) {
    violations.push('policy.providers is not an array');
  } else {
    for (const p of policy.providers) {
      if (!p.id) violations.push('policy provider missing id');
      if (typeof p.maxConcurrency !== 'number') {
        violations.push(`policy provider "${p.id || '?'}" missing numeric maxConcurrency`);
      }
    }
  }
  if (policy.concurrency && typeof policy.concurrency.globalMaxWorkers !== 'number') {
    violations.push('policy.concurrency.globalMaxWorkers is not a number');
  }
  return violations;
}

function validateStateStructure(state) {
  const violations = [];
  if (!Array.isArray(state.providers)) {
    violations.push('state.providers is not an array');
    return violations;
  }
  for (const p of state.providers) {
    if (!p.id) violations.push('state provider missing id');
    if (!VALID_STATUSES.includes(p.status)) {
      violations.push(`state provider "${p.id || '?'}" has invalid status "${p.status}"`);
    }
    if (typeof p.currentConcurrency !== 'number') {
      violations.push(`state provider "${p.id || '?'}" missing numeric currentConcurrency`);
    }
    if (typeof p.maxConcurrency !== 'number') {
      violations.push(`state provider "${p.id || '?'}" missing numeric maxConcurrency`);
    }
    if (p.lastFailureClass !== null && !VALID_FAILURE_CLASSES.includes(p.lastFailureClass)) {
      violations.push(`state provider "${p.id || '?'}" has invalid lastFailureClass "${p.lastFailureClass}"`);
    }
  }
  if (state.global) {
    if (typeof state.global.globalMaxWorkers !== 'number') {
      violations.push('state.global.globalMaxWorkers is not a number');
    }
  }
  return violations;
}

function crossValidate(policy, state) {
  const violations = [];
  const policyIds = new Set((policy.providers || []).map((p) => p.id));
  const stateIds = new Set((state.providers || []).map((p) => p.id));

  for (const id of stateIds) {
    if (!policyIds.has(id)) {
      violations.push(`state provider "${id}" not found in policy`);
    }
  }
  for (const id of policyIds) {
    if (!stateIds.has(id)) {
      violations.push(`policy provider "${id}" missing from state`);
    }
  }

  const policyMax = policy.concurrency && policy.concurrency.globalMaxWorkers;
  const stateMax = state.global && state.global.globalMaxWorkers;
  if (policyMax !== undefined && stateMax !== undefined && policyMax !== stateMax) {
    violations.push(`globalMaxWorkers mismatch: policy=${policyMax} state=${stateMax}`);
  }

  for (const sp of state.providers || []) {
    const pp = (policy.providers || []).find((p) => p.id === sp.id);
    if (pp && pp.maxConcurrency !== undefined && sp.maxConcurrency !== undefined && pp.maxConcurrency !== sp.maxConcurrency) {
      violations.push(`maxConcurrency mismatch for "${sp.id}": policy=${pp.maxConcurrency} state=${sp.maxConcurrency}`);
    }
  }

  return violations;
}

function checkCooldownExpiry(state) {
  const warnings = [];
  const now = new Date();
  for (const p of state.providers || []) {
    if (p.status === 'exhausted' && p.cooldownExpiresAt) {
      const expires = new Date(p.cooldownExpiresAt);
      if (isNaN(expires.getTime())) {
        warnings.push(`provider "${p.id}" has invalid cooldownExpiresAt: ${p.cooldownExpiresAt}`);
      } else if (expires <= now) {
        warnings.push(`provider "${p.id}" cooldown has expired but status is still exhausted`);
      }
    }
  }
  return warnings;
}

function computeLaunchReadiness(policy, state) {
  const launchGate = policy.launchGateIntegration || {};
  const blockAllExhausted = launchGate.blockWhenAllExhausted !== false;
  const blockAtCapacity = launchGate.blockWhenAtCapacity !== false;

  const providers = state.providers || [];
  const available = providers.filter((p) => p.status === 'available');
  const exhausted = providers.filter((p) => p.status === 'exhausted');
  const disabled = providers.filter((p) => p.status === 'disabled');

  const hasAvailableProvider = available.length > 0;
  const hasCapacityProvider = available.some(
    (p) => typeof p.currentConcurrency === 'number' && typeof p.maxConcurrency === 'number' && p.currentConcurrency < p.maxConcurrency
  );

  let ready = true;
  const reasons = [];

  if (blockAllExhausted && available.length === 0) {
    ready = false;
    reasons.push('all providers are exhausted or disabled');
  }

  if (blockAtCapacity && hasAvailableProvider && !hasCapacityProvider) {
    ready = false;
    reasons.push('all available providers are at max concurrency');
  }

  const globalMax = (state.global && state.global.globalMaxWorkers) || (policy.concurrency && policy.concurrency.globalMaxWorkers) || 0;
  const totalActive = (state.global && state.global.totalActiveWorkers) || 0;
  if (globalMax > 0 && totalActive >= globalMax) {
    ready = false;
    reasons.push(`at global worker capacity (${totalActive}/${globalMax})`);
  }

  return {
    ready,
    reasons,
    summary: {
      totalProviders: providers.length,
      available: available.length,
      exhausted: exhausted.length,
      disabled: disabled.length,
      totalActiveWorkers: totalActive,
      globalMaxWorkers: globalMax,
    },
  };
}

function checkProviderPool({ policyPath, statePath, dryRun } = {}) {
  const pPath = policyPath || DEFAULT_POLICY_PATH;
  const sPath = statePath || DEFAULT_STATE_PATH;

  const policyResult = loadJson(pPath);
  if (!policyResult.ok) {
    return { ok: false, tool: 'check-provider-pool', violations: [policyResult.error], warnings: [], readiness: null };
  }
  const stateResult = loadJson(sPath);
  if (!stateResult.ok) {
    return { ok: false, tool: 'check-provider-pool', violations: [stateResult.error], warnings: [], readiness: null };
  }

  const policy = policyResult.data;
  const state = stateResult.data;

  const violations = [
    ...validatePolicyStructure(policy),
    ...validateStateStructure(state),
    ...crossValidate(policy, state),
  ];

  const warnings = checkCooldownExpiry(state);
  const readiness = computeLaunchReadiness(policy, state);

  if (!readiness.ready) {
    for (const reason of readiness.reasons) {
      violations.push(`launch not ready: ${reason}`);
    }
  }

  const result = {
    ok: violations.length === 0,
    tool: 'check-provider-pool',
    dryRun: !!dryRun,
    violations,
    warnings,
    readiness,
  };

  return result;
}

function parseArgs(argv) {
  const args = { json: false, warnOnly: false, dryRun: false, help: false, policy: null, state: null };
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
    } else if (arg === '--policy' && i + 1 < argv.length) {
      args.policy = argv[++i];
    } else if (arg === '--state' && i + 1 < argv.length) {
      args.state = argv[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  const help = `
check-provider-pool.js — Provider pool launch readiness guard

Reads provider-pool policy and state files, validates structural consistency,
and reports whether enough providers are available for launch.

Usage:
  node scripts/guards/check-provider-pool.js [options]

Options:
  --json              Output machine-readable JSON
  --dry-run           Show what would be checked without enforcing exit code
  --warn-only         Exit 0 even when violations are found (report only)
  --policy <path>     Path to provider-pool-policy.json (default: .github/ai-policy/)
  --state  <path>     Path to provider-pool.json (default: .github/ai-state/)
  --help, -h          Show this help message

Exit codes:
  0  Pass — providers available, state consistent
  1  Violation — no providers available or state inconsistent
  2  Usage error — bad arguments or missing files

Checks performed:
  1. Policy and state files are valid JSON
  2. Policy structure: providers array, maxConcurrency fields
  3. State structure: valid statuses, numeric concurrency fields
  4. Cross-validation: policy/state provider ids match, limits consistent
  5. Cooldown expiry: exhausted providers with expired cooldowns flagged
  6. Launch readiness: availability, concurrency capacity, global worker cap
`.trim();
  console.log(help);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = checkProviderPool({
    policyPath: args.policy,
    statePath: args.state,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('Provider pool guard passed.');
    console.log(`  Providers: ${result.readiness.summary.available}/${result.readiness.summary.totalProviders} available`);
    console.log(`  Workers: ${result.readiness.summary.totalActiveWorkers}/${result.readiness.summary.globalMaxWorkers} active`);
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ⚠ ' + w);
      }
    }
  } else {
    console.error('Provider pool guard FAILED.');
    for (const v of result.violations) {
      console.error('  - ' + v);
    }
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ⚠ ' + w);
      }
    }
  }

  const exitCode = result.ok ? 0 : (args.warnOnly ? 0 : 1);
  process.exit(exitCode);
}

module.exports = {
  checkProviderPool,
  loadJson,
  validatePolicyStructure,
  validateStateStructure,
  crossValidate,
  checkCooldownExpiry,
  computeLaunchReadiness,
  VALID_STATUSES,
  VALID_FAILURE_CLASSES,
};

if (require.main === module) {
  main();
}
