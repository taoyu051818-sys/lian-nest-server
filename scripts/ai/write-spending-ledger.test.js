#!/usr/bin/env node

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WRITER = path.resolve(__dirname, 'write-spending-ledger.js');

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [WRITER, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    if (error.status !== undefined) {
      return {
        exitCode: error.status,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
      };
    }
    throw error;
  }
}

function tmpFile() {
  return path.join(os.tmpdir(), `spending-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

const REQUIRED = [
  '--task-id', 'wave16-issue-1294-worker-001',
  '--issue', '1294',
  '--agent-id', 'claude-sonnet-4-6',
  '--provider', 'anthropic-primary',
  '--event', 'checkpoint',
  '--desc', 'checkpoint spend snapshot',
];

describe('dry-run', () => {
  it('prints preview without writing', () => {
    const outPath = tmpFile();
    const result = run([...REQUIRED, '--dry-run', '--out', outPath]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /DRY RUN/);
    assert.ok(!fs.existsSync(outPath));
  });

  it('emits JSON entry in preview output', () => {
    const result = run([...REQUIRED, '--dry-run']);
    const jsonLine = result.stdout.split('\n').find((line) => line.startsWith('{'));
    assert.ok(jsonLine);
    const entry = JSON.parse(jsonLine);
    assert.equal(entry.taskId, 'wave16-issue-1294-worker-001');
    assert.equal(entry.providerAlias, 'anthropic-primary');
    assert.equal(entry.eventType, 'checkpoint');
  });
});

describe('live write shape', () => {
  it('writes required fields', () => {
    const outPath = tmpFile();
    try {
      const result = run([...REQUIRED, '--live', '--out', outPath]);
      assert.equal(result.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(outPath, 'utf8').trim());
      assert.equal(entry.schemaVersion, 1);
      assert.equal(entry.issueNumber, 1294);
      assert.equal(entry.agentId, 'claude-sonnet-4-6');
      assert.equal(entry.providerAlias, 'anthropic-primary');
      assert.equal(entry.description, 'checkpoint spend snapshot');
      assert.equal(entry.prNumber, null);
    } finally {
      try { fs.unlinkSync(outPath); } catch {}
    }
  });

  it('writes token usage and cost snapshot', () => {
    const outPath = tmpFile();
    try {
      const result = run([
        ...REQUIRED,
        '--input-tokens', '2400',
        '--output-tokens', '800',
        '--token-source', 'actual',
        '--token-confidence', 'actual',
        '--cost-cents', '9',
        '--pricing-basis', 'api-list',
        '--model', 'claude-sonnet-4-6',
        '--elapsed-ms', '180000',
        '--live',
        '--out',
        outPath,
      ]);
      assert.equal(result.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(outPath, 'utf8').trim());
      assert.equal(entry.elapsedMs, 180000);
      assert.equal(entry.tokenUsage.inputTokens, 2400);
      assert.equal(entry.tokenUsage.outputTokens, 800);
      assert.equal(entry.tokenUsage.source, 'actual');
      assert.equal(entry.estimatedCost.amountCents, 9);
      assert.equal(entry.estimatedCost.pricingBasis, 'api-list');
      assert.equal(entry.estimatedCost.model, 'claude-sonnet-4-6');
    } finally {
      try { fs.unlinkSync(outPath); } catch {}
    }
  });

  it('writes budget snapshot', () => {
    const outPath = tmpFile();
    try {
      const result = run([
        ...REQUIRED,
        '--event', 'budget-warning',
        '--budget-kind', 'token',
        '--budget-limit', '10000',
        '--budget-used', '8600',
        '--budget-unit', 'tokens',
        '--budget-state', 'warning',
        '--budget-percent', '86',
        '--live',
        '--out',
        outPath,
      ]);
      assert.equal(result.exitCode, 0);
      const entry = JSON.parse(fs.readFileSync(outPath, 'utf8').trim());
      assert.equal(entry.budget.kind, 'token');
      assert.equal(entry.budget.limit, 10000);
      assert.equal(entry.budget.used, 8600);
      assert.equal(entry.budget.unit, 'tokens');
      assert.equal(entry.budget.state, 'warning');
      assert.equal(entry.budget.percentUsed, 86);
    } finally {
      try { fs.unlinkSync(outPath); } catch {}
    }
  });

  it('appends one line per invocation', () => {
    const outPath = tmpFile();
    try {
      run([...REQUIRED, '--live', '--out', outPath]);
      run([...REQUIRED, '--event', 'complete', '--live', '--out', outPath]);
      const lines = fs.readFileSync(outPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[0]).eventType, 'checkpoint');
      assert.equal(JSON.parse(lines[1]).eventType, 'complete');
    } finally {
      try { fs.unlinkSync(outPath); } catch {}
    }
  });
});

describe('validation', () => {
  it('rejects missing required flags', () => {
    const result = run(['--issue', '1294', '--agent-id', 'a', '--provider', 'p', '--event', 'start', '--desc', 'test']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--task-id is required/);
  });

  it('rejects invalid event', () => {
    const result = run([...REQUIRED, '--event', 'invalid']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--event must be one of/);
  });

  it('rejects token counts without source metadata', () => {
    const result = run([...REQUIRED, '--input-tokens', '1']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--token-source and --token-confidence are required/);
  });

  it('rejects cost without pricing basis', () => {
    const result = run([...REQUIRED, '--cost-cents', '3']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--pricing-basis is required/);
  });

  it('rejects partial budget snapshot', () => {
    const result = run([...REQUIRED, '--budget-kind', 'cost']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /must be provided together/);
  });

  it('rejects budget events without budget snapshot', () => {
    const result = run([...REQUIRED, '--event', 'budget-critical']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /budget events require a full budget snapshot/);
  });

  it('rejects invalid token source', () => {
    const result = run([...REQUIRED, '--input-tokens', '10', '--output-tokens', '5', '--token-source', 'bad', '--token-confidence', 'actual']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--token-source must be one of/);
  });

  it('rejects invalid pricing basis', () => {
    const result = run([...REQUIRED, '--cost-cents', '5', '--pricing-basis', 'bad']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--pricing-basis must be one of/);
  });

  it('rejects invalid budget kind', () => {
    const result = run([...REQUIRED, '--budget-kind', 'bad', '--budget-limit', '1', '--budget-used', '1', '--budget-unit', 'tokens', '--budget-state', 'warning']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--budget-kind must be one of/);
  });

  it('rejects invalid budget unit', () => {
    const result = run([...REQUIRED, '--budget-kind', 'token', '--budget-limit', '1', '--budget-used', '1', '--budget-unit', 'bad', '--budget-state', 'warning']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--budget-unit must be one of/);
  });

  it('rejects invalid budget state', () => {
    const result = run([...REQUIRED, '--budget-kind', 'token', '--budget-limit', '1', '--budget-used', '1', '--budget-unit', 'tokens', '--budget-state', 'bad']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--budget-state must be one of/);
  });

  it('rejects invalid meta JSON', () => {
    const result = run([...REQUIRED, '--meta', '{bad json']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--meta must be valid JSON/);
  });

  it('rejects unknown flags', () => {
    const result = run([...REQUIRED, '--nope']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Unknown argument/);
  });
});

describe('coverage of enum values', () => {
  for (const eventType of ['start', 'checkpoint', 'complete', 'budget-warning', 'budget-critical']) {
    it(`accepts event type ${eventType}`, () => {
      const args = [...REQUIRED, '--event', eventType];
      if (eventType.startsWith('budget-')) {
        args.push('--budget-kind', 'cost', '--budget-limit', '10', '--budget-used', '9', '--budget-unit', 'cents', '--budget-state', 'warning');
      }
      const result = run(args);
      assert.equal(result.exitCode, 0);
    });
  }

  for (const source of ['actual', 'estimated', 'unknown']) {
    it(`accepts token source ${source}`, () => {
      const result = run([...REQUIRED, '--input-tokens', '10', '--output-tokens', '5', '--token-source', source, '--token-confidence', source]);
      assert.equal(result.exitCode, 0);
    });
  }

  for (const basis of ['api-list', 'estimated', 'unknown']) {
    it(`accepts pricing basis ${basis}`, () => {
      const result = run([...REQUIRED, '--cost-cents', '5', '--pricing-basis', basis]);
      assert.equal(result.exitCode, 0);
    });
  }

  for (const kind of ['token', 'time', 'cost']) {
    it(`accepts budget kind ${kind}`, () => {
      const unit = kind === 'token' ? 'tokens' : kind === 'time' ? 'ms' : 'cents';
      const result = run([...REQUIRED, '--event', 'budget-warning', '--budget-kind', kind, '--budget-limit', '10', '--budget-used', '8', '--budget-unit', unit, '--budget-state', 'warning']);
      assert.equal(result.exitCode, 0);
    });
  }
});

describe('self-test and help', () => {
  it('prints help', () => {
    const result = run(['--help']);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /USAGE/);
    assert.match(result.stdout, /--provider/);
    assert.match(result.stdout, /--budget-kind/);
  });

  it('passes built-in self-test', () => {
    const result = run(['--self-test']);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /self-test/);
    assert.match(result.stdout, /passed/);
  });
});
