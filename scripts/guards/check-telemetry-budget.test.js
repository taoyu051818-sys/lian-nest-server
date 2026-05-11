#!/usr/bin/env node

/**
 * check-telemetry-budget.test.js
 *
 * Self-contained tests for check-telemetry-budget.js guard.
 * No external test framework — uses assert + counters.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  validateRecord,
  resolveTaskType,
  checkWallClock,
  checkTokenBudget,
  checkCostOverrun,
  checkBudget,
  POLICY,
  TASK_TYPES,
  REQUIRED_FIELDS,
} = require('./check-telemetry-budget');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
  }
}

// --- Helpers ---

function makeRecord(overrides) {
  return {
    schemaVersion: 1,
    taskId: 'test-task-001',
    capturedAt: '2026-05-11T12:00:00Z',
    taskType: 'execution',
    timing: { elapsedMs: 1800000 }, // 30 min
    tokenUsage: {
      inputTokens: 100000,
      outputTokens: 50000,
      source: 'api_response',
      confidence: 'high',
    },
    estimatedCost: {
      amountCents: 80, // $0.80 — well under derived budget of $1.05
      currency: 'USD',
      model: 'claude-opus-4-7',
    },
    changedFiles: { count: 3, linesAdded: 100, linesRemoved: 20 },
    validationResults: [{ command: 'npm run check', exitCode: 0 }],
    gateOutcome: { passed: true },
    ...overrides,
  };
}

// --- Tests ---

console.log('\n-- parseArgs');
{
  const a = parseArgs(['node', 'script', '--file', 'telemetry.json', '--json']);
  assertEq(a.file, 'telemetry.json', '--file parsed');
  assertEq(a.json, true, '--json parsed');
  assertEq(a.help, false, 'help defaults false');
}
{
  const a = parseArgs(['node', 'script', '--task-type', 'docs', '--max-cost-usd', '5', '--warn-only', '--dry-run']);
  assertEq(a.taskType, 'docs', '--task-type parsed');
  assertEq(a.maxCostUsd, 5, '--max-cost-usd parsed');
  assertEq(a.warnOnly, true, '--warn-only parsed');
  assertEq(a.dryRun, true, '--dry-run parsed');
}
{
  const a = parseArgs(['node', 'script', '-h']);
  assertEq(a.help, true, '-h parsed as help');
}
{
  const a = parseArgs(['node', 'script', '--unknown-flag']);
  assertEq(a._unknown, '--unknown-flag', 'unknown arg captured');
}

console.log('\n-- validateRecord');
{
  const r = validateRecord(makeRecord());
  assertEq(r.valid, true, 'valid record passes');
  assertEq(r.violations, [], 'no violations for valid record');
}
{
  const r = validateRecord({});
  assertEq(r.valid, false, 'empty record fails');
  assert(r.violations.length > 0, 'empty record has violations');
}
{
  const r = validateRecord(makeRecord({ schemaVersion: 2 }));
  assertEq(r.valid, false, 'wrong schemaVersion fails');
  assert(r.violations.some((v) => v.includes('schemaVersion')), 'mentions schemaVersion');
}
{
  const r = validateRecord(null);
  assertEq(r.valid, false, 'null record fails');
}
{
  const rec = makeRecord();
  delete rec.taskId;
  const r = validateRecord(rec);
  assertEq(r.valid, false, 'missing taskId fails');
  assert(r.violations.some((v) => v.includes('taskId')), 'mentions taskId');
}

console.log('\n-- resolveTaskType');
{
  assertEq(resolveTaskType(makeRecord({ taskType: 'execution' }), null), 'execution', 'from record');
  assertEq(resolveTaskType(makeRecord({ taskType: 'review' }), 'docs'), 'docs', 'override wins');
  assertEq(resolveTaskType(makeRecord({ taskType: 'unknown' }), null), 'default', 'unknown falls back');
  assertEq(resolveTaskType(makeRecord({ taskType: undefined }), null), 'default', 'missing falls back');
}

console.log('\n-- checkWallClock');
{
  // Under soft limit
  const r = checkWallClock({ timing: { elapsedMs: 600000 } }, 'execution'); // 10 min
  assertEq(r.violations.length, 0, 'under soft: no violations');
  assertEq(r.warnings.length, 0, 'under soft: no warnings');
}
{
  // Over soft, under hard
  const r = checkWallClock({ timing: { elapsedMs: 3000000 } }, 'execution'); // 50 min (>45 soft, <90 hard)
  assertEq(r.violations.length, 0, 'over soft, under hard: no violations');
  assertEq(r.warnings.length, 1, 'over soft, under hard: 1 warning');
}
{
  // Over hard limit
  const r = checkWallClock({ timing: { elapsedMs: 6000000 } }, 'execution'); // 100 min
  assertEq(r.violations.length, 1, 'over hard: 1 violation');
  assert(r.violations[0].includes('hard limit'), 'mentions hard limit');
}
{
  // Missing timing
  const r = checkWallClock({}, 'execution');
  assertEq(r.violations.length, 0, 'missing timing: no violations');
  assertEq(r.warnings.length, 1, 'missing timing: 1 warning');
}
{
  // Default task type
  const r = checkWallClock({ timing: { elapsedMs: 3600000 } }, 'default'); // 60 min
  assertEq(r.violations.length, 0, 'default type at 60min: no violations (exactly at soft)');
  assertEq(r.warnings.length, 1, 'default type at 60min: 1 warning (at soft)');
}
{
  // Docs type
  const r = checkWallClock({ timing: { elapsedMs: 2100000 } }, 'docs'); // 35 min
  assertEq(r.violations.length, 1, 'docs at 35min: 1 violation (over hard 30min)');
}

console.log('\n-- checkTokenBudget');
{
  // Under budget
  const r = checkTokenBudget({ tokenUsage: { inputTokens: 100000, outputTokens: 50000 } }, 'execution');
  assertEq(r.violations.length, 0, 'under budget: no violations');
  assertEq(r.warnings.length, 0, 'under budget: no warnings');
}
{
  // Over input budget
  const r = checkTokenBudget({ tokenUsage: { inputTokens: 600000, outputTokens: 50000 } }, 'execution');
  assertEq(r.violations.length, 1, 'over input: 1 violation');
  assert(r.violations[0].includes('Input token'), 'mentions input tokens');
}
{
  // Over output budget
  const r = checkTokenBudget({ tokenUsage: { inputTokens: 100000, outputTokens: 200000 } }, 'execution');
  assertEq(r.violations.length, 1, 'over output: 1 violation');
  assert(r.violations[0].includes('Output token'), 'mentions output tokens');
}
{
  // At warning threshold (80%)
  const r = checkTokenBudget({ tokenUsage: { inputTokens: 400000, outputTokens: 50000 } }, 'execution');
  assertEq(r.violations.length, 0, 'at 80% input: no violations');
  assertEq(r.warnings.length, 1, 'at 80% input: 1 warning');
}
{
  // Missing tokenUsage
  const r = checkTokenBudget({}, 'execution');
  assertEq(r.violations.length, 0, 'missing tokenUsage: no violations');
  assertEq(r.warnings.length, 1, 'missing tokenUsage: 1 warning');
}
{
  // No budget for unknown task type
  const r = checkTokenBudget({ tokenUsage: { inputTokens: 999999, outputTokens: 999999 } }, 'unknown');
  assertEq(r.violations.length, 0, 'unknown task type: no violations (no budget)');
}

console.log('\n-- checkCostOverrun');
{
  // Normal cost
  const r = checkCostOverrun({ estimatedCost: { amountCents: 50 }, tokenUsage: { inputTokens: 100000, outputTokens: 50000 } }, null);
  assertEq(r.violations.length, 0, 'normal cost: no violations');
  assertEq(r.warnings.length, 0, 'normal cost: no warnings');
}
{
  // Warning threshold
  const r = checkCostOverrun({ estimatedCost: { amountCents: 100 }, tokenUsage: { inputTokens: 100000, outputTokens: 50000 } }, null);
  assertEq(r.violations.length, 0, 'warning cost: no violations');
  assertEq(r.warnings.length, 1, 'warning cost: 1 warning');
}
{
  // Critical threshold (between 100% and 150%)
  const r = checkCostOverrun({ estimatedCost: { amountCents: 130 }, tokenUsage: { inputTokens: 100000, outputTokens: 50000 } }, null);
  assertEq(r.violations.length, 1, 'critical cost: 1 violation');
  assert(r.violations[0].includes('critical'), 'mentions critical');
}
{
  // Hard-stop threshold
  const r = checkCostOverrun({ estimatedCost: { amountCents: 300 }, tokenUsage: { inputTokens: 100000, outputTokens: 50000 } }, null);
  assertEq(r.violations.length, 1, 'hard-stop cost: 1 violation');
  assert(r.violations[0].includes('hard-stop'), 'mentions hard-stop');
}
{
  // Explicit maxCostUsd override
  const r = checkCostOverrun({ estimatedCost: { amountCents: 90 } }, 1.0);
  assertEq(r.warnings.length, 1, 'explicit cap at 90%: 1 warning');
}
{
  // Missing estimatedCost
  const r = checkCostOverrun({}, null);
  assertEq(r.violations.length, 0, 'missing cost: no violations');
  assertEq(r.warnings.length, 1, 'missing cost: 1 warning');
}

console.log('\n-- checkBudget (integrated)');
{
  const r = checkBudget(makeRecord(), {});
  assertEq(r.status, 'pass', 'healthy record: pass');
  assertEq(r.violations.length, 0, 'healthy record: no violations');
  assertEq(r.summary.recordValid, true, 'summary recordValid true');
}
{
  const r = checkBudget(makeRecord({
    timing: { elapsedMs: 6000000 }, // 100 min, over hard for execution (90)
    tokenUsage: { inputTokens: 600000, outputTokens: 200000, source: 'api_response', confidence: 'high' },
    estimatedCost: { amountCents: 300, currency: 'USD', model: 'claude-opus-4-7' },
  }), {});
  assertEq(r.status, 'fail', 'overrun record: fail');
  assert(r.violations.length >= 2, 'overrun record: multiple violations');
}
{
  const r = checkBudget(makeRecord(), { dryRun: true });
  assertEq(r.status, 'pass', 'dry-run: pass');
  assert(r.warnings.some((w) => w.includes('Dry-run')), 'dry-run: warning mentions dry-run');
  assertEq(r.summary.dryRun, true, 'summary dryRun true');
}
{
  const r = checkBudget(makeRecord(), { taskType: 'docs' });
  assert(r.summary.taskType === 'docs', 'taskType override applied');
}
{
  const r = checkBudget({}, {});
  assertEq(r.status, 'fail', 'invalid record: fail');
  assert(r.violations.length > 0, 'invalid record: has violations');
}

console.log('\n-- CLI integration');
{
  const script = path.join(__dirname, 'check-telemetry-budget.js');

  // --help
  try {
    const out = execSync(`node "${script}" --help`, { encoding: 'utf-8' });
    assert(out.includes('Usage:'), '--help prints usage');
    assert(out.includes('--file'), '--help mentions --file');
  } catch (e) {
    assert(false, `--help should exit 0: ${e.message}`);
  }

  // --help exit code
  try {
    execSync(`node "${script}" --help`, { encoding: 'utf-8' });
    assert(true, '--help exits 0');
  } catch {
    assert(false, '--help should exit 0');
  }

  // unknown arg exits 2
  try {
    execSync(`node "${script}" --bogus`, { encoding: 'utf-8' });
    assert(false, 'unknown arg should exit non-zero');
  } catch (e) {
    assert(e.status === 2, `unknown arg exits 2 (got ${e.status})`);
  }

  // invalid --task-type exits 2
  try {
    execSync(`node "${script}" --task-type bogus`, { encoding: 'utf-8' });
    assert(false, 'invalid task-type should exit non-zero');
  } catch (e) {
    assert(e.status === 2, `invalid task-type exits 2 (got ${e.status})`);
  }

  // valid record via --file exits 0
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-guard-'));
  const tmpFile = path.join(tmpDir, 'telemetry.json');
  fs.writeFileSync(tmpFile, JSON.stringify(makeRecord()));
  try {
    execSync(`node "${script}" --file "${tmpFile}"`, { encoding: 'utf-8' });
    assert(true, 'valid record --file exits 0');
  } catch (e) {
    assert(false, `valid record should exit 0: ${e.message}`);
  }

  // --json output
  try {
    const out = execSync(`node "${script}" --file "${tmpFile}" --json`, { encoding: 'utf-8' });
    const parsed = JSON.parse(out);
    assertEq(parsed.status, 'pass', '--json status pass');
    assert(parsed.summary != null, '--json has summary');
  } catch (e) {
    assert(false, `--json should work: ${e.message}`);
  }

  // --dry-run
  try {
    const out = execSync(`node "${script}" --file "${tmpFile}" --dry-run --json`, { encoding: 'utf-8' });
    const parsed = JSON.parse(out);
    assertEq(parsed.status, 'pass', '--dry-run --json status pass');
    assert(parsed.summary.dryRun === true, '--dry-run summary.dryRun true');
  } catch (e) {
    assert(false, `--dry-run should work: ${e.message}`);
  }

  // invalid record exits 1
  const badFile = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(badFile, JSON.stringify({ schemaVersion: 1 }));
  try {
    execSync(`node "${script}" --file "${badFile}"`, { encoding: 'utf-8' });
    assert(false, 'invalid record should exit non-zero');
  } catch (e) {
    assert(e.status === 1, `invalid record exits 1 (got ${e.status})`);
  }

  // --warn-only downgrades to 0
  try {
    execSync(`node "${script}" --file "${badFile}" --warn-only`, { encoding: 'utf-8' });
    assert(true, '--warn-only exits 0 for invalid record');
  } catch (e) {
    assert(false, `--warn-only should downgrade: ${e.message}`);
  }

  // file not found exits 2
  try {
    execSync(`node "${script}" --file "nonexistent.json"`, { encoding: 'utf-8' });
    assert(false, 'missing file should exit non-zero');
  } catch (e) {
    assert(e.status === 2, `missing file exits 2 (got ${e.status})`);
  }

  // stdin input
  try {
    const out = execSync(`node "${script}" --json`, {
      encoding: 'utf-8',
      input: JSON.stringify(makeRecord()),
    });
    const parsed = JSON.parse(out);
    assertEq(parsed.status, 'pass', 'stdin input: pass');
  } catch (e) {
    assert(false, `stdin should work: ${e.message}`);
  }

  // Cleanup
  try { fs.unlinkSync(tmpFile); } catch {}
  try { fs.unlinkSync(badFile); } catch {}
  try { fs.rmdirSync(tmpDir); } catch {}
}

// --- Summary ---
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
