# Worker Metrics Sampler

Samples active worker metrics (pid, cpu, memory, age, status) and projects them into ai-state for WebUI dashboard and scheduling decisions.

## Purpose

The control plane tracks worker liveness via heartbeats and the active-workers manifest, but does not surface a consolidated metrics view for the WebUI or scheduler. The worker metrics sampler fills this gap by periodically reading the manifest, sampling each worker's process footprint, and classifying status — enabling:

- **WebUI dashboard:** Display real-time worker status, resource usage, and age in the monitoring view.
- **Scheduler decisions:** Use status classification (running/stale/unknown) to avoid scheduling work on stale workers.
- **Capacity planning:** Detect when workers approach memory or CPU limits before they OOM or thrash.
- **Stale worker detection:** A worker with zero CPU for an extended period is flagged as stale.

## Script

`scripts/ai/sample-worker-metrics.ps1`

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ManifestFile` | string | `./.github/ai-state/active-workers.json` | Path to the active-workers state projection. |
| `OutFile` | string | `./.github/ai-state/worker-metrics.json` | Output path for the metrics projection JSON. |
| `Json` | switch | off | Output report as JSON instead of console table. |
| `DryRun` | switch | off | Print manifest contents without sampling (default behavior). |
| `Execute` | switch | off | Actually sample processes and write the metrics file. |
| `StaleMinutes` | int | 30 | Minutes of zero CPU before a worker is classified as stale. |
| `Help` | switch | off | Show full PowerShell help. |

### Usage

```powershell
# Dry-run (default): show what would be sampled
./scripts/ai/sample-worker-metrics.ps1

# Actually sample and write metrics
./scripts/ai/sample-worker-metrics.ps1 -Execute

# JSON output for telemetry ingestion
./scripts/ai/sample-worker-metrics.ps1 -Execute -Json

# Custom stale threshold
./scripts/ai/sample-worker-metrics.ps1 -Execute -StaleMinutes 60

# Validate manifest without sampling
./scripts/ai/sample-worker-metrics.ps1 -DryRun

# Show help
./scripts/ai/sample-worker-metrics.ps1 -Help
```

## Report Schema

The JSON report has this shape:

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T14:00:00Z",
  "manifestVersion": 1,
  "manifestCapturedAt": "2026-05-11T13:55:00Z",
  "staleMinutes": 30,
  "workerCount": 2,
  "runningCount": 1,
  "staleCount": 1,
  "unknownCount": 0,
  "samples": [
    {
      "conflictGroup": "auth-core",
      "issue": 258,
      "branch": "claude/wave6-issue-258-auth-slice1",
      "sampledAt": "2026-05-11T14:00:00Z",
      "processFound": true,
      "pid": 12345,
      "cpuSeconds": 42.5,
      "workingSetMB": 312.4,
      "handleCount": 580,
      "threadCount": 24,
      "ageSeconds": 1800,
      "status": "running",
      "note": null
    }
  ]
}
```

### Sample Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conflictGroup` | string | yes | Worker conflict group from manifest. |
| `issue` | int or null | no | GitHub issue number. |
| `branch` | string | no | Git branch or worktree name. |
| `sampledAt` | ISO-8601 | yes | When this sample was taken. |
| `processFound` | boolean | yes | Whether a matching OS process was located. |
| `pid` | int or null | no | OS process ID (null when not found). |
| `cpuSeconds` | float or null | no | Cumulative CPU time in seconds. |
| `workingSetMB` | float or null | no | Working set memory in megabytes. |
| `handleCount` | int or null | no | Open handle count (Windows). |
| `threadCount` | int or null | no | Thread count. |
| `ageSeconds` | float or null | no | Seconds since the process was started. |
| `status` | string | yes | Worker status classification. |
| `note` | string or null | no | Diagnostic message (e.g., "No process matched"). |

### Status Classification

| Status | Meaning | Condition |
|--------|---------|-----------|
| `running` | Worker process is alive and active. | Process found, CPU > 0 or age < stale threshold. |
| `stale` | Worker process exists but appears hung. | Process found, CPU = 0, age > stale threshold. |
| `unknown` | Worker process could not be located. | No process matched the branch pattern. |

## Process Matching

The sampler uses a heuristic: it scans running processes for a command line containing the worker's branch name. This is intentionally conservative — when no match is found, `processFound` is `false`, all metric fields are `null`, and `status` is `unknown`.

Future iterations may resolve PIDs from:

- Worker heartbeat lock files.
- Worktree-scoped PID files written by the launcher.
- The state reconciler's running-worker projection.

## Dry-Run Contract

This script defaults to **dry-run mode**. In dry-run mode:

- No processes are sampled.
- No output files are written.
- The script prints what it *would* do and exits.

To actually sample and write metrics, pass `-Execute` explicitly.

## Integration Points

| Consumer | How It Uses This Report |
|----------|------------------------|
| **WebUI dashboard** | Displays worker status, CPU, memory, and age in the monitoring view. |
| **Scheduler** | Reads `status` to avoid dispatching work to stale workers. |
| **Orchestrator** | Reads `workingSetMB` to detect memory pressure before scheduling new workers. |
| **Stale worker detector** | Flags workers with `status: stale` or `processFound: false`. |

## Design Decisions

- **Dry-run by default.** The sampler never modifies state unless `-Execute` is passed.
- **Read-only.** The sampler never kills processes or modifies the manifest.
- **Null-safe.** Missing processes produce null metrics, not errors. Consumers distinguish "no data" from "zero."
- **No secrets.** The report contains only process metrics and manifest metadata.
- **Schema versioned.** `schemaVersion` enables forward-compatible evolution.
- **Manifest-faithful.** The sampler trusts the manifest as the source of truth for which workers are active.

## See Also

- [Active Workers State](active-workers-state.md) — Manifest schema and reconciler ownership
- [Active Worker Resource Sampler](active-worker-resource-sampler.md) — Per-worker OS-level resource sampling
- [Resource Pressure Sampler](resource-pressure-sampler.md) — Machine-level pressure classification
- [Monitor State Schema](monitor-state-schema.md) — Heartbeat state classification
- [Launch Gate](launch-gate.md) — Pre-dispatch conflict detection
