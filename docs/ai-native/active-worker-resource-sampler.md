# Active Worker Resource Sampler

Samples OS-level resource usage (CPU, memory, handles, threads) for each active worker process listed in the active-workers state projection.

## Purpose

The control plane tracks worker liveness via heartbeats and the active-workers manifest, but does not capture resource pressure. The resource sampler fills this gap by periodically reading the manifest and sampling each worker's process footprint, enabling:

- **Capacity planning:** Detect when workers approach memory or CPU limits before they OOM or thrash.
- **Cost attribution:** Correlate resource usage with task metadata (issue, conflict group) for per-issue cost estimates.
- **Stale worker detection:** A worker with zero CPU for an extended period may be hung.

## Script

`scripts/ai/sample-active-worker-resources.ps1`

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ManifestFile` | string | `./.github/ai-state/active-workers.json` | Path to the active-workers state projection. |
| `Json` | switch | off | Output report as JSON instead of console table. |
| `DryRun` | switch | off | Print manifest contents without sampling processes. |
| `Help` | switch | off | Show full PowerShell help. |

### Usage

```powershell
# Console table output
./scripts/ai/sample-active-worker-resources.ps1

# JSON for telemetry ingestion
./scripts/ai/sample-active-worker-resources.ps1 -Json

# Validate manifest without sampling
./scripts/ai/sample-active-worker-resources.ps1 -DryRun

# Show help
./scripts/ai/sample-active-worker-resources.ps1 -Help
```

## Report Schema

The JSON report has this shape:

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T14:00:00Z",
  "manifestVersion": 1,
  "manifestCapturedAt": "2026-05-11T13:55:00Z",
  "workerCount": 2,
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
| `note` | string or null | no | Diagnostic message (e.g., "No process matched"). |

## Process Matching

The skeleton uses a heuristic: it scans running processes for a command line containing the worker's branch name. This is intentionally conservative — when no match is found, `processFound` is `false` and all metric fields are `null`.

Future iterations may resolve PIDs from:

- Worker heartbeat lock files.
- Worktree-scoped PID files written by the launcher.
- The state reconciler's running-worker projection.

## Integration Points

| Consumer | How It Uses This Report |
|----------|------------------------|
| **Telemetry calculator** | Joins resource samples with task telemetry for cost attribution. |
| **Orchestrator** | Reads `workingSetMB` to detect memory pressure before scheduling new workers. |
| **Monitoring dashboard** | Plots `cpuSeconds` and `workingSetMB` over time per conflict group. |
| **Stale worker detector** | Flags workers with `processFound: false` or zero CPU delta across samples. |

## Design Decisions

- **Read-only.** The sampler never modifies the manifest or kills processes.
- **Null-safe.** Missing processes produce null metrics, not errors. Consumers distinguish "no data" from "zero."
- **No secrets.** The report contains only process metrics and manifest metadata.
- **Schema versioned.** `schemaVersion` enables forward-compatible evolution.
- **Manifest-faithful.** The sampler trusts the manifest as the source of truth for which workers are active.

## See Also

- [Active Workers State](active-workers-state.md) — Manifest schema and reconciler ownership
- [Worker Telemetry Schema](worker-telemetry-schema.md) — Post-task cost and outcome telemetry
- [Worker Heartbeat](worker-heartbeat.md) — Worker liveness signals
- [Launch Gate](launch-gate.md) — Pre-dispatch conflict detection
