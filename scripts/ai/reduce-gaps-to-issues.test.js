#!/usr/bin/env node

/**
 * reduce-gaps-to-issues.test.js
 *
 * Focused tests for reduce-gaps-to-issues.js covering:
 *   - Gap entry to candidate mapping
 *   - Task board gap discovery and mapping
 *   - Provider capacity candidate generation
 *   - Meta-signal enrichment
 *   - Deduplication against issues/PRs
 *   - Policy gate (risk, forbidden scopes)
 *   - Issue body with CONTROL APPENDIX
 *   - Output shape
 *   - CLI help flag
 *
 * Run:  node scripts/ai/reduce-gaps-to-issues.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, 'reduce-gaps-to-issues.js');
const {
  mapGapEntryToCandidate,
  mapTaskBoardGapToCandidate,
  discoverTaskBoardGaps,
  generateProviderCapacityCandidate,
  enrichCandidateWithMetaSignals,
  deduplicate,
  applyPolicyGate,
  buildOutput,
  buildIssueBody,
  makeCandidate,
  extractKeywords,
  titleOverlap,
  isFileScopeForbidden,
  extractConflictGroupFromIssueBody,
  buildEvidenceFromGapEntry,
  buildRationaleFromGapEntry,
  GAP_TYPE_TEMPLATES,
} = require('./reduce-gaps-to-issues');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    if (err.status !== undefined) {
      return {
        exitCode: err.status,
        stdout: err.stdout || '',
        stderr: err.stderr || '',
      };
    }
    throw err;
  }
}

function makeGapEntry(overrides) {
  return {
    entryVersion: 1,
    recordedAt: '2026-05-13T12:00:00Z',
    gapType: 'worker-failed',
    severity: 'high',
    description: 'Worker exited code 1, no PR produced',
    ...overrides,
  };
}

// ── extractKeywords ──────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('extracts meaningful keywords and removes stopwords', () => {
    const kw = extractKeywords('Investigate and recover from worker failure');
    assert.ok(kw.includes('investigate'), 'has investigate');
    assert.ok(kw.includes('recover'), 'has recover');
    assert.ok(kw.includes('worker'), 'has worker');
    assert.ok(kw.includes('failure'), 'has failure');
    assert.ok(!kw.includes('and'), 'stopword removed');
    assert.ok(!kw.includes('from'), 'stopword removed');
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(extractKeywords(''), []);
  });
});

// ── titleOverlap ─────────────────────────────────────────────────────────────

describe('titleOverlap', () => {
  it('returns high overlap for similar titles', () => {
    const overlap = titleOverlap(
      'Investigate and recover from worker failure',
      'Investigate worker failure recovery'
    );
    assert.ok(overlap > 0.5, `overlap ${overlap} > 0.5`);
  });

  it('returns low overlap for different titles', () => {
    const overlap = titleOverlap(
      'Investigate worker failure',
      'Refresh stale migration matrix row'
    );
    assert.ok(overlap < 0.5, `overlap ${overlap} < 0.5`);
  });

  it('returns 0 for empty strings', () => {
    assert.equal(titleOverlap('', 'something'), 0);
    assert.equal(titleOverlap('something', ''), 0);
  });
});

// ── isFileScopeForbidden ─────────────────────────────────────────────────────

describe('isFileScopeForbidden', () => {
  it('detects src/** as forbidden', () => {
    assert.ok(isFileScopeForbidden(['src/**']));
  });

  it('detects prisma as forbidden', () => {
    assert.ok(isFileScopeForbidden(['prisma/migrations']));
  });

  it('detects package.json as forbidden', () => {
    assert.ok(isFileScopeForbidden(['package.json']));
  });

  it('allows docs/**', () => {
    assert.ok(!isFileScopeForbidden(['docs/**']));
  });

  it('allows scripts/ai/**', () => {
    assert.ok(!isFileScopeForbidden(['scripts/ai/**']));
  });
});

// ── extractConflictGroupFromIssueBody ────────────────────────────────────────

describe('extractConflictGroupFromIssueBody', () => {
  it('extracts conflict group from body', () => {
    const body = 'Some text\nConflict group: auth-core\nCONTROL APPENDIX';
    assert.equal(extractConflictGroupFromIssueBody(body), 'auth-core');
  });

  it('returns null for body without conflict group', () => {
    assert.equal(extractConflictGroupFromIssueBody('No conflict group here'), null);
  });

  it('returns null for null body', () => {
    assert.equal(extractConflictGroupFromIssueBody(null), null);
  });
});

// ── mapGapEntryToCandidate ───────────────────────────────────────────────────

describe('mapGapEntryToCandidate', () => {
  it('maps worker-failed entry to high-risk candidate', () => {
    const entry = makeGapEntry({ gapType: 'worker-failed', issue: 398 });
    const candidate = mapGapEntryToCandidate(entry);

    assert.ok(candidate, 'candidate should not be null');
    assert.equal(candidate.risk, 'high');
    assert.equal(candidate.conflictGroup, 'worker-recovery');
    assert.equal(candidate.taskType, 'execution');
    assert.ok(candidate.title.includes('worker failure'), 'title mentions worker failure');
    assert.ok(candidate.title.includes('#398'), 'title includes issue number');
    assert.ok(candidate.evidence.includes('worker-failed'), 'evidence includes gap type');
    assert.ok(candidate.rationale.includes('worker failed'), 'rationale explains the gap');
    assert.ok(candidate.rollbackFollowUp.length > 0, 'rollback is not empty');
  });

  it('maps health-gate-fail entry to high-risk candidate', () => {
    const entry = makeGapEntry({
      gapType: 'health-gate-fail',
      severity: 'critical',
      description: 'tsc and build failed',
      commit: 'abc1234',
    });
    const candidate = mapGapEntryToCandidate(entry);

    assert.equal(candidate.risk, 'high');
    assert.equal(candidate.conflictGroup, 'health-gate-repair');
    assert.ok(candidate.evidence.includes('abc1234'), 'evidence includes commit');
  });

  it('maps launch-blocked entry to medium-risk candidate', () => {
    const entry = makeGapEntry({
      gapType: 'launch-blocked',
      severity: 'medium',
      description: 'conflict group collision',
      meta: { conflictGroup: 'auth-core', blockingIssue: 258 },
    });
    const candidate = mapGapEntryToCandidate(entry);

    assert.equal(candidate.risk, 'medium');
    assert.equal(candidate.conflictGroup, 'launch-block-resolution');
    assert.ok(candidate.evidence.includes('auth-core'), 'evidence includes meta conflictGroup');
  });

  it('maps plan-drift entry to low-risk candidate', () => {
    const entry = makeGapEntry({
      gapType: 'plan-drift',
      severity: 'low',
      description: 'task deferred to next wave',
    });
    const candidate = mapGapEntryToCandidate(entry);

    assert.equal(candidate.risk, 'low');
    assert.equal(candidate.conflictGroup, 'plan-drift-correction');
    assert.equal(candidate.taskType, 'docs');
  });

  it('maps stale-row entry to low-risk candidate', () => {
    const entry = makeGapEntry({
      gapType: 'stale-row',
      severity: 'low',
      description: 'migration row detected stale',
    });
    const candidate = mapGapEntryToCandidate(entry);

    assert.equal(candidate.risk, 'low');
    assert.equal(candidate.conflictGroup, 'stale-row-refresh');
  });

  it('returns null for unknown gap type', () => {
    const entry = makeGapEntry({ gapType: 'unknown-type' });
    const candidate = mapGapEntryToCandidate(entry);
    assert.equal(candidate, null);
  });

  it('candidate has CONTROL APPENDIX fields', () => {
    const entry = makeGapEntry();
    const candidate = mapGapEntryToCandidate(entry);

    assert.ok(typeof candidate.taskType === 'string', 'has taskType');
    assert.ok(typeof candidate.risk === 'string', 'has risk');
    assert.ok(typeof candidate.conflictGroup === 'string', 'has conflictGroup');
    assert.ok(Array.isArray(candidate.allowedFiles), 'has allowedFiles');
    assert.ok(Array.isArray(candidate.forbiddenFiles), 'has forbiddenFiles');
    assert.ok(Array.isArray(candidate.validationCommands), 'has validationCommands');
    assert.ok(typeof candidate.actorRole === 'string', 'has actorRole');
    assert.ok(typeof candidate.macroGoal === 'string', 'has macroGoal');
  });
});

// ── discoverTaskBoardGaps ────────────────────────────────────────────────────

describe('discoverTaskBoardGaps', () => {
  it('detects blocked lanes', () => {
    const taskBoard = {
      tasks: [
        { issue: 10, state: 'blocked', blockedReason: 'dependency not ready', conflictGroup: 'auth-core' },
        { issue: 20, state: 'ready', conflictGroup: 'docs' },
        { issue: 21, state: 'ready', conflictGroup: 'docs2' },
        { issue: 22, state: 'ready', conflictGroup: 'docs3' },
      ],
    };
    const gaps = discoverTaskBoardGaps(taskBoard);

    const blocked = gaps.filter(g => g.type === 'blocked-lane');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].issue, 10);
    assert.equal(blocked[0].reason, 'dependency not ready');
  });

  it('detects empty-ready lane', () => {
    const taskBoard = {
      tasks: [
        { issue: 1, state: 'running', conflictGroup: 'a' },
        { issue: 2, state: 'blocked', conflictGroup: 'b' },
      ],
    };
    const gaps = discoverTaskBoardGaps(taskBoard);

    const emptyReady = gaps.find(g => g.type === 'empty-ready');
    assert.ok(emptyReady, 'should detect empty-ready');
    assert.equal(emptyReady.deficit, 3, 'deficit is 3 (0 ready, threshold 3)');
  });

  it('does not detect empty-ready when sufficient ready tasks exist', () => {
    const taskBoard = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'a' },
        { issue: 2, state: 'ready', conflictGroup: 'b' },
        { issue: 3, state: 'ready', conflictGroup: 'c' },
      ],
    };
    const gaps = discoverTaskBoardGaps(taskBoard);

    const emptyReady = gaps.find(g => g.type === 'empty-ready');
    assert.equal(emptyReady, undefined, 'should not detect empty-ready');
  });

  it('detects stale-running lanes with no heartbeat', () => {
    const taskBoard = {
      tasks: [
        { issue: 50, state: 'running', conflictGroup: 'a', worker: {} },
      ],
    };
    const gaps = discoverTaskBoardGaps(taskBoard);

    const stale = gaps.find(g => g.type === 'stale-running');
    assert.ok(stale, 'should detect stale-running');
    assert.equal(stale.reason, 'no-heartbeat');
  });

  it('returns empty array for null task board', () => {
    assert.deepEqual(discoverTaskBoardGaps(null), []);
  });

  it('returns empty-ready signal for task board with no tasks', () => {
    const gaps = discoverTaskBoardGaps({ tasks: [] });
    const emptyReady = gaps.find(g => g.type === 'empty-ready');
    assert.ok(emptyReady, 'should detect empty-ready with 0 tasks');
    assert.equal(emptyReady.deficit, 3, 'deficit is 3');
  });
});

// ── mapTaskBoardGapToCandidate ───────────────────────────────────────────────

describe('mapTaskBoardGapToCandidate', () => {
  it('maps blocked-lane signal to candidate', () => {
    const signal = { type: 'blocked-lane', issue: 10, reason: 'dependency not ready', conflictGroup: 'auth-core' };
    const candidate = mapTaskBoardGapToCandidate(signal);

    assert.ok(candidate, 'candidate should not be null');
    assert.equal(candidate.risk, 'medium');
    assert.equal(candidate.conflictGroup, 'auth-core');
    assert.ok(candidate.title.includes('#10'), 'title includes issue number');
    assert.ok(candidate.evidence.includes('blocked-lane'), 'evidence includes gap type');
  });

  it('maps empty-ready signal to candidate', () => {
    const signal = { type: 'empty-ready', readyCount: 0, threshold: 3, deficit: 3 };
    const candidate = mapTaskBoardGapToCandidate(signal);

    assert.equal(candidate.risk, 'low');
    assert.ok(candidate.evidence.includes('deficit'), 'evidence mentions deficit');
  });

  it('maps stale-running signal to candidate', () => {
    const signal = { type: 'stale-running', issue: 50, conflictGroup: 'a', reason: 'heartbeat-stale', ageMinutes: 15 };
    const candidate = mapTaskBoardGapToCandidate(signal);

    assert.equal(candidate.risk, 'medium');
    assert.ok(candidate.evidence.includes('15 minutes'), 'evidence includes age');
  });

  it('returns null for unknown signal type', () => {
    const signal = { type: 'unknown' };
    assert.equal(mapTaskBoardGapToCandidate(signal), null);
  });
});

// ── generateProviderCapacityCandidate ────────────────────────────────────────

describe('generateProviderCapacityCandidate', () => {
  it('generates candidate when available < max', () => {
    const pool = { global: { availableProviders: 2, globalMaxWorkers: 5 } };
    const candidate = generateProviderCapacityCandidate(pool);

    assert.ok(candidate, 'candidate should not be null');
    assert.equal(candidate.risk, 'medium');
    assert.ok(candidate.evidence.includes('availableProviders=2'), 'evidence includes available');
    assert.ok(candidate.evidence.includes('globalMaxWorkers=5'), 'evidence includes max');
  });

  it('returns null when available >= max', () => {
    const pool = { global: { availableProviders: 5, globalMaxWorkers: 5 } };
    assert.equal(generateProviderCapacityCandidate(pool), null);
  });

  it('returns null for null pool', () => {
    assert.equal(generateProviderCapacityCandidate(null), null);
  });
});

// ── enrichCandidateWithMetaSignals ───────────────────────────────────────────

describe('enrichCandidateWithMetaSignals', () => {
  it('enriches candidate with high failure score', () => {
    const candidate = makeCandidate({ title: 'test', evidence: 'base evidence' });
    const meta = { failureScore: 0.8, frictionScore: 0.2, riskScore: 0.3 };

    enrichCandidateWithMetaSignals(candidate, meta);
    assert.ok(candidate.evidence.includes('failure score'), 'evidence includes failure score');
    assert.ok(!candidate.evidence.includes('friction'), 'low friction not included');
  });

  it('enriches candidate with top pain', () => {
    const candidate = makeCandidate({ title: 'test', evidence: '' });
    const meta = { topPain: 'worker stability' };

    enrichCandidateWithMetaSignals(candidate, meta);
    assert.ok(candidate.evidence.includes('worker stability'), 'evidence includes top pain');
  });

  it('does not modify candidate when meta signals are normal', () => {
    const candidate = makeCandidate({ title: 'test', evidence: 'base' });
    const meta = { failureScore: 0.1, frictionScore: 0.1, riskScore: 0.1 };

    enrichCandidateWithMetaSignals(candidate, meta);
    assert.equal(candidate.evidence, 'base', 'evidence unchanged');
  });

  it('handles null meta signals', () => {
    const candidate = makeCandidate({ title: 'test', evidence: 'base' });
    enrichCandidateWithMetaSignals(candidate, null);
    assert.equal(candidate.evidence, 'base', 'evidence unchanged');
  });
});

// ── deduplicate ──────────────────────────────────────────────────────────────

describe('deduplicate', () => {
  it('removes candidates with title overlap > 0.5', () => {
    const candidates = [
      makeCandidate({ title: 'Investigate worker failure recovery' }),
      makeCandidate({ title: 'Refresh stale migration matrix row' }),
    ];
    const openIssues = [{ title: 'Investigate and recover from worker failure', body: '', labels: [] }];

    const { proposed, skipped } = deduplicate(candidates, openIssues, [], []);
    assert.equal(proposed.length, 1, '1 proposed');
    assert.equal(skipped.length, 1, '1 skipped');
    assert.ok(skipped[0].reason.includes('title overlap'), 'reason mentions title overlap');
  });

  it('removes candidates with conflictGroup collision', () => {
    const candidates = [
      makeCandidate({ title: 'Unique title A', conflictGroup: 'worker-recovery' }),
    ];
    const openIssues = [{ title: 'Old issue', body: 'Conflict group: worker-recovery\nCONTROL APPENDIX', labels: [] }];

    const { proposed, skipped } = deduplicate(candidates, openIssues, [], []);
    assert.equal(proposed.length, 0, '0 proposed');
    assert.equal(skipped.length, 1, '1 skipped');
  });

  it('removes candidates with conflictGroup collision in PRs', () => {
    const candidates = [
      makeCandidate({ title: 'Unique title B', conflictGroup: 'auth-core' }),
    ];
    const openPRs = [{ title: 'Auth PR', body: 'Conflict group: auth-core\nCONTROL APPENDIX', headRefName: 'auth' }];

    const { proposed, skipped } = deduplicate(candidates, [], openPRs, []);
    assert.equal(proposed.length, 0, '0 proposed');
  });

  it('removes candidates with conflictGroup collision in merged PRs', () => {
    const candidates = [
      makeCandidate({ title: 'Unique title C', conflictGroup: 'feed' }),
    ];
    const mergedPRs = [{ title: 'Feed PR', body: 'Conflict group: feed\nCONTROL APPENDIX', headRefName: 'feed' }];

    const { proposed, skipped } = deduplicate(candidates, [], [], mergedPRs);
    assert.equal(proposed.length, 0, '0 proposed');
  });

  it('keeps candidates without overlap', () => {
    const candidates = [
      makeCandidate({ title: 'Investigate worker failure' }),
      makeCandidate({ title: 'Refresh stale migration matrix' }),
    ];

    const { proposed, skipped } = deduplicate(candidates, [], [], []);
    assert.equal(proposed.length, 2, '2 proposed');
    assert.equal(skipped.length, 0, '0 skipped');
  });
});

// ── applyPolicyGate ──────────────────────────────────────────────────────────

describe('applyPolicyGate', () => {
  it('blocks high-risk candidates', () => {
    const candidates = [makeCandidate({ title: 'Dangerous change', risk: 'high' })];
    const { autoCreatable, humanRequired } = applyPolicyGate(candidates);

    assert.equal(autoCreatable.length, 0, '0 auto-creatable');
    assert.equal(humanRequired.length, 1, '1 human-required');
    assert.equal(humanRequired[0].readiness, 'blocked');
    assert.ok(humanRequired[0].humanRequired, 'humanRequired is true');
  });

  it('allows low-risk candidates', () => {
    const candidates = [makeCandidate({ title: 'Safe docs change', risk: 'low' })];
    const { autoCreatable, humanRequired } = applyPolicyGate(candidates);

    assert.equal(autoCreatable.length, 1, '1 auto-creatable');
    assert.equal(humanRequired.length, 0, '0 human-required');
    assert.equal(autoCreatable[0].readiness, 'ready');
  });

  it('allows medium-risk candidates', () => {
    const candidates = [makeCandidate({ title: 'Medium change', risk: 'medium' })];
    const { autoCreatable, humanRequired } = applyPolicyGate(candidates);

    assert.equal(autoCreatable.length, 1, '1 auto-creatable');
    assert.equal(humanRequired.length, 0, '0 human-required');
  });

  it('blocks candidates with forbidden file scopes', () => {
    const candidates = [makeCandidate({
      title: 'Bad scope change',
      risk: 'low',
      allowedFiles: ['src/**'],
    })];
    const { autoCreatable, humanRequired } = applyPolicyGate(candidates);

    assert.equal(autoCreatable.length, 0, '0 auto-creatable');
    assert.equal(humanRequired.length, 1, '1 human-required');
  });
});

// ── buildIssueBody ───────────────────────────────────────────────────────────

describe('buildIssueBody', () => {
  it('contains CONTROL APPENDIX', () => {
    const body = buildIssueBody(makeCandidate({
      title: 'Test issue',
      conflictGroup: 'test-group',
      evidence: 'test evidence',
      rollbackFollowUp: 'test rollback',
    }));

    assert.ok(body.includes('CONTROL APPENDIX'), 'contains CONTROL APPENDIX');
    assert.ok(body.includes('Conflict group: test-group'), 'contains conflict group');
    assert.ok(body.includes('Role packet:'), 'contains role packet');
  });

  it('contains all required sections', () => {
    const body = buildIssueBody(makeCandidate({ title: 'Test' }));

    assert.ok(body.includes('## Goal'), 'has Goal section');
    assert.ok(body.includes('## Evidence'), 'has Evidence section');
    assert.ok(body.includes('## Scope'), 'has Scope section');
    assert.ok(body.includes('## Acceptance'), 'has Acceptance section');
    assert.ok(body.includes('## Constraints'), 'has Constraints section');
    assert.ok(body.includes('## Rollback / Follow-up'), 'has Rollback section');
  });

  it('contains allowed and forbidden files', () => {
    const body = buildIssueBody(makeCandidate({ title: 'Test' }));

    assert.ok(body.includes('Allowed files:'), 'has Allowed files');
    assert.ok(body.includes('Forbidden files:'), 'has Forbidden files');
    assert.ok(body.includes('docs/**'), 'lists docs glob');
    assert.ok(body.includes('src/**'), 'lists src glob');
  });

  it('contains validation commands', () => {
    const body = buildIssueBody(makeCandidate({ title: 'Test' }));
    assert.ok(body.includes('npm run check'), 'lists validation command');
  });

  it('contains actor role and macro goal', () => {
    const body = buildIssueBody(makeCandidate({
      title: 'Test',
      actorRole: 'issue-production-worker',
      macroGoal: 'test-goal',
    }));

    assert.ok(body.includes('Actor role: issue-production-worker'), 'has actor role');
    assert.ok(body.includes('Macro goal: test-goal'), 'has macro goal');
  });
});

// ── buildOutput ──────────────────────────────────────────────────────────────

describe('buildOutput', () => {
  it('has correct shape', () => {
    const output = buildOutput([makeCandidate({ title: 'test' })], [], 'dry-run', 10);

    assert.equal(output.planVersion, 1, 'planVersion is 1');
    assert.ok(typeof output.capturedAt === 'string', 'capturedAt is string');
    assert.ok(Array.isArray(output.candidates), 'candidates is array');
    assert.ok(Array.isArray(output.skippedDuplicates), 'skippedDuplicates is array');
    assert.equal(output.mode, 'dry-run', 'mode is dry-run');
    assert.equal(output.totalProposed, 1, 'totalProposed is 1');
    assert.equal(output.totalCapped, 1, 'totalCapped is 1');
    assert.equal(output.totalSkipped, 0, 'totalSkipped is 0');
  });

  it('caps candidates at max', () => {
    const many = Array.from({ length: 15 }, (_, i) => makeCandidate({ title: `Issue ${i}` }));
    const output = buildOutput(many, [], 'dry-run', 5);

    assert.equal(output.candidates.length, 5, 'capped at 5');
    assert.equal(output.totalProposed, 15, 'totalProposed is 15');
    assert.equal(output.totalCapped, 5, 'totalCapped is 5');
  });

  it('includes policy info', () => {
    const output = buildOutput([], [], 'dry-run', 10);

    assert.ok(Array.isArray(output.policy.allowedScopes), 'has allowedScopes');
    assert.ok(Array.isArray(output.policy.forbiddenScopes), 'has forbiddenScopes');
    assert.equal(output.policy.maxAutoCreate, 10, 'maxAutoCreate matches');
  });
});

// ── makeCandidate defaults ───────────────────────────────────────────────────

describe('makeCandidate', () => {
  it('has correct defaults', () => {
    const c = makeCandidate({ title: 'test' });

    assert.equal(c.risk, 'low', 'default risk is low');
    assert.equal(c.readiness, 'ready', 'default readiness is ready');
    assert.equal(c.humanRequired, false, 'default humanRequired is false');
    assert.equal(c.issueNumber, null, 'default issueNumber is null');
    assert.equal(c.taskType, 'execution', 'default taskType is execution');
    assert.equal(c.actorRole, 'issue-production-worker', 'default actorRole');
  });

  it('allows overrides', () => {
    const c = makeCandidate({ title: 'custom', risk: 'high', conflictGroup: 'my-group' });

    assert.equal(c.title, 'custom');
    assert.equal(c.risk, 'high');
    assert.equal(c.conflictGroup, 'my-group');
  });
});

// ── buildEvidenceFromGapEntry ────────────────────────────────────────────────

describe('buildEvidenceFromGapEntry', () => {
  it('includes all entry fields', () => {
    const entry = makeGapEntry({
      gapType: 'worker-failed',
      severity: 'high',
      description: 'exit code 1',
      issue: 398,
      pr: 401,
      branch: 'claude/w1',
      commit: 'abc1234',
      meta: { exitCode: 1 },
    });

    const evidence = buildEvidenceFromGapEntry(entry);
    assert.ok(evidence.includes('worker-failed'), 'includes gapType');
    assert.ok(evidence.includes('high'), 'includes severity');
    assert.ok(evidence.includes('exit code 1'), 'includes description');
    assert.ok(evidence.includes('#398'), 'includes issue');
    assert.ok(evidence.includes('#401'), 'includes PR');
    assert.ok(evidence.includes('claude/w1'), 'includes branch');
    assert.ok(evidence.includes('abc1234'), 'includes commit');
    assert.ok(evidence.includes('exitCode'), 'includes meta');
  });

  it('handles minimal entry', () => {
    const entry = makeGapEntry({ issue: undefined, pr: undefined, branch: undefined, commit: undefined, meta: undefined });
    const evidence = buildEvidenceFromGapEntry(entry);
    assert.ok(evidence.includes('worker-failed'), 'includes gapType');
    assert.ok(!evidence.includes('Related issue'), 'no issue field');
  });
});

// ── buildRationaleFromGapEntry ───────────────────────────────────────────────

describe('buildRationaleFromGapEntry', () => {
  it('returns type-specific rationale for each gap type', () => {
    const types = ['worker-failed', 'worker-stale', 'health-gate-fail', 'launch-blocked', 'plan-drift', 'stale-row'];
    for (const gapType of types) {
      const entry = makeGapEntry({ gapType });
      const rationale = buildRationaleFromGapEntry(entry);
      assert.ok(rationale.length > 0, `rationale for ${gapType} is not empty`);
    }
  });
});

// ── CLI ──────────────────────────────────────────────────────────────────────

describe('CLI', () => {
  it('prints help and exits 0 with --help', () => {
    const res = run(['--help']);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes('USAGE'), 'has USAGE');
    assert.ok(res.stdout.includes('--max'), 'has --max');
    assert.ok(res.stdout.includes('--stdout'), 'has --stdout');
  });

  it('rejects unknown flags', () => {
    const res = run(['--unknown-flag']);
    assert.equal(res.exitCode, 2);
    assert.ok(res.stderr.includes('Unknown argument'), 'error mentions unknown argument');
  });

  it('outputs JSON to stdout with --stdout', () => {
    const res = run(['--stdout']);
    assert.equal(res.exitCode, 0);
    const output = JSON.parse(res.stdout);
    assert.equal(output.planVersion, 1, 'planVersion is 1');
    assert.ok(Array.isArray(output.candidates), 'candidates is array');
    assert.ok(Array.isArray(output.skippedDuplicates), 'skippedDuplicates is array');
  });

  it('respects --max flag', () => {
    const res = run(['--stdout', '--max', '2']);
    assert.equal(res.exitCode, 0);
    const output = JSON.parse(res.stdout);
    assert.ok(output.candidates.length <= 2, 'candidates capped at 2');
  });
});
