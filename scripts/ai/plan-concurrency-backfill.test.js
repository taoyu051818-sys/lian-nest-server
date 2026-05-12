#!/usr/bin/env node

/**
 * plan-concurrency-backfill.test.js
 *
 * Focused self-tests for plan-concurrency-backfill.js covering:
 *   - Provider slot extraction
 *   - Resource slot extraction
 *   - Active worker counting
 *   - Risk-safe slot extraction
 *   - Conflict-safe slot counting
 *   - Task filtering (executable vs non-executable)
 *   - Wave planning (conflict groups, high-risk solo, parallelism cap)
 *   - Full plan integration
 *   - CLI help flag
 *   - CLI validation errors
 *   - CLI stdout output
 *   - CLI self-test flag
 *
 * Run:  node scripts/ai/plan-concurrency-backfill.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PLANNER = path.resolve(__dirname, 'plan-concurrency-backfill.js');

const {
  extractProviderSlots,
  extractResourceSlots,
  countActiveWorkers,
  extractRiskSafeSlots,
  countConflictSafeSlots,
  filterExecutableTasks,
  planWaves,
  planConcurrencyBackfill,
  identifyLimitingFactor,
  DEFAULTS,
} = require('./plan-concurrency-backfill.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [PLANNER, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      ...opts,
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

function tmpFile(ext = '.json') {
  return path.join(os.tmpdir(), `backfill-planner-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

function writeTmpFixture(fixture) {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify(fixture), 'utf8');
  return p;
}

// ── Provider slot extraction ─────────────────────────────────────────────────

describe('extractProviderSlots', () => {
  it('returns 0 for null pool', () => {
    assert.equal(extractProviderSlots(null), 0);
  });

  it('returns 0 for missing providers array', () => {
    assert.equal(extractProviderSlots({}), 0);
  });

  it('returns 0 for empty providers', () => {
    assert.equal(extractProviderSlots({ providers: [] }), 0);
  });

  it('counts available providers', () => {
    const pool = {
      providers: [
        { id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
        { id: 'p2', status: 'available', currentConcurrency: 3, maxConcurrency: 5 },
      ],
    };
    assert.equal(extractProviderSlots(pool), 2);
  });

  it('excludes exhausted and disabled providers', () => {
    const pool = {
      providers: [
        { id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
        { id: 'p2', status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 },
        { id: 'p3', status: 'disabled', currentConcurrency: 0, maxConcurrency: 5 },
      ],
    };
    assert.equal(extractProviderSlots(pool), 1);
  });

  it('excludes at-capacity providers', () => {
    const pool = {
      providers: [
        { id: 'p1', status: 'available', currentConcurrency: 5, maxConcurrency: 5 },
      ],
    };
    assert.equal(extractProviderSlots(pool), 0);
  });
});

// ── Resource slot extraction ─────────────────────────────────────────────────

describe('extractResourceSlots', () => {
  it('returns 1 for null resource', () => {
    assert.equal(extractResourceSlots(null), 1);
  });

  it('returns 1 for missing process key', () => {
    assert.equal(extractResourceSlots({}), 1);
  });

  it('returns maxAllowed value', () => {
    assert.equal(extractResourceSlots({ process: { maxAllowed: 12 } }), 12);
  });

  it('returns 1 for zero maxAllowed', () => {
    assert.equal(extractResourceSlots({ process: { maxAllowed: 0 } }), 1);
  });

  it('returns 1 for negative maxAllowed', () => {
    assert.equal(extractResourceSlots({ process: { maxAllowed: -1 } }), 1);
  });
});

// ── Active worker counting ───────────────────────────────────────────────────

describe('countActiveWorkers', () => {
  it('returns 0 for null input', () => {
    assert.equal(countActiveWorkers(null), 0);
  });

  it('returns 0 for empty workers', () => {
    assert.equal(countActiveWorkers({ workers: [] }), 0);
  });

  it('counts running and planned workers', () => {
    const aw = {
      workers: [
        { status: 'running' },
        { status: 'planned' },
        { status: 'completed' },
        { status: 'failed' },
      ],
    };
    assert.equal(countActiveWorkers(aw), 2);
  });
});

// ── Risk-safe slots ──────────────────────────────────────────────────────────

describe('extractRiskSafeSlots', () => {
  it('returns full requested for null signals', () => {
    assert.equal(extractRiskSafeSlots(null, 10), 10);
  });

  it('returns full requested for empty signals', () => {
    assert.equal(extractRiskSafeSlots({ signals: [] }, 10), 10);
  });

  it('returns 1 for high severity', () => {
    assert.equal(extractRiskSafeSlots({ signals: [{ severity: 'high' }] }, 10), 1);
  });

  it('returns 1 for critical severity', () => {
    assert.equal(extractRiskSafeSlots({ signals: [{ severity: 'critical' }] }, 10), 1);
  });

  it('returns half for medium severity', () => {
    assert.equal(extractRiskSafeSlots({ signals: [{ severity: 'medium' }] }, 10), 5);
  });

  it('returns full for low severity', () => {
    assert.equal(extractRiskSafeSlots({ signals: [{ severity: 'low' }] }, 10), 10);
  });
});

// ── Conflict-safe slots ──────────────────────────────────────────────────────

describe('countConflictSafeSlots', () => {
  it('returns 0 for empty tasks', () => {
    assert.equal(countConflictSafeSlots([]), 0);
  });

  it('counts distinct conflict groups', () => {
    const tasks = [
      { conflictGroup: 'auth' },
      { conflictGroup: 'auth' },
      { conflictGroup: 'docs' },
    ];
    assert.equal(countConflictSafeSlots(tasks), 2);
  });

  it('handles tasks without conflictGroup', () => {
    const tasks = [
      { conflictGroup: 'auth' },
      {},
      { conflictGroup: null },
    ];
    assert.equal(countConflictSafeSlots(tasks), 2); // 'auth' and 'general'
  });
});

// ── Task filtering ───────────────────────────────────────────────────────────

describe('filterExecutableTasks', () => {
  it('returns empty for null board', () => {
    assert.deepEqual(filterExecutableTasks(null), []);
  });

  it('returns empty for empty tasks', () => {
    assert.deepEqual(filterExecutableTasks({ tasks: [] }), []);
  });

  it('excludes done, archived, running, blocked, discussion tasks', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'a' },
        { issue: 2, state: 'running', conflictGroup: 'b' },
        { issue: 3, state: 'done', conflictGroup: 'c' },
        { issue: 4, state: 'archived', conflictGroup: 'd' },
        { issue: 5, state: 'blocked', conflictGroup: 'e' },
        { issue: 6, state: 'discussion/open', conflictGroup: 'f' },
        { issue: 7, state: 'todo', conflictGroup: 'g' },
      ],
    };
    const exec = filterExecutableTasks(board);
    assert.equal(exec.length, 2);
    assert.equal(exec[0].issueNumber, 1);
    assert.equal(exec[1].issueNumber, 7);
  });

  it('excludes tasks with linked PRs', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'a' },
        { issue: 2, state: 'ready', conflictGroup: 'b', linkedPR: 50 },
      ],
    };
    const exec = filterExecutableTasks(board);
    assert.equal(exec.length, 1);
    assert.equal(exec[0].issueNumber, 1);
  });

  it('defaults conflictGroup to general', () => {
    const board = {
      tasks: [{ issue: 1, state: 'ready' }],
    };
    const exec = filterExecutableTasks(board);
    assert.equal(exec[0].conflictGroup, 'general');
  });
});

// ── Wave planning ────────────────────────────────────────────────────────────

describe('planWaves', () => {
  it('returns empty for empty tasks', () => {
    assert.deepEqual(planWaves([], 5), []);
  });

  it('returns empty for zero parallelism', () => {
    assert.deepEqual(planWaves([{ issueNumber: 1, conflictGroup: 'a', risk: 'low' }], 0), []);
  });

  it('puts non-conflicting tasks in one wave', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'auth', risk: 'low', state: 'ready' },
      { issueNumber: 2, conflictGroup: 'docs', risk: 'low', state: 'ready' },
      { issueNumber: 3, conflictGroup: 'test', risk: 'low', state: 'ready' },
    ];
    const waves = planWaves(tasks, 10);
    assert.equal(waves.length, 1);
    assert.equal(waves[0].tasks.length, 3);
    assert.equal(waves[0].isSoloWave, false);
  });

  it('splits conflicting tasks across waves', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'auth', risk: 'low', state: 'ready' },
      { issueNumber: 2, conflictGroup: 'auth', risk: 'low', state: 'ready' },
      { issueNumber: 3, conflictGroup: 'docs', risk: 'low', state: 'ready' },
    ];
    const waves = planWaves(tasks, 10);
    assert.equal(waves.length, 2);
    assert.equal(waves[0].tasks.length, 2);
    assert.equal(waves[1].tasks.length, 1);
  });

  it('forces high-risk tasks into solo waves', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'auth', risk: 'high', state: 'ready' },
      { issueNumber: 2, conflictGroup: 'docs', risk: 'low', state: 'ready' },
    ];
    const waves = planWaves(tasks, 10);
    assert.equal(waves.length, 2);
    assert.equal(waves[0].isSoloWave, true);
    assert.equal(waves[0].tasks[0].risk, 'high');
    assert.equal(waves[1].isSoloWave, false);
  });

  it('respects parallelism cap', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'a', risk: 'low', state: 'ready' },
      { issueNumber: 2, conflictGroup: 'b', risk: 'low', state: 'ready' },
      { issueNumber: 3, conflictGroup: 'c', risk: 'low', state: 'ready' },
      { issueNumber: 4, conflictGroup: 'd', risk: 'low', state: 'ready' },
    ];
    const waves = planWaves(tasks, 2);
    assert.equal(waves.length, 2);
    assert.equal(waves[0].tasks.length, 2);
    assert.equal(waves[1].tasks.length, 2);
  });

  it('handles multiple high-risk tasks', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'a', risk: 'high', state: 'ready' },
      { issueNumber: 2, conflictGroup: 'b', risk: 'high', state: 'ready' },
      { issueNumber: 3, conflictGroup: 'c', risk: 'low', state: 'ready' },
    ];
    const waves = planWaves(tasks, 10);
    assert.equal(waves.length, 3);
    assert.equal(waves[0].isSoloWave, true);
    assert.equal(waves[1].isSoloWave, true);
    assert.equal(waves[2].isSoloWave, false);
  });

  it('handles mix of conflicting and non-conflicting', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'auth', risk: 'low', state: 'ready' },
      { issueNumber: 2, conflictGroup: 'auth', risk: 'low', state: 'ready' },
      { issueNumber: 3, conflictGroup: 'docs', risk: 'low', state: 'ready' },
      { issueNumber: 4, conflictGroup: 'test', risk: 'low', state: 'ready' },
    ];
    const waves = planWaves(tasks, 10);
    // auth-1 and docs and test can go in wave 0, auth-2 goes to wave 1
    assert.equal(waves.length, 2);
    assert.equal(waves[0].tasks.length, 3);
    assert.equal(waves[1].tasks.length, 1);
  });
});

// ── Limiting factor identification ───────────────────────────────────────────

describe('identifyLimitingFactor', () => {
  it('identifies requestedParallelism as limit', () => {
    const result = identifyLimitingFactor({
      requestedParallelism: 5,
      providerSlots: 10,
      resourceSlots: 10,
      conflictSafeSlots: 10,
      riskSafeSlots: 10,
      reviewCapacity: 10,
      mergeCapacity: 10,
      failureBudget: 10,
    }, 5);
    assert.equal(result, 'requestedParallelism');
  });

  it('identifies providerSlots as limit', () => {
    const result = identifyLimitingFactor({
      requestedParallelism: 30,
      providerSlots: 3,
      resourceSlots: 12,
      conflictSafeSlots: 10,
      riskSafeSlots: 30,
      reviewCapacity: 5,
      mergeCapacity: 5,
      failureBudget: 3,
    }, 3);
    assert.equal(result, 'providerSlots');
  });

  it('identifies failureBudget as limit', () => {
    const result = identifyLimitingFactor({
      requestedParallelism: 30,
      providerSlots: 30,
      resourceSlots: 30,
      conflictSafeSlots: 30,
      riskSafeSlots: 30,
      reviewCapacity: 30,
      mergeCapacity: 30,
      failureBudget: 3,
    }, 3);
    assert.equal(result, 'failureBudget');
  });
});

// ── Full plan integration ────────────────────────────────────────────────────

describe('planConcurrencyBackfill — integration', () => {
  it('produces a complete plan with mixed inputs', () => {
    const plan = planConcurrencyBackfill({
      taskBoard: {
        tasks: [
          { issue: 1, state: 'ready', conflictGroup: 'auth' },
          { issue: 2, state: 'ready', conflictGroup: 'auth' },
          { issue: 3, state: 'ready', conflictGroup: 'docs' },
          { issue: 4, state: 'todo', conflictGroup: 'test' },
          { issue: 5, state: 'running', conflictGroup: 'ai' },
        ],
      },
      providerPool: {
        providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 30 }],
      },
      localResource: { process: { maxAllowed: 12 } },
      activeWorkers: { workers: [{ status: 'running', issueNumber: 5 }] },
      riskSignals: { signals: [] },
    }, 30);

    assert.equal(plan.schemaVersion, 1);
    assert.equal(typeof plan.capturedAt, 'string');
    assert.equal(plan.requestedParallelism, 30);
    assert.ok(plan.effectiveParallelism >= 1);
    assert.ok(plan.effectiveParallelism <= 30);
    assert.equal(plan.executableTaskCount, 4);
    assert.equal(plan.activeWorkerCount, 1);
    assert.ok(Array.isArray(plan.waves));
    assert.ok(plan.waves.length > 0);
    assert.equal(typeof plan.limitingFactor, 'string');
    assert.equal(plan.summary.totalPlannedTasks, 4);
    assert.equal(plan.summary.effectiveParallelism, plan.effectiveParallelism);
  });

  it('handles null inputs gracefully', () => {
    const plan = planConcurrencyBackfill({
      taskBoard: null,
      providerPool: null,
      localResource: null,
      activeWorkers: null,
      riskSignals: null,
    }, 10);

    assert.equal(plan.effectiveParallelism, 1);
    assert.equal(plan.waves.length, 0);
    assert.equal(plan.summary.totalPlannedTasks, 0);
  });

  it('handles exhausted providers', () => {
    const plan = planConcurrencyBackfill({
      taskBoard: { tasks: [{ issue: 1, state: 'ready', conflictGroup: 'a' }] },
      providerPool: { providers: [{ id: 'p1', status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 }] },
      localResource: { process: { maxAllowed: 12 } },
      activeWorkers: { workers: [] },
      riskSignals: { signals: [] },
    }, 10);

    assert.equal(plan.effectiveParallelism, 1);
  });

  it('produces correct plan shape', () => {
    const plan = planConcurrencyBackfill({
      taskBoard: { tasks: [{ issue: 1, state: 'ready', conflictGroup: 'a' }] },
      providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 }] },
      localResource: { process: { maxAllowed: 4 } },
      activeWorkers: { workers: [] },
      riskSignals: { signals: [] },
    }, 10);

    const requiredKeys = [
      'schemaVersion', 'capturedAt', 'requestedParallelism',
      'effectiveParallelism', 'limitingFactor', 'capacityInputs',
      'executableTaskCount', 'activeWorkerCount', 'waves', 'summary',
    ];
    for (const key of requiredKeys) {
      assert.ok(key in plan, `key ${key} present`);
    }
  });

  it('handles high-risk tasks in plan', () => {
    const plan = planConcurrencyBackfill({
      taskBoard: {
        tasks: [
          { issue: 1, state: 'ready', conflictGroup: 'a', risk: 'high' },
          { issue: 2, state: 'ready', conflictGroup: 'b', risk: 'low' },
        ],
      },
      providerPool: { providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 }] },
      localResource: { process: { maxAllowed: 4 } },
      activeWorkers: { workers: [] },
      riskSignals: { signals: [] },
    }, 10);

    assert.equal(plan.summary.soloWaves, 1);
    assert.equal(plan.summary.totalWaves, 2);
  });
});

// ── CLI tests ────────────────────────────────────────────────────────────────

describe('CLI — help flag', () => {
  it('prints help and exits 0 with --help', () => {
    const res = run(['--help']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /USAGE/);
    assert.match(res.stdout, /--fixture/);
    assert.match(res.stdout, /--requested/);
  });
});

describe('CLI — validation errors', () => {
  it('rejects unknown arguments', () => {
    const res = run(['--unknown-flag']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Unknown argument/);
  });

  it('rejects --requested without value', () => {
    const res = run(['--requested']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--requested requires a number/);
  });

  it('rejects --requested with non-number', () => {
    const res = run(['--requested', 'abc']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--requested must be >= 1/);
  });

  it('rejects --requested with zero', () => {
    const res = run(['--requested', '0']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--requested must be >= 1/);
  });

  it('rejects nonexistent fixture file', () => {
    const res = run(['--fixture', '/nonexistent/path.json']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Could not read fixture/);
  });
});

describe('CLI — stdout output', () => {
  it('reads from state files and prints JSON to stdout', () => {
    const res = run(['--stdout']);
    assert.equal(res.exitCode, 0);
    const output = JSON.parse(res.stdout);
    assert.equal(output.schemaVersion, 1);
    assert.ok(typeof output.effectiveParallelism === 'number');
    assert.ok(Array.isArray(output.waves));
  });
});

describe('CLI — fixture input', () => {
  it('reads from fixture file', () => {
    const fixture = {
      taskBoard: {
        tasks: [
          { issue: 1, state: 'ready', conflictGroup: 'auth' },
          { issue: 2, state: 'ready', conflictGroup: 'docs' },
        ],
      },
      providerPool: {
        providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 5 }],
      },
      localResource: { process: { maxAllowed: 4 } },
      activeWorkers: { workers: [] },
      riskSignals: { signals: [] },
    };
    const p = writeTmpFixture(fixture);
    try {
      const res = run(['--fixture', p, '--stdout']);
      assert.equal(res.exitCode, 0);
      const output = JSON.parse(res.stdout);
      assert.equal(output.executableTaskCount, 2);
      assert.equal(output.summary.totalPlannedTasks, 2);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('respects --requested flag', () => {
    const fixture = {
      taskBoard: {
        tasks: Array.from({ length: 20 }, (_, i) => ({
          issue: i + 1, state: 'ready', conflictGroup: `group-${i}`,
        })),
      },
      providerPool: {
        providers: [{ id: 'p1', status: 'available', currentConcurrency: 0, maxConcurrency: 30 }],
      },
      localResource: { process: { maxAllowed: 30 } },
      activeWorkers: { workers: [] },
      riskSignals: { signals: [] },
    };
    const p = writeTmpFixture(fixture);
    try {
      const res = run(['--fixture', p, '--stdout', '--requested', '5']);
      assert.equal(res.exitCode, 0);
      const output = JSON.parse(res.stdout);
      assert.equal(output.requestedParallelism, 5);
      assert.ok(output.effectiveParallelism <= 5);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('CLI — self-test flag', () => {
  it('runs self-test and exits 0', () => {
    const res = run(['--self-test']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /self-test/);
    assert.match(res.stdout, /All self-tests passed/);
  });
});
