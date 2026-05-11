#!/usr/bin/env node

/**
 * calculate-worker-telemetry.test.js
 *
 * Focused self-tests for calculate-worker-telemetry.js covering:
 *   1. Missing manifests — produces zeroed-out default record
 *   2. Estimated token source — defaults to estimate/low when no source
 *   3. Sanitized output — no secrets, raw logs, or llm_io_logs content
 *
 * No external test framework — uses assert + counters.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CALC_SCRIPT = path.resolve(__dirname, 'calculate-worker-telemetry.js');

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

function runCalc(args) {
  const cmd = `node "${CALC_SCRIPT}" ${args}`;
  const stdout = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
  // Strip the dry-run trailer if present
  const lines = stdout.split('\n');
  const jsonLines = [];
  for (const line of lines) {
    if (line.startsWith('[dry-run]')) continue;
    jsonLines.push(line);
  }
  return JSON.parse(jsonLines.join('\n'));
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'calc-telemetry-test-'));
}

function cleanupTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Missing manifests — zeroed-out default record
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n-- Missing manifests (no inputs)');

{
  const rec = runCalc('--dry-run');
  assertEq(rec.schemaVersion, 1, 'schemaVersion is 1 with no inputs');
  assert(rec.taskId.startsWith('unknown-'), 'taskId falls back to unknown- prefix');
  assertEq(rec.taskType, null, 'taskType is null with no task contract');
  assertEq(rec.actorRole, null, 'actorRole is null with no task contract');
  assertEq(rec.pmPhase, null, 'pmPhase is null with no task contract');
  assertEq(rec.issueNumber, null, 'issueNumber is null with no task contract');
  assertEq(rec.prNumber, null, 'prNumber is null with no task contract');
}

{
  const rec = runCalc('--dry-run');
  assertEq(rec.timing.elapsedMs, 0, 'elapsedMs is 0 with no heartbeat');
  assertEq(rec.timing.softTimeMinutes, null, 'softTimeMinutes null without budget');
  assertEq(rec.timing.hardTimeMinutes, null, 'hardTimeMinutes null without budget');
  assert(Array.isArray(rec.timing.progressMilestones), 'progressMilestones is an array');
  assertEq(rec.timing.progressMilestones.length, 0, 'progressMilestones is empty');
}

{
  const rec = runCalc('--dry-run');
  assertEq(rec.changedFiles.count, 0, 'changedFiles.count is 0 with no result');
  assertEq(rec.changedFiles.linesAdded, 0, 'changedFiles.linesAdded is 0');
  assertEq(rec.changedFiles.linesRemoved, 0, 'changedFiles.linesRemoved is 0');
  assertEq(rec.changedFiles.maxBudget, null, 'maxBudget null without task');
  assertEq(rec.changedFiles.maxLinesBudget, null, 'maxLinesBudget null without task');
}

{
  const rec = runCalc('--dry-run');
  assertEq(rec.validationResults, [], 'validationResults is empty array');
  assertEq(rec.qualitySignals, null, 'qualitySignals is null');
  assertEq(rec.gateOutcome.passed, false, 'gateOutcome.passed defaults false');
  assertEq(rec.gateOutcome.reason, null, 'gateOutcome.reason defaults null');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Estimated token source — estimate/low default
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n-- Estimated token source');

{
  const rec = runCalc('--dry-run');
  assertEq(rec.tokenUsage.source, 'estimate', 'source defaults to estimate');
  assertEq(rec.tokenUsage.confidence, 'low', 'confidence defaults to low');
  assertEq(rec.tokenUsage.inputTokens, 0, 'inputTokens defaults to 0');
  assertEq(rec.tokenUsage.outputTokens, 0, 'outputTokens defaults to 0');
  assertEq(rec.tokenUsage.cachedInputTokens, null, 'cachedInputTokens defaults null');
  assertEq(rec.tokenUsage.apiCalls, null, 'apiCalls defaults null');
}

{
  const rec = runCalc('--dry-run');
  assertEq(rec.estimatedCost.pricingBasis, 'unknown', 'pricingBasis unknown when estimate');
  assertEq(rec.estimatedCost.amountCents, 0, 'cost is 0 cents with zero tokens');
  assertEq(rec.estimatedCost.currency, 'USD', 'currency is USD');
  assertEq(rec.estimatedCost.model, 'claude-opus-4-7', 'model is claude-opus-4-7');
}

// Test with a result file that has token usage — log_parse source
{
  const tmpDir = makeTmpDir();
  try {
    const resultPath = path.join(tmpDir, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify({
      tokenUsage: {
        inputTokens: 50000,
        outputTokens: 10000,
        source: 'log_parse',
        confidence: 'medium',
      },
    }));
    const rec = runCalc(`--result "${resultPath}" --dry-run`);
    assertEq(rec.tokenUsage.source, 'log_parse', 'source from result file');
    assertEq(rec.tokenUsage.confidence, 'medium', 'confidence from result file');
    assertEq(rec.tokenUsage.inputTokens, 50000, 'inputTokens from result file');
    assertEq(rec.tokenUsage.outputTokens, 10000, 'outputTokens from result file');
    assertEq(rec.estimatedCost.pricingBasis, 'estimated', 'pricingBasis estimated for log_parse');
    assert(rec.estimatedCost.amountCents > 0, 'cost > 0 when tokens present');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// Test with a result file that has api_response source
{
  const tmpDir = makeTmpDir();
  try {
    const resultPath = path.join(tmpDir, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify({
      tokenUsage: {
        inputTokens: 100000,
        outputTokens: 20000,
        source: 'api_response',
        confidence: 'high',
        cachedInputTokens: 40000,
        apiCalls: 3,
      },
    }));
    const rec = runCalc(`--result "${resultPath}" --dry-run`);
    assertEq(rec.tokenUsage.source, 'api_response', 'api_response source preserved');
    assertEq(rec.tokenUsage.confidence, 'high', 'high confidence preserved');
    assertEq(rec.tokenUsage.cachedInputTokens, 40000, 'cachedInputTokens preserved');
    assertEq(rec.tokenUsage.apiCalls, 3, 'apiCalls preserved');
    assertEq(rec.estimatedCost.pricingBasis, 'api_list', 'pricingBasis api_list for api_response');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Sanitized output — no secrets or raw logs leaked
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n-- Sanitized output');

{
  const rec = runCalc('--dry-run');
  const json = JSON.stringify(rec);
  assert(!json.includes('GITHUB_TOKEN'), 'no GITHUB_TOKEN in output');
  assert(!json.includes('OPENAI_API_KEY'), 'no OPENAI_API_KEY in output');
  assert(!json.includes('ANTHROPIC_API_KEY'), 'no ANTHROPIC_API_KEY in output');
  assert(!json.includes('sk-ant-'), 'no Anthropic key prefix in output');
  assert(!json.includes('ghp_'), 'no GitHub token prefix in output');
  assert(!json.includes('llm_io_logs'), 'no llm_io_logs reference in output');
}

// Test that a task contract with sensitive fields is NOT leaked into output
{
  const tmpDir = makeTmpDir();
  try {
    const taskPath = path.join(tmpDir, 'task.json');
    fs.writeFileSync(taskPath, JSON.stringify({
      taskId: 'test-sanitize-001',
      taskType: 'execution',
      actorRole: 'test-worker',
      targetIssue: 447,
      secret: 'should-not-appear',
      apiKey: 'sk-ant-fake-key-12345',
      budget: { maxFiles: 4, maxLinesChanged: 500 },
    }));
    const rec = runCalc(`--task "${taskPath}" --dry-run`);
    const json = JSON.stringify(rec);
    assertEq(rec.taskId, 'test-sanitize-001', 'taskId from contract');
    assert(!json.includes('should-not-appear'), 'arbitrary secret field not in output');
    assert(!json.includes('sk-ant-fake'), 'apiKey value not in output');
    assert(!json.includes('"secret"'), 'secret key not in output');
    assert(!json.includes('"apiKey"'), 'apiKey key not in output');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// Test that heartbeat with arbitrary fields does not leak
{
  const tmpDir = makeTmpDir();
  try {
    const hbPath = path.join(tmpDir, 'heartbeat.ndjson');
    fs.writeFileSync(hbPath, [
      JSON.stringify({ elapsedMs: 10000, token: 'secret-hb-token' }),
      JSON.stringify({ elapsedMs: 20000 }),
    ].join('\n'));
    const rec = runCalc(`--heartbeat "${hbPath}" --dry-run`);
    const json = JSON.stringify(rec);
    assertEq(rec.timing.elapsedMs, 20000, 'latest heartbeat elapsedMs used');
    assert(!json.includes('secret-hb-token'), 'heartbeat token field not leaked');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Task contract with budget fields
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n-- Task contract budget and identity');

{
  const tmpDir = makeTmpDir();
  try {
    const taskPath = path.join(tmpDir, 'task.json');
    fs.writeFileSync(taskPath, JSON.stringify({
      taskId: 'test-budget-001',
      taskType: 'execution',
      actorRole: 'ai-native-tooling-worker',
      rolePacket: { actorRole: 'ai-native-tooling-worker' },
      pmPhase: 'self-cycle-wave13-40-worker-pressure',
      targetIssue: 447,
      targetPR: 450,
      budgets: { maxFiles: 4, maxLinesChanged: 500, softTimeMinutes: 45, hardTimeMinutes: 90 },
    }));
    const rec = runCalc(`--task "${taskPath}" --dry-run`);
    assertEq(rec.taskId, 'test-budget-001', 'taskId from contract');
    assertEq(rec.taskType, 'execution', 'taskType from contract');
    assertEq(rec.actorRole, 'ai-native-tooling-worker', 'actorRole from contract');
    assertEq(rec.pmPhase, 'self-cycle-wave13-40-worker-pressure', 'pmPhase from contract');
    assertEq(rec.issueNumber, 447, 'issueNumber from contract');
    assertEq(rec.prNumber, 450, 'prNumber from contract');
    assertEq(rec.timing.softTimeMinutes, 45, 'softTimeMinutes from budget');
    assertEq(rec.timing.hardTimeMinutes, 90, 'hardTimeMinutes from budget');
    assertEq(rec.changedFiles.maxBudget, 4, 'maxBudget from budgets.maxFiles');
    assertEq(rec.changedFiles.maxLinesBudget, 500, 'maxLinesBudget from budgets.maxLinesChanged');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// Test budget field alias (budget vs budgets)
{
  const tmpDir = makeTmpDir();
  try {
    const taskPath = path.join(tmpDir, 'task.json');
    fs.writeFileSync(taskPath, JSON.stringify({
      taskId: 'test-budget-alias',
      budget: { maxFiles: 6, maxLinesChanged: 300, softTimeMinutes: 30, hardTimeMinutes: 60 },
    }));
    const rec = runCalc(`--task "${taskPath}" --dry-run`);
    assertEq(rec.timing.softTimeMinutes, 30, 'softTimeMinutes from budget (singular)');
    assertEq(rec.changedFiles.maxBudget, 6, 'maxBudget from budget.maxFiles (singular)');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Full integration — task + heartbeat + result
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n-- Full integration (task + heartbeat + result)');

{
  const tmpDir = makeTmpDir();
  try {
    const taskPath = path.join(tmpDir, 'task.json');
    const hbPath = path.join(tmpDir, 'heartbeat.ndjson');
    const resultPath = path.join(tmpDir, 'result.json');

    fs.writeFileSync(taskPath, JSON.stringify({
      taskId: 'integration-001',
      taskType: 'execution',
      actorRole: 'test-worker',
      pmPhase: 'test-wave',
      targetIssue: 100,
      targetPR: 101,
      budgets: { maxFiles: 5, maxLinesChanged: 400, softTimeMinutes: 45, hardTimeMinutes: 90 },
      mainHealthPolicy: 'gate-all',
      generatedCodePolicy: 'allow-with-regenerate-note',
    }));

    fs.writeFileSync(hbPath, [
      JSON.stringify({ elapsedMs: 5000 }),
      JSON.stringify({ elapsedMs: 15000 }),
      JSON.stringify({ elapsedMs: 30000 }),
    ].join('\n'));

    fs.writeFileSync(resultPath, JSON.stringify({
      tokenUsage: {
        inputTokens: 80000,
        outputTokens: 15000,
        source: 'api_response',
        confidence: 'high',
        cachedInputTokens: 30000,
        apiCalls: 4,
      },
      changedFiles: {
        count: 3,
        linesAdded: 150,
        linesRemoved: 20,
      },
      validationResults: [
        { command: 'npm run check', exitCode: 0, durationMs: 8000 },
        { command: 'npm run build', exitCode: 0, durationMs: 30000 },
      ],
      qualitySignals: [
        { category: 'docs_guard', severity: 'yellow', confidence: 'medium', message: 'Missing doc update' },
      ],
      gateOutcome: {
        passed: true,
        reason: null,
        mainHealthPolicy: 'gate-all',
        generatedCodePolicy: 'allow-with-regenerate-note',
      },
    }));

    const rec = runCalc(`--task "${taskPath}" --heartbeat "${hbPath}" --result "${resultPath}" --dry-run`);

    assertEq(rec.taskId, 'integration-001', 'taskId from task contract');
    assertEq(rec.issueNumber, 100, 'issueNumber from task');
    assertEq(rec.prNumber, 101, 'prNumber from task');
    assertEq(rec.timing.elapsedMs, 30000, 'latest heartbeat elapsedMs');
    assertEq(rec.timing.softTimeMinutes, 45, 'softTimeMinutes from budget');
    assertEq(rec.tokenUsage.inputTokens, 80000, 'inputTokens from result');
    assertEq(rec.tokenUsage.source, 'api_response', 'source from result');
    assertEq(rec.estimatedCost.pricingBasis, 'api_list', 'pricingBasis api_list');
    assert(rec.estimatedCost.amountCents > 0, 'cost > 0 with tokens');
    assertEq(rec.changedFiles.count, 3, 'changedFiles count from result');
    assertEq(rec.changedFiles.maxBudget, 5, 'maxBudget from task');
    assertEq(rec.validationResults.length, 2, '2 validation results');
    assertEq(rec.validationResults[0].command, 'npm run check', 'first validation command');
    assert(rec.qualitySignals !== null, 'qualitySignals present');
    assertEq(rec.qualitySignals.length, 1, '1 quality signal');
    assertEq(rec.gateOutcome.passed, true, 'gate passed');
    assertEq(rec.gateOutcome.mainHealthPolicy, 'gate-all', 'mainHealthPolicy from gate');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. File output mode (not dry-run)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n-- File output (--out)');

{
  const tmpDir = makeTmpDir();
  try {
    const outPath = path.join(tmpDir, 'telemetry.json');
    execSync(`node "${CALC_SCRIPT}" --out "${outPath}"`, { encoding: 'utf8', timeout: 10000 });
    assert(fs.existsSync(outPath), 'output file written');
    const rec = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assertEq(rec.schemaVersion, 1, 'written file has schemaVersion 1');
    assert(rec.taskId.startsWith('unknown-'), 'written file has taskId');
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
