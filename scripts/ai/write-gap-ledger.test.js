#!/usr/bin/env node

/**
 * write-gap-ledger.test.js
 *
 * Focused self-tests for write-gap-ledger.js covering:
 *   - dry-run output shape
 *   - append entry schema
 *   - required field validation
 *   - optional field passthrough
 *   - severity default
 *   - commit format validation
 *   - meta JSON parsing
 *
 * Run:  node scripts/ai/write-gap-ledger.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WRITER = path.resolve(__dirname, 'write-gap-ledger.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  const argv = ['node', WRITER, ...args];
  try {
    const stdout = execFileSync(process.execPath, [WRITER, ...args], {
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

function tmpFile(ext = '.ndjson') {
  return path.join(os.tmpdir(), `gap-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

// ── Dry-run tests ────────────────────────────────────────────────────────────

describe('dry-run', () => {
  it('prints entry JSON without writing to disk', () => {
    const outPath = tmpFile();
    const res = run([
      '--type', 'worker-failed',
      '--desc', 'exit code 1',
      '--issue', '398',
      '--dry-run',
      '--out', outPath,
    ]);

    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /\[dry-run\] Would append to ledger:/);
    assert.match(res.stdout, /\[dry-run\] Target file:/);
    assert.ok(!fs.existsSync(outPath), 'dry-run must not create the ledger file');
  });

  it('dry-run entry contains valid JSON', () => {
    const res = run([
      '--type', 'plan-drift',
      '--desc', 'task deferred',
      '--severity', 'low',
      '--dry-run',
    ]);

    assert.equal(res.exitCode, 0);
    const lines = res.stdout.trim().split('\n');
    const jsonLine = lines.find((l) => l.startsWith('{'));
    assert.ok(jsonLine, 'dry-run output must contain a JSON line');
    const entry = JSON.parse(jsonLine);
    assert.equal(entry.gapType, 'plan-drift');
    assert.equal(entry.severity, 'low');
    assert.equal(entry.description, 'task deferred');
  });
});

// ── Entry shape tests ────────────────────────────────────────────────────────

describe('append entry shape', () => {
  let outPath;

  before(() => {
    outPath = tmpFile();
  });

  after(() => {
    try { fs.unlinkSync(outPath); } catch {}
  });

  it('appends a valid NDJSON line with required fields', () => {
    const res = run([
      '--type', 'worker-failed',
      '--desc', 'Worker exited code 1, no PR produced',
      '--out', outPath,
    ]);

    assert.equal(res.exitCode, 0);
    assert.ok(fs.existsSync(outPath), 'ledger file must be created');

    const content = fs.readFileSync(outPath, 'utf8').trim();
    const entry = JSON.parse(content);

    assert.equal(entry.entryVersion, 1);
    assert.equal(entry.gapType, 'worker-failed');
    assert.equal(entry.severity, 'medium');
    assert.equal(entry.description, 'Worker exited code 1, no PR produced');
    assert.ok(entry.recordedAt, 'recordedAt must be present');
    assert.ok(!isNaN(Date.parse(entry.recordedAt)), 'recordedAt must be valid ISO 8601');
  });

  it('appends exactly one line per invocation', () => {
    const multiPath = tmpFile();
    try {
      run(['--type', 'worker-stale', '--desc', 'first', '--out', multiPath]);
      run(['--type', 'health-gate-fail', '--desc', 'second', '--out', multiPath]);

      const lines = fs.readFileSync(multiPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2, 'must have exactly 2 lines after 2 invocations');

      const e1 = JSON.parse(lines[0]);
      const e2 = JSON.parse(lines[1]);
      assert.equal(e1.gapType, 'worker-stale');
      assert.equal(e2.gapType, 'health-gate-fail');
    } finally {
      try { fs.unlinkSync(multiPath); } catch {}
    }
  });

  it('includes optional fields when provided', () => {
    const optPath = tmpFile();
    try {
      const res = run([
        '--type', 'launch-blocked',
        '--desc', 'conflict group collision',
        '--issue', '398',
        '--pr', '401',
        '--branch', 'claude/wave11-20260511-123047-issue-398',
        '--commit', 'abc1234def567',
        '--severity', 'high',
        '--meta', '{"conflictGroup":"auth-core"}',
        '--out', optPath,
      ]);

      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(optPath, 'utf8').trim());

      assert.equal(entry.issue, 398);
      assert.equal(entry.pr, 401);
      assert.equal(entry.branch, 'claude/wave11-20260511-123047-issue-398');
      assert.equal(entry.commit, 'abc1234def567');
      assert.equal(entry.severity, 'high');
      assert.deepEqual(entry.meta, { conflictGroup: 'auth-core' });
    } finally {
      try { fs.unlinkSync(optPath); } catch {}
    }
  });

  it('omits optional fields when not provided', () => {
    const minPath = tmpFile();
    try {
      run(['--type', 'stale-row', '--desc', 'row detected stale', '--out', minPath]);
      const entry = JSON.parse(fs.readFileSync(minPath, 'utf8').trim());

      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'issue'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'pr'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'branch'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'commit'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'meta'), false);
    } finally {
      try { fs.unlinkSync(minPath); } catch {}
    }
  });
});

// ── Validation tests ─────────────────────────────────────────────────────────

describe('required field validation', () => {
  it('rejects missing --type', () => {
    const res = run(['--desc', 'some description']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--type is required/);
  });

  it('rejects missing --desc', () => {
    const res = run(['--type', 'worker-failed']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--desc is required/);
  });

  it('rejects invalid gap type', () => {
    const res = run(['--type', 'not-a-type', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--type must be one of:/);
  });

  it('rejects invalid severity', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--severity', 'extreme']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--severity must be one of:/);
  });

  it('rejects non-numeric --issue', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--issue', 'abc']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--issue must be a number/);
  });

  it('rejects non-numeric --pr', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--pr', 'xyz']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--pr must be a number/);
  });

  it('rejects --type without value', () => {
    const res = run(['--type']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--type requires a value/);
  });

  it('rejects --desc without value', () => {
    const res = run(['--desc']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--desc requires a value/);
  });
});

// ── Commit format validation ─────────────────────────────────────────────────

describe('commit format validation', () => {
  it('accepts valid 7-char hex commit', () => {
    const p = tmpFile();
    try {
      const res = run(['--type', 'worker-failed', '--desc', 'test', '--commit', 'abc1234', '--out', p]);
      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.equal(entry.commit, 'abc1234');
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('accepts valid 40-char hex commit', () => {
    const p = tmpFile();
    try {
      const sha = 'a'.repeat(40);
      const res = run(['--type', 'worker-failed', '--desc', 'test', '--commit', sha, '--out', p]);
      assert.equal(res.exitCode, 0);
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('rejects commit shorter than 7 chars', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--commit', 'abc123']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--commit must be 7-40 hex characters/);
  });

  it('rejects commit longer than 40 chars', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--commit', 'a'.repeat(41)]);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--commit must be 7-40 hex characters/);
  });

  it('rejects commit with non-hex characters', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--commit', 'zzzzzzz']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--commit must be 7-40 hex characters/);
  });
});

// ── Meta JSON validation ─────────────────────────────────────────────────────

describe('meta JSON validation', () => {
  it('accepts valid JSON meta', () => {
    const p = tmpFile();
    try {
      const res = run([
        '--type', 'launch-blocked',
        '--desc', 'collision',
        '--meta', '{"key":"value","num":42}',
        '--out', p,
      ]);
      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.deepEqual(entry.meta, { key: 'value', num: 42 });
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('rejects invalid JSON meta', () => {
    const res = run([
      '--type', 'launch-blocked',
      '--desc', 'collision',
      '--meta', '{not valid json',
    ]);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--meta must be valid JSON/);
  });
});

// ── Severity default ─────────────────────────────────────────────────────────

describe('severity default', () => {
  it('defaults severity to medium when --severity is omitted', () => {
    const p = tmpFile();
    try {
      run(['--type', 'plan-drift', '--desc', 'deferred', '--out', p]);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.equal(entry.severity, 'medium');
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });
});

// ── All gap types ────────────────────────────────────────────────────────────

describe('all gap types accepted', () => {
  const types = [
    'worker-failed',
    'worker-stale',
    'health-gate-fail',
    'launch-blocked',
    'plan-drift',
    'stale-row',
  ];

  for (const gapType of types) {
    it(`accepts gap type "${gapType}"`, () => {
      const p = tmpFile();
      try {
        const res = run(['--type', gapType, '--desc', `test ${gapType}`, '--out', p]);
        assert.equal(res.exitCode, 0);
        const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
        assert.equal(entry.gapType, gapType);
      } finally {
        try { fs.unlinkSync(p); } catch {}
      }
    });
  }
});

// ── Unknown argument ─────────────────────────────────────────────────────────

describe('unknown arguments', () => {
  it('rejects unknown flags', () => {
    const res = run(['--type', 'worker-failed', '--desc', 'test', '--unknown-flag']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Unknown argument/);
  });
});

// ── Help flag ────────────────────────────────────────────────────────────────

describe('help flag', () => {
  it('prints help and exits 0 with --help', () => {
    const res = run(['--help']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /USAGE/);
    assert.match(res.stdout, /--type/);
    assert.match(res.stdout, /--dry-run/);
  });
});
