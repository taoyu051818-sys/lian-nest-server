#!/usr/bin/env node

/**
 * emit-command-steward-autonomy-readiness.js
 *
 * Read-only autonomy readiness report combining Codex duty detection,
 * main health, task board, control skills, and open blockers.
 *
 * Usage:
 *   node scripts/ai/emit-command-steward-autonomy-readiness.js [--live] [--stdout] [--self-test] [--help]
 *
 * Exit codes: 0 — report produced, 2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./lib');

const STATE_DIR = process.env.COMMAND_STEWARD_STATE_DIR || path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'command-steward-autonomy-readiness.json');
const SCHEMA_VERSION = 1;

const INPUT_FILES = {
  health: 'main-health.json', activeWorkers: 'active-workers.json',
  metaSignals: 'meta-signals.json', providerPool: 'provider-pool.json',
  workerTrust: 'worker-trust.json', queue: 'queue-state.json',
  legacyRetirement: 'legacy-orchestration-retirement.json',
};

const SECRET_PATTERNS = [/token/i, /secret/i, /key/i, /password/i, /credential/i, /auth/i, /bearer/i];

const SKILL_CATALOGUE = [
  { skillId: 'merge-prs', category: 'merge', risk: 'high', humanRequired: true, dangerous: true },
  { skillId: 'launch-batch', category: 'launch', risk: 'high', humanRequired: true, dangerous: true },
  { skillId: 'issue-state', category: 'issue', risk: 'medium', humanRequired: false, dangerous: true },
  { skillId: 'health-state', category: 'health', risk: 'low', humanRequired: false, dangerous: true },
  { skillId: 'status-bundle', category: 'view', risk: 'low', humanRequired: false, dangerous: false },
  { skillId: 'self-cycle', category: 'view', risk: 'low', humanRequired: false, dangerous: false },
  { skillId: 'command-steward-brief', category: 'view', risk: 'low', humanRequired: false, dangerous: false },
  { skillId: 'compile-tasks', category: 'planning', risk: 'low', humanRequired: false, dangerous: false },
  { skillId: 'create-issues', category: 'issue', risk: 'high', humanRequired: true, dangerous: true },
  { skillId: 'plan-next-batch', category: 'planning', risk: 'low', humanRequired: false, dangerous: false },
  { skillId: 'provider-rotation', category: 'provider', risk: 'high', humanRequired: true, dangerous: true },
  { skillId: 'worker.control', category: 'worker', risk: 'high', humanRequired: false, dangerous: true },
];

const EXPECTED_SKILL_CATEGORIES = [
  { category: 'view', minCount: 1, description: 'Read-only state inspection' },
  { category: 'merge', minCount: 1, description: 'PR merge with guards' },
  { category: 'launch', minCount: 1, description: 'Worker batch dispatch' },
  { category: 'health', minCount: 1, description: 'Health state management' },
  { category: 'planning', minCount: 1, description: 'Task and batch planning' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(fp) {
  if (!fp || !fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function sanitizeObject(obj) {
  const r = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some(p => p.test(k))) continue;
    r[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  }
  return r;
}

function printHelp() {
  process.stdout.write(`
emit-command-steward-autonomy-readiness.js — Autonomy readiness report (v1)

USAGE
    node scripts/ai/emit-command-steward-autonomy-readiness.js [options]

OPTIONS
    --live          Write report to output file (default: dry-run).
    --out <path>    Output path (default: .github/ai-state/command-steward-autonomy-readiness.json).
    --stdout        Print JSON to stdout.
    --self-test     Run built-in assertions and exit.
    --help          Show this help.

EXIT CODES
    0   Report produced
    2   Invalid arguments
`.trimStart());
}

function parseArgs(argv) {
  const args = { live: false, out: DEFAULT_OUT, stdout: false, help: false, selfTest: false };
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--live') args.live = true;
    else if (a === '--out') { i++; if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); } args.out = argv[i]; }
    else if (a === '--stdout') args.stdout = true;
    else if (a === '--self-test') args.selfTest = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
    i++;
  }
  return args;
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildHealthSection(h) {
  if (!h) return { loaded: false, state: 'unknown', capturedAt: null, checks: [], failedChecks: [] };
  return { loaded: true, state: h.state || 'unknown', capturedAt: h.capturedAt || null,
    checks: Array.isArray(h.checks) ? h.checks : [], failedChecks: Array.isArray(h.failedChecks) ? h.failedChecks : [] };
}

function evaluateDuty7Status(retirement) {
  if (!retirement) return { status: 'blocked', evidence: 'legacy-orchestration-retirement.json missing' };
  const rs = retirement.status;
  if (rs === 'complete') return { status: 'met', evidence: 'retirement status is complete' };
  if (rs === 'rolled_back' || rs === 'pending') return { status: 'blocked', evidence: `retirement status is ${rs}` };
  if (rs === 'in_progress') {
    const d7 = retirement.duties && retirement.duties['duty-7'];
    if (!d7) return { status: 'blocked', evidence: 'duty-7 entry missing from retirement state' };
    const s = d7.status;
    if (s === 'met') return { status: 'met', evidence: 'duty-7 marked met in retirement state' };
    if (s === 'partial') return { status: 'partial', evidence: 'duty-7 marked partial in retirement state' };
    return { status: 'blocked', evidence: `duty-7 status is ${s}` };
  }
  return { status: 'blocked', evidence: `unknown retirement status: ${rs}` };
}

function evaluateCodexDuties(inputs) {
  const { health: h, activeWorkers: w, workerTrust: wt, metaSignals: m, legacyRetirement: lr } = inputs;
  const hOk = h !== null && h.state;
  const wOk = w !== null;
  const schedOk = wt && wt.scheduling && Array.isArray(wt.scheduling.rules) && wt.scheduling.rules.length > 0;
  const ffOk = !!(wt && wt.workerClasses && wt.workerClasses['foundation-fix']);
  const mOk = m !== null;
  const duty7 = evaluateDuty7Status(lr);

  return [
    { id: 'duty-1', name: 'Self-cycle runner launches workers autonomously', blocking: true,
      status: hOk && wOk ? 'met' : 'blocked', evidence: hOk && wOk ? 'active-workers and health state loadable' : 'missing state files' },
    { id: 'duty-2', name: 'Launch gate runs unattended', blocking: true,
      status: hOk && schedOk ? 'met' : 'blocked', evidence: hOk && schedOk ? 'health gate and scheduling rules available' : 'scheduling rules or health missing' },
    { id: 'duty-3', name: 'Post-merge health gate auto-triggers', blocking: false,
      status: h && h.capturedAt ? 'met' : 'partial', evidence: h && h.capturedAt ? 'health state has timestamp' : 'auto-trigger not confirmed' },
    { id: 'duty-4', name: 'Recovery workers auto-dispatch on red', blocking: false,
      status: ffOk ? 'met' : 'partial', evidence: ffOk ? 'foundation-fix worker class defined' : 'auto-dispatch not wired' },
    { id: 'duty-5', name: 'PR review gate operates without Codex triage', blocking: true,
      status: 'met', evidence: 'checklist-driven review by design' },
    { id: 'duty-6', name: 'Next-wave decisions are human-initiated', blocking: true,
      status: 'met', evidence: 'self-cycle runner pauses after wave; human decides next' },
    { id: 'duty-7', name: 'Legacy orchestration retired', blocking: true,
      status: duty7.status, evidence: duty7.evidence },
    { id: 'duty-8', name: 'Loop-model runner operational', blocking: true,
      status: wOk && mOk ? 'met' : 'blocked', evidence: wOk && mOk ? 'active-workers and meta-signals loadable' : 'state files missing' },
  ];
}

function buildTaskBoardSection(inputs) {
  const workers = inputs.activeWorkers && Array.isArray(inputs.activeWorkers.workers) ? inputs.activeWorkers.workers : [];
  const qEntries = inputs.queue && Array.isArray(inputs.queue.entries) ? inputs.queue.entries : [];
  return {
    loaded: inputs.activeWorkers !== null || inputs.queue !== null,
    activeWorkerCount: workers.length,
    workers: workers.map(w => ({ issue: w.issue || null, conflictGroup: w.conflictGroup || null, state: w.state || 'unknown' })),
    queueDepth: qEntries.length,
    queueSummary: inputs.queue && inputs.queue.summary ? sanitizeObject(inputs.queue.summary) : null,
  };
}

function buildControlSkillsSection() {
  const byCat = {};
  for (const s of SKILL_CATALOGUE) { (byCat[s.category] = byCat[s.category] || []).push(s.skillId); }
  const coverage = EXPECTED_SKILL_CATEGORIES.map(e => ({
    category: e.category, description: e.description, count: (byCat[e.category] || []).length,
    met: (byCat[e.category] || []).length >= e.minCount,
  }));
  return {
    totalSkills: SKILL_CATALOGUE.length,
    dangerousCount: SKILL_CATALOGUE.filter(s => s.dangerous).length,
    humanRequiredCount: SKILL_CATALOGUE.filter(s => s.humanRequired).length,
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.length])),
    coverage, coverageComplete: coverage.every(c => c.met),
  };
}

function collectBlockers(duties, health, taskBoard, skills) {
  const blockers = [];
  if (!health.loaded) blockers.push({ source: 'health', severity: 'warning', message: 'main-health.json missing — health state unknown' });
  else if (health.state === 'red' || health.state === 'black')
    blockers.push({ source: 'health', severity: health.state === 'black' ? 'critical' : 'high', message: `Main branch health is ${health.state}` });
  for (const d of duties) {
    if (d.blocking && d.status !== 'met')
      blockers.push({ source: 'codex-duty', severity: 'high', message: `[${d.id}] ${d.name}: ${d.evidence}` });
  }
  for (const c of skills.coverage) {
    if (!c.met) blockers.push({ source: 'control-skills', severity: 'medium', message: `Skill category '${c.category}' below minimum (${c.count}/${c.description})` });
  }
  if (!taskBoard.loaded) blockers.push({ source: 'task-board', severity: 'info', message: 'Task board state not available' });
  return blockers;
}

// ── Build report ─────────────────────────────────────────────────────────────

function buildReport(inputs) {
  const health = buildHealthSection(inputs.health);
  const codexDuties = evaluateCodexDuties(inputs);
  const taskBoard = buildTaskBoardSection(inputs);
  const controlSkills = buildControlSkillsSection();
  const blockers = collectBlockers(codexDuties, health, taskBoard, controlSkills);

  const blockingDuties = codexDuties.filter(d => d.blocking);
  const metBlocking = blockingDuties.filter(d => d.status === 'met').length;
  const highBlockers = blockers.filter(b => b.severity === 'critical' || b.severity === 'high').length;
  const verdict = metBlocking === blockingDuties.length && highBlockers === 0 ? 'ready'
    : metBlocking > 0 ? 'partial' : 'not_ready';

  const inputSources = {};
  for (const key of Object.keys(INPUT_FILES)) inputSources[`${key}Loaded`] = inputs[key] !== null;

  return { schemaVersion: SCHEMA_VERSION, capturedAt: new Date().toISOString(), verdict,
    codexDuties: { totalBlocking: blockingDuties.length, metBlocking, duties: codexDuties },
    health, taskBoard, controlSkills, blockers, inputSources };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0, failed = 0;
  function assert(cond, msg) { if (!cond) { failed++; console.error(`  FAIL: ${msg}`); } else passed++; }

  const emptyInputs = {};
  for (const k of Object.keys(INPUT_FILES)) emptyInputs[k] = null;
  const empty = buildReport(emptyInputs);
  assert(empty.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.verdict === 'partial', 'verdict partial with all null (duty-5, duty-6 structural)');
  assert(empty.health.loaded === false, 'health not loaded');
  assert(empty.taskBoard.loaded === false, 'task board not loaded');
  assert(empty.controlSkills.totalSkills > 0, 'control skills catalogue not empty');
  assert(empty.controlSkills.coverageComplete === true, 'all skill categories covered');
  assert(empty.blockers.length > 0, 'has blockers when all null');
  assert(empty.codexDuties.duties.length === 8, '8 codex duties');
  for (const d of empty.codexDuties.duties) {
    assert(typeof d.id === 'string' && typeof d.name === 'string', 'duty has id/name');
    assert(typeof d.blocking === 'boolean', 'duty.blocking is boolean');
    assert(['met', 'partial', 'blocked'].includes(d.status), 'duty.status is valid');
  }
  for (const k of Object.keys(INPUT_FILES)) assert(empty.inputSources[`${k}Loaded`] === false, `inputSources.${k}Loaded is false`);

  const fullInputs = {
    health: { state: 'green', capturedAt: '2026-01-01T00:00:00.000Z', checks: ['tsc'], failedChecks: [] },
    activeWorkers: { workers: [{ issue: 100, conflictGroup: 'runtime', state: 'active' }] },
    metaSignals: { signals: { failureScore: 0, frictionScore: 0, riskScore: 10, trust: 90 } },
    providerPool: { global: { availableProviders: 2 } },
    workerTrust: { workerClasses: { 'foundation-fix': { allowedHealthStates: ['green', 'yellow', 'red'] }, 'runtime-feature': { allowedHealthStates: ['green'] } },
      scheduling: { minTrustToLaunch: 0.3, rules: [{ condition: 'trustScore < 0.3', action: 'block' }] } },
    queue: { entries: [{ id: 'q1' }], summary: { queued: 1 } },
  };
  const full = buildReport(fullInputs);
  assert(full.health.loaded === true, 'health loaded');
  assert(full.health.state === 'green', 'health green');
  assert(full.taskBoard.activeWorkerCount === 1, 'active worker count 1');
  assert(full.inputSources.healthLoaded === true, 'healthLoaded true');
  assert(full.inputSources.workerTrustLoaded === true, 'workerTrustLoaded true');
  assert(full.codexDuties.duties.filter(d => d.blocking && d.status === 'met').length >= 5, 'at least 5 blocking duties met');
  assert(full.verdict === 'partial', 'verdict partial with full inputs (duty-7 blocked)');

  const redInputs = { ...emptyInputs, health: { state: 'red', capturedAt: '2026-01-01T00:00:00.000Z' } };
  const red = buildReport(redInputs);
  assert(red.blockers.some(b => b.source === 'health' && b.severity === 'high'), 'red health blocker');

  const expectedKeys = ['schemaVersion', 'capturedAt', 'verdict', 'codexDuties', 'health', 'taskBoard', 'controlSkills', 'blockers', 'inputSources'];
  for (const k of expectedKeys) assert(k in full, `key ${k} present`);

  console.log(`\n  emit-command-steward-autonomy-readiness self-test`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) { console.log(`\n  Some self-tests failed.\n`); process.exit(1); }
  else { console.log(`\n  All self-tests passed.\n`); process.exit(0); }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }
  if (args.selfTest) { runSelfTest(); return; }

  const inputs = {};
  for (const [k, f] of Object.entries(INPUT_FILES)) inputs[k] = readJsonFile(path.join(STATE_DIR, f));
  const report = buildReport(inputs);
  const json = JSON.stringify(report, null, 2) + '\n';

  if (args.stdout) { process.stdout.write(json); return; }
  if (!args.live) {
    const banner = '╔══════════════════════════════════════════════════════════════╗\n║                     DRY RUN                                ║\n╚══════════════════════════════════════════════════════════════╝';
    process.stdout.write(`${banner}\nTarget: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n\n${json}`);
    return;
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Command Steward autonomy readiness report written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
