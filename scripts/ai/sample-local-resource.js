#!/usr/bin/env node
/**
 * sample-local-resource.js
 *
 * Cross-platform Node.js sampler that writes sanitized local resource state
 * to .github/ai-state/local-resource.json. Mirrors sample-local-resource.ps1
 * using the os module and child_process for disk/process metrics.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_FILE = path.join(REPO_ROOT, '.github', 'ai-state', 'local-resource.json');

// Thresholds (matching sample-local-resource.ps1 defaults)
const THRESHOLDS = {
  cpu: { greenMax: 50, yellowMax: 80 },
  memory: { greenMax: 70, yellowMax: 85 },
  disk: { greenMax: 75, yellowMax: 90 },
  process: { warn: 25, block: 30 },
};

const TTL_SECONDS = 300;
const PROCESS_MARKER = 'claude-worker';

// ── Classification helpers ──────────────────────────────────────────────────

function classifyCpu(percent) {
  if (percent > THRESHOLDS.cpu.yellowMax) return 'red';
  if (percent > THRESHOLDS.cpu.greenMax) return 'yellow';
  return 'green';
}

function classifyMemory(pressurePct) {
  if (pressurePct > THRESHOLDS.memory.yellowMax) return 'red';
  if (pressurePct > THRESHOLDS.memory.greenMax) return 'yellow';
  return 'green';
}

function classifyDisk(usedPct) {
  if (usedPct > THRESHOLDS.disk.yellowMax) return 'red';
  if (usedPct > THRESHOLDS.disk.greenMax) return 'yellow';
  return 'green';
}

function classifyProcess(runningCount, maxAllowed = THRESHOLDS.process.block) {
  if (runningCount == null) return 'unknown';
  if (runningCount >= maxAllowed) return 'critical';
  if (runningCount >= THRESHOLDS.process.warn) return 'constrained';
  return 'healthy';
}

function toResourceState(color) {
  if (color === 'red') return 'critical';
  if (color === 'yellow') return 'constrained';
  return 'healthy';
}

function deriveGlobalResourceState(projection) {
  const states = [];
  let coreMetricCount = 0;

  if (projection.cpu.usagePercent != null) {
    states.push(toResourceState(classifyCpu(projection.cpu.usagePercent)));
    coreMetricCount += 1;
  }
  if (projection.memory.usagePercent != null) {
    states.push(toResourceState(classifyMemory(projection.memory.usagePercent)));
    coreMetricCount += 1;
  }
  if (projection.disk.usagePercent != null) {
    states.push(toResourceState(classifyDisk(projection.disk.usagePercent)));
    coreMetricCount += 1;
  }
  if (projection.process.runningCount != null) {
    states.push(classifyProcess(projection.process.runningCount, projection.process.maxAllowed));
  }

  if (coreMetricCount === 0) return 'unknown';
  if (states.includes('critical')) return 'critical';
  if (states.includes('constrained')) return 'constrained';
  return 'healthy';
}

// ── Sampling helpers ────────────────────────────────────────────────────────

function sampleCpu() {
  const cores = os.cpus().length;
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    totalIdle += idle;
    totalTick += user + nice + sys + idle + irq;
  }

  const idlePercent = (totalIdle / totalTick) * 100;
  const usagePercent = Math.round(Math.max(0, Math.min(100 - idlePercent, 100)) * 100) / 100;

  return { cores, usagePercent };
}

function sampleMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  return {
    totalGB: Math.round((totalBytes / 1073741824) * 100) / 100,
    usedGB: Math.round((usedBytes / 1073741824) * 100) / 100,
    availableGB: Math.round((freeBytes / 1073741824) * 100) / 100,
    usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0,
  };
}

function sampleDisk() {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      const cwd = process.cwd();
      const drive = path.parse(cwd).root.replace('\\', '');
      const output = execSync(
        `wmic logicaldisk where "DeviceID='${drive}'" get Size,FreeSpace /format:csv`,
        { encoding: 'utf8', timeout: 10000 }
      );
      const lines = output.trim().split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].split(',');
        const freeBytes = parseInt(parts[1], 10);
        const totalBytes = parseInt(parts[2], 10);
        if (!isNaN(freeBytes) && !isNaN(totalBytes) && totalBytes > 0) {
          const usedBytes = totalBytes - freeBytes;
          return {
            totalGB: Math.round((totalBytes / 1073741824) * 100) / 100,
            usedGB: Math.round((usedBytes / 1073741824) * 100) / 100,
            availableGB: Math.round((freeBytes / 1073741824) * 100) / 100,
            usagePercent: Math.round((usedBytes / totalBytes) * 10000) / 100,
            mountPoint: drive + '\\',
          };
        }
      }
    } else {
      const output = execSync("df -k / | tail -1", { encoding: 'utf8', timeout: 10000 });
      const parts = output.trim().split(/\s+/);
      const totalKB = parseInt(parts[1], 10);
      const usedKB = parseInt(parts[2], 10);
      const availKB = parseInt(parts[3], 10);
      if (!isNaN(totalKB) && totalKB > 0) {
        return {
          totalGB: Math.round((totalKB / 1048576) * 100) / 100,
          usedGB: Math.round((usedKB / 1048576) * 100) / 100,
          availableGB: Math.round((availKB / 1048576) * 100) / 100,
          usagePercent: Math.round((usedKB / totalKB) * 10000) / 100,
          mountPoint: '/',
        };
      }
    }
  } catch {
    // Disk sampling unavailable
  }

  return { totalGB: null, usedGB: null, availableGB: null, usagePercent: null, mountPoint: null };
}

function sampleProcessCount() {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      const output = execSync(
        `wmic process where "CommandLine like '%${PROCESS_MARKER}%'" get ProcessId /format:csv`,
        { encoding: 'utf8', timeout: 10000 }
      );
      const lines = output.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
      return Math.max(0, lines.length - 1);
    } else {
      const output = execSync(
        `ps aux | grep -c "${PROCESS_MARKER}" || true`,
        { encoding: 'utf8', timeout: 10000 }
      );
      const count = parseInt(output.trim(), 10);
      // Subtract 1 for the grep process itself
      return Math.max(0, (isNaN(count) ? 0 : count) - 1);
    }
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let stateFile = DEFAULT_STATE_FILE;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state-file' && args[i + 1]) {
      stateFile = path.resolve(args[++i]);
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  const fallbackNotes = [];

  // Sample CPU
  const cpuData = sampleCpu();
  const cpuReport = {
    cores: cpuData.cores,
    usagePercent: cpuData.usagePercent,
    loadAverage: {
      oneMin: os.loadavg()[0] != null ? Math.round(os.loadavg()[0] * 100) / 100 : null,
      fiveMin: os.loadavg()[1] != null ? Math.round(os.loadavg()[1] * 100) / 100 : null,
      fifteenMin: os.loadavg()[2] != null ? Math.round(os.loadavg()[2] * 100) / 100 : null,
    },
  };

  // Sample memory
  const memData = sampleMemory();
  const memoryReport = {
    totalGB: memData.totalGB,
    usedGB: memData.usedGB,
    availableGB: memData.availableGB,
    usagePercent: memData.usagePercent,
  };

  // Sample disk
  const diskData = sampleDisk();
  const diskReport = {
    totalGB: diskData.totalGB,
    usedGB: diskData.usedGB,
    availableGB: diskData.availableGB,
    usagePercent: diskData.usagePercent,
    mountPoint: diskData.mountPoint,
  };
  if (diskData.totalGB == null) {
    fallbackNotes.push('Disk metric unavailable.');
  }

  // Sample process count
  const procCount = sampleProcessCount();
  const maxAllowed = THRESHOLDS.process.block;
  const processReport = {
    runningCount: procCount,
    maxAllowed,
    headroomPercent: procCount != null && maxAllowed > 0
      ? Math.round(Math.max(maxAllowed - procCount, 0) / maxAllowed * 10000) / 100
      : null,
  };
  if (procCount == null) {
    fallbackNotes.push('Process metric unavailable.');
  }

  // Derive global state
  const projection = {
    cpu: cpuReport,
    memory: memoryReport,
    disk: diskReport,
    process: processReport,
  };
  const globalState = deriveGlobalResourceState(projection);
  const capturedAt = new Date().toISOString();

  const notes = [
    'This file is a sanitized state projection. It never contains API keys, tokens, hostnames, usernames, personally identifying paths, or raw system command output.',
  ];
  if (fallbackNotes.length > 0) {
    notes.push('Fallbacks used: ' + [...new Set(fallbackNotes)].join(' '));
  }

  const state = {
    stateVersion: 1,
    cpu: cpuReport,
    memory: memoryReport,
    disk: diskReport,
    process: processReport,
    global: {
      resourceState: globalState,
      lastUpdatedBy: 'sample-local-resource',
      capturedAt,
      ttlSeconds: TTL_SECONDS,
    },
    notes: notes.join(' '),
  };

  const jsonContent = JSON.stringify(state, null, 2);

  if (dryRun) {
    console.log(jsonContent);
    return;
  }

  const stateDir = path.dirname(stateFile);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  fs.writeFileSync(stateFile, jsonContent, 'utf8');

  console.log('========================================');
  console.log('  Local Resource Sampler (Node.js)');
  console.log('========================================');
  console.log('');
  console.log(`Captured at:    ${capturedAt}`);
  console.log(`Resource state: ${globalState}`);
  console.log(`State file:     ${stateFile}`);
  console.log('');
  console.log(`CPU usage:      ${cpuReport.usagePercent != null ? cpuReport.usagePercent + '%' : '(unavailable)'}`);
  console.log(`Memory usage:   ${memoryReport.usagePercent != null ? memoryReport.usagePercent + '%' : '(unavailable)'}`);
  console.log(`Disk usage:     ${diskReport.usagePercent != null ? diskReport.usagePercent + '%' : '(unavailable)'}`);
  console.log(`Worker count:   ${procCount != null ? procCount + '/' + maxAllowed : '(unavailable)'}`);
  if (fallbackNotes.length > 0) {
    console.log('');
    console.log(`Fallbacks: ${[...new Set(fallbackNotes)].join(' ')}`);
  }
  console.log('');
  console.log('[ok] Sanitized local resource state updated.');
}

main();
