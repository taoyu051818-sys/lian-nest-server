#!/usr/bin/env node

/**
 * detect-issue-close-candidates.test.js
 *
 * Self-tests for the issue close candidate detector with discussion safeguards.
 * Covers: merged PR candidates, discussion issue blocking, umbrella blocking,
 * label-based blocking, already-closed blocking, and output shape validation.
 *
 * Runs without any test framework — uses hand-rolled harness with
 * assert/assertEq helpers, mirroring the pattern from check-agent-idea-gate.test.js.
 *
 * Usage:
 *   node scripts/ai/detect-issue-close-candidates.test.js
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

'use strict';

const {
  evaluateIssue,
  detectCloseCandidates,
  findMergedClosingPR,
  hasDiscussionSignals,
  hasBlockingLabels,
  sanitizeIssue,
  BLOCK_REASONS,
  SCHEMA_VERSION,
} = require('./detect-issue-close-candidates');

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

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('detect-issue-close-candidates.test.js');
console.log('='.repeat(50));

// ── Suite 1: Issue with merged closing PR is candidate ──────────────────────

suite('issue with merged closing PR is candidate');

{
  const issue = {
    number: 100,
    title: 'Add unit tests for auth service',
    state: 'open',
    labels: ['agent:done'],
  };
  const mergedPRs = [
    {
      number: 200,
      title: 'feat(auth): add unit tests',
      body: 'Closes #100. Adds comprehensive unit tests for auth service.',
      merged_at: '2026-05-10T10:00:00Z',
    },
  ];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, true, 'is candidate');
  assertEq(result.blockers.length, 0, 'no blockers');
  assert(result.mergedPR !== null, 'has mergedPR');
  assertEq(result.mergedPR.number, 200, 'mergedPR number correct');
  assertEq(result.issueNumber, 100, 'issueNumber preserved');
  assertEq(result.title, 'Add unit tests for auth service', 'title preserved');
}

// ── Suite 2: Discussion issue remains blocked even with merged PR ───────────

suite('discussion issue blocked even with merged PR');

{
  const issue = {
    number: 96,
    title: 'Discussion: Long-term architecture plan',
    state: 'open',
    labels: ['discussion'],
  };
  const mergedPRs = [
    {
      number: 201,
      title: 'Archive old discussion artifacts',
      body: 'Closes #96. Archives discussion artifacts.',
      merged_at: '2026-05-10T12:00:00Z',
    },
  ];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.DISCUSSION_ISSUE), 'has DISCUSSION_ISSUE blocker');
  // The merged PR is still recorded for transparency
  assert(result.mergedPR !== null, 'mergedPR still recorded');
}

// ── Suite 3: Umbrella issue blocked ─────────────────────────────────────────

suite('umbrella issue blocked');

{
  const issue = {
    number: 50,
    title: 'Umbrella: Auth module migration',
    state: 'open',
    labels: ['type:feature'],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.DISCUSSION_ISSUE), 'has DISCUSSION_ISSUE blocker');
}

// ── Suite 4: Epic issue blocked ─────────────────────────────────────────────

suite('epic issue blocked');

{
  const issue = {
    number: 75,
    title: 'Epic: Payment gateway integration',
    state: 'open',
    labels: [],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.DISCUSSION_ISSUE), 'has DISCUSSION_ISSUE blocker');
}

// ── Suite 5: Tracking issue blocked ─────────────────────────────────────────

suite('tracking issue blocked');

{
  const issue = {
    number: 80,
    title: 'Tracking Q2 infrastructure goals',
    state: 'open',
    labels: [],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.DISCUSSION_ISSUE), 'has DISCUSSION_ISSUE blocker');
}

// ── Suite 6: Meta-issue blocked ─────────────────────────────────────────────

suite('meta-issue blocked');

{
  const issue = {
    number: 85,
    title: 'Meta-issue: Consolidate logging strategy',
    state: 'open',
    labels: [],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.DISCUSSION_ISSUE), 'has DISCUSSION_ISSUE blocker');
}

// ── Suite 7: do-not-close label blocks ──────────────────────────────────────

suite('do-not-close label blocks');

{
  const issue = {
    number: 110,
    title: 'Refactor auth module',
    state: 'open',
    labels: ['do-not-close'],
  };
  const mergedPRs = [
    {
      number: 210,
      title: 'Refactor auth',
      body: 'Fixes #110',
      merged_at: '2026-05-11T10:00:00Z',
    },
  ];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.HUMAN_REQUIRED_LABEL), 'has HUMAN_REQUIRED_LABEL blocker');
}

// ── Suite 8: wip label blocks ───────────────────────────────────────────────

suite('wip label blocks');

{
  const issue = {
    number: 111,
    title: 'Fix runtime failures',
    state: 'open',
    labels: ['wip', 'agent:running'],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.HUMAN_REQUIRED_LABEL), 'has HUMAN_REQUIRED_LABEL blocker');
}

// ── Suite 9: No merged PR blocks ────────────────────────────────────────────

suite('no merged PR blocks');

{
  const issue = {
    number: 120,
    title: 'Add caching layer',
    state: 'open',
    labels: ['agent:done'],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.NO_MERGED_PR), 'has NO_MERGED_PR blocker');
}

// ── Suite 10: Already closed issue blocked ──────────────────────────────────

suite('already closed issue blocked');

{
  const issue = {
    number: 130,
    title: 'Old feature',
    state: 'closed',
    labels: [],
  };
  const mergedPRs = [
    {
      number: 220,
      title: 'Old feature PR',
      body: 'Closes #130',
      merged_at: '2026-05-01T10:00:00Z',
    },
  ];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.ISSUE_ALREADY_CLOSED), 'has ISSUE_ALREADY_CLOSED blocker');
}

// ── Suite 11: PR without closing keyword doesn't count ──────────────────────

suite('PR without closing keyword does not count');

{
  const issue = {
    number: 140,
    title: 'Add feature X',
    state: 'open',
    labels: ['agent:done'],
  };
  const mergedPRs = [
    {
      number: 230,
      title: 'Related work for #140',
      body: 'This PR does some related work but does not close #140.',
      merged_at: '2026-05-11T10:00:00Z',
    },
  ];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.NO_MERGED_PR), 'has NO_MERGED_PR blocker');
}

// ── Suite 12: Multiple closing keywords recognized ──────────────────────────

suite('multiple closing keywords recognized');

{
  const keywords = ['closes', 'close', 'fixes', 'fix', 'resolves', 'resolve'];
  for (const kw of keywords) {
    const issue = {
      number: 150,
      title: 'Test keyword',
      state: 'open',
      labels: [],
    };
    const mergedPRs = [
      {
        number: 240,
        title: 'Test PR',
        body: `${kw} #150`,
        merged_at: '2026-05-11T10:00:00Z',
      },
    ];

    const result = evaluateIssue(issue, mergedPRs);
    assertEq(result.candidate, true, `keyword "${kw}" recognized`);
  }
}

// ── Suite 13: Closing keyword in PR title also recognized ───────────────────

suite('closing keyword in PR title recognized');

{
  const issue = {
    number: 160,
    title: 'Fix bug Y',
    state: 'open',
    labels: [],
  };
  const mergedPRs = [
    {
      number: 250,
      title: 'Fixes #160 — bug Y resolution',
      body: '',
      merged_at: '2026-05-11T10:00:00Z',
    },
  ];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, true, 'keyword in title recognized');
}

// ── Suite 14: Output explains every blocked issue ───────────────────────────

suite('output explains every blocked issue');

{
  const issues = [
    { number: 1, title: 'Discussion: Plan', state: 'open', labels: ['discussion'] },
    { number: 2, title: 'WIP feature', state: 'open', labels: ['wip'] },
    { number: 3, title: 'Done feature', state: 'open', labels: ['agent:done'] },
  ];
  const mergedPRs = [];

  const result = detectCloseCandidates(issues, mergedPRs);

  assertEq(result.blockedCount, 3, 'all three blocked');
  for (const b of result.blocked) {
    assert(b.blockers.length > 0, `issue #${b.issueNumber} has at least one blocker explanation`);
    for (const blocker of b.blockers) {
      assert(typeof blocker.code === 'string', `blocker on #${b.issueNumber} has code`);
      assert(typeof blocker.message === 'string' && blocker.message.length > 0, `blocker on #${b.issueNumber} has message`);
    }
  }
}

// ── Suite 15: detectCloseCandidates output shape ────────────────────────────

suite('detectCloseCandidates output shape');

{
  const issues = [
    { number: 10, title: 'Feature A', state: 'open', labels: ['agent:done'] },
    { number: 20, title: 'Discussion B', state: 'open', labels: ['discussion'] },
  ];
  const mergedPRs = [
    { number: 30, title: 'feat: Feature A', body: 'Closes #10', merged_at: '2026-05-10T10:00:00Z' },
  ];

  const result = detectCloseCandidates(issues, mergedPRs);

  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
  assert(typeof result.capturedAt === 'string', 'capturedAt is string');
  assert(result.capturedAt.includes('T'), 'capturedAt is ISO-8601');
  assertEq(result.totalIssues, 2, 'totalIssues is 2');
  assertEq(result.candidateCount, 1, 'candidateCount is 1');
  assertEq(result.blockedCount, 1, 'blockedCount is 1');
  assert(Array.isArray(result.candidates), 'candidates is array');
  assert(Array.isArray(result.blocked), 'blocked is array');
  assertEq(result.candidates[0].issueNumber, 10, 'candidate is issue 10');
  assertEq(result.blocked[0].issueNumber, 20, 'blocked is issue 20');
}

// ── Suite 16: sanitizeIssue removes sensitive fields ────────────────────────

suite('sanitizeIssue removes sensitive fields');

{
  const issue = {
    number: 1,
    title: 'Test',
    state: 'open',
    labels: [],
    body: 'This is the body with potentially sensitive content',
    html_url: 'https://github.com/owner/repo/issues/1',
    node_id: 'MDU6SXNzdWUx',
    author_association: 'OWNER',
    reactions: { '+1': 0 },
    pull_request: { url: 'https://api.github.com/repos/...' },
  };

  const safe = sanitizeIssue(issue);

  assertEq(safe.number, 1, 'number preserved');
  assertEq(safe.title, 'Test', 'title preserved');
  assert(safe.body === undefined, 'body removed');
  assert(safe.html_url === undefined, 'html_url removed');
  assert(safe.node_id === undefined, 'node_id removed');
  assert(safe.author_association === undefined, 'author_association removed');
  assert(safe.reactions === undefined, 'reactions removed');
  assert(safe.pull_request === undefined, 'pull_request removed');
}

// ── Suite 17: hasDiscussionSignals with labels ──────────────────────────────

suite('hasDiscussionSignals with label objects');

{
  const issue = {
    number: 1,
    title: 'Regular issue',
    state: 'open',
    labels: [{ name: 'epic' }],
  };

  assert(hasDiscussionSignals(issue) === true, 'detects epic label object');
}

// ── Suite 18: hasBlockingLabels with string labels ──────────────────────────

suite('hasBlockingLabels with string labels');

{
  const issue = {
    number: 1,
    title: 'Test',
    state: 'open',
    labels: ['blocked', 'agent:running'],
  };

  assert(hasBlockingLabels(issue) === true, 'detects blocked string label');
}

// ── Suite 19: findMergedClosingPR returns null when no match ────────────────

suite('findMergedClosingPR returns null when no match');

{
  const issue = { number: 999 };
  const mergedPRs = [
    { number: 100, title: 'Unrelated PR', body: 'No reference here' },
  ];

  assert(findMergedClosingPR(issue, mergedPRs) === null, 'returns null for no match');
}

// ── Suite 20: findMergedClosingPR finds fix in title ────────────────────────

suite('findMergedClosingPR finds fix in title');

{
  const issue = { number: 42 };
  const mergedPRs = [
    { number: 101, title: 'Fix #42 bug', body: '' },
  ];

  const pr = findMergedClosingPR(issue, mergedPRs);
  assert(pr !== null, 'finds PR with fix in title');
  assertEq(pr.number, 101, 'correct PR number');
}

// ── Suite 21: Multiple blockers accumulate ──────────────────────────────────

suite('multiple blockers accumulate');

{
  const issue = {
    number: 55,
    title: 'Discussion: Q3 plan',
    state: 'open',
    labels: ['discussion', 'do-not-close'],
  };
  const mergedPRs = [];

  const result = evaluateIssue(issue, mergedPRs);

  assertEq(result.candidate, false, 'not candidate');
  assert(result.blockers.length >= 2, 'has multiple blockers');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.DISCUSSION_ISSUE), 'has DISCUSSION_ISSUE');
  assert(result.blockers.some((b) => b.code === BLOCK_REASONS.HUMAN_REQUIRED_LABEL), 'has HUMAN_REQUIRED_LABEL');
}

// ── Suite 22: Empty inputs produce valid output ─────────────────────────────

suite('empty inputs produce valid output');

{
  const result = detectCloseCandidates([], []);

  assertEq(result.totalIssues, 0, 'totalIssues is 0');
  assertEq(result.candidateCount, 0, 'candidateCount is 0');
  assertEq(result.blockedCount, 0, 'blockedCount is 0');
  assertEq(result.candidates.length, 0, 'candidates empty');
  assertEq(result.blocked.length, 0, 'blocked empty');
  assertEq(result.schemaVersion, 1, 'schemaVersion is 1');
}

// ── Results ─────────────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
