#!/usr/bin/env node

/**
 * check-provider-quota.test.js
 *
 * Self-contained tests for the provider quota exhaustion guard.
 * No external test framework.
 * Run: node scripts/guards/check-provider-quota.test.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
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
} = require('./check-provider-quota');

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

function validPolicy() {
  return {
    policyVersion: 1,
    providers: [
      { id: 'provider-a', maxConcurrency: 2 },
    ],
    exhaustion: {
      triggers: [
        { condition: 'http-429', action: 'mark-exhausted', cooldownMinutes: 15 },
        { condition: 'quota-exhausted', action: 'mark-exhausted', cooldownMinutes: 60 },
        { condition: 'auth-failure', action: 'mark-disabled', cooldownMinutes: null },
      ],
    },
  };
}

// --- Tests ---

console.log('\ncheck-provider-quota tests\n');

// --- validateQuotaState ---

{
  const violations = validateQuotaState(validState());
  assert(violations.length === 0, 'valid state passes quota validation');
}
{
  const state = validState();
  state.providers[0].status = 'broken';
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('invalid status')), 'invalid status fails');
}
{
  const state = validState();
  state.providers[0].totalQuotaEvents = 'many';
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('totalQuotaEvents')), 'non-numeric totalQuotaEvents fails');
}
{
  const state = validState();
  state.providers[0].consecutiveFailures = 'three';
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('consecutiveFailures')), 'non-numeric consecutiveFailures fails');
}
{
  const state = validState();
  state.providers[0].lastFailureClass = 'unknown-type';
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('lastFailureClass')), 'invalid lastFailureClass fails');
}
{
  const state = validState();
  state.providers[0].lastFailureClass = 'exhaustion';
  const violations = validateQuotaState(state);
  assert(violations.length === 0, 'valid lastFailureClass passes');
}
{
  const state = validState();
  delete state.providers;
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('not an array')), 'missing providers array fails');
}
{
  const state = validState();
  state.providers[0].id = '';
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('missing id')), 'empty provider id fails');
}
{
  const state = validState();
  delete state.providers[0].currentConcurrency;
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('currentConcurrency')), 'missing currentConcurrency fails');
}
{
  const state = validState();
  state.providers = null;
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('not an array')), 'null providers fails');
}
{
  const state = validState();
  delete state.providers[0].maxConcurrency;
  const violations = validateQuotaState(state);
  assert(violations.some((v) => v.includes('maxConcurrency')), 'missing maxConcurrency fails');
}
{
  const state = validState();
  state.providers = [];
  const violations = validateQuotaState(state);
  assert(violations.length === 0, 'empty providers array passes validation');
}
{
  const state = validState();
  state.providers[0].consecutiveFailures = -1;
  const violations = validateQuotaState(state);
  assert(violations.length === 0, 'negative consecutiveFailures passes schema check (numeric)');
}
{
  const state = validState();
  state.providers[0].currentConcurrency = -5;
  const violations = validateQuotaState(state);
  assert(violations.length === 0, 'negative currentConcurrency passes schema check (numeric)');
}
{
  const state = validState();
  state.providers[0].status = 'disabled';
  const violations = validateQuotaState(state);
  assert(violations.length === 0, 'disabled status passes validation');
}

// --- validatePolicyExhaustionConfig ---

{
  const violations = validatePolicyExhaustionConfig(validPolicy());
  assert(violations.length === 0, 'valid policy exhaustion config passes');
}
{
  const policy = validPolicy();
  policy.exhaustion.triggers = 'not-array';
  const violations = validatePolicyExhaustionConfig(policy);
  assert(violations.some((v) => v.includes('not an array')), 'non-array triggers fails');
}
{
  const policy = validPolicy();
  delete policy.exhaustion.triggers[0].condition;
  const violations = validatePolicyExhaustionConfig(policy);
  assert(violations.some((v) => v.includes('missing condition')), 'trigger without condition fails');
}
{
  const policy = validPolicy();
  delete policy.exhaustion.triggers[0].action;
  const violations = validatePolicyExhaustionConfig(policy);
  assert(violations.some((v) => v.includes('missing action')), 'trigger without action fails');
}
{
  const policy = validPolicy();
  policy.exhaustion.triggers[0].cooldownMinutes = 'fifteen';
  const violations = validatePolicyExhaustionConfig(policy);
  assert(violations.some((v) => v.includes('cooldownMinutes')), 'non-numeric cooldownMinutes for mark-exhausted fails');
}
{
  const policy = { exhaustion: null };
  const violations = validatePolicyExhaustionConfig(policy);
  assert(violations.length === 0, 'null exhaustion section passes (no triggers to validate)');
}

// --- detectExhaustedProviders ---

{
  const state = validState();
  const result = detectExhaustedProviders(state);
  assert(result.blocked.length === 0, 'no exhausted providers → empty blocked');
  assert(result.recovered.length === 0, 'no exhausted providers → empty recovered');
  assert(result.stalled.length === 0, 'no exhausted providers → empty stalled');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2099-12-31T23:59:59Z';
  const result = detectExhaustedProviders(state);
  assert(result.blocked.length === 1, 'exhausted with future cooldown → blocked');
  assert(result.blocked[0].id === 'provider-a', 'blocked contains correct provider id');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2020-01-01T00:00:00Z';
  const result = detectExhaustedProviders(state);
  assert(result.recovered.length === 1, 'exhausted with expired cooldown → recovered');
  assert(result.recovered[0].cooldownExpiredAt === '2020-01-01T00:00:00Z', 'recovered entry has expired timestamp');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = null;
  const result = detectExhaustedProviders(state);
  assert(result.stalled.length === 1, 'exhausted with no cooldown → stalled');
  assert(result.stalled[0].reason.includes('no cooldown'), 'stalled reason mentions no cooldown');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = 'not-a-date';
  const result = detectExhaustedProviders(state);
  assert(result.stalled.length === 1, 'exhausted with invalid cooldown → stalled');
  assert(result.stalled[0].reason.includes('invalid'), 'stalled reason mentions invalid');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2099-01-01T00:00:00Z';
  state.providers[1].status = 'exhausted';
  state.providers[1].cooldownExpiresAt = '2020-01-01T00:00:00Z';
  const result = detectExhaustedProviders(state);
  assert(result.blocked.length === 1, 'mixed: one blocked');
  assert(result.recovered.length === 1, 'mixed: one recovered');
}
{
  const state = validState();
  state.providers[0].status = 'disabled';
  state.providers[0].cooldownExpiresAt = '2099-12-31T23:59:59Z';
  const result = detectExhaustedProviders(state);
  assert(result.blocked.length === 0, 'disabled provider not counted in blocked');
  assert(result.recovered.length === 0, 'disabled provider not counted in recovered');
  assert(result.stalled.length === 0, 'disabled provider not counted in stalled');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2099-01-01T00:00:00Z';
  state.providers[1].status = 'exhausted';
  state.providers[1].cooldownExpiresAt = '2099-06-01T00:00:00Z';
  const result = detectExhaustedProviders(state);
  assert(result.blocked.length === 2, 'two exhausted future cooldowns → both blocked');
  assert(result.recovered.length === 0, 'two blocked → none recovered');
  assert(result.stalled.length === 0, 'two blocked → none stalled');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = null;
  state.providers[1].status = 'exhausted';
  state.providers[1].cooldownExpiresAt = null;
  const result = detectExhaustedProviders(state);
  assert(result.stalled.length === 2, 'two exhausted no cooldowns → both stalled');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = new Date().toISOString();
  const result = detectExhaustedProviders(state);
  assert(result.recovered.length === 1, 'cooldown at exact current time → recovered (expires <= now)');
}

// --- detectQuotaTrends ---

{
  const warnings = detectQuotaTrends(validState());
  assert(warnings.length === 0, 'no warnings for clean state');
}
{
  const state = validState();
  state.providers[0].consecutiveFailures = HIGH_CONSECUTIVE_FAILURES;
  const warnings = detectQuotaTrends(state);
  assert(warnings.some((w) => w.includes('consecutive failures')), 'high consecutive failures produces warning');
}
{
  const state = validState();
  state.providers[0].totalQuotaEvents = HIGH_QUOTA_EVENTS;
  const warnings = detectQuotaTrends(state);
  assert(warnings.some((w) => w.includes('total quota events')), 'high total quota events produces warning');
}
{
  const state = validState();
  state.providers[0].lastFailureClass = EXHAUSTION_FAILURE_CLASS;
  state.providers[0].status = 'available';
  const warnings = detectQuotaTrends(state);
  assert(warnings.some((w) => w.includes('exhaustion') && w.includes('available')), 'exhaustion failure on available provider produces warning');
}

// --- computeQuotaReadiness ---

{
  const readiness = computeQuotaReadiness(validState());
  assert(readiness.assignable === true, 'available providers → assignable');
  assert(readiness.summary.available === 2, 'reports correct available count');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[1].status = 'exhausted';
  const readiness = computeQuotaReadiness(state);
  assert(readiness.assignable === false, 'all exhausted → not assignable');
  assert(readiness.reasons.some((r) => r.includes('no alias')), 'reason mentions no alias');
}
{
  const state = validState();
  state.providers[0].status = 'disabled';
  state.providers[1].status = 'disabled';
  const readiness = computeQuotaReadiness(state);
  assert(readiness.assignable === false, 'all disabled → not assignable');
}
{
  const state = validState();
  state.providers[0].currentConcurrency = 2;
  state.providers[1].currentConcurrency = 1;
  const readiness = computeQuotaReadiness(state);
  assert(readiness.assignable === false, 'all at max concurrency → not assignable');
  assert(readiness.reasons.some((r) => r.includes('max concurrency')), 'reason mentions max concurrency');
}
{
  const state = validState();
  state.providers[0].status = 'exhausted';
  state.providers[0].cooldownExpiresAt = '2099-01-01T00:00:00Z';
  const readiness = computeQuotaReadiness(state);
  assert(readiness.assignable === true, 'one exhausted + one available → still assignable');
  assert(readiness.summary.exhausted === 1, 'reports correct exhausted count');
}
{
  const state = validState();
  state.providers = [];
  const readiness = computeQuotaReadiness(state);
  assert(readiness.assignable === false, 'empty providers → not assignable');
  assert(readiness.summary.totalProviders === 0, 'empty providers → zero total');
}
{
  const state = validState();
  state.providers[0].status = 'disabled';
  const readiness = computeQuotaReadiness(state);
  assert(readiness.assignable === true, 'one disabled + one available → still assignable');
  assert(readiness.summary.disabled === 1, 'reports correct disabled count');
  assert(readiness.summary.available === 1, 'reports correct available count');
}

// --- checkProviderQuota (integration with real files) ---

{
  const result = checkProviderQuota();
  assert(result.ok === true, 'real state file passes quota guard');
  assert(result.tool === 'check-provider-quota', 'result has tool name');
  assert(result.readiness !== null, 'result has readiness object');
  assert(result.exhaustion !== null, 'result has exhaustion object');
}
{
  const result = checkProviderQuota({ dryRun: true });
  assert(result.dryRun === true, 'dryRun flag is reflected in result');
}
{
  const result = checkProviderQuota({ statePath: '/nonexistent/path.json' });
  assert(result.ok === false, 'missing state file fails guard');
  assert(result.violations.some((v) => v.includes('not found')), 'violation mentions not found');
}
{
  const tmpState = path.join(__dirname, '.tmp-exhausted-state.json');
  const exhausted = validState();
  exhausted.providers[0].status = 'exhausted';
  exhausted.providers[0].cooldownExpiresAt = '2099-12-31T23:59:59Z';
  fs.writeFileSync(tmpState, JSON.stringify(exhausted));
  try {
    const result = checkProviderQuota({ statePath: tmpState });
    assert(result.ok === false, 'exhausted provider with active cooldown fails guard');
    assert(result.violations.some((v) => v.includes('exhausted')), 'violation mentions exhausted');
    assert(result.exhaustion.blocked === 1, 'result reports 1 blocked');
  } finally {
    fs.unlinkSync(tmpState);
  }
}
{
  const tmpState = path.join(__dirname, '.tmp-disabled-state.json');
  const disabled = validState();
  disabled.providers[0].status = 'disabled';
  fs.writeFileSync(tmpState, JSON.stringify(disabled));
  try {
    const result = checkProviderQuota({ statePath: tmpState });
    assert(result.ok === true, 'disabled provider with one available passes guard');
    assert(result.readiness.summary.disabled === 1, 'result reports 1 disabled');
  } finally {
    fs.unlinkSync(tmpState);
  }
}
{
  const result = checkProviderQuota();
  assert(Array.isArray(result.violations), 'violations is an array');
  assert(result.violations.every((v) => typeof v === 'string'), 'all violations are strings');
  assert(result.violations.every((v) => !v.includes('at ') || !v.match(/\.(js|ts):\d+/)), 'no stack traces in violations');
  assert(result.warnings.every((w) => typeof w === 'string'), 'all warnings are strings');
}
{
  const tmpState = path.join(__dirname, '.tmp-stalled-state.json');
  const stalled = validState();
  stalled.providers[0].status = 'exhausted';
  stalled.providers[0].cooldownExpiresAt = null;
  fs.writeFileSync(tmpState, JSON.stringify(stalled));
  try {
    const result = checkProviderQuota({ statePath: tmpState });
    assert(result.ok === false, 'exhausted with no cooldown fails guard');
    assert(result.violations.some((v) => v.includes('stalled')), 'violation mentions stalled');
    assert(result.exhaustion.stalled === 1, 'result reports 1 stalled');
  } finally {
    fs.unlinkSync(tmpState);
  }
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
{
  const tmpInvalid = path.join(__dirname, '.tmp-invalid.json');
  fs.writeFileSync(tmpInvalid, '{bad json');
  try {
    const result = loadJson(tmpInvalid);
    assert(result.ok === false, 'loadJson fails for invalid JSON');
    assert(result.error.includes('Invalid JSON'), 'error mentions invalid JSON');
  } finally {
    fs.unlinkSync(tmpInvalid);
  }
}

// --- CLI ---

console.log('\nCLI tests\n');

const script = path.resolve(__dirname, 'check-provider-quota.js');

{
  const out = execSync(`node "${script}" --json`, { encoding: 'utf-8' });
  const result = JSON.parse(out);
  assert(result.ok === true, 'CLI --json returns valid JSON with ok=true');
  assert(result.tool === 'check-provider-quota', 'CLI --json includes tool name');
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
  assert(out.includes('quota'), 'CLI --help mentions quota');
}
{
  try {
    execSync(`node "${script}" --unknown-flag`, { encoding: 'utf-8', stdio: 'pipe' });
    assert(false, 'CLI unknown flag should exit non-zero');
  } catch (err) {
    assert(err.status === 2, 'CLI unknown flag exits with code 2');
  }
}
{
  const out = execSync(`node "${script}" --json --warn-only`, { encoding: 'utf-8' });
  const result = JSON.parse(out);
  assert(typeof result.ok === 'boolean', 'CLI --json --warn-only returns valid JSON');
}
{
  const tmpCli = path.join(__dirname, '.tmp-cli-exhausted.json');
  const exhausted = validState();
  exhausted.providers[0].status = 'exhausted';
  exhausted.providers[0].cooldownExpiresAt = '2099-12-31T23:59:59Z';
  fs.writeFileSync(tmpCli, JSON.stringify(exhausted));
  try {
    try {
      execSync(`node "${script}" --json --state "${tmpCli}"`, { encoding: 'utf-8', stdio: 'pipe' });
      assert(false, 'CLI with exhausted state should exit non-zero');
    } catch (err) {
      const result = JSON.parse(err.stdout);
      assert(result.ok === false, 'CLI with exhausted state returns ok=false');
      assert(result.violations.length > 0, 'CLI with exhausted state has violations');
    }
  } finally {
    fs.unlinkSync(tmpCli);
  }
}
{
  const tmpCli = path.join(__dirname, '.tmp-cli-warn.json');
  const exhausted = validState();
  exhausted.providers[0].status = 'exhausted';
  exhausted.providers[0].cooldownExpiresAt = '2099-12-31T23:59:59Z';
  fs.writeFileSync(tmpCli, JSON.stringify(exhausted));
  try {
    execSync(`node "${script}" --json --warn-only --state "${tmpCli}"`, { encoding: 'utf-8', stdio: 'pipe' });
    assert(true, 'CLI --warn-only exits 0 even with violations');
  } catch {
    assert(false, 'CLI --warn-only exits 0 even with violations');
  } finally {
    fs.unlinkSync(tmpCli);
  }
}

// --- Summary ---

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
