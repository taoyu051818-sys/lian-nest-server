#!/usr/bin/env node

/**
 * check-provider-pool.test.js
 *
 * Self-contained tests for the provider pool guard. No external test framework.
 * Run: node scripts/guards/check-provider-pool.test.js
 */

const path = require('path');
const { execSync } = require('child_process');
const {
  checkProviderPool,
  loadJson,
  validatePolicyStructure,
  validateStateStructure,
  crossValidate,
  checkCooldownExpiry,
  computeLaunchReadiness,
  VALID_STATUSES,
  VALID_FAILURE_CLASSES,
} = require('./check-provider-pool');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.error('  FAIL  ' + name);
  }
}

// --- Fixtures ---

function validPolicy() {
  return {
    policyVersion: 1,
    providers: [
      { id: 'provider-a', label: 'A', maxConcurrency: 2, capabilities: ['claude-code'] },
      { id: 'provider-b', label: 'B', maxConcurrency: 1, capabilities: ['claude-code'] },
    ],
    concurrency: { globalMaxWorkers: 3 },
    launchGateIntegration: {
      blockWhenAllExhausted: true,
      blockWhenAtCapacity: true,
      preLaunchCheck: true,
    },
  };
}

function validState() {
  return {
    stateVersion: 1,
    providers: [
      {
        id: 'provider-a',
        status: 'available',
        currentConcurrency: 0,
        maxConcurrency: 2,
        lastHealthCheckAt: null,
        lastFailureClass: null,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
        totalQuotaEvents: 0,
      },
      {
        id: 'provider-b',
        status: 'available',
        currentConcurrency: 0,
        maxConcurrency: 1,
        lastHealthCheckAt: null,
        lastFailureClass: null,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
        totalQuotaEvents: 0,
      },
    ],
    global: {
      totalActiveWorkers: 0,
      globalMaxWorkers: 3,
      availableProviders: 2,
      exhaustedProviders: 0,
      disabledProviders: 0,
      lastUpdatedBy: 'test',
      capturedAt: '2026-05-11T00:00:00Z',
    },
  };
}

// --- Tests ---

console.log('\ncheck-provider-pool tests\n');

// --- validatePolicyStructure ---

{
  const violations = validatePolicyStructure(validPolicy());
  assert(violations.length === 0, 'valid policy passes structure check');
}
{
  const policy = validPolicy();
  delete policy.providers;
  const violations = validatePolicyStructure(policy);
  assert(violations.length > 0, 'policy without providers array fails');
}
{
  const policy = validPolicy();
  policy.providers[0].id = '';
  const violations = validatePolicyStructure(policy);
  assert(violations.some((v) => v.includes('missing id')), 'policy provider with empty id fails');
}
{
  const policy = validPolicy();
  delete policy.providers[0].maxConcurrency;
  const violations = validatePolicyStructure(policy);
  assert(violations.some((v) => v.includes('maxConcurrency')), 'policy provider without maxConcurrency fails');
}

// --- validateStateStructure ---

{
  const violations = validateStateStructure(validState());
  assert(violations.length === 0, 'valid state passes structure check');
}
{
  const state = validState();
  state.providers[0].status = 'broken';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('invalid status')), 'state with invalid status fails');
}
{
  const state = validState();
  state.providers[0].currentConcurrency = 'zero';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('currentConcurrency')), 'state with non-numeric currentConcurrency fails');
}
{
  const state = validState();
  state.providers[0].lastFailureClass = 'unknown';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('lastFailureClass')), 'state with invalid lastFailureClass fails');
}
{
  const state = validState();
  state.providers[0].lastFailureClass = 'exhaustion';
  const violations = validateStateStructure(state);
  assert(violations.length === 0, 'state with valid lastFailureClass passes');
}

// --- crossValidate ---

{
  const violations = crossValidate(validPolicy(), validState());
  assert(violations.length === 0, 'matching policy/state passes cross-validation');
}
{
  const state = validState();
  state.providers.push({ id: 'provider-ghost', status: 'available', currentConcurrency: 0, maxConcurrency: 1 });
  const violations = crossValidate(validPolicy(), state);
  assert(violations.some((v) => v.includes('provider-ghost') && v.includes('not found in policy')), 'state provider not in policy fails');
}
{
  const policy = validPolicy();
  policy.providers.push({ id: 'provider-c', label: 'C', maxConcurrency: 1 });
  const violations = crossValidate(policy, validState());
  assert(violations.some((v) => v.includes('provider-c') && v.includes('missing from state')), 'policy provider missing from state fails');
}
{
  const state = validState();
  state.global.globalMaxWorkers = 5;
  const violations = crossValidate(validPolicy(), state);
  assert(violations.some((v) => v.includes('globalMaxWorkers mismatch')), 'globalMaxWorkers mismatch fails');
}
{
  const state = validState();
  state.providers[0].maxConcurrency = 99;
  const violations = crossValidate(validPolicy(), state);
  assert(violations.some((v) => v.includes('maxConcurrency mismatch')), 'per-provider maxConcurrency mismatch fails');
}

// --- checkCooldownExpiry ---

{
  const warnings = checkCooldownExpiry(validState());
  assert(warnings.length === 0, 'no warnings for state without cooldowns');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2020-01-01T00:00:00Z';
  const warnings = checkCooldownExpiry(state);
  assert(warnings.length === 1, 'expired cooldown produces warning');
  assert(warnings[0].includes('expired'), 'warning mentions expired');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2099-12-31T23:59:59Z';
  const warnings = checkCooldownExpiry(state);
  assert(warnings.length === 0, 'future cooldown produces no warning');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = 'not-a-date';
  const warnings = checkCooldownExpiry(state);
  assert(warnings.some((w) => w.includes('invalid')), 'invalid cooldownExpiresAt produces warning');
}

// --- computeLaunchReadiness ---

{
  const readiness = computeLaunchReadiness(validPolicy(), validState());
  assert(readiness.ready === true, 'available providers with capacity → ready');
  assert(readiness.summary.available === 2, 'reports correct available count');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[1].status = 'exhausted';
  const readiness = computeLaunchReadiness(validPolicy(), state);
  assert(readiness.ready === false, 'all exhausted → not ready');
  assert(readiness.reasons.some((r) => r.includes('all providers')), 'reason mentions all providers');
}
{
  const state = validState();
  state.providers[0].status = 'disabled';
  state.providers[1].status = 'disabled';
  const readiness = computeLaunchReadiness(validPolicy(), state);
  assert(readiness.ready === false, 'all disabled → not ready');
}
{
  const state = validState();
  state.providers[0].currentConcurrency = 2; // at max
  state.providers[1].currentConcurrency = 1; // at max
  const readiness = computeLaunchReadiness(validPolicy(), state);
  assert(readiness.ready === false, 'all at max concurrency → not ready');
  assert(readiness.reasons.some((r) => r.includes('max concurrency')), 'reason mentions max concurrency');
}
{
  const state = validState();
  state.global.totalActiveWorkers = 3;
  const readiness = computeLaunchReadiness(validPolicy(), state);
  assert(readiness.ready === false, 'at global worker cap → not ready');
  assert(readiness.reasons.some((r) => r.includes('global worker capacity')), 'reason mentions global capacity');
}
{
  const policy = validPolicy();
  policy.launchGateIntegration = {};
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[1].status = 'exhausted';
  const readiness = computeLaunchReadiness(policy, state);
  assert(readiness.ready === false, 'blockWhenAllExhausted defaults to true → still blocks');
}

// --- checkProviderPool (integration with real files) ---

{
  const result = checkProviderPool();
  assert(result.ok === true, 'real policy+state files pass guard');
  assert(result.tool === 'check-provider-pool', 'result has tool name');
  assert(result.readiness !== null, 'result has readiness object');
}
{
  const result = checkProviderPool({ dryRun: true });
  assert(result.dryRun === true, 'dryRun flag is reflected in result');
}

// --- loadJson ---

{
  const result = loadJson(path.resolve(__dirname, '..', '..', '.github', 'ai-state', 'provider-pool.json'));
  assert(result.ok === true, 'loadJson reads existing file');
  assert(typeof result.data === 'object', 'loadJson returns parsed JSON');
}
{
  const result = loadJson('/nonexistent/path.json');
  assert(result.ok === false, 'loadJson fails for missing file');
  assert(result.error.includes('not found'), 'error mentions not found');
}

// --- CLI ---

console.log('\nCLI tests\n');

const script = path.resolve(__dirname, 'check-provider-pool.js');

{
  const out = execSync(`node "${script}" --json`, { encoding: 'utf-8' });
  const result = JSON.parse(out);
  assert(result.ok === true, 'CLI --json returns valid JSON with ok=true');
  assert(result.tool === 'check-provider-pool', 'CLI --json includes tool name');
}
{
  const out = execSync(`node "${script}" --json --dry-run`, { encoding: 'utf-8' });
  const result = JSON.parse(out);
  assert(result.dryRun === true, 'CLI --json --dry-run reflects dryRun flag');
}
{
  try {
    execSync(`node "${script}" --help`, { encoding: 'utf-8', stdio: 'pipe' });
    assert(true, 'CLI --help exits 0');
  } catch {
    assert(false, 'CLI --help exits 0');
  }
}
{
  const out = execSync(`node "${script}" --help`, { encoding: 'utf-8' });
  assert(out.includes('Usage'), 'CLI --help shows usage');
  assert(out.includes('--json'), 'CLI --help mentions --json');
  assert(out.includes('--dry-run'), 'CLI --help mentions --dry-run');
}
{
  try {
    execSync(`node "${script}" --unknown-flag`, { encoding: 'utf-8', stdio: 'pipe' });
    assert(false, 'CLI unknown flag should exit non-zero');
  } catch (err) {
    assert(err.status === 2, 'CLI unknown flag exits with code 2');
  }
}

// --- Summary ---

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
