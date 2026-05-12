#!/usr/bin/env node

/**
 * write-contribution-ledger.test.js
 *
 * Focused self-tests for write-contribution-ledger.js covering:
 *   - dry-run output shape
 *   - append entry schema
 *   - required field validation
 *   - optional field passthrough
 *   - all contribution types
 *   - all statuses
 *   - commit format validation
 *   - meta JSON parsing
 *   - rollback-of validation
 *   - self-test pass
 *
 * Run:  node scripts/ai/write-contribution-ledger.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WRITER = path.resolve(__dirname, 'write-contribution-ledger.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
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
  return path.join(os.tmpdir(), `contribution-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

const REQUIRED_ARGS = [
  '--task-id', 'test-001',
  '--issue', '100',
  '--agent-id', 'claude-opus-4-7',
  '--role', 'worker',
  '--type', 'code-change',
  '--status', 'claimed',
  '--validated', 'true',
  '--desc', 'test contribution',
];

// ── Dry-run tests ────────────────────────────────────────────────────────────

describe('dry-run', () => {
  it('prints entry JSON without writing to disk', () => {
    const outPath = tmpFile();
    const res = run([...REQUIRED_ARGS, '--dry-run', '--out', outPath]);

    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /DRY RUN/);
    assert.match(res.stdout, /No file was modified/);
    assert.ok(!fs.existsSync(outPath), 'dry-run must not create the ledger file');
  });

  it('dry-run entry contains valid JSON', () => {
    const res = run([...REQUIRED_ARGS, '--dry-run']);

    assert.equal(res.exitCode, 0);
    const lines = res.stdout.trim().split('\n');
    const jsonLine = lines.find((l) => l.startsWith('{'));
    assert.ok(jsonLine, 'dry-run output must contain a JSON line');
    const entry = JSON.parse(jsonLine);
    assert.equal(entry.contributionType, 'code-change');
    assert.equal(entry.status, 'claimed');
    assert.equal(entry.description, 'test contribution');
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

  it('appends a valid NDJSON line with all required fields', () => {
    const res = run([
      '--task-id', 'wave16-issue-588',
      '--issue', '588',
      '--agent-id', 'claude-opus-4-7',
      '--role', 'worker',
      '--type', 'code-change',
      '--status', 'claimed',
      '--validated', 'false',
      '--desc', 'Auth module implementation',
      '--live',
      '--out', outPath,
    ]);

    assert.equal(res.exitCode, 0);
    assert.ok(fs.existsSync(outPath), 'ledger file must be created');

    const content = fs.readFileSync(outPath, 'utf8').trim();
    const entry = JSON.parse(content);

    assert.equal(entry.schemaVersion, 1);
    assert.ok(entry.entryId, 'entryId must be present');
    assert.ok(entry.recordedAt, 'recordedAt must be present');
    assert.ok(!isNaN(Date.parse(entry.recordedAt)), 'recordedAt must be valid ISO 8601');
    assert.equal(entry.taskId, 'wave16-issue-588');
    assert.equal(entry.issueNumber, 588);
    assert.equal(entry.agentId, 'claude-opus-4-7');
    assert.equal(entry.role, 'worker');
    assert.equal(entry.contributionType, 'code-change');
    assert.equal(entry.status, 'claimed');
    assert.equal(entry.validated, false);
    assert.equal(entry.description, 'Auth module implementation');
  });

  it('appends exactly one line per invocation', () => {
    const multiPath = tmpFile();
    try {
      run([...REQUIRED_ARGS, '--out', multiPath, '--live']);
      run([...REQUIRED_ARGS, '--task-id', 'test-002', '--status', 'accepted', '--validated', 'true', '--out', multiPath, '--live']);

      const lines = fs.readFileSync(multiPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2, 'must have exactly 2 lines after 2 invocations');

      const e1 = JSON.parse(lines[0]);
      const e2 = JSON.parse(lines[1]);
      assert.equal(e1.status, 'claimed');
      assert.equal(e2.status, 'accepted');
    } finally {
      try { fs.unlinkSync(multiPath); } catch {}
    }
  });

  it('includes optional fields when provided', () => {
    const optPath = tmpFile();
    try {
      const res = run([
        '--task-id', 'wave16-issue-588',
        '--issue', '588',
        '--pr', '590',
        '--agent-id', 'claude-opus-4-7',
        '--role', 'worker',
        '--type', 'code-change',
        '--status', 'accepted',
        '--validated', 'true',
        '--desc', 'Auth module merged',
        '--branch', 'claude/wave16-20260511-123047-issue-588',
        '--commit', 'abc1234def567',
        '--conflict-group', 'auth-core',
        '--reused', 'false',
        '--meta', '{"prSize":"small"}',
        '--live',
        '--out', optPath,
      ]);

      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(optPath, 'utf8').trim());

      assert.equal(entry.prNumber, 590);
      assert.equal(entry.branch, 'claude/wave16-20260511-123047-issue-588');
      assert.equal(entry.commit, 'abc1234def567');
      assert.equal(entry.conflictGroup, 'auth-core');
      assert.equal(entry.reused, false);
      assert.deepEqual(entry.meta, { prSize: 'small' });
    } finally {
      try { fs.unlinkSync(optPath); } catch {}
    }
  });

  it('omits optional fields when not provided', () => {
    const minPath = tmpFile();
    try {
      run([...REQUIRED_ARGS, '--live', '--out', minPath]);
      const entry = JSON.parse(fs.readFileSync(minPath, 'utf8').trim());

      assert.equal(entry.prNumber, null);
      assert.equal(entry.branch, null);
      assert.equal(entry.commit, null);
      assert.equal(entry.conflictGroup, null);
      assert.equal(entry.reused, null);
      assert.equal(entry.rollbackOf, null);
      assert.equal(entry.meta, null);
    } finally {
      try { fs.unlinkSync(minPath); } catch {}
    }
  });
});

// ── Validation tests ─────────────────────────────────────────────────────────

describe('required field validation', () => {
  it('rejects missing --task-id', () => {
    const res = run(['--issue', '100', '--agent-id', 'a', '--role', 'r', '--type', 'code-change', '--status', 'claimed', '--validated', 'true', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--task-id is required/);
  });

  it('rejects missing --issue', () => {
    const res = run(['--task-id', 't', '--agent-id', 'a', '--role', 'r', '--type', 'code-change', '--status', 'claimed', '--validated', 'true', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--issue is required/);
  });

  it('rejects missing --agent-id', () => {
    const res = run(['--task-id', 't', '--issue', '100', '--role', 'r', '--type', 'code-change', '--status', 'claimed', '--validated', 'true', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--agent-id is required/);
  });

  it('rejects missing --role', () => {
    const res = run(['--task-id', 't', '--issue', '100', '--agent-id', 'a', '--type', 'code-change', '--status', 'claimed', '--validated', 'true', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--role is required/);
  });

  it('rejects missing --type', () => {
    const res = run(['--task-id', 't', '--issue', '100', '--agent-id', 'a', '--role', 'r', '--status', 'claimed', '--validated', 'true', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--type is required/);
  });

  it('rejects missing --status', () => {
    const res = run(['--task-id', 't', '--issue', '100', '--agent-id', 'a', '--role', 'r', '--type', 'code-change', '--validated', 'true', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--status is required/);
  });

  it('rejects missing --validated', () => {
    const res = run(['--task-id', 't', '--issue', '100', '--agent-id', 'a', '--role', 'r', '--type', 'code-change', '--status', 'claimed', '--desc', 'test']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--validated is required/);
  });

  it('rejects missing --desc', () => {
    const res = run(['--task-id', 't', '--issue', '100', '--agent-id', 'a', '--role', 'r', '--type', 'code-change', '--status', 'claimed', '--validated', 'true']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--desc is required/);
  });

  it('rejects invalid contribution type', () => {
    const res = run([...REQUIRED_ARGS, '--type', 'not-a-type']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--type must be one of:/);
  });

  it('rejects invalid status', () => {
    const res = run([...REQUIRED_ARGS, '--status', 'invalid']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--status must be one of:/);
  });

  it('rejects non-numeric --issue', () => {
    const res = run([...REQUIRED_ARGS, '--issue', 'abc']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--issue must be a number/);
  });

  it('rejects non-numeric --pr', () => {
    const res = run([...REQUIRED_ARGS, '--pr', 'xyz']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--pr must be a number/);
  });

  it('rejects invalid --validated value', () => {
    const res = run([...REQUIRED_ARGS, '--validated', 'maybe']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--validated must be true or false/);
  });

  it('rejects invalid --reused value', () => {
    const res = run([...REQUIRED_ARGS, '--reused', 'maybe']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--reused must be true or false/);
  });
});

// ── Commit format validation ─────────────────────────────────────────────────

describe('commit format validation', () => {
  it('accepts valid 7-char hex commit', () => {
    const p = tmpFile();
    try {
      const res = run([...REQUIRED_ARGS, '--commit', 'abc1234', '--live', '--out', p]);
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
      const res = run([...REQUIRED_ARGS, '--commit', sha, '--live', '--out', p]);
      assert.equal(res.exitCode, 0);
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('rejects commit shorter than 7 chars', () => {
    const res = run([...REQUIRED_ARGS, '--commit', 'abc123']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--commit must be 7-40 hex characters/);
  });

  it('rejects commit longer than 40 chars', () => {
    const res = run([...REQUIRED_ARGS, '--commit', 'a'.repeat(41)]);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--commit must be 7-40 hex characters/);
  });

  it('rejects commit with non-hex characters', () => {
    const res = run([...REQUIRED_ARGS, '--commit', 'zzzzzzz']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--commit must be 7-40 hex characters/);
  });
});

// ── Meta JSON validation ─────────────────────────────────────────────────────

describe('meta JSON validation', () => {
  it('accepts valid JSON meta', () => {
    const p = tmpFile();
    try {
      const res = run([...REQUIRED_ARGS, '--meta', '{"key":"value","num":42}', '--live', '--out', p]);
      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.deepEqual(entry.meta, { key: 'value', num: 42 });
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('rejects invalid JSON meta', () => {
    const res = run([...REQUIRED_ARGS, '--meta', '{not valid json']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--meta must be valid JSON/);
  });
});

// ── All contribution types ───────────────────────────────────────────────────

describe('all contribution types accepted', () => {
  const types = [
    'code-change',
    'schema-change',
    'doc-change',
    'test-change',
    'config-change',
    'fact-produced',
    'review',
    'research',
  ];

  for (const contributionType of types) {
    it(`accepts contribution type "${contributionType}"`, () => {
      const p = tmpFile();
      try {
        const res = run([...REQUIRED_ARGS, '--type', contributionType, '--live', '--out', p]);
        assert.equal(res.exitCode, 0);
        const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
        assert.equal(entry.contributionType, contributionType);
      } finally {
        try { fs.unlinkSync(p); } catch {}
      }
    });
  }
});

// ── All statuses ─────────────────────────────────────────────────────────────

describe('all statuses accepted', () => {
  const statuses = ['claimed', 'accepted', 'rolled-back', 'disputed'];

  for (const status of statuses) {
    it(`accepts status "${status}"`, () => {
      const p = tmpFile();
      try {
        const extraArgs = status === 'rolled-back' ? ['--rollback-of', 'some-entry-id'] : [];
        const res = run([...REQUIRED_ARGS, '--status', status, ...extraArgs, '--live', '--out', p]);
        assert.equal(res.exitCode, 0);
        const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
        assert.equal(entry.status, status);
      } finally {
        try { fs.unlinkSync(p); } catch {}
      }
    });
  }
});

// ── Rollback-of validation ───────────────────────────────────────────────────

describe('rollback-of validation', () => {
  it('requires --rollback-of when status is rolled-back', () => {
    const res = run([...REQUIRED_ARGS, '--status', 'rolled-back']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--rollback-of is required when --status is rolled-back/);
  });

  it('accepts --rollback-of with rolled-back status', () => {
    const p = tmpFile();
    try {
      const res = run([...REQUIRED_ARGS, '--status', 'rolled-back', '--rollback-of', 'original-entry-id', '--live', '--out', p]);
      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.equal(entry.rollbackOf, 'original-entry-id');
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });
});

// ── Unknown argument ─────────────────────────────────────────────────────────

describe('unknown arguments', () => {
  it('rejects unknown flags', () => {
    const res = run([...REQUIRED_ARGS, '--unknown-flag']);
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
    assert.match(res.stdout, /--task-id/);
    assert.match(res.stdout, /--agent-id/);
    assert.match(res.stdout, /--type/);
    assert.match(res.stdout, /--live/);
  });
});

// ── Self-test ────────────────────────────────────────────────────────────────

describe('self-test', () => {
  it('built-in --self-test passes', () => {
    const res = run(['--self-test']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /self-test/);
    assert.match(res.stdout, /passed/);
  });
});

// ── EntryId uniqueness ───────────────────────────────────────────────────────

describe('entryId uniqueness', () => {
  it('generates unique entryId per invocation', () => {
    const p1 = tmpFile();
    const p2 = tmpFile();
    try {
      run([...REQUIRED_ARGS, '--live', '--out', p1]);
      run([...REQUIRED_ARGS, '--live', '--out', p2]);

      const e1 = JSON.parse(fs.readFileSync(p1, 'utf8').trim());
      const e2 = JSON.parse(fs.readFileSync(p2, 'utf8').trim());
      assert.notEqual(e1.entryId, e2.entryId, 'entryId must be unique');
    } finally {
      try { fs.unlinkSync(p1); } catch {}
      try { fs.unlinkSync(p2); } catch {}
    }
  });
});

// ── Validated boolean ────────────────────────────────────────────────────────

describe('validated boolean', () => {
  it('accepts --validated true', () => {
    const p = tmpFile();
    try {
      const res = run([...REQUIRED_ARGS, '--validated', 'true', '--live', '--out', p]);
      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.equal(entry.validated, true);
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('accepts --validated false', () => {
    const p = tmpFile();
    try {
      const res = run([...REQUIRED_ARGS, '--validated', 'false', '--live', '--out', p]);
      assert.equal(res.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.equal(entry.validated, false);
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });
});

// ── Missing --task-id value ──────────────────────────────────────────────────

describe('CLI edge cases', () => {
  it('rejects --task-id without value', () => {
    const res = run(['--task-id']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--task-id requires a value/);
  });

  it('rejects --desc without value', () => {
    const res = run([...REQUIRED_ARGS.slice(0, -2), '--desc']);
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /--desc requires a value/);
  });
});
