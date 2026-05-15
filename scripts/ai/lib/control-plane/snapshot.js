'use strict';

const path = require('path');
const fs = require('fs');
const { REPO_ROOT } = require('../constants');
const { readJson, readNdjson } = require('../fs-utils');

const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');

const CONTROL_PLANE_INPUT_FILES = {
  health: 'main-health.json',
  providerPool: 'provider-pool.json',
  localResource: 'local-resource.json',
  activeWorkers: 'active-workers.json',
  workerTrust: 'worker-trust.json',
  metaSignals: 'meta-signals.json',
  riskSignals: 'risk-signals.json',
  opportunitySignals: 'opportunity-signals.json',
  launchLocks: 'launch-locks.json',
  workerTelemetry: 'worker-telemetry-events.ndjson',
  lastCycle: 'self-cycle-run.json',
  launchCandidates: 'launch-candidates.json',
};

function loadControlPlaneInputs(options = {}) {
  const stateDir = options.stateDir || DEFAULT_STATE_DIR;
  const inputFiles = options.inputFiles || CONTROL_PLANE_INPUT_FILES;
  const inputs = {};
  const inputSources = {};

  for (const [key, filename] of Object.entries(inputFiles)) {
    const filePath = path.join(stateDir, filename);
    inputs[key] = !fs.existsSync(filePath)
      ? null
      : (filename.endsWith('.ndjson') ? readNdjson(filePath) : readJson(filePath));
    inputSources[`${key}Loaded`] = filename.endsWith('.ndjson')
      ? Array.isArray(inputs[key]) && inputs[key].length > 0
      : inputs[key] !== null;
  }

  return { inputs, inputSources, stateDir, inputFiles };
}

function countWorkers(activeWorkers) {
  const workers = activeWorkers && Array.isArray(activeWorkers.workers)
    ? activeWorkers.workers
    : [];
  const counts = {
    total: workers.length,
    running: 0,
    planned: 0,
    completed: 0,
    failed: 0,
    stale: 0,
    blocked: 0,
    humanRequired: 0,
  };

  for (const worker of workers) {
    const status = worker && worker.status ? String(worker.status) : 'unknown';
    if (status === 'running') counts.running++;
    else if (status === 'planned') counts.planned++;
    else if (status === 'completed' || status === 'complete') counts.completed++;
    else if (status === 'failed') counts.failed++;
    else if (status === 'stale') counts.stale++;
    else if (status === 'blocked') counts.blocked++;
    else if (status === 'human-required' || status === 'needs-human') counts.humanRequired++;
  }

  return counts;
}

function extractProviderSlots(providerPool) {
  if (!providerPool || !providerPool.global) {
    return { loaded: false, providerSlots: 0, activeWorkers: 0, availableProviders: 0 };
  }
  const global = providerPool.global;
  return {
    loaded: true,
    providerSlots: Number(global.globalMaxWorkers || 0),
    activeWorkers: Number(global.totalActiveWorkers || 0),
    availableProviders: Number(global.availableProviders || 0),
    exhaustedProviders: Number(global.exhaustedProviders || 0),
    disabledProviders: Number(global.disabledProviders || 0),
  };
}

function extractResourceSlots(localResource) {
  if (!localResource || !localResource.global) {
    return { loaded: false, resourceSlots: 0, state: 'unknown' };
  }
  const global = localResource.global;
  return {
    loaded: true,
    resourceSlots: Number(global.maxWorkers || global.availableWorkerSlots || global.resourceSlots || 0),
    state: global.resourceState || 'unknown',
  };
}

function buildConcurrencySummary(inputs) {
  const active = inputs.activeWorkers || null;
  const provider = extractProviderSlots(inputs.providerPool);
  const resource = extractResourceSlots(inputs.localResource);
  const workerCounts = countWorkers(active);

  const requested = active && typeof active.requestedParallelism === 'number'
    ? active.requestedParallelism
    : null;
  const effective = active && typeof active.effectiveParallelism === 'number'
    ? active.effectiveParallelism
    : null;
  const blockedReason = active && active.blockedParallelismReason
    ? String(active.blockedParallelismReason)
    : null;

  const blockers = [];
  if (!inputs.health) blockers.push('main health unavailable');
  if (inputs.health && ['red', 'black'].includes(inputs.health.state)) blockers.push(`main health ${inputs.health.state}`);
  if (provider.loaded && provider.availableProviders === 0) blockers.push('no available providers');
  if (workerCounts.failed > 0) blockers.push(`${workerCounts.failed} failed worker(s)`);
  if (workerCounts.stale > 0) blockers.push(`${workerCounts.stale} stale worker(s)`);
  if (blockedReason) blockers.push(blockedReason);

  return {
    requestedParallelism: requested,
    effectiveParallelism: effective,
    blockedParallelismReason: blockedReason,
    providerSlots: provider.providerSlots,
    resourceSlots: resource.resourceSlots,
    provider,
    resource,
    workers: workerCounts,
    safeToIncrease: blockers.length === 0 && active !== null,
    blockers,
  };
}

function buildIssuePoolSummary(inputs) {
  const launchCandidates = inputs.launchCandidates;
  const activeWorkers = inputs.activeWorkers;
  const summary = launchCandidates && launchCandidates.summary ? launchCandidates.summary : {};
  const ready = Number(summary.candidateCount || 0);
  const totalOpen = Number(summary.totalOpen || 0);
  const excluded = Number(summary.excludedCount || 0);
  const requested = activeWorkers && typeof activeWorkers.requestedParallelism === 'number'
    ? activeWorkers.requestedParallelism
    : null;
  const gap = requested === null ? null : Math.max(0, requested - ready);

  return {
    loaded: !!launchCandidates,
    readyIssueCount: ready,
    totalOpen,
    excludedIssueCount: excluded,
    requestedParallelism: requested,
    topUpGap: gap,
    topUpNeeded: gap !== null && gap > 0,
  };
}

function buildControlPlaneSnapshot(inputs, options = {}) {
  const inputSources = options.inputSources || {};
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    inputSources,
    health: {
      loaded: !!inputs.health,
      state: inputs.health && inputs.health.state ? inputs.health.state : 'unknown',
      capturedAt: inputs.health && inputs.health.capturedAt ? inputs.health.capturedAt : null,
    },
    concurrency: buildConcurrencySummary(inputs),
    issuePool: buildIssuePoolSummary(inputs),
  };
}

function loadControlPlaneSnapshot(options = {}) {
  const loaded = loadControlPlaneInputs(options);
  return {
    ...loaded,
    snapshot: buildControlPlaneSnapshot(loaded.inputs, { inputSources: loaded.inputSources }),
  };
}

module.exports = {
  CONTROL_PLANE_INPUT_FILES,
  DEFAULT_STATE_DIR,
  loadControlPlaneInputs,
  buildControlPlaneSnapshot,
  loadControlPlaneSnapshot,
};
