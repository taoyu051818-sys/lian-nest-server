#!/usr/bin/env node

/**
 * top-up-self-cycle-queue.test.js
 *
 * Focused self-tests for top-up-self-cycle-queue.js covering:
 *   - Active worker counting
 *   - Ready task counting
 *   - Provider capacity extraction
 *   - Held lock counting
 *   - Conflict group extraction (active + locked)
 *   - Health gate checking
 *   - Risk level extraction
 *   - Eligible task selection (state, conflict, lock, risk filtering)
 *   - Conflict group deduplication
 *   - Full top-up plan computation (normal, blocked, at-capacity, conflict)
 *   - CLI help flag
 *   - CLI validation errors
 *   - CLI stdout output
 *   - CLI fixture input
 *   - CLI self-test flag
 *
 * Run:  node scripts/ai/top-up-self-cycle-queue.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, 'top-up-self-cycle-queue.js');

const {
  countActiveWorkers,
  countReadyTasks,
  extractProviderCapacity,
  countHeldLocks,
  extractActiveConflictGroups,
  extractLockedGroups,
  isHealthOk,
  extractRiskLevel,
  selectEligibleTasks,
  deduplicateByConflictGroup,
  computeTopUpPlan,
  DEFAULTS,
} = require('./top-up-self-cycle-queue.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
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
  return path.join(os.tmpdir(), `topup-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

function writeTmpFixture(fixture) {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify(fixture), 'utf8');
  return p;
}

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

// ── Ready task counting ─────────────────────────────────────────────────────

describe('countReadyTasks', () => {
  it('returns 0 for null input', () => {
    assert.equal(countReadyTasks(null), 0);
  });

  it('returns 0 for empty tasks', () => {
    assert.equal(countReadyTasks({ tasks: [] }), 0);
  });

  it('counts only ready tasks', () => {
    const board = {
      tasks: [
        { state: 'ready' },
        { state: 'ready' },
        { state: 'todo' },
        { state: 'running' },
      ],
    };
    assert.equal(countReadyTasks(board), 2);
  });
});

// ── Provider capacity extraction ─────────────────────────────────────────────

describe('extractProviderCapacity', () => {
  it('returns 0 for null pool', () => {
    assert.equal(extractProviderCapacity(null), 0);
  });

  it('returns 0 for empty providers', () => {
    assert.equal(extractProviderCapacity({ providers: [] }), 0);
  });

  it('sums available capacity across providers', () => {
    const pool = {
      providers: [
        { status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
        { status: 'available', currentConcurrency: 3, maxConcurrency: 5 },
      ],
    };
    assert.equal(extractProviderCapacity(pool), 7);
  });

  it('excludes exhausted providers', () => {
    const pool = {
      providers: [
        { status: 'available', currentConcurrency: 0, maxConcurrency: 5 },
        { status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 },
      ],
    };
    assert.equal(extractProviderCapacity(pool), 5);
  });

  it('returns 0 when all at capacity', () => {
    const pool = {
      providers: [
        { status: 'available', currentConcurrency: 5, maxConcurrency: 5 },
      ],
    };
    assert.equal(extractProviderCapacity(pool), 0);
  });
});

// ── Held lock counting ───────────────────────────────────────────────────────

describe('countHeldLocks', () => {
  it('returns 0 for null input', () => {
    assert.equal(countHeldLocks(null), 0);
  });

  it('returns 0 for empty locks', () => {
    assert.equal(countHeldLocks({ locks: [] }), 0);
  });

  it('counts only held locks', () => {
    const locks = {
      locks: [
        { status: 'held' },
        { status: 'released' },
        { status: 'held' },
      ],
    };
    assert.equal(countHeldLocks(locks), 2);
  });
});

// ── Active conflict groups ───────────────────────────────────────────────────

describe('extractActiveConflictGroups', () => {
  it('returns empty set for null input', () => {
    assert.equal(extractActiveConflictGroups(null).size, 0);
  });

  it('extracts groups from running and planned workers only', () => {
    const aw = {
      workers: [
        { status: 'running', conflictGroup: 'auth' },
        { status: 'planned', conflictGroup: 'docs' },
        { status: 'completed', conflictGroup: 'test' },
      ],
    };
    const groups = extractActiveConflictGroups(aw);
    assert.equal(groups.size, 2);
    assert.ok(groups.has('auth'));
    assert.ok(groups.has('docs'));
    assert.ok(!groups.has('test'));
  });
});

// ── Locked conflict groups ───────────────────────────────────────────────────

describe('extractLockedGroups', () => {
  it('returns empty set for null input', () => {
    assert.equal(extractLockedGroups(null).size, 0);
  });

  it('extracts groups from held locks only', () => {
    const locks = {
      locks: [
        { status: 'held', conflictGroup: 'auth' },
        { status: 'released', conflictGroup: 'docs' },
      ],
    };
    const groups = extractLockedGroups(locks);
    assert.equal(groups.size, 1);
    assert.ok(groups.has('auth'));
  });
});

// ── Health gate ──────────────────────────────────────────────────────────────

describe('isHealthOk', () => {
  it('returns true for null health', () => {
    assert.equal(isHealthOk(null), true);
  });

  it('returns true for green', () => {
    assert.equal(isHealthOk({ status: 'green' }), true);
  });

  it('returns true for yellow', () => {
    assert.equal(isHealthOk({ status: 'yellow' }), true);
  });

  it('returns false for red', () => {
    assert.equal(isHealthOk({ status: 'red' }), false);
  });

  it('returns false for black', () => {
    assert.equal(isHealthOk({ status: 'black' }), false);
  });
});

// ── Risk level extraction ────────────────────────────────────────────────────

describe('extractRiskLevel', () => {
  it('returns low for null input', () => {
    assert.equal(extractRiskLevel(null), 'low');
  });

  it('returns low for empty signals', () => {
    assert.equal(extractRiskLevel({ signals: [] }), 'low');
  });

  it('returns high for high severity', () => {
    assert.equal(extractRiskLevel({ signals: [{ severity: 'high' }] }), 'high');
  });

  it('returns high for critical severity', () => {
    assert.equal(extractRiskLevel({ signals: [{ severity: 'critical' }] }), 'high');
  });

  it('returns medium for medium severity', () => {
    assert.equal(extractRiskLevel({ signals: [{ severity: 'medium' }] }), 'medium');
  });

  it('returns low for low severity only', () => {
    assert.equal(extractRiskLevel({ signals: [{ severity: 'low' }] }), 'low');
  });
});

// ── Eligible task selection ──────────────────────────────────────────────────

describe('selectEligibleTasks', () => {
  it('returns empty for null board', () => {
    assert.deepEqual(selectEligibleTasks(null, new Set(), new Set()), []);
  });

  it('filters by state (only ready/todo)', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'a', risk: 'low' },
        { issue: 2, state: 'todo', conflictGroup: 'b', risk: 'low' },
        { issue: 3, state: 'running', conflictGroup: 'c', risk: 'low' },
        { issue: 4, state: 'done', conflictGroup: 'd', risk: 'low' },
      ],
    };
    const result = selectEligibleTasks(board, new Set(), new Set());
    assert.equal(result.length, 2);
    assert.equal(result[0].issueNumber, 1);
    assert.equal(result[1].issueNumber, 2);
  });

  it('excludes tasks with linked PRs', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'a', risk: 'low' },
        { issue: 2, state: 'ready', conflictGroup: 'b', risk: 'low', linkedPR: 50 },
      ],
    };
    const result = selectEligibleTasks(board, new Set(), new Set());
    assert.equal(result.length, 1);
  });

  it('excludes tasks conflicting with active workers', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'auth', risk: 'low' },
        { issue: 2, state: 'ready', conflictGroup: 'docs', risk: 'low' },
      ],
    };
    const result = selectEligibleTasks(board, new Set(['auth']), new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].conflictGroup, 'docs');
  });

  it('excludes tasks conflicting with held locks', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'locked', risk: 'low' },
        { issue: 2, state: 'ready', conflictGroup: 'free', risk: 'low' },
      ],
    };
    const result = selectEligibleTasks(board, new Set(), new Set(['locked']));
    assert.equal(result.length, 1);
    assert.equal(result[0].conflictGroup, 'free');
  });

  it('excludes high-risk tasks', () => {
    const board = {
      tasks: [
        { issue: 1, state: 'ready', conflictGroup: 'a', risk: 'high' },
        { issue: 2, state: 'ready', conflictGroup: 'b', risk: 'low' },
      ],
    };
    const result = selectEligibleTasks(board, new Set(), new Set());
    assert.equal(result.length, 1);
    assert.equal(result[0].issueNumber, 2);
  });

  it('defaults conflictGroup to general', () => {
    const board = {
      tasks: [{ issue: 1, state: 'ready', risk: 'low' }],
    };
    const result = selectEligibleTasks(board, new Set(), new Set());
    assert.equal(result[0].conflictGroup, 'general');
  });
});

// ── Conflict group deduplication ─────────────────────────────────────────────

describe('deduplicateByConflictGroup', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(deduplicateByConflictGroup([]), []);
  });

  it('keeps first task per conflict group', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'auth' },
      { issueNumber: 2, conflictGroup: 'auth' },
      { issueNumber: 3, conflictGroup: 'docs' },
    ];
    const result = deduplicateByConflictGroup(tasks);
    assert.equal(result.length, 2);
    assert.equal(result[0].issueNumber, 1);
    assert.equal(result[1].issueNumber, 3);
  });

  it('keeps all when no duplicates', () => {
    const tasks = [
      { issueNumber: 1, conflictGroup: 'auth' },
      { issueNumber: 2, conflictGroup: 'docs' },
    ];
    assert.equal(deduplicateByConflictGroup(tasks).length, 2);
  });
});

// ── Full top-up plan computation ─────────────────────────────────────────────

describe('computeTopUpPlan — integration', () => {
  it('produces a complete plan with normal inputs', () => {
    const plan = computeTopUpPlan({
      activeWorkers: {
        workers: [
          { status: 'running', conflictGroup: 'a' },
          { status: 'running', conflictGroup: 'b' },
        ],
      },
      taskBoard: {
        tasks: [
          { issue: 10, state: 'ready', conflictGroup: 'c', risk: 'low' },
          { issue: 11, state: 'ready', conflictGroup: 'd', risk: 'low' },
          { issue: 12, state: 'ready', conflictGroup: 'e', risk: 'low' },
        ],
      },
      providerPool: {
        providers: [{ status: 'available', currentConcurrency: 2, maxConcurrency: 30 }],
      },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.schemaVersion, 1);
    assert.equal(typeof plan.capturedAt, 'string');
    assert.equal(plan.targetConcurrency, 30);
    assert.equal(plan.activeWorkerCount, 2);
    assert.equal(plan.deficit, 28);
    assert.equal(plan.selectedTaskCount, 3);
    assert.equal(plan.recommendation, 'immediate');
    assert.equal(plan.blockers.length, 0);
  });

  it('blocks dispatch when health is red', () => {
    const plan = computeTopUpPlan({
      activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
      taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'b', risk: 'low' }] },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'red' },
    }, 30);

    assert.equal(plan.recommendation, 'hold');
    assert.equal(plan.blockers.length, 1);
    assert.equal(plan.blockers[0].type, 'health-gate');
    assert.equal(plan.selectedTaskCount, 0);
  });

  it('blocks dispatch when risk is high', () => {
    const plan = computeTopUpPlan({
      activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
      taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'b', risk: 'low' }] },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
      riskSignals: { signals: [{ severity: 'high' }] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.recommendation, 'hold');
    assert.ok(plan.blockers.some(b => b.type === 'risk-gate'));
  });

  it('blocks dispatch when provider exhausted', () => {
    const plan = computeTopUpPlan({
      activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
      taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'b', risk: 'low' }] },
      providerPool: { providers: [{ status: 'exhausted', currentConcurrency: 5, maxConcurrency: 5 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.recommendation, 'hold');
    assert.ok(plan.blockers.some(b => b.type === 'provider-exhausted'));
  });

  it('holds when at target concurrency', () => {
    const plan = computeTopUpPlan({
      activeWorkers: {
        workers: Array.from({ length: 30 }, () => ({ status: 'running', conflictGroup: 'x' })),
      },
      taskBoard: { tasks: [{ issue: 10, state: 'ready', conflictGroup: 'y', risk: 'low' }] },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 30, maxConcurrency: 30 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.deficit, 0);
    assert.equal(plan.recommendation, 'hold');
    assert.equal(plan.selectedTaskCount, 0);
  });

  it('filters tasks conflicting with active workers', () => {
    const plan = computeTopUpPlan({
      activeWorkers: { workers: [{ status: 'running', conflictGroup: 'auth' }] },
      taskBoard: {
        tasks: [
          { issue: 10, state: 'ready', conflictGroup: 'auth', risk: 'low' },
          { issue: 11, state: 'ready', conflictGroup: 'docs', risk: 'low' },
        ],
      },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.selectedTaskCount, 1);
    assert.equal(plan.selectedTasks[0].issueNumber, 11);
  });

  it('filters tasks conflicting with held locks', () => {
    const plan = computeTopUpPlan({
      activeWorkers: { workers: [{ status: 'running', conflictGroup: 'a' }] },
      taskBoard: {
        tasks: [
          { issue: 10, state: 'ready', conflictGroup: 'locked', risk: 'low' },
          { issue: 11, state: 'ready', conflictGroup: 'free', risk: 'low' },
        ],
      },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [{ status: 'held', conflictGroup: 'locked' }] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.selectedTaskCount, 1);
    assert.equal(plan.selectedTasks[0].conflictGroup, 'free');
  });

  it('returns next-tick recommendation near target', () => {
    const plan = computeTopUpPlan({
      activeWorkers: {
        workers: Array.from({ length: 27 }, (_, i) => ({ status: 'running', conflictGroup: `g${i}` })),
      },
      taskBoard: {
        tasks: [{ issue: 100, state: 'ready', conflictGroup: 'new', risk: 'low' }],
      },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 27, maxConcurrency: 30 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    assert.equal(plan.recommendation, 'next-tick');
    assert.equal(plan.selectedTaskCount, 1);
  });

  it('handles null inputs gracefully', () => {
    const plan = computeTopUpPlan({
      activeWorkers: null,
      taskBoard: null,
      providerPool: null,
      riskSignals: null,
      launchLocks: null,
      mainHealth: null,
    }, 30);

    assert.equal(plan.activeWorkerCount, 0);
    assert.equal(plan.readyCount, 0);
    assert.equal(plan.deficit, 30);
    assert.equal(plan.selectedTaskCount, 0);
    assert.ok(plan.blockers.some(b => b.type === 'provider-exhausted'), 'null pool triggers provider blocker');
  });

  it('produces correct plan shape', () => {
    const plan = computeTopUpPlan({
      activeWorkers: { workers: [] },
      taskBoard: { tasks: [{ issue: 1, state: 'ready', conflictGroup: 'a', risk: 'low' }] },
      providerPool: { providers: [{ status: 'available', currentConcurrency: 0, maxConcurrency: 5 }] },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    }, 30);

    const requiredKeys = [
      'schemaVersion', 'capturedAt', 'targetConcurrency', 'activeWorkerCount',
      'readyCount', 'deficit', 'providerCapacity', 'heldLocks', 'healthOk',
      'riskLevel', 'batchSize', 'blockers', 'eligibleTaskCount',
      'selectedTaskCount', 'selectedTasks', 'recommendation', 'summary',
    ];
    for (const key of requiredKeys) {
      assert.ok(key in plan, `key ${key} present`);
    }
  });
});

// ── CLI tests ────────────────────────────────────────────────────────────────

describe('CLI — help flag', () => {
  it('prints help and exits 0 with --help', () => {
    const res = run(['--help']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /USAGE/);
    assert.match(res.stdout, /--fixture/);
    assert.match(res.stdout, /--target/);
  });
});

describe('CLI — validation errors', () => {
  it('rejects unknown arguments', () => {
    const res = run(['--unknown-flag']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Unknown argument/);
  });

  it('rejects --target without value', () => {
    const res = run(['--target']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--target requires a number/);
  });

  it('rejects --target with non-number', () => {
    const res = run(['--target', 'abc']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--target must be >= 1/);
  });

  it('rejects --target with zero', () => {
    const res = run(['--target', '0']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--target must be >= 1/);
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
    assert.ok(typeof output.activeWorkerCount === 'number');
    assert.ok(typeof output.deficit === 'number');
    assert.ok(Array.isArray(output.selectedTasks));
  });
});

describe('CLI — fixture input', () => {
  it('reads from fixture file', () => {
    const fixture = {
      activeWorkers: {
        workers: [{ status: 'running', conflictGroup: 'a' }],
      },
      taskBoard: {
        tasks: [
          { issue: 10, state: 'ready', conflictGroup: 'b', risk: 'low' },
          { issue: 11, state: 'ready', conflictGroup: 'c', risk: 'low' },
        ],
      },
      providerPool: {
        providers: [{ status: 'available', currentConcurrency: 1, maxConcurrency: 30 }],
      },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    };
    const p = writeTmpFixture(fixture);
    try {
      const res = run(['--fixture', p, '--stdout']);
      assert.equal(res.exitCode, 0);
      const output = JSON.parse(res.stdout);
      assert.equal(output.activeWorkerCount, 1);
      assert.equal(output.selectedTaskCount, 2);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('respects --target flag', () => {
    const fixture = {
      activeWorkers: { workers: [] },
      taskBoard: {
        tasks: Array.from({ length: 20 }, (_, i) => ({
          issue: i + 1, state: 'ready', conflictGroup: `group-${i}`, risk: 'low',
        })),
      },
      providerPool: {
        providers: [{ status: 'available', currentConcurrency: 0, maxConcurrency: 30 }],
      },
      riskSignals: { signals: [] },
      launchLocks: { locks: [] },
      mainHealth: { status: 'green' },
    };
    const p = writeTmpFixture(fixture);
    try {
      const res = run(['--fixture', p, '--stdout', '--target', '5']);
      assert.equal(res.exitCode, 0);
      const output = JSON.parse(res.stdout);
      assert.equal(output.targetConcurrency, 5);
      assert.equal(output.deficit, 5);
      assert.ok(output.selectedTaskCount <= 5);
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
