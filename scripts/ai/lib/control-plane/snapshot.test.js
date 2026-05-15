#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadControlPlaneSnapshot,
  buildControlPlaneSnapshot,
} = require('./snapshot');

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf8');
}

function writeNdjson(dir, name, records) {
  fs.writeFileSync(path.join(dir, name), records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

test('missing inputs produce conservative unknown snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-plane-empty-'));
  const { inputs, snapshot } = loadControlPlaneSnapshot({ stateDir: dir });

  assert.strictEqual(inputs.health, null);
  assert.strictEqual(snapshot.health.loaded, false);
  assert.strictEqual(snapshot.health.state, 'unknown');
  assert.strictEqual(snapshot.concurrency.effectiveParallelism, null);
  assert.ok(snapshot.concurrency.blockers.includes('main health unavailable'));
  assert.strictEqual(snapshot.issuePool.loaded, false);
});

test('loads JSON and NDJSON state files into one snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-plane-full-'));
  writeJson(dir, 'main-health.json', { state: 'green', capturedAt: '2026-01-01T00:00:00.000Z' });
  writeJson(dir, 'provider-pool.json', {
    global: {
      globalMaxWorkers: 30,
      totalActiveWorkers: 2,
      availableProviders: 1,
      exhaustedProviders: 0,
      disabledProviders: 0,
    },
  });
  writeJson(dir, 'local-resource.json', { global: { resourceState: 'healthy', maxWorkers: 30 } });
  writeJson(dir, 'active-workers.json', {
    requestedParallelism: 30,
    effectiveParallelism: 13,
    blockedParallelismReason: 'conflict-safe slots=13',
    workers: [
      { status: 'running' },
      { status: 'planned' },
      { status: 'failed' },
      { status: 'stale' },
    ],
  });
  writeJson(dir, 'launch-candidates.json', {
    summary: { totalOpen: 18, candidateCount: 12, excludedCount: 6 },
    candidates: [],
  });
  writeNdjson(dir, 'worker-telemetry-events.ndjson', [
    { eventType: 'start', issueNumber: 1 },
    { eventType: 'complete', issueNumber: 1 },
  ]);

  const { inputs, inputSources, snapshot } = loadControlPlaneSnapshot({ stateDir: dir });

  assert.strictEqual(Array.isArray(inputs.workerTelemetry), true);
  assert.strictEqual(inputs.workerTelemetry.length, 2);
  assert.strictEqual(inputSources.workerTelemetryLoaded, true);
  assert.strictEqual(snapshot.health.state, 'green');
  assert.strictEqual(snapshot.concurrency.requestedParallelism, 30);
  assert.strictEqual(snapshot.concurrency.effectiveParallelism, 13);
  assert.strictEqual(snapshot.concurrency.providerSlots, 30);
  assert.strictEqual(snapshot.concurrency.resourceSlots, 30);
  assert.strictEqual(snapshot.concurrency.workers.running, 1);
  assert.strictEqual(snapshot.concurrency.workers.failed, 1);
  assert.strictEqual(snapshot.concurrency.workers.stale, 1);
  assert.strictEqual(snapshot.concurrency.safeToIncrease, false);
  assert.strictEqual(snapshot.issuePool.readyIssueCount, 12);
  assert.strictEqual(snapshot.issuePool.topUpGap, 18);
});

test('buildControlPlaneSnapshot can be used from in-memory inputs', () => {
  const snapshot = buildControlPlaneSnapshot({
    health: { state: 'yellow' },
    providerPool: { global: { globalMaxWorkers: 5, availableProviders: 1 } },
    localResource: { global: { resourceState: 'constrained', availableWorkerSlots: 3 } },
    activeWorkers: { requestedParallelism: 5, effectiveParallelism: 3, workers: [] },
    launchCandidates: { summary: { totalOpen: 5, candidateCount: 5, excludedCount: 0 } },
  });

  assert.strictEqual(snapshot.health.state, 'yellow');
  assert.strictEqual(snapshot.concurrency.providerSlots, 5);
  assert.strictEqual(snapshot.concurrency.resourceSlots, 3);
  assert.strictEqual(snapshot.issuePool.topUpNeeded, false);
});

console.log(`\ncontrol-plane snapshot tests: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
