#!/usr/bin/env node
/**
 * Fixture tests for resource pressure classification and sanitized state
 * projection logic used by sample-local-resource.ps1.
 */

const THRESHOLDS = {
  cpu: { greenMax: 50, yellowMax: 80 },
  memory: { greenMax: 70, yellowMax: 85 },
  disk: { greenMax: 75, yellowMax: 90 },
  process: { warn: 25, block: 30 },
};

function classifyCpu(percent) {
  if (percent > THRESHOLDS.cpu.yellowMax) return "red";
  if (percent > THRESHOLDS.cpu.greenMax) return "yellow";
  return "green";
}

function classifyMemory(pressurePct) {
  if (pressurePct > THRESHOLDS.memory.yellowMax) return "red";
  if (pressurePct > THRESHOLDS.memory.greenMax) return "yellow";
  return "green";
}

function classifyDisk(usedPct) {
  if (usedPct > THRESHOLDS.disk.yellowMax) return "red";
  if (usedPct > THRESHOLDS.disk.greenMax) return "yellow";
  return "green";
}

function classifyProcess(runningCount, maxAllowed = THRESHOLDS.process.block) {
  if (runningCount == null) return "unknown";
  if (runningCount >= maxAllowed) return "critical";
  if (runningCount >= THRESHOLDS.process.warn) return "constrained";
  return "healthy";
}

function classifyAll(sample) {
  return {
    cpu: classifyCpu(sample.cpu.overallPercent),
    memory: classifyMemory(sample.memory.pressurePct),
    disk: classifyDisk(sample.disk.usedPct),
  };
}

function toResourceState(color) {
  if (color === "red") return "critical";
  if (color === "yellow") return "constrained";
  return "healthy";
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
    states.push(
      classifyProcess(
        projection.process.runningCount,
        projection.process.maxAllowed
      )
    );
  }

  if (coreMetricCount === 0) return "unknown";
  if (states.includes("critical")) return "critical";
  if (states.includes("constrained")) return "constrained";
  return "healthy";
}

function buildSanitizedProjection(sample) {
  const projection = {
    stateVersion: 1,
    cpu: {
      cores: sample.cpu.logicalCores ?? null,
      usagePercent: sample.cpu.overallPercent ?? null,
      loadAverage: {
        oneMin: null,
        fiveMin: null,
        fifteenMin: null,
      },
    },
    memory: {
      totalGB: sample.memory.totalGB ?? null,
      usedGB: sample.memory.usedGB ?? null,
      availableGB: sample.memory.availableGB ?? null,
      usagePercent: sample.memory.pressurePct ?? null,
    },
    disk: {
      totalGB: sample.disk.totalGB ?? null,
      usedGB: sample.disk.usedGB ?? null,
      availableGB: sample.disk.freeGB ?? null,
      usagePercent: sample.disk.usedPct ?? null,
      mountPoint: sample.disk.volume ?? null,
    },
    process: {
      runningCount: sample.process?.runningCount ?? null,
      maxAllowed: sample.process?.maxAllowed ?? THRESHOLDS.process.block,
      headroomPercent:
        sample.process?.runningCount == null
          ? null
          : Number(
              (
                (Math.max(
                  (sample.process?.maxAllowed ?? THRESHOLDS.process.block) -
                    sample.process.runningCount,
                  0
                ) /
                  (sample.process?.maxAllowed ?? THRESHOLDS.process.block)) *
                100
              ).toFixed(2)
            ),
    },
    global: {
      resourceState: "unknown",
      lastUpdatedBy: "sample-local-resource",
      capturedAt: "2026-05-12T00:00:00.0000000Z",
      ttlSeconds: 300,
    },
    notes:
      "This file is a sanitized state projection. It never contains API keys, tokens, hostnames, usernames, personally identifying paths, or raw system command output.",
  };

  projection.global.resourceState = deriveGlobalResourceState(projection);
  return projection;
}

const fixtures = [
  {
    name: "idle machine - all green",
    sample: {
      cpu: { overallPercent: 5 },
      memory: { pressurePct: 30 },
      disk: { usedPct: 40 },
    },
    expected: { cpu: "green", memory: "green", disk: "green" },
  },
  {
    name: "exact green upper bounds",
    sample: {
      cpu: { overallPercent: 50 },
      memory: { pressurePct: 70 },
      disk: { usedPct: 75 },
    },
    expected: { cpu: "green", memory: "green", disk: "green" },
  },
  {
    name: "just above green - all yellow",
    sample: {
      cpu: { overallPercent: 51 },
      memory: { pressurePct: 71 },
      disk: { usedPct: 76 },
    },
    expected: { cpu: "yellow", memory: "yellow", disk: "yellow" },
  },
  {
    name: "mid yellow range",
    sample: {
      cpu: { overallPercent: 65 },
      memory: { pressurePct: 78 },
      disk: { usedPct: 82 },
    },
    expected: { cpu: "yellow", memory: "yellow", disk: "yellow" },
  },
  {
    name: "exact yellow upper bounds",
    sample: {
      cpu: { overallPercent: 80 },
      memory: { pressurePct: 85 },
      disk: { usedPct: 90 },
    },
    expected: { cpu: "yellow", memory: "yellow", disk: "yellow" },
  },
  {
    name: "just above yellow - all red",
    sample: {
      cpu: { overallPercent: 81 },
      memory: { pressurePct: 86 },
      disk: { usedPct: 91 },
    },
    expected: { cpu: "red", memory: "red", disk: "red" },
  },
  {
    name: "fully saturated",
    sample: {
      cpu: { overallPercent: 100 },
      memory: { pressurePct: 99 },
      disk: { usedPct: 99 },
    },
    expected: { cpu: "red", memory: "red", disk: "red" },
  },
  {
    name: "zero values",
    sample: {
      cpu: { overallPercent: 0 },
      memory: { pressurePct: 0 },
      disk: { usedPct: 0 },
    },
    expected: { cpu: "green", memory: "green", disk: "green" },
  },
  {
    name: "mixed levels - cpu red, memory green, disk yellow",
    sample: {
      cpu: { overallPercent: 95 },
      memory: { pressurePct: 50 },
      disk: { usedPct: 80 },
    },
    expected: { cpu: "red", memory: "green", disk: "yellow" },
  },
  {
    name: "mixed levels - cpu green, memory red, disk green",
    sample: {
      cpu: { overallPercent: 20 },
      memory: { pressurePct: 90 },
      disk: { usedPct: 60 },
    },
    expected: { cpu: "green", memory: "red", disk: "green" },
  },
  {
    name: "realistic moderate load",
    sample: {
      cpu: { overallPercent: 45 },
      memory: { pressurePct: 72 },
      disk: { usedPct: 68 },
    },
    expected: { cpu: "green", memory: "yellow", disk: "green" },
  },
  {
    name: "realistic high load",
    sample: {
      cpu: { overallPercent: 88 },
      memory: { pressurePct: 91 },
      disk: { usedPct: 85 },
    },
    expected: { cpu: "red", memory: "red", disk: "yellow" },
  },
];

const projectionFixtures = [
  {
    name: "healthy projection with worker headroom",
    sample: {
      cpu: { logicalCores: 8, overallPercent: 35 },
      memory: { totalGB: 32, usedGB: 14, availableGB: 18, pressurePct: 43.75 },
      disk: { volume: "C:\\", totalGB: 512, usedGB: 220, freeGB: 292, usedPct: 42.97 },
      process: { runningCount: 2, maxAllowed: 30 },
    },
    expectedState: "healthy",
  },
  {
    name: "constrained projection when memory is elevated",
    sample: {
      cpu: { logicalCores: 8, overallPercent: null },
      memory: { totalGB: 32, usedGB: 26, availableGB: 6, pressurePct: 81.25 },
      disk: { volume: "C:\\", totalGB: 512, usedGB: 220, freeGB: 292, usedPct: 42.97 },
      process: { runningCount: 1, maxAllowed: 30 },
    },
    expectedState: "constrained",
  },
  {
    name: "healthy projection when only memory is available",
    sample: {
      cpu: { logicalCores: 8, overallPercent: null },
      memory: { totalGB: 32, usedGB: 12, availableGB: 20, pressurePct: 37.5 },
      disk: { volume: null, totalGB: null, usedGB: null, freeGB: null, usedPct: null },
      process: { runningCount: 0, maxAllowed: 30 },
    },
    expectedState: "healthy",
  },
  {
    name: "critical projection when disk is exhausted",
    sample: {
      cpu: { logicalCores: 8, overallPercent: 20 },
      memory: { totalGB: 32, usedGB: 10, availableGB: 22, pressurePct: 31.25 },
      disk: { volume: "C:\\", totalGB: 512, usedGB: 490, freeGB: 22, usedPct: 95.7 },
      process: { runningCount: 1, maxAllowed: 30 },
    },
    expectedState: "critical",
  },
  {
    name: "unknown projection when no safe metrics exist",
    sample: {
      cpu: { logicalCores: 8, overallPercent: null },
      memory: { totalGB: null, usedGB: null, availableGB: null, pressurePct: null },
      disk: { volume: null, totalGB: null, usedGB: null, freeGB: null, usedPct: null },
      process: { runningCount: null, maxAllowed: 30 },
    },
    expectedState: "unknown",
  },
];

let passed = 0;
let failed = 0;

for (const fixture of fixtures) {
  const actual = classifyAll(fixture.sample);
  const ok =
    actual.cpu === fixture.expected.cpu &&
    actual.memory === fixture.expected.memory &&
    actual.disk === fixture.expected.disk;

  if (ok) {
    passed++;
    console.log(`  PASS  ${fixture.name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${fixture.name}`);
    console.error(`    expected: ${JSON.stringify(fixture.expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

for (const fixture of projectionFixtures) {
  const projection = buildSanitizedProjection(fixture.sample);
  const ok =
    projection.global.resourceState === fixture.expectedState &&
    projection.global.lastUpdatedBy === "sample-local-resource" &&
    !Object.prototype.hasOwnProperty.call(projection, "hostname") &&
    !Object.prototype.hasOwnProperty.call(projection, "topProcesses");

  if (ok) {
    passed++;
    console.log(`  PASS  ${fixture.name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${fixture.name}`);
    console.error(`    expected state: ${fixture.expectedState}`);
    console.error(`    actual state:   ${projection.global.resourceState}`);
    console.error(`    projection:     ${JSON.stringify(projection)}`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${fixtures.length + projectionFixtures.length} total`);

if (failed > 0) {
  process.exit(1);
}