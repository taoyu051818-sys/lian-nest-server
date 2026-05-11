#!/usr/bin/env node

/**
 * check-local-resource.js
 *
 * Reads local-resource policy and state files, validates structural consistency,
 * and reports whether local resources meet thresholds for launch readiness.
 *
 * Exit codes:
 *   0 — pass (local resources sufficient, state consistent)
 *   1 — violation (resource shortfall or state inconsistent)
 *   2 — usage error (bad args or missing files)
 *
 * Usage:
 *   node scripts/guards/check-local-resource.js
 *   node scripts/guards/check-local-resource.js --json
 *   node scripts/guards/check-local-resource.js --dry-run
 *   node scripts/guards/check-local-resource.js --warn-only
 *   node scripts/guards/check-local-resource.js --help
 *   node scripts/guards/check-local-resource.js --policy ./my-policy.json --state ./my-state.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_POLICY_PATH = path.join(ROOT, '.github', 'ai-policy', 'local-resource-policy.json');
const DEFAULT_STATE_PATH = path.join(ROOT, '.github', 'ai-state', 'local-resource.json');

const VALID_RESOURCE_TYPES = ['disk', 'memory', 'cpu', 'port', 'service'];
const VALID_SEVERITIES = ['critical', 'warning', 'info'];

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
  if (!Array.isArray(policy.resources)) {
    violations.push('policy.resources is not an array');
  } else {
    for (const r of policy.resources) {
      if (!r.id) violations.push('policy resource missing id');
      if (!r.type || !VALID_RESOURCE_TYPES.includes(r.type)) {
        violations.push(`policy resource "${r.id || '?'}" has invalid type "${r.type}"`);
      }
      if (r.threshold !== undefined && typeof r.threshold !== 'number') {
        violations.push(`policy resource "${r.id || '?'}" has non-numeric threshold`);
      }
      if (r.severity !== undefined && !VALID_SEVERITIES.includes(r.severity)) {
        violations.push(`policy resource "${r.id || '?'}" has invalid severity "${r.severity}"`);
      }
    }
  }
  return violations;
}

function validateStateStructure(state) {
  const violations = [];
  if (!Array.isArray(state.resources)) {
    violations.push('state.resources is not an array');
    return violations;
  }
  for (const r of state.resources) {
    if (!r.id) violations.push('state resource missing id');
    if (!VALID_RESOURCE_TYPES.includes(r.type)) {
      violations.push(`state resource "${r.id || '?'}" has invalid type "${r.type}"`);
    }
    if (typeof r.available !== 'number') {
      violations.push(`state resource "${r.id || '?'}" missing numeric available`);
    }
    if (r.unit !== undefined && typeof r.unit !== 'string') {
      violations.push(`state resource "${r.id || '?'}" has non-string unit`);
    }
    if (r.status !== undefined && !['ok', 'low', 'critical', 'unavailable'].includes(r.status)) {
      violations.push(`state resource "${r.id || '?'}" has invalid status "${r.status}"`);
    }
  }
  if (state.global) {
    if (state.global.ready !== undefined && typeof state.global.ready !== 'boolean') {
      violations.push('state.global.ready is not a boolean');
    }
  }
  return violations;
}

function crossValidate(policy, state) {
  const violations = [];
  const policyIds = new Set((policy.resources || []).map((r) => r.id));
  const stateIds = new Set((state.resources || []).map((r) => r.id));

  for (const id of stateIds) {
    if (!policyIds.has(id)) {
      violations.push(`state resource "${id}" not found in policy`);
    }
  }
  for (const id of policyIds) {
    if (!stateIds.has(id)) {
      violations.push(`policy resource "${id}" missing from state`);
    }
  }

  for (const sr of state.resources || []) {
    const pr = (policy.resources || []).find((r) => r.id === sr.id);
    if (pr && pr.type !== undefined && sr.type !== undefined && pr.type !== sr.type) {
      violations.push(`type mismatch for "${sr.id}": policy=${pr.type} state=${sr.type}`);
    }
  }

  return violations;
}

function checkThresholds(policy, state) {
  const warnings = [];
  const violations = [];
  for (const pr of policy.resources || []) {
    const sr = (state.resources || []).find((r) => r.id === pr.id);
    if (!sr || pr.threshold === undefined) continue;
    if (sr.available < pr.threshold) {
      const msg = `resource "${pr.id}" below threshold: available=${sr.available} threshold=${pr.threshold}`;
      if (pr.severity === 'critical') {
        violations.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }
  return { violations, warnings };
}

function computeLaunchReadiness(policy, state) {
  const launchGate = policy.launchGateIntegration || {};
  const blockOnCritical = launchGate.blockOnCritical !== false;
  const blockOnMissing = launchGate.blockOnMissingState !== false;

  const resources = state.resources || [];
  const policyResources = policy.resources || [];

  let ready = true;
  const reasons = [];

  const criticalResources = policyResources.filter((r) => r.severity === 'critical');
  for (const pr of criticalResources) {
    const sr = resources.find((r) => r.id === pr.id);
    if (!sr) {
      if (blockOnMissing) {
        ready = false;
        reasons.push(`critical resource "${pr.id}" missing from state`);
      }
    } else if (pr.threshold !== undefined && sr.available < pr.threshold) {
      if (blockOnCritical) {
        ready = false;
        reasons.push(`critical resource "${pr.id}" below threshold (${sr.available}/${pr.threshold})`);
      }
    }
  }

  if (state.global && state.global.ready === false) {
    ready = false;
    reasons.push('state.global.ready is false');
  }

  return {
    ready,
    reasons,
    summary: {
      totalResources: resources.length,
      ok: resources.filter((r) => r.status === 'ok').length,
      low: resources.filter((r) => r.status === 'low').length,
      critical: resources.filter((r) => r.status === 'critical').length,
      unavailable: resources.filter((r) => r.status === 'unavailable').length,
    },
  };
}

function checkLocalResource({ policyPath, statePath, dryRun } = {}) {
  const pPath = policyPath || DEFAULT_POLICY_PATH;
  const sPath = statePath || DEFAULT_STATE_PATH;

  const policyResult = loadJson(pPath);
  if (!policyResult.ok) {
    return { ok: false, tool: 'check-local-resource', dryRun: !!dryRun, violations: [policyResult.error], warnings: [], readiness: null };
  }
  const stateResult = loadJson(sPath);
  if (!stateResult.ok) {
    return { ok: false, tool: 'check-local-resource', dryRun: !!dryRun, violations: [stateResult.error], warnings: [], readiness: null };
  }

  const policy = policyResult.data;
  const state = stateResult.data;

  const structuralViolations = [
    ...validatePolicyStructure(policy),
    ...validateStateStructure(state),
    ...crossValidate(policy, state),
  ];

  const thresholdResult = checkThresholds(policy, state);
  const warnings = [...thresholdResult.warnings];
  const readiness = computeLaunchReadiness(policy, state);

  const violations = [
    ...structuralViolations,
    ...thresholdResult.violations,
  ];

  if (!readiness.ready) {
    for (const reason of readiness.reasons) {
      if (!violations.includes(`launch not ready: ${reason}`)) {
        violations.push(`launch not ready: ${reason}`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    tool: 'check-local-resource',
    dryRun: !!dryRun,
    violations,
    warnings,
    readiness,
  };
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
check-local-resource.js — Local resource launch readiness guard

Reads local-resource policy and state files, validates structural consistency,
and reports whether local resources meet thresholds for launch.

Usage:
  node scripts/guards/check-local-resource.js [options]

Options:
  --json              Output machine-readable JSON
  --dry-run           Show what would be checked without enforcing exit code
  --warn-only         Exit 0 even when violations are found (report only)
  --policy <path>     Path to local-resource-policy.json (default: .github/ai-policy/)
  --state  <path>     Path to local-resource.json (default: .github/ai-state/)
  --help, -h          Show this help message

Exit codes:
  0  Pass — local resources sufficient, state consistent
  1  Violation — resource shortfall or state inconsistent
  2  Usage error — bad arguments or missing files

Checks performed:
  1. Policy and state files are valid JSON
  2. Policy structure: resources array, valid types, thresholds, severities
  3. State structure: resources array with numeric available, valid statuses
  4. Cross-validation: policy/state resource ids match, types consistent
  5. Threshold checks: resources below threshold flagged by severity
  6. Launch readiness: critical shortfalls, missing state, global ready flag
`.trim();
  console.log(help);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = checkLocalResource({
    policyPath: args.policy,
    statePath: args.state,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('Local resource guard passed.');
    console.log(`  Resources: ${result.readiness.summary.ok}/${result.readiness.summary.totalResources} ok`);
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ' + w);
      }
    }
  } else {
    console.error('Local resource guard FAILED.');
    for (const v of result.violations) {
      console.error('  - ' + v);
    }
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ' + w);
      }
    }
  }

  const exitCode = result.ok ? 0 : (args.warnOnly ? 0 : 1);
  process.exit(exitCode);
}

module.exports = {
  checkLocalResource,
  loadJson,
  validatePolicyStructure,
  validateStateStructure,
  crossValidate,
  checkThresholds,
  computeLaunchReadiness,
  VALID_RESOURCE_TYPES,
  VALID_SEVERITIES,
};

if (require.main === module) {
  main();
}
