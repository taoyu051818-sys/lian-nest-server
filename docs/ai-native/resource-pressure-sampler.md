# Resource Pressure Sampler

## Overview

The resource pressure sampler classifies local machine resource usage into three levels (green/yellow/red) based on CPU, memory, and disk thresholds. This document covers the classification rules and the fixture test that validates them.

## Classification Thresholds

| Signal       | Green       | Yellow        | Red        |
|--------------|-------------|---------------|------------|
| CPU load %   | <= 50       | 51 -- 80      | > 80       |
| Memory %     | <= 70       | 71 -- 85      | > 85       |
| Disk usage % | <= 75       | 76 -- 90      | > 90       |

These thresholds match the inline logic in `scripts/ai/sample-local-resource.ps1` (issue #527).

## Fixture Test

**File:** `scripts/ai/test-resource-pressure-sampler.js`

**Run:**
```bash
node scripts/ai/test-resource-pressure-sampler.js
```

The test contains 12 fixtures covering:

- All-green idle machine
- Exact boundary values at green/yellow and yellow/red edges
- Mixed signal levels (e.g., CPU red + memory green + disk yellow)
- Realistic moderate and high load scenarios
- Zero and saturated (100%) values

Each fixture provides an input sample and the expected classification for all three signals. The test exits non-zero on any failure.

## Relation to Other Samplers

- **Local resource sampler** (`scripts/ai/sample-local-resource.ps1`, issue #527): Collects raw CPU/memory/disk/process metrics and applies these thresholds in its text renderer.
- **Active worker resource sampler** (`scripts/ai/sample-active-worker-resources.ps1`, issue #528): Samples per-worker process metrics; no pressure classification.
- **Health failure classifier** (`scripts/ai/classify-health-failure.js`): Classifies build/CI error text, not resource pressure.

## JSON Schema

The local sampler outputs JSON with `schemaVersion: 1`:

```json
{
  "schemaVersion": 1,
  "capturedAt": "ISO-8601",
  "hostname": "string",
  "cpu": { "logicalCores": 8, "overallPercent": 45.2 },
  "memory": { "totalGB": 32, "usedGB": 18, "availableGB": 14, "pressurePct": 56.3 },
  "disk": { "volume": "C:", "totalGB": 500, "usedGB": 320, "freeGB": 180, "usedPct": 64 },
  "topProcesses": [{ "pid": 1234, "name": "node", "cpuSeconds": 12.5, "memMB": 512 }]
}
```

The JSON output does not include the pressure level classification; consumers apply the thresholds above.
