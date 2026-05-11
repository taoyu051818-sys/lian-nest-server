# Local Resource Sampler

A non-destructive PowerShell sampler that reports CPU, memory, disk, and process
state for orchestration health checks and capacity planning.

## Purpose

The control plane tracks worker liveness (heartbeat), cost (telemetry), and
outcome (acceptance gates), but has no visibility into the host machine's
physical resource pressure. The local resource sampler fills this gap by
capturing a point-in-time snapshot of:

| Signal   | What it reports |
|----------|-----------------|
| CPU      | Logical core count, overall processor utilization |
| Memory   | Total, used, available (GB), pressure ratio (%) |
| Disk     | Volume capacity, used, free (GB), usage (%) |
| Processes | Top processes by CPU time (PID, name, CPU seconds, memory MB) |

This is a **read-only** sampler — it does not modify any files or state.

## Usage

```powershell
# Default: formatted text report
./scripts/ai/sample-local-resource.ps1

# JSON output for programmatic consumption
./scripts/ai/sample-local-resource.ps1 -Json

# Include top 20 processes instead of default 10
./scripts/ai/sample-local-resource.ps1 -TopProcessCount 20

# Check disk for a specific directory's volume
./scripts/ai/sample-local-resource.ps1 -WorkingDirectory "D:\data"

# Dry-run: verify script loads without collecting data
./scripts/ai/sample-local-resource.ps1 -DryRun
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Json` | switch | off | Output as JSON instead of formatted text |
| `-TopProcessCount` | int (1–50) | 10 | Number of top processes to include |
| `-WorkingDirectory` | string | CWD | Directory whose volume is used for disk check |
| `-DryRun` | switch | off | Print config without collecting data |

## Output Schema (JSON)

When using `-Json`, the output conforms to this shape:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T12:00:00.0000000Z",
  "hostname": "MACHINE-NAME",
  "cpu": {
    "logicalCores": 8,
    "overallPercent": 23.5
  },
  "memory": {
    "totalGB": 32.0,
    "usedGB": 18.4,
    "availableGB": 13.6,
    "pressurePct": 57.5
  },
  "disk": {
    "volume": "C:",
    "totalGB": 476.94,
    "usedGB": 312.5,
    "freeGB": 164.44,
    "usedPct": 65.53
  },
  "topProcesses": [
    {
      "pid": 1234,
      "name": "node",
      "cpuSeconds": 142.5,
      "memMB": 512.3
    }
  ]
}
```

All fields except `schemaVersion`, `capturedAt`, and `hostname` may be `null`
if the underlying system call fails (the sampler does not abort on partial
failure — it reports what it can).

## Text Output Format

When running without `-Json`, the sampler prints a formatted report with
color-coded thresholds:

| Signal | Green | Yellow | Red |
|--------|-------|--------|-----|
| CPU load | ≤ 50% | 50–80% | > 80% |
| Memory pressure | ≤ 70% | 70–85% | > 85% |
| Disk usage | ≤ 75% | 75–90% | > 90% |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Sampler completed (all or partial data collected) |
| 2    | Script error (invalid parameters, cannot load) |

The sampler never exits with code 1 — partial failures are reported as
warnings but do not abort the report.

## Integration

Run alongside the launch gate or attach to telemetry records:

```powershell
# Snapshot before a launch gate check
./scripts/ai/sample-local-resource.ps1 -Json > ./resource-snapshot.json
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json

# Periodic sampling during a worker batch
./scripts/ai/sample-local-resource.ps1 -Json >> ./resource-log.jsonl
```

## Safety

- **Read-only**: No files are created, modified, or deleted.
- **No secrets**: Does not read `.env`, credentials, or API keys.
- **No network calls**: All data comes from local OS APIs.
- **Graceful degradation**: Partial failures emit warnings but do not abort.

## Platform Notes

Designed for **Windows** (PowerShell 7+). Uses `Get-Counter`, WMI
(`Win32_OperatingSystem`), `Get-PSDrive`, and `Get-Process`. Linux
adaptation would use `/proc/stat`, `/proc/meminfo`, `df`, and `ps`.
