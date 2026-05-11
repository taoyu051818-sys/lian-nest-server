#!/usr/bin/env node

/**
 * check-local-resource.test.js
 *
 * Self-contained tests for the local resource guard. No external test framework.
 * Run: node scripts/guards/check-local-resource.test.js
 */

const path = require('path');
const { execSync } = require('child_process');
const {
  checkLocalResource,
  loadJson,
  validatePolicyStructure,
  validateStateStructure,
  crossValidate,
  checkThresholds,
  computeLaunchReadiness,
  VALID_RESOURCE_TYPES,
  VALID_SEVERITIES,
} = require('./check-local-resource');

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
    resources: [
      { id: 'disk-root', type: 'disk', threshold: 1024, severity: 'critical', unit: 'MB' },
      { id: 'memory', type: 'memory', threshold: 512, severity: 'warning', unit: 'MB' },
      { id: 'port-3000', type: 'port', threshold: 1, severity: 'critical', unit: 'count' },
    ],
    launchGateIntegration: {
      blockOnCritical: true,
      blockOnMissingState: true,
      preLaunchCheck: true,
    },
  };
}

function validState() {
  return {
    stateVersion: 1,
    resources: [
      { id: 'disk-root', type: 'disk', available: 2048, unit: 'MB', status: 'ok', capturedAt: '2026-05-11T00:00:00Z' },
      { id: 'memory', type: 'memory', available: 1024, unit: 'MB', status: 'ok', capturedAt: '2026-05-11T00:00:00Z' },
      { id: 'port-3000', type: 'port', available: 1, unit: 'count', status: 'ok', capturedAt: '2026-05-11T00:00:00Z' },
    ],
    global: {
      ready: true,
      lastUpdatedBy: 'test',
      capturedAt: '2026-05-11T00:00:00Z',
    },
  };
}

// --- Tests ---

console.log('\ncheck-local-resource tests\n');

// --- VALID_RESOURCE_TYPES / VALID_SEVERITIES ---

{
  assert(Array.isArray(VALID_RESOURCE_TYPES), 'VALID_RESOURCE_TYPES is an array');
  assert(VALID_RESOURCE_TYPES.includes('disk'), 'VALID_RESOURCE_TYPES includes disk');
  assert(VALID_RESOURCE_TYPES.includes('memory'), 'VALID_RESOURCE_TYPES includes memory');
  assert(VALID_RESOURCE_TYPES.includes('cpu'), 'VALID_RESOURCE_TYPES includes cpu');
  assert(VALID_RESOURCE_TYPES.includes('port'), 'VALID_RESOURCE_TYPES includes port');
  assert(VALID_RESOURCE_TYPES.includes('service'), 'VALID_RESOURCE_TYPES includes service');
  assert(Array.isArray(VALID_SEVERITIES), 'VALID_SEVERITIES is an array');
  assert(VALID_SEVERITIES.includes('critical'), 'VALID_SEVERITIES includes critical');
  assert(VALID_SEVERITIES.includes('warning'), 'VALID_SEVERITIES includes warning');
  assert(VALID_SEVERITIES.includes('info'), 'VALID_SEVERITIES includes info');
}

// --- validatePolicyStructure ---

{
  const violations = validatePolicyStructure(validPolicy());
  assert(violations.length === 0, 'valid policy passes structure check');
}
{
  const policy = validPolicy();
  delete policy.resources;
  const violations = validatePolicyStructure(policy);
  assert(violations.length > 0, 'policy without resources array fails');
}
{
  const policy = validPolicy();
  policy.resources[0].id = '';
  const violations = validatePolicyStructure(policy);
  assert(violations.some((v) => v.includes('missing id')), 'policy resource with empty id fails');
}
{
  const policy = validPolicy();
  policy.resources[0].type = 'bogus';
  const violations = validatePolicyStructure(policy);
  assert(violations.some((v) => v.includes('invalid type')), 'policy resource with invalid type fails');
}
{
  const policy = validPolicy();
  policy.resources[0].threshold = 'many';
  const violations = validatePolicyStructure(policy);
  assert(violations.some((v) => v.includes('non-numeric threshold')), 'policy resource with non-numeric threshold fails');
}
{
  const policy = validPolicy();
  policy.resources[0].severity = 'extreme';
  const violations = validatePolicyStructure(policy);
  assert(violations.some((v) => v.includes('invalid severity')), 'policy resource with invalid severity fails');
}
{
  const policy = validPolicy();
  policy.resources[0].threshold = undefined;
  policy.resources[0].severity = undefined;
  const violations = validatePolicyStructure(policy);
  assert(violations.length === 0, 'policy resource with optional fields omitted passes');
}

// --- validateStateStructure ---

{
  const violations = validateStateStructure(validState());
  assert(violations.length === 0, 'valid state passes structure check');
}
{
  const state = validState();
  state.resources = 'not-array';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('not an array')), 'state with non-array resources fails');
}
{
  const state = validState();
  state.resources[0].id = '';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('missing id')), 'state resource with empty id fails');
}
{
  const state = validState();
  state.resources[0].type = 'bogus';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('invalid type')), 'state resource with invalid type fails');
}
{
  const state = validState();
  state.resources[0].available = 'plenty';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('numeric available')), 'state resource with non-numeric available fails');
}
{
  const state = validState();
  state.resources[0].unit = 42;
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('non-string unit')), 'state resource with non-string unit fails');
}
{
  const state = validState();
  state.resources[0].status = 'broken';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('invalid status')), 'state resource with invalid status fails');
}
{
  const state = validState();
  state.global.ready = 'yes';
  const violations = validateStateStructure(state);
  assert(violations.some((v) => v.includes('not a boolean')), 'state.global.ready non-boolean fails');
}
{
  const state = validState();
  state.resources[0].status = 'low';
  const violations = validateStateStructure(state);
  assert(violations.length === 0, 'state with valid status "low" passes');
}

// --- crossValidate ---

{
  const violations = crossValidate(validPolicy(), validState());
  assert(violations.length === 0, 'matching policy/state passes cross-validation');
}
{
  const state = validState();
  state.resources.push({ id: 'ghost', type: 'disk', available: 100, status: 'ok' });
  const violations = crossValidate(validPolicy(), state);
  assert(violations.some((v) => v.includes('ghost') && v.includes('not found in policy')), 'state resource not in policy fails');
}
{
  const policy = validPolicy();
  policy.resources.push({ id: 'extra', type: 'cpu', threshold: 50, severity: 'info' });
  const violations = crossValidate(policy, validState());
  assert(violations.some((v) => v.includes('extra') && v.includes('missing from state')), 'policy resource missing from state fails');
}
{
  const state = validState();
  state.resources[0].type = 'memory';
  const violations = crossValidate(validPolicy(), state);
  assert(violations.some((v) => v.includes('type mismatch')), 'type mismatch between policy and state fails');
}

// --- checkThresholds ---

{
  const result = checkThresholds(validPolicy(), validState());
  assert(result.violations.length === 0, 'no violations when all resources above threshold');
  assert(result.warnings.length === 0, 'no warnings when all resources above threshold');
}
{
  const state = validState();
  state.resources[0].available = 512;
  const result = checkThresholds(validPolicy(), state);
  assert(result.violations.length === 1, 'critical resource below threshold produces violation');
  assert(result.violations[0].includes('disk-root'), 'violation mentions resource id');
}
{
  const state = validState();
  state.resources[1].available = 256;
  const result = checkThresholds(validPolicy(), state);
  assert(result.warnings.length === 1, 'warning resource below threshold produces warning');
  assert(result.warnings[0].includes('memory'), 'warning mentions resource id');
}

// --- computeLaunchReadiness ---

{
  const readiness = computeLaunchReadiness(validPolicy(), validState());
  assert(readiness.ready === true, 'all resources ok → ready');
  assert(readiness.summary.totalResources === 3, 'reports correct total resources');
  assert(readiness.summary.ok === 3, 'reports correct ok count');
}
{
  const state = validState();
  state.resources[0].available = 100;
  const readiness = computeLaunchReadiness(validPolicy(), state);
  assert(readiness.ready === false, 'critical resource below threshold → not ready');
  assert(readiness.reasons.some((r) => r.includes('below threshold')), 'reason mentions below threshold');
}
{
  const policy = validPolicy();
  const state = validState();
  state.resources = state.resources.filter((r) => r.id !== 'port-3000');
  const readiness = computeLaunchReadiness(policy, state);
  assert(readiness.ready === false, 'missing critical resource → not ready');
  assert(readiness.reasons.some((r) => r.includes('missing from state')), 'reason mentions missing');
}
{
  const state = validState();
  state.global.ready = false;
  const readiness = computeLaunchReadiness(validPolicy(), state);
  assert(readiness.ready === false, 'global.ready false → not ready');
  assert(readiness.reasons.some((r) => r.includes('global.ready')), 'reason mentions global.ready');
}
{
  const policy = validPolicy();
  policy.launchGateIntegration = {};
  const state = validState();
  state.resources[0].available = 100;
  const readiness = computeLaunchReadiness(policy, state);
  assert(readiness.ready === false, 'blockOnCritical defaults to true → still blocks');
}
{
  const policy = validPolicy();
  policy.launchGateIntegration = { blockOnCritical: false };
  const state = validState();
  state.resources[0].available = 100;
  const readiness = computeLaunchReadiness(policy, state);
  assert(readiness.ready === true, 'blockOnCritical false → does not block on threshold');
}

// --- checkLocalResource (integration) ---

{
  const result = checkLocalResource();
  assert(result.ok === false, 'guard fails when policy/state files are missing');
  assert(result.tool === 'check-local-resource', 'result has tool name');
  assert(result.readiness === null, 'result has null readiness when files missing');
}
{
  const result = checkLocalResource({ dryRun: true });
  assert(result.dryRun === true, 'dryRun flag is reflected in result');
}

// --- loadJson ---

{
  const result = loadJson('/nonexistent/path.json');
  assert(result.ok === false, 'loadJson fails for missing file');
  assert(result.error.includes('not found'), 'error mentions not found');
}
{
  const tmpFile = path.join(__dirname, '__tmp_test_invalid.json');
  require('fs').writeFileSync(tmpFile, '{bad json', 'utf-8');
  const result = loadJson(tmpFile);
  assert(result.ok === false, 'loadJson fails for invalid JSON');
  assert(result.error.includes('Invalid JSON'), 'error mentions invalid JSON');
  require('fs').unlinkSync(tmpFile);
}
{
  const tmpFile = path.join(__dirname, '__tmp_test_valid.json');
  require('fs').writeFileSync(tmpFile, '{"ok":true}', 'utf-8');
  const result = loadJson(tmpFile);
  assert(result.ok === true, 'loadJson reads valid JSON file');
  assert(result.data.ok === true, 'loadJson returns parsed data');
  require('fs').unlinkSync(tmpFile);
}

// --- CLI ---

console.log('\nCLI tests\n');

const script = path.resolve(__dirname, 'check-local-resource.js');

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
  assert(out.includes('--warn-only'), 'CLI --help mentions --warn-only');
  assert(out.includes('--policy'), 'CLI --help mentions --policy');
  assert(out.includes('--state'), 'CLI --help mentions --state');
}
{
  const out = execSync(`node "${script}" --json --warn-only`, { encoding: 'utf-8' });
  const result = JSON.parse(out);
  assert(typeof result.ok === 'boolean', 'CLI --json returns valid JSON with ok field');
  assert(result.tool === 'check-local-resource', 'CLI --json includes tool name');
  assert(Array.isArray(result.violations), 'CLI --json includes violations array');
}
{
  const out = execSync(`node "${script}" --json --dry-run --warn-only`, { encoding: 'utf-8' });
  const result = JSON.parse(out);
  assert(result.dryRun === true, 'CLI --json --dry-run reflects dryRun flag');
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
