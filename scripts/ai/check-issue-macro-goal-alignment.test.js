#!/usr/bin/env node

/**
 * check-issue-macro-goal-alignment.test.js
 *
 * Self-tests for the macro-goal alignment gate logic.
 * Covers: lane alignment, evidence quality, advancement rationale,
 * decision aggregation, and gate result shape.
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pure-function pattern from
 * check-agent-idea-gate.test.js.
 *
 * Usage:
 *   node scripts/ai/check-issue-macro-goal-alignment.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

const crypto = require('crypto');

// ── Pure function mirrors (gate evaluation logic) ──────────────────────────

const REQUIRED_FIELDS = [
  'allowedFiles',
  'forbiddenFiles',
  'validationCommands',
  'conflictGroup',
  'risk',
];

const ADVANCEMENT_KEYWORDS = [
  'self-cycle',
  'codex exit',
  'codex-exit',
  'autonomous',
  'autonomy',
  'command steward',
  'command-steward',
  'health gate',
  'health-gate',
  'reconcil',
  'telemetry',
  'budget',
  'launch gate',
  'launch-gate',
  'merge gate',
  'merge-gate',
  'issue lifecycle',
  'issue-lifecycle',
  'state reconcil',
  'state-reconcil',
  'control-plane',
  'control plane',
  'priority lane',
  'priority-lane',
  'north star',
  'north-star',
  'lane alignment',
  'lane-alignment',
];

const SHALLOW_PATTERNS = [
  /^add comment/i,
  /^rename \w+$/i,
  /^update readme/i,
  /^fix typo/i,
  /^add logging$/i,
];

function markerId(title, conflictGroup) {
  const hash = crypto
    .createHash('sha256')
    .update(`${title}||${conflictGroup}`)
    .digest('hex')
    .slice(0, 12);
  return `macro-goal-${hash}-alignment`;
}

function evaluateLaneAlignment(candidate, macroGoalState) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  const priorityLanes = (macroGoalState && macroGoalState.priorityLanes) || [];
  factsRead.push({
    source: 'macro-goal.json',
    summary: `priorityLanes=[${priorityLanes.join(', ')}]`,
  });

  if (!candidate.macroGoal || typeof candidate.macroGoal !== 'string' || candidate.macroGoal.trim() === '') {
    blockers.push({
      code: 'NO_MACRO_GOAL',
      message: 'Candidate has no macroGoal field. Every issue must declare which macro goal it serves.',
    });
    return { blockers, warnings, factsRead };
  }

  factsRead.push({
    source: 'candidate.macroGoal',
    summary: `macroGoal=${candidate.macroGoal}`,
  });

  if (candidate.priorityLane) {
    if (!priorityLanes.includes(candidate.priorityLane)) {
      blockers.push({
        code: 'UNKNOWN_PRIORITY_LANE',
        message: `priorityLane "${candidate.priorityLane}" is not in macro-goal.json priorityLanes: [${priorityLanes.join(', ')}].`,
      });
    } else {
      factsRead.push({
        source: 'candidate.priorityLane',
        summary: `priorityLane=${candidate.priorityLane} (matched)`,
      });
    }
    return { blockers, warnings, factsRead };
  }

  const goalLower = candidate.macroGoal.toLowerCase();
  const matchedLane = priorityLanes.find(lane => {
    const laneLower = lane.toLowerCase();
    return goalLower.includes(laneLower) || laneLower.includes(goalLower);
  });

  if (!matchedLane) {
    warnings.push({
      code: 'UNMATCHED_MACRO_GOAL',
      message: `macroGoal "${candidate.macroGoal}" does not match any priority lane: [${priorityLanes.join(', ')}]. Consider setting priorityLane explicitly or aligning to a recognized lane.`,
    });
  } else {
    factsRead.push({
      source: 'candidate.macroGoal (fuzzy)',
      summary: `matched lane: ${matchedLane}`,
    });
  }

  return { blockers, warnings, factsRead };
}

function evaluateEvidenceQuality(candidate) {
  const blockers = [];
  const warnings = [];

  for (const field of REQUIRED_FIELDS) {
    const value = candidate[field];
    if (value === undefined || value === null) {
      blockers.push({
        code: 'MISSING_REQUIRED_FIELD',
        message: `Required field "${field}" is missing from candidate.`,
      });
    } else if (Array.isArray(value) && value.length === 0) {
      blockers.push({
        code: 'EMPTY_REQUIRED_FIELD',
        message: `Required field "${field}" is an empty array. At least one entry is required.`,
      });
    } else if (typeof value === 'string' && value.trim() === '') {
      blockers.push({
        code: 'EMPTY_REQUIRED_FIELD',
        message: `Required field "${field}" is an empty string.`,
      });
    }
  }

  const allowedFiles = candidate.allowedFiles || [];
  const broadPatterns = ['src/**', '**/*', '**', 'src/**/**'];
  for (const pattern of allowedFiles) {
    if (broadPatterns.includes(pattern)) {
      blockers.push({
        code: 'SCOPE_TOO_BROAD',
        message: `allowedFiles contains overly broad pattern "${pattern}". Use module-level patterns.`,
      });
    }
  }

  const evidence = candidate.evidence || [];
  if (evidence.length === 0) {
    warnings.push({
      code: 'NO_EVIDENCE',
      message: 'No evidence provided. Include at least one evidence item justifying this issue.',
    });
  }

  if (!candidate.rollbackPlan || (typeof candidate.rollbackPlan === 'string' && candidate.rollbackPlan.trim() === '')) {
    warnings.push({
      code: 'NO_ROLLBACK_PLAN',
      message: 'No rollbackPlan provided. Include a plan for reverting if this change fails.',
    });
  }

  if (!candidate.followUp || (typeof candidate.followUp === 'string' && candidate.followUp.trim() === '')) {
    warnings.push({
      code: 'NO_FOLLOW_UP',
      message: 'No followUp provided. Describe what should happen after this issue is closed.',
    });
  }

  return { blockers, warnings };
}

function evaluateAdvancementRationale(candidate) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  const rationale = candidate.rationale || '';
  const title = candidate.title || '';

  if (!rationale || rationale.trim() === '') {
    blockers.push({
      code: 'NO_RATIONALE',
      message: 'Candidate has no rationale. Every issue must explain how it advances the macro goal.',
    });
    return { blockers, warnings, factsRead };
  }

  factsRead.push({
    source: 'candidate.rationale',
    summary: `rationale length=${rationale.length}`,
  });

  const combinedText = `${title} ${rationale}`.toLowerCase();
  const hasAdvancementSignal = ADVANCEMENT_KEYWORDS.some(kw => combinedText.includes(kw));

  if (!hasAdvancementSignal) {
    warnings.push({
      code: 'WEAK_ADVANCEMENT_SIGNAL',
      message: 'Rationale does not mention self-cycle, Codex exit, or control-plane concepts. Consider connecting this work to macro goals.',
    });
  }

  const isShallow = SHALLOW_PATTERNS.some(re => re.test(title));
  if (isShallow && !hasAdvancementSignal) {
    blockers.push({
      code: 'SHALLOW_WORK',
      message: `Title "${title}" matches a shallow-work pattern and rationale lacks advancement signals. Issues must create structural value, not cosmetic changes.`,
    });
  }

  if (rationale.length < 20) {
    blockers.push({
      code: 'RATIONALE_TOO_SHORT',
      message: 'Rationale is too short (< 20 chars). Provide a substantive explanation of how this issue advances the macro goal.',
    });
  }

  return { blockers, warnings, factsRead };
}

function aggregateDecision(criteriaResults) {
  const allBlockers = [];
  const allWarnings = [];

  for (const result of criteriaResults) {
    allBlockers.push(...result.blockers);
    allWarnings.push(...result.warnings);
  }

  let decision;
  let severity;

  if (allBlockers.length > 0) {
    decision = 'block';
    severity = 'error';
  } else if (allWarnings.length > 0) {
    decision = 'warn';
    severity = 'warning';
  } else {
    decision = 'pass';
    severity = 'info';
  }

  return { decision, severity, blockers: allBlockers, warnings: allWarnings };
}

function evaluateCandidate(candidate, macroGoalState) {
  const factsRead = [];

  const laneResult = evaluateLaneAlignment(candidate, macroGoalState);
  factsRead.push(...laneResult.factsRead);

  const evidenceResult = evaluateEvidenceQuality(candidate);

  const rationaleResult = evaluateAdvancementRationale(candidate);
  factsRead.push(...rationaleResult.factsRead);

  const allResults = [laneResult, evidenceResult, rationaleResult];
  const { decision, severity, blockers, warnings } = aggregateDecision(allResults);

  const hashInput = (candidate.title || '') + (candidate.conflictGroup || '');
  const id = markerId(candidate.title || '', candidate.conflictGroup || '');

  const producedFacts = [];
  if (candidate.macroGoal) producedFacts.push({ key: 'macro-goal', value: candidate.macroGoal });
  if (candidate.priorityLane) producedFacts.push({ key: 'priority-lane', value: candidate.priorityLane });
  if (candidate.conflictGroup) producedFacts.push({ key: 'conflict-group', value: candidate.conflictGroup });
  if (candidate.risk) producedFacts.push({ key: 'risk', value: candidate.risk });

  return {
    schemaVersion: 1,
    gateType: 'macro-goal-alignment',
    decision,
    severity,
    markerId: id,
    capturedAt: new Date().toISOString(),
    targetIssue: null,
    targetPR: null,
    factsRead,
    blockers,
    warnings,
    producedFacts,
  };
}

// ── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`    ✓ ${label}`);
  } else {
    failed++;
    console.error(`    ✗ ${label}`);
  }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`    ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  assert(ok, label);
}

// ── Shared macro-goal state fixture ─────────────────────────────────────────

const MACRO_GOAL_STATE = {
  schemaVersion: 1,
  goalId: 'command-steward-self-cycle-autonomy',
  priorityLanes: [
    'self-cycle-runner',
    'command-steward',
    'webui-control-plane',
    'telemetry-budget',
    'issue-lifecycle',
    'state-reconcile',
  ],
  northStar: 'Two consecutive full cycles complete without Codex intervention except human-owned decisions.',
};

// ── Shared candidate fixtures ───────────────────────────────────────────────

function validCandidate(overrides) {
  return {
    title: 'Add self-cycle health gate enforcement',
    macroGoal: 'self-cycle-runner',
    taskType: 'execution',
    risk: 'low',
    conflictGroup: 'self-cycle-health-gate',
    allowedFiles: ['scripts/ai/check-self-cycle-safety-gate.js'],
    forbiddenFiles: ['src/**', 'prisma/**'],
    validationCommands: ['npm run check'],
    rationale: 'This issue advances self-cycle autonomy by enforcing health gates before launch. Without this, the self-cycle could launch workers against a red main branch.',
    evidence: ['Health gate is currently advisory-only, not enforced.'],
    rollbackPlan: 'Revert the gate enforcement change and restore advisory mode.',
    followUp: 'Monitor self-cycle runs for blocked launches and adjust thresholds.',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('check-issue-macro-goal-alignment.test.js');
console.log('='.repeat(50));

// ── Suite 1: Lane alignment — valid candidate with matching lane ────────────

suite('lane alignment: valid candidate with matching macroGoal');

{
  const candidate = validCandidate();
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.severity, 'info', 'severity is info');
  assertEq(result.gateType, 'macro-goal-alignment', 'gateType is macro-goal-alignment');
  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
  assertEq(result.blockers.length, 0, 'no blockers');
  assertEq(result.warnings.length, 0, 'no warnings');
  assert(result.producedFacts.some(f => f.key === 'macro-goal'), 'produced facts include macro-goal');
  assertEq(result.producedFacts.find(f => f.key === 'macro-goal').value, 'self-cycle-runner', 'macro-goal value correct');
}

// ── Suite 2: Lane alignment — missing macroGoal ─────────────────────────────

suite('lane alignment: missing macroGoal');

{
  const candidate = validCandidate({ macroGoal: null });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assertEq(result.severity, 'error', 'severity is error');
  assert(result.blockers.some(b => b.code === 'NO_MACRO_GOAL'), 'has NO_MACRO_GOAL blocker');
}

// ── Suite 3: Lane alignment — empty macroGoal ───────────────────────────────

suite('lane alignment: empty macroGoal string');

{
  const candidate = validCandidate({ macroGoal: '  ' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_MACRO_GOAL'), 'has NO_MACRO_GOAL blocker');
}

// ── Suite 4: Lane alignment — explicit priorityLane match ───────────────────

suite('lane alignment: explicit priorityLane matches');

{
  const candidate = validCandidate({ priorityLane: 'issue-lifecycle' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.blockers.length, 0, 'no blockers for matched lane');
  assert(result.producedFacts.some(f => f.key === 'priority-lane'), 'produced facts include priority-lane');
  assertEq(result.producedFacts.find(f => f.key === 'priority-lane').value, 'issue-lifecycle', 'priority-lane value correct');
}

// ── Suite 5: Lane alignment — explicit priorityLane mismatch ────────────────

suite('lane alignment: explicit priorityLane unknown');

{
  const candidate = validCandidate({ priorityLane: 'nonexistent-lane' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'UNKNOWN_PRIORITY_LANE'), 'has UNKNOWN_PRIORITY_LANE blocker');
}

// ── Suite 6: Lane alignment — unmatched macroGoal (warn) ────────────────────

suite('lane alignment: unmatched macroGoal produces warning');

{
  const candidate = validCandidate({ macroGoal: 'cosmetic-cleanup' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'warn', 'decision is warn');
  assert(result.warnings.some(w => w.code === 'UNMATCHED_MACRO_GOAL'), 'has UNMATCHED_MACRO_GOAL warning');
}

// ── Suite 7: Lane alignment — fuzzy match via macroGoal ─────────────────────

suite('lane alignment: fuzzy match via macroGoal containing lane name');

{
  const candidate = validCandidate({ macroGoal: 'improve-telemetry-budget-tracking' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.blockers.length, 0, 'no blockers for fuzzy matched lane');
  assert(result.factsRead.some(f => f.summary.includes('matched lane')), 'factsRead shows matched lane');
}

// ── Suite 8: Evidence quality — all required fields present ─────────────────

suite('evidence quality: all required fields present');

{
  const candidate = validCandidate();
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.blockers.length, 0, 'no blockers');
}

// ── Suite 9: Evidence quality — missing allowedFiles ────────────────────────

suite('evidence quality: missing allowedFiles');

{
  const candidate = validCandidate({ allowedFiles: undefined });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'MISSING_REQUIRED_FIELD' && b.message.includes('allowedFiles')), 'has MISSING_REQUIRED_FIELD for allowedFiles');
}

// ── Suite 10: Evidence quality — empty validationCommands ───────────────────

suite('evidence quality: empty validationCommands array');

{
  const candidate = validCandidate({ validationCommands: [] });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'EMPTY_REQUIRED_FIELD' && b.message.includes('validationCommands')), 'has EMPTY_REQUIRED_FIELD for validationCommands');
}

// ── Suite 11: Evidence quality — empty risk string ──────────────────────────

suite('evidence quality: empty risk string');

{
  const candidate = validCandidate({ risk: '  ' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'EMPTY_REQUIRED_FIELD' && b.message.includes('risk')), 'has EMPTY_REQUIRED_FIELD for risk');
}

// ── Suite 12: Evidence quality — overly broad allowedFiles ──────────────────

suite('evidence quality: overly broad allowedFiles pattern');

{
  const candidate = validCandidate({ allowedFiles: ['src/**'] });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'SCOPE_TOO_BROAD'), 'has SCOPE_TOO_BROAD blocker');
}

// ── Suite 13: Evidence quality — no evidence (warn) ─────────────────────────

suite('evidence quality: no evidence produces warning');

{
  const candidate = validCandidate({ evidence: [] });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assert(result.warnings.some(w => w.code === 'NO_EVIDENCE'), 'has NO_EVIDENCE warning');
}

// ── Suite 14: Evidence quality — no rollbackPlan (warn) ─────────────────────

suite('evidence quality: no rollbackPlan produces warning');

{
  const candidate = validCandidate({ rollbackPlan: undefined });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assert(result.warnings.some(w => w.code === 'NO_ROLLBACK_PLAN'), 'has NO_ROLLBACK_PLAN warning');
}

// ── Suite 15: Evidence quality — no followUp (warn) ─────────────────────────

suite('evidence quality: no followUp produces warning');

{
  const candidate = validCandidate({ followUp: null });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assert(result.warnings.some(w => w.code === 'NO_FOLLOW_UP'), 'has NO_FOLLOW_UP warning');
}

// ── Suite 16: Advancement rationale — valid rationale ───────────────────────

suite('advancement rationale: valid rationale with advancement keywords');

{
  const candidate = validCandidate();
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.blockers.length, 0, 'no blockers');
  assert(!result.warnings.some(w => w.code === 'WEAK_ADVANCEMENT_SIGNAL'), 'no weak advancement signal warning');
}

// ── Suite 17: Advancement rationale — missing rationale ─────────────────────

suite('advancement rationale: missing rationale');

{
  const candidate = validCandidate({ rationale: '' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'NO_RATIONALE'), 'has NO_RATIONALE blocker');
}

// ── Suite 18: Advancement rationale — rationale too short ───────────────────

suite('advancement rationale: rationale too short');

{
  const candidate = validCandidate({ rationale: 'short' });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'RATIONALE_TOO_SHORT'), 'has RATIONALE_TOO_SHORT blocker');
}

// ── Suite 19: Advancement rationale — shallow work without advancement ──────

suite('advancement rationale: shallow work title without advancement signal');

{
  const candidate = validCandidate({
    title: 'Fix typo',
    macroGoal: 'cosmetic-cleanup',
    rationale: 'There is a typo in the README that should be corrected for readability purposes.',
  });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'block', 'decision is block');
  assert(result.blockers.some(b => b.code === 'SHALLOW_WORK'), 'has SHALLOW_WORK blocker');
}

// ── Suite 20: Advancement rationale — shallow title but with advancement ────

suite('advancement rationale: shallow title but rationale has advancement signal');

{
  const candidate = validCandidate({
    title: 'Fix typo',
    rationale: 'Fix typo in self-cycle health gate documentation that caused incorrect launch decisions.',
  });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  // Shallow title + advancement signal in rationale = warn (not block)
  assert(!result.blockers.some(b => b.code === 'SHALLOW_WORK'), 'no SHALLOW_WORK blocker when rationale has advancement signal');
}

// ── Suite 21: Advancement rationale — weak signal (warn) ────────────────────

suite('advancement rationale: weak signal');

{
  const candidate = validCandidate({
    title: 'Improve general code style',
    macroGoal: 'cosmetic-cleanup',
    rationale: 'This is a general code quality improvement that makes the codebase cleaner and more maintainable for the team.',
  });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assert(result.warnings.some(w => w.code === 'WEAK_ADVANCEMENT_SIGNAL'), 'has WEAK_ADVANCEMENT_SIGNAL warning');
}

// ── Suite 22: Multiple blockers accumulated ─────────────────────────────────

suite('multiple blockers accumulated');

{
  const candidate = {
    title: 'Fix typo',
    macroGoal: null,
    risk: '',
    rationale: '',
  };
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assert(result.blockers.length >= 3, `has at least 3 blockers, got ${result.blockers.length}`);
  assertEq(result.severity, 'error', 'severity is error');
}

// ── Suite 23: Marker ID determinism ─────────────────────────────────────────

suite('markerId determinism');

{
  const id1 = markerId('Fix auth', 'auth-fix');
  const id2 = markerId('Fix auth', 'auth-fix');
  const id3 = markerId('Fix auth', 'other-group');
  const id4 = markerId('Fix payments', 'auth-fix');

  assertEq(id1, id2, 'same inputs produce same markerId');
  assert(id1 !== id3, 'different conflictGroup produces different markerId');
  assert(id1 !== id4, 'different title produces different markerId');
  assert(id1.startsWith('macro-goal-'), 'markerId starts with macro-goal-');
  assert(id1.endsWith('-alignment'), 'markerId ends with -alignment');
}

// ── Suite 24: Gate result shape completeness ────────────────────────────────

suite('gate result shape completeness');

{
  const candidate = validCandidate();
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(typeof result.schemaVersion, 'number', 'schemaVersion is number');
  assertEq(typeof result.gateType, 'string', 'gateType is string');
  assertEq(typeof result.decision, 'string', 'decision is string');
  assertEq(typeof result.severity, 'string', 'severity is string');
  assertEq(typeof result.markerId, 'string', 'markerId is string');
  assertEq(typeof result.capturedAt, 'string', 'capturedAt is string');
  assertEq(result.targetIssue, null, 'targetIssue is null');
  assertEq(result.targetPR, null, 'targetPR is null');
  assert(Array.isArray(result.factsRead), 'factsRead is array');
  assert(Array.isArray(result.blockers), 'blockers is array');
  assert(Array.isArray(result.warnings), 'warnings is array');
  assert(Array.isArray(result.producedFacts), 'producedFacts is array');
}

// ── Suite 25: factsRead includes lane alignment source ──────────────────────

suite('factsRead includes lane alignment sources');

{
  const candidate = validCandidate();
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assert(result.factsRead.some(f => f.source === 'macro-goal.json'), 'factsRead includes macro-goal.json source');
  assert(result.factsRead.some(f => f.source === 'candidate.macroGoal'), 'factsRead includes candidate.macroGoal source');
  assert(result.factsRead.some(f => f.source === 'candidate.rationale'), 'factsRead includes candidate.rationale source');
}

// ── Suite 26: No macroGoalState — lenient mode ──────────────────────────────

suite('no macroGoalState: lenient mode (no lane blockers)');

{
  const candidate = validCandidate({ macroGoal: 'some-unknown-goal' });
  const result = evaluateCandidate(candidate, null);

  // Without macroGoalState, no lanes to match against, so only warn
  assertEq(result.blockers.length, 0, 'no blockers when state is null');
  assert(result.warnings.some(w => w.code === 'UNMATCHED_MACRO_GOAL'), 'has UNMATCHED_MACRO_GOAL warning');
}

// ── Suite 27: Full pass with all optional fields ────────────────────────────

suite('full pass with all optional fields');

{
  const candidate = validCandidate({
    priorityLane: 'self-cycle-runner',
    evidence: ['Health gate currently advisory-only.', 'Main branch went red twice last week.'],
    rollbackPlan: 'Revert gate enforcement and restore advisory mode.',
    followUp: 'Monitor self-cycle runs for 2 weeks, then adjust thresholds.',
  });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  assertEq(result.decision, 'pass', 'decision is pass');
  assertEq(result.blockers.length, 0, 'no blockers');
  assertEq(result.warnings.length, 0, 'no warnings');
  assert(result.producedFacts.length >= 3, 'produced facts include macro-goal, priority-lane, conflict-group, risk');
}

// ── Suite 28: Multiple missing required fields ──────────────────────────────

suite('multiple missing required fields');

{
  const candidate = validCandidate({
    allowedFiles: undefined,
    forbiddenFiles: undefined,
    validationCommands: undefined,
    conflictGroup: undefined,
    risk: undefined,
  });
  const result = evaluateCandidate(candidate, MACRO_GOAL_STATE);

  const missingBlockers = result.blockers.filter(b => b.code === 'MISSING_REQUIRED_FIELD');
  assertEq(missingBlockers.length, 5, '5 MISSING_REQUIRED_FIELD blockers for 5 missing fields');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
