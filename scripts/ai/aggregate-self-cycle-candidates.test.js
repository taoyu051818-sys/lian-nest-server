#!/usr/bin/env node

/**
 * aggregate-self-cycle-candidates.test.js
 *
 * Fixture-driven tests for aggregate-self-cycle-candidates.js.
 * Exercises all aggregation paths, blocking logic, and output shape
 * without any network access.
 */

'use strict';

const {
  extractStatusSummary,
  extractTaskBoardSummary,
  extractEntropySuggestions,
  extractLaunchCandidates,
  extractMergeCandidates,
  extractCloseCandidates,
  buildBlockers,
  generateActions,
  aggregate,
  SCHEMA_VERSION,
} = require('./aggregate-self-cycle-candidates');

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (!condition) {
    failed++;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_FULL = {
  statusBundle: {
    health: { state: 'green' },
    blockers: [
      { source: 'health', severity: 'info', message: 'No active workers' },
    ],
  },
  taskBoard: {
    tasks: [
      { issue: 200, state: 'open', conflictGroup: 'general' },
      { issue: 258, state: 'running', conflictGroup: 'ai-native-docs' },
      { issue: 275, state: 'blocked', conflictGroup: 'auth' },
      { issue: 300, state: 'done', conflictGroup: 'docs' },
      { issue: 310, state: 'ready', conflictGroup: 'test' },
    ],
  },
  entropyReductionTasks: {
    suggestions: [
      { id: 'health-gate-stabilize', title: 'Stabilize main branch health gate', priority: 'high', risk: 'low', category: 'mainRed', actionHint: 'Run health gate.' },
      { id: 'entropy-low-no-action', title: 'Entropy is low', priority: 'info', risk: 'none', category: 'health', actionHint: 'No action needed.' },
    ],
  },
  launchCandidates: {
    candidates: [
      { number: 1246, title: 'Add self-cycle candidate aggregator', workerClass: 'runtime-feature', risk: 'low' },
      { number: 1247, title: 'Update auth module', workerClass: 'runtime-feature', risk: 'high' },
      { number: 1248, title: 'Fix critical security flaw', workerClass: 'bugfix', risk: 'critical' },
    ],
  },
  mergeCandidates: {
    mergeable: [
      { number: 100, title: 'feat: add feature' },
    ],
    blocked: [
      { number: 101, title: 'fix: conflict' },
    ],
    humanRequired: [
      { number: 102, title: 'fix: auth middleware' },
    ],
  },
  closeCandidates: {
    candidates: [
      { issueNumber: 200, title: 'Add feature X', mergedPR: { number: 50, title: 'feat: X' } },
      { issueNumber: 201, title: 'Discussion: roadmap', mergedPR: null },
    ],
  },
};

const FIXTURE_EMPTY = {};

const FIXTURE_PARTIAL = {
  launchCandidates: {
    candidates: [
      { number: 500, title: 'Low risk task', workerClass: 'docs', risk: 'low' },
    ],
  },
};

// ── Tests: extractStatusSummary ──────────────────────────────────────────────

function testExtractStatusSummary() {
  // Null input
  const nullResult = extractStatusSummary(null);
  assert(nullResult.loaded === false, 'null statusBundle → loaded false');
  assert(nullResult.healthState === 'unknown', 'null → healthState unknown');
  assert(nullResult.blockerCount === 0, 'null → 0 blockers');

  // Full input
  const fullResult = extractStatusSummary(FIXTURE_FULL.statusBundle);
  assert(fullResult.loaded === true, 'full statusBundle → loaded true');
  assert(fullResult.healthState === 'green', 'health state green');
  assert(fullResult.blockerCount === 1, 'one blocker');
  assert(fullResult.blockers[0].source === 'health', 'blocker source health');

  // Missing health
  const noHealth = extractStatusSummary({ blockers: [] });
  assert(noHealth.healthState === 'unknown', 'missing health → unknown');
}

// ── Tests: extractTaskBoardSummary ───────────────────────────────────────────

function testExtractTaskBoardSummary() {
  const nullResult = extractTaskBoardSummary(null);
  assert(nullResult.loaded === false, 'null taskBoard → loaded false');

  const fullResult = extractTaskBoardSummary(FIXTURE_FULL.taskBoard);
  assert(fullResult.loaded === true, 'taskBoard loaded');
  assert(fullResult.totalCount === 5, 'total 5 tasks');
  assert(fullResult.open === 1, '1 open');
  assert(fullResult.running === 1, '1 running');
  assert(fullResult.blocked === 1, '1 blocked');
  assert(fullResult.done === 1, '1 done');
  assert(fullResult.ready === 1, '1 ready');

  // Empty tasks array
  const emptyResult = extractTaskBoardSummary({ tasks: [] });
  assert(emptyResult.loaded === true, 'empty tasks → loaded true');
  assert(emptyResult.totalCount === 0, 'empty → 0');
}

// ── Tests: extractEntropySuggestions ─────────────────────────────────────────

function testExtractEntropySuggestions() {
  const nullResult = extractEntropySuggestions(null);
  assert(nullResult.loaded === false, 'null entropy → loaded false');

  const fullResult = extractEntropySuggestions(FIXTURE_FULL.entropyReductionTasks);
  assert(fullResult.loaded === true, 'entropy loaded');
  assert(fullResult.count === 2, '2 suggestions');
  assert(fullResult.suggestions[0].id === 'health-gate-stabilize', 'first suggestion id');
  assert(fullResult.suggestions[1].priority === 'info', 'second suggestion is info');
}

// ── Tests: extractLaunchCandidates ───────────────────────────────────────────

function testExtractLaunchCandidates() {
  const nullResult = extractLaunchCandidates(null);
  assert(nullResult.loaded === false, 'null launch → loaded false');

  const fullResult = extractLaunchCandidates(FIXTURE_FULL.launchCandidates);
  assert(fullResult.loaded === true, 'launch loaded');
  assert(fullResult.count === 3, '3 candidates');
  assert(fullResult.candidates[0].number === 1246, 'first candidate number');
  assert(fullResult.candidates[1].risk === 'high', 'second candidate high-risk');
  assert(fullResult.candidates[2].risk === 'critical', 'third candidate critical-risk');
}

// ── Tests: extractMergeCandidates ────────────────────────────────────────────

function testExtractMergeCandidates() {
  const nullResult = extractMergeCandidates(null);
  assert(nullResult.loaded === false, 'null merge → loaded false');

  const fullResult = extractMergeCandidates(FIXTURE_FULL.mergeCandidates);
  assert(fullResult.loaded === true, 'merge loaded');
  assert(fullResult.mergeable === 1, '1 mergeable');
  assert(fullResult.blocked === 1, '1 blocked');
  assert(fullResult.humanRequired === 1, '1 humanRequired');
  assert(fullResult.items.length === 3, '3 items total');

  const mergeableItem = fullResult.items.find(i => i.classification === 'mergeable');
  assert(mergeableItem.number === 100, 'mergeable item is PR 100');

  const blockedItem = fullResult.items.find(i => i.classification === 'blocked');
  assert(blockedItem.number === 101, 'blocked item is PR 101');
}

// ── Tests: extractCloseCandidates ────────────────────────────────────────────

function testExtractCloseCandidates() {
  const nullResult = extractCloseCandidates(null);
  assert(nullResult.loaded === false, 'null close → loaded false');

  const fullResult = extractCloseCandidates(FIXTURE_FULL.closeCandidates);
  assert(fullResult.loaded === true, 'close loaded');
  assert(fullResult.count === 2, '2 close candidates');
  assert(fullResult.candidates[0].issueNumber === 200, 'first close candidate');
  assert(fullResult.candidates[1].title === 'Discussion: roadmap', 'discussion candidate preserved');
}

// ── Tests: buildBlockers ─────────────────────────────────────────────────────

function testBuildBlockers() {
  const statusSummary = extractStatusSummary(FIXTURE_FULL.statusBundle);
  const mergeSummary = extractMergeCandidates(FIXTURE_FULL.mergeCandidates);
  const launchSummary = extractLaunchCandidates(FIXTURE_FULL.launchCandidates);
  const closeSummary = extractCloseCandidates(FIXTURE_FULL.closeCandidates);

  const blockers = buildBlockers(statusSummary, mergeSummary, launchSummary, closeSummary);

  // Should have: 1 status + 2 high/critical launch + 1 blocked merge + 1 humanRequired merge + 1 discussion close = 6
  assert(blockers.length === 6, `6 blockers, got ${blockers.length}`);

  // Status blocker
  assert(blockers.some(b => b.source === 'statusBundle'), 'has statusBundle blocker');

  // High-risk launch blocker
  assert(blockers.some(b => b.source === 'launchCandidates' && b.candidate === 1247), 'high-risk launch #1247 blocked');

  // Critical-risk launch blocker
  assert(blockers.some(b => b.source === 'launchCandidates' && b.candidate === 1248), 'critical launch #1248 blocked');

  // Blocked merge PR
  assert(blockers.some(b => b.source === 'mergeCandidates' && b.pr === 101), 'blocked PR 101');

  // HumanRequired merge PR
  assert(blockers.some(b => b.source === 'mergeCandidates' && b.pr === 102), 'humanRequired PR 102');

  // Discussion close candidate
  assert(blockers.some(b => b.source === 'closeCandidates' && b.issue === 201), 'discussion issue 201 blocked');

  // Empty inputs
  const emptyBlockers = buildBlockers(
    extractStatusSummary(null),
    extractMergeCandidates(null),
    extractLaunchCandidates(null),
    extractCloseCandidates(null),
  );
  assert(emptyBlockers.length === 0, 'empty inputs → 0 blockers');
}

// ── Tests: generateActions ───────────────────────────────────────────────────

function testGenerateActions() {
  const actions = generateActions(FIXTURE_FULL);

  // Should have: 1 low-risk launch + 1 mergeable PR + 1 close (skip discussion) + 1 entropy (skip info) = 4
  assert(actions.length === 4, `4 actions, got ${actions.length}`);

  // Launch actions (low/medium only, not high/critical)
  const launchActions = actions.filter(a => a.type === 'launch');
  assert(launchActions.length === 1, '1 launch action (low-risk only)');
  assert(launchActions[0].issue === 1246, 'launch #1246');

  // Merge actions
  const mergeActions = actions.filter(a => a.type === 'merge');
  assert(mergeActions.length === 1, '1 merge action');
  assert(mergeActions[0].pr === 100, 'merge PR 100');

  // Close actions (discussion skipped)
  const closeActions = actions.filter(a => a.type === 'close');
  assert(closeActions.length === 1, '1 close action (discussion skipped)');
  assert(closeActions[0].issue === 200, 'close #200');

  // Entropy actions (info skipped)
  const entropyActions = actions.filter(a => a.type === 'entropyReduction');
  assert(entropyActions.length === 1, '1 entropy action');
  assert(entropyActions[0].id === 'health-gate-stabilize', 'entropy health-gate-stabilize');

  // Actions sorted by priority (high > medium > low)
  assert(actions[0].priority === 'high', 'first action is high priority');

  // Empty input
  const emptyActions = generateActions({});
  assert(emptyActions.length === 0, 'empty input → 0 actions');
}

// ── Tests: aggregate ─────────────────────────────────────────────────────────

function testAggregateFull() {
  const result = aggregate(FIXTURE_FULL);

  assert(result.schemaVersion === SCHEMA_VERSION, 'schemaVersion matches');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(result.mode === 'dry-run', 'mode is dry-run');

  // Summary
  assert(result.summary.statusBundle.loaded === true, 'summary status loaded');
  assert(result.summary.taskBoard.loaded === true, 'summary taskboard loaded');
  assert(result.summary.entropyReduction.loaded === true, 'summary entropy loaded');
  assert(result.summary.launchCandidates.loaded === true, 'summary launch loaded');
  assert(result.summary.mergeCandidates.loaded === true, 'summary merge loaded');
  assert(result.summary.closeCandidates.loaded === true, 'summary close loaded');
  assert(typeof result.summary.actionCount === 'number', 'actionCount is number');
  assert(typeof result.summary.blockerCount === 'number', 'blockerCount is number');

  // Blockers and actions
  assert(Array.isArray(result.blockers), 'blockers is array');
  assert(Array.isArray(result.actions), 'actions is array');
  assert(result.blockers.length > 0, 'has blockers');
  assert(result.actions.length > 0, 'has actions');

  // Details
  assert(Array.isArray(result.details.entropySuggestions), 'details entropySuggestions');
  assert(Array.isArray(result.details.launchCandidates), 'details launchCandidates');
  assert(Array.isArray(result.details.mergeItems), 'details mergeItems');
  assert(Array.isArray(result.details.closeCandidates), 'details closeCandidates');
}

function testAggregateEmpty() {
  const result = aggregate(FIXTURE_EMPTY);

  assert(result.schemaVersion === SCHEMA_VERSION, 'empty schemaVersion');
  assert(typeof result.capturedAt === 'string', 'empty capturedAt');
  assert(result.mode === 'dry-run', 'empty mode dry-run');

  assert(result.summary.statusBundle.loaded === false, 'empty status not loaded');
  assert(result.summary.taskBoard.loaded === false, 'empty taskboard not loaded');
  assert(result.summary.entropyReduction.loaded === false, 'empty entropy not loaded');
  assert(result.summary.launchCandidates.loaded === false, 'empty launch not loaded');
  assert(result.summary.mergeCandidates.loaded === false, 'empty merge not loaded');
  assert(result.summary.closeCandidates.loaded === false, 'empty close not loaded');
  assert(result.summary.actionCount === 0, 'empty 0 actions');
  assert(result.summary.blockerCount === 0, 'empty 0 blockers');
  assert(result.blockers.length === 0, 'empty blockers array');
  assert(result.actions.length === 0, 'empty actions array');
}

function testAggregatePartial() {
  const result = aggregate(FIXTURE_PARTIAL);

  assert(result.summary.launchCandidates.loaded === true, 'partial launch loaded');
  assert(result.summary.launchCandidates.count === 1, 'partial 1 launch candidate');
  assert(result.summary.statusBundle.loaded === false, 'partial status not loaded');
  assert(result.summary.mergeCandidates.loaded === false, 'partial merge not loaded');
  assert(result.actions.length === 1, 'partial 1 action');
  assert(result.actions[0].issue === 500, 'partial action is #500');
}

// ── Tests: output sanitization ───────────────────────────────────────────────

function testSanitization() {
  const dirtyInput = {
    statusBundle: {
      health: { state: 'green' },
      blockers: [{ source: 'test', severity: 'info', message: 'A'.repeat(600) }],
    },
    launchCandidates: {
      candidates: [{ number: 1, title: 'B'.repeat(600), workerClass: 'docs', risk: 'low' }],
    },
  };

  const result = aggregate(dirtyInput);
  const json = JSON.stringify(result);

  // Secrets should not appear
  assert(!json.includes('token'), 'no token in output');
  assert(!json.includes('secret'), 'no secret in output');
  assert(!json.includes('password'), 'no password in output');

  // Long strings should be truncated (within sanitizer limits)
  assert(result.summary.statusBundle.blockers[0].message.length <= 500, 'blocker message truncated');
}

// ── Tests: high-risk items are always blocked ────────────────────────────────

function testHighRiskAlwaysBlocked() {
  const input = {
    launchCandidates: {
      candidates: [
        { number: 1, title: 'Safe task', workerClass: 'docs', risk: 'low' },
        { number: 2, title: 'Medium task', workerClass: 'runtime-feature', risk: 'medium' },
        { number: 3, title: 'High risk', workerClass: 'runtime-feature', risk: 'high' },
        { number: 4, title: 'Critical risk', workerClass: 'bugfix', risk: 'critical' },
      ],
    },
  };

  const result = aggregate(input);

  // Only low/medium should produce actions
  assert(result.actions.length === 2, `2 safe actions, got ${result.actions.length}`);
  assert(result.actions.every(a => a.issue !== 3), 'high-risk #3 not in actions');
  assert(result.actions.every(a => a.issue !== 4), 'critical-risk #4 not in actions');

  // High/critical should produce blockers
  assert(result.blockers.some(b => b.candidate === 3), 'high-risk #3 blocked');
  assert(result.blockers.some(b => b.candidate === 4), 'critical-risk #4 blocked');
}

// ── Tests: human-required merge items are always blocked ─────────────────────

function testHumanRequiredAlwaysBlocked() {
  const input = {
    mergeCandidates: {
      mergeable: [{ number: 100, title: 'Safe PR' }],
      blocked: [{ number: 101, title: 'Dirty PR' }],
      humanRequired: [{ number: 102, title: 'Auth PR' }],
    },
  };

  const result = aggregate(input);

  // Only mergeable should produce action
  assert(result.actions.length === 1, '1 mergeable action');
  assert(result.actions[0].pr === 100, 'action is PR 100');

  // Blocked and humanRequired should be blockers
  assert(result.blockers.some(b => b.pr === 101), 'blocked PR 101 in blockers');
  assert(result.blockers.some(b => b.pr === 102), 'humanRequired PR 102 in blockers');
}

// ── Run all tests ────────────────────────────────────────────────────────────

function main() {
  testExtractStatusSummary();
  testExtractTaskBoardSummary();
  testExtractEntropySuggestions();
  testExtractLaunchCandidates();
  testExtractMergeCandidates();
  testExtractCloseCandidates();
  testBuildBlockers();
  testGenerateActions();
  testAggregateFull();
  testAggregateEmpty();
  testAggregatePartial();
  testSanitization();
  testHighRiskAlwaysBlocked();
  testHumanRequiredAlwaysBlocked();

  console.log(`\n  aggregate-self-cycle-candidates tests`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.error(`\n  Failures:`);
    for (const f of failures) {
      console.error(`    - ${f}`);
    }
    console.error('');
    process.exit(1);
  } else {
    console.log(`\n  All tests passed.\n`);
    process.exit(0);
  }
}

main();
