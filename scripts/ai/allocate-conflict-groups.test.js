#!/usr/bin/env node

/**
 * allocate-conflict-groups.test.js
 *
 * Focused self-tests for allocate-conflict-groups.js covering:
 *   - Route segment extraction
 *   - Route overlap detection
 *   - Shared lock detection
 *   - Conflict group allocation for independent tasks
 *   - Conflict group allocation for overlapping tasks
 *   - Mixed independent and overlapping tasks
 *   - Shared lock assignment
 *   - Empty and single-task inputs
 *   - CLI dry-run output
 *   - CLI help flag
 *   - CLI validation errors
 *
 * Run:  node scripts/ai/allocate-conflict-groups.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ALLOCATOR = path.resolve(__dirname, 'allocate-conflict-groups.js');

const {
  extractRouteSegments,
  routesOverlap,
  claimsLock,
  detectSharedLocks,
  buildGroupName,
  allocateConflictGroups,
  SHARED_LOCKS,
} = require('./allocate-conflict-groups.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [ALLOCATOR, ...args], {
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
  return path.join(os.tmpdir(), `conflict-group-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

function writeTmpInput(tasks) {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ tasks }), 'utf8');
  return p;
}

// ── Route segment extraction ─────────────────────────────────────────────────

describe('extractRouteSegments', () => {
  it('extracts meaningful segments from src paths', () => {
    const routes = extractRouteSegments(['src/modules/auth/auth.service.ts']);
    assert.ok(routes.has('auth'));
    assert.ok(!routes.has('modules'), 'intermediate dirs like modules should be skipped');
  });

  it('extracts segments from scripts paths', () => {
    const routes = extractRouteSegments(['scripts/ai/allocate-conflict-groups.js']);
    assert.ok(routes.has('ai'));
  });

  it('strips file extensions', () => {
    const routes = extractRouteSegments(['src/foo.ts', 'src/bar.js', 'src/baz.md']);
    assert.ok(routes.has('foo'));
    assert.ok(routes.has('bar'));
    assert.ok(routes.has('baz'));
  });

  it('skips broad patterns', () => {
    const routes = extractRouteSegments(['**', 'src/**', 'docs/**']);
    assert.equal(routes.size, 0);
  });

  it('handles glob patterns', () => {
    const routes = extractRouteSegments(['src/modules/auth/**']);
    assert.ok(routes.has('auth'));
    assert.ok(!routes.has('modules'), 'intermediate dirs are skipped');
  });

  it('returns empty set for empty input', () => {
    const routes = extractRouteSegments([]);
    assert.equal(routes.size, 0);
  });
});

// ── Route overlap ────────────────────────────────────────────────────────────

describe('routesOverlap', () => {
  it('returns true when routes share a segment', () => {
    const a = new Set(['auth', 'modules']);
    const b = new Set(['auth', 'users']);
    assert.equal(routesOverlap(a, b), true);
  });

  it('returns false when routes are disjoint', () => {
    const a = new Set(['auth']);
    const b = new Set(['posts']);
    assert.equal(routesOverlap(a, b), false);
  });

  it('returns false for empty sets', () => {
    assert.equal(routesOverlap(new Set(), new Set(['auth'])), false);
    assert.equal(routesOverlap(new Set(['auth']), new Set()), false);
  });
});

// ── Shared lock detection ────────────────────────────────────────────────────

describe('claimsLock', () => {
  it('detects exact package.json lock', () => {
    assert.equal(claimsLock(['package.json'], SHARED_LOCKS['package']), true);
  });

  it('detects exact package-lock.json lock', () => {
    assert.equal(claimsLock(['package-lock.json'], SHARED_LOCKS['package']), true);
  });

  it('detects prisma/** lock', () => {
    assert.equal(claimsLock(['prisma/schema.prisma'], SHARED_LOCKS['prisma-schema']), true);
    assert.equal(claimsLock(['prisma/**'], SHARED_LOCKS['prisma-schema']), true);
  });

  it('detects app-module lock', () => {
    assert.equal(claimsLock(['src/app.module.ts'], SHARED_LOCKS['app-module']), true);
  });

  it('detects docs-index lock', () => {
    assert.equal(claimsLock(['docs/foo.md'], SHARED_LOCKS['docs-index']), true);
    assert.equal(claimsLock(['docs/**/*.md'], SHARED_LOCKS['docs-index']), true);
  });

  it('returns false for unrelated patterns', () => {
    assert.equal(claimsLock(['src/modules/auth/**'], SHARED_LOCKS['package']), false);
    assert.equal(claimsLock(['scripts/ai/foo.js'], SHARED_LOCKS['app-module']), false);
  });
});

describe('detectSharedLocks', () => {
  it('returns empty array when no locks claimed', () => {
    const locks = detectSharedLocks(['src/modules/auth/**']);
    assert.deepEqual(locks, []);
  });

  it('returns single lock', () => {
    const locks = detectSharedLocks(['src/app.module.ts']);
    assert.deepEqual(locks, ['app-module']);
  });

  it('returns multiple locks sorted', () => {
    const locks = detectSharedLocks(['package.json', 'prisma/schema.prisma', 'src/app.module.ts']);
    assert.deepEqual(locks, ['app-module', 'package', 'prisma-schema']);
  });

  it('handles docs-only tasks', () => {
    const locks = detectSharedLocks(['docs/**/*.md']);
    assert.deepEqual(locks, ['docs-index']);
  });
});

// ── Group name building ──────────────────────────────────────────────────────

describe('buildGroupName', () => {
  it('uses route segments for group name', () => {
    const name = buildGroupName({ id: 'test-1', allowedFiles: ['src/modules/auth/**'] });
    assert.equal(name, 'auth');
  });

  it('falls back to generic-id for no routes', () => {
    const name = buildGroupName({ id: 'test-1', allowedFiles: ['**'] });
    assert.equal(name, 'generic-test-1');
  });
});

// ── Core allocation: independent tasks ───────────────────────────────────────

describe('allocateConflictGroups — independent tasks', () => {
  it('assigns different groups to non-overlapping tasks', () => {
    const tasks = [
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
      { id: 'task-b', allowedFiles: ['src/features/posts/**'] },
    ];
    const result = allocateConflictGroups(tasks);

    assert.equal(result.schemaVersion, 1);
    assert.ok(result.capturedAt);
    assert.equal(result.summary.taskCount, 2);
    assert.equal(result.summary.groupCount, 2);

    const a = result.tasks.find(t => t.id === 'task-a');
    const b = result.tasks.find(t => t.id === 'task-b');
    assert.notEqual(a.conflictGroup, b.conflictGroup);
  });

  it('assigns no shared locks when none claimed', () => {
    const tasks = [
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
    ];
    const result = allocateConflictGroups(tasks);
    assert.deepEqual(result.tasks[0].sharedLocks, []);
  });
});

// ── Core allocation: overlapping tasks ───────────────────────────────────────

describe('allocateConflictGroups — overlapping tasks', () => {
  it('assigns same group to tasks with route overlap', () => {
    const tasks = [
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
      { id: 'task-b', allowedFiles: ['src/modules/auth/auth.service.ts'] },
    ];
    const result = allocateConflictGroups(tasks);

    const a = result.tasks.find(t => t.id === 'task-a');
    const b = result.tasks.find(t => t.id === 'task-b');
    assert.equal(a.conflictGroup, b.conflictGroup);
    assert.equal(result.summary.groupCount, 1);
  });

  it('transitively groups overlapping tasks', () => {
    // A overlaps B, B overlaps C, but A does not overlap C
    const tasks = [
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
      { id: 'task-b', allowedFiles: ['src/modules/auth/auth.service.ts', 'src/modules/users/**'] },
      { id: 'task-c', allowedFiles: ['src/modules/users/users.service.ts'] },
    ];
    const result = allocateConflictGroups(tasks);

    const groups = new Set(result.tasks.map(t => t.conflictGroup));
    assert.equal(groups.size, 1, 'all three tasks should be in the same group');
  });
});

// ── Core allocation: mixed tasks ─────────────────────────────────────────────

describe('allocateConflictGroups — mixed independent and overlapping', () => {
  it('creates correct groups for a realistic batch', () => {
    const tasks = [
      { id: 'auth-1', allowedFiles: ['src/modules/auth/**'] },
      { id: 'auth-2', allowedFiles: ['src/modules/auth/auth.guard.ts'] },
      { id: 'posts-1', allowedFiles: ['src/features/posts/**'] },
      { id: 'docs-1', allowedFiles: ['docs/ai-native/overview.md'] },
      { id: 'docs-2', allowedFiles: ['docs/ai-native/foo.md'] },
    ];
    const result = allocateConflictGroups(tasks);

    assert.equal(result.summary.taskCount, 5);

    const auth1 = result.tasks.find(t => t.id === 'auth-1');
    const auth2 = result.tasks.find(t => t.id === 'auth-2');
    const posts1 = result.tasks.find(t => t.id === 'posts-1');
    const docs1 = result.tasks.find(t => t.id === 'docs-1');
    const docs2 = result.tasks.find(t => t.id === 'docs-2');

    // auth tasks share group
    assert.equal(auth1.conflictGroup, auth2.conflictGroup);
    // posts is independent
    assert.notEqual(posts1.conflictGroup, auth1.conflictGroup);
    // docs tasks share group (ai-native segment overlap)
    assert.equal(docs1.conflictGroup, docs2.conflictGroup);
  });
});

// ── Shared lock assignment ───────────────────────────────────────────────────

describe('allocateConflictGroups — shared lock assignment', () => {
  it('assigns app-module lock to AppModule task', () => {
    const tasks = [
      { id: 'wire-search', allowedFiles: ['src/app.module.ts', 'src/modules/search/**'] },
    ];
    const result = allocateConflictGroups(tasks);
    assert.ok(result.tasks[0].sharedLocks.includes('app-module'));
  });

  it('assigns package lock to package task', () => {
    const tasks = [
      { id: 'update-deps', allowedFiles: ['package.json', 'package-lock.json'] },
    ];
    const result = allocateConflictGroups(tasks);
    assert.ok(result.tasks[0].sharedLocks.includes('package'));
  });

  it('assigns multiple locks when applicable', () => {
    const tasks = [
      { id: 'prisma-update', allowedFiles: ['prisma/schema.prisma', 'package.json'] },
    ];
    const result = allocateConflictGroups(tasks);
    const locks = result.tasks[0].sharedLocks;
    assert.ok(locks.includes('prisma-schema'));
    assert.ok(locks.includes('package'));
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('allocateConflictGroups — edge cases', () => {
  it('returns empty result for empty tasks array', () => {
    const result = allocateConflictGroups([]);
    assert.equal(result.summary.taskCount, 0);
    assert.equal(result.summary.groupCount, 0);
    assert.deepEqual(result.tasks, []);
  });

  it('handles single task', () => {
    const tasks = [
      { id: 'solo', allowedFiles: ['src/modules/auth/**'] },
    ];
    const result = allocateConflictGroups(tasks);
    assert.equal(result.summary.taskCount, 1);
    assert.equal(result.summary.groupCount, 1);
    assert.equal(result.tasks[0].conflictGroup, 'auth');
  });

  it('preserves task metadata fields', () => {
    const tasks = [
      {
        id: 'meta-test',
        title: 'Test task',
        allowedFiles: ['src/foo.ts'],
        forbiddenFiles: ['src/**'],
      },
    ];
    const result = allocateConflictGroups(tasks);
    const t = result.tasks[0];
    assert.equal(t.title, 'Test task');
    assert.deepEqual(t.forbiddenFiles, ['src/**']);
    assert.deepEqual(t.allowedFiles, ['src/foo.ts']);
  });

  it('produces stable group names for same input', () => {
    const tasks = [
      { id: 'a', allowedFiles: ['src/modules/auth/**'] },
      { id: 'b', allowedFiles: ['src/modules/posts/**'] },
    ];
    const r1 = allocateConflictGroups(tasks);
    const r2 = allocateConflictGroups(tasks);

    // Same group names on both runs
    const names1 = r1.tasks.map(t => t.conflictGroup).sort();
    const names2 = r2.tasks.map(t => t.conflictGroup).sort();
    assert.deepEqual(names1, names2);
  });

  it('handles broad allowedFiles patterns gracefully', () => {
    const tasks = [
      { id: 'broad', allowedFiles: ['**'] },
    ];
    const result = allocateConflictGroups(tasks);
    assert.equal(result.summary.taskCount, 1);
    assert.ok(result.tasks[0].conflictGroup.startsWith('generic-'));
  });
});

// ── CLI subprocess tests ─────────────────────────────────────────────────────

describe('CLI — help flag', () => {
  it('prints help and exits 0 with --help', () => {
    const res = run(['--help']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /USAGE/);
    assert.match(res.stdout, /--input/);
    assert.match(res.stdout, /--dry-run/);
  });
});

describe('CLI — validation errors', () => {
  it('rejects missing --input', () => {
    const res = run([]);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--input.*is required/);
  });

  it('rejects nonexistent input file', () => {
    const res = run(['--input', '/nonexistent/path.json']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /input file not found/);
  });

  it('rejects invalid JSON', () => {
    const p = tmpFile();
    fs.writeFileSync(p, 'not json', 'utf8');
    try {
      const res = run(['--input', p]);
      assert.equal(res.exitCode, 2);
      assert.match(res.stderr, /not valid JSON/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('rejects input without tasks array', () => {
    const p = tmpFile();
    fs.writeFileSync(p, '{"other": true}', 'utf8');
    try {
      const res = run(['--input', p]);
      assert.equal(res.exitCode, 2);
      assert.match(res.stderr, /"tasks" array/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('rejects task without id', () => {
    const p = writeTmpInput([{ allowedFiles: ['src/foo.ts'] }]);
    try {
      const res = run(['--input', p]);
      assert.equal(res.exitCode, 2);
      assert.match(res.stderr, /missing required "id"/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('rejects task without allowedFiles', () => {
    const p = writeTmpInput([{ id: 'test' }]);
    try {
      const res = run(['--input', p]);
      assert.equal(res.exitCode, 2);
      assert.match(res.stderr, /missing required "allowedFiles"/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('rejects unknown arguments', () => {
    const p = writeTmpInput([{ id: 'test', allowedFiles: ['src/foo.ts'] }]);
    try {
      const res = run(['--input', p, '--unknown-flag']);
      assert.equal(res.exitCode, 2);
      assert.match(res.stderr, /Unknown argument/);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('CLI — dry-run', () => {
  it('prints summary without writing file', () => {
    const p = writeTmpInput([
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
      { id: 'task-b', allowedFiles: ['src/features/posts/**'] },
    ]);
    const outPath = tmpFile();
    try {
      const res = run(['--input', p, '--dry-run', '--out', outPath]);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /\[dry-run\] Conflict group allocation summary:/);
      assert.match(res.stdout, /Tasks: 2/);
      assert.match(res.stdout, /Groups: 2/);
      assert.ok(!fs.existsSync(outPath), 'dry-run must not create output file');
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('CLI — stdout output', () => {
  it('prints JSON to stdout', () => {
    const p = writeTmpInput([
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
    ]);
    try {
      const res = run(['--input', p, '--stdout']);
      assert.equal(res.exitCode, 0);
      const output = JSON.parse(res.stdout);
      assert.equal(output.schemaVersion, 1);
      assert.equal(output.summary.taskCount, 1);
      const group = output.tasks[0].conflictGroup;
      assert.ok(group.includes('auth') || group.includes('modules'), `unexpected group: ${group}`);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('CLI — file output', () => {
  let outPath;

  before(() => {
    outPath = tmpFile();
  });

  after(() => {
    try { fs.unlinkSync(outPath); } catch {}
  });

  it('writes allocation JSON to output file', () => {
    const p = writeTmpInput([
      { id: 'task-a', allowedFiles: ['src/modules/auth/**'] },
      { id: 'task-b', allowedFiles: ['src/modules/posts/**'] },
    ]);
    try {
      const res = run(['--input', p, '--out', outPath]);
      assert.equal(res.exitCode, 0);
      assert.ok(fs.existsSync(outPath), 'output file must be created');

      const content = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.equal(content.schemaVersion, 1);
      assert.equal(content.summary.taskCount, 2);
      assert.equal(content.tasks.length, 2);
    } finally {
      fs.unlinkSync(p);
    }
  });
});
