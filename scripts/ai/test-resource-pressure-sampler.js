#!/usr/bin/env node
/**
 * Fixture tests for resource pressure sampler classification logic.
 *
 * Mirrors the threshold rules from sample-local-resource.ps1 (issue #527):
 *   CPU:  <=50 green, 50-80 yellow, >80 red
 *   Mem:  <=70 green, 70-85 yellow, >85 red
 *   Disk: <=75 green, 75-90 yellow, >90 red
 *
 * Run: node scripts/ai/test-resource-pressure-sampler.js
 */

// ---------------------------------------------------------------------------
// Classification function (JS port of the inline logic in the PS1 sampler)
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  cpu: { greenMax: 50, yellowMax: 80 },
  memory: { greenMax: 70, yellowMax: 85 },
  disk: { greenMax: 75, yellowMax: 90 },
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

function classifyAll(sample) {
  return {
    cpu: classifyCpu(sample.cpu.overallPercent),
    memory: classifyMemory(sample.memory.pressurePct),
    disk: classifyDisk(sample.disk.usedPct),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${fixtures.length} total`);

if (failed > 0) {
  process.exit(1);
}
