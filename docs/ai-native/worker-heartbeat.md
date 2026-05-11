# Worker Heartbeat Monitor

Self-hosted monitor that watches a Claude Code batch worker and emits
structured state snapshots so silent workers stay visible.

## Problem

Background batch workers can go quiet — the process is still running but
produces no stdout/stderr for minutes. Without a heartbeat, the orchestrator
and human reviewers cannot distinguish "working hard in silence" from "hung."
This monitor closes that gap.

## State Machine

```
                    +-----------+
                    |  running  |<----- output activity resets timer
                    +-----------+
                         |
            no output > 60s
                         v
                +-----------------+
                | running:no-output|
                +-----------------+
                         |
            no output > 5 min
                         v
                    +--------+
                    | stale  |
                    +--------+

    Process exits:  exit code 0  -->  done
                    exit code !=0 -->  failed
```

### State Definitions

| State | Meaning |
|-------|---------|
| `running` | Process is alive and recently produced output. |
| `running:no-output` | Process is alive but stdout/stderr has been silent for > 60 seconds. |
| `stale` | Process is alive but no output for > 5 minutes. Likely needs attention. |
| `done` | Process exited with code 0. |
| `failed` | Process exited with a non-zero code. |

## Snapshot Schema

Each heartbeat writes a JSON snapshot conforming to
[`scripts/ai/monitor-state.schema.json`](../../scripts/ai/monitor-state.schema.json).

Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `snapshotVersion` | `1` | Schema version |
| `taskId` | string | Process ID or manifest key |
| `state` | enum | One of the five states above |
| `elapsedMs` | int | Milliseconds since launch |
| `lastOutputAt` | ISO-8601 | Last stdout/stderr activity |
| `capturedAt` | ISO-8601 | When this snapshot was taken |
| `exitCode` | int/null | Exit code, null while running |
| `noOutputMs` | int | Milliseconds since last output |
| `issueNumber` | int/null | Linked GitHub issue |

## Usage

### Basic

```powershell
# Start a Claude Code batch worker
$proc = Start-Process -FilePath "claude" -ArgumentList "--batch","--issue","87" -PassThru

# Monitor it
.\scripts\ai\wait-claude-batch.ps1 -ProcessId $proc.Id -IssueNumber 87
```

### Custom Thresholds

```powershell
.\scripts\ai\wait-claude-batch.ps1 `
    -ProcessId 12345 `
    -NoOutputThresholdMs 120000 `
    -StaleThresholdMs 600000 `
    -PollIntervalMs 30000
```

### Reading the Snapshot

The monitor writes to `./scripts/ai/monitor-state.json` by default:

```json
{
  "snapshotVersion": 1,
  "taskId": "12345",
  "state": "running",
  "elapsedMs": 45200,
  "lastOutputAt": "2026-05-11T10:30:00Z",
  "capturedAt": "2026-05-11T10:30:15Z",
  "exitCode": null,
  "noOutputMs": 15000,
  "issueNumber": 87,
  "prNumber": null,
  "label": null
}
```

## Design Decisions

### Local snapshots only (no GitHub heartbeat publishing)

The initial implementation writes snapshots to a local file. GitHub issue
comment publishing is deferred because:

- Token scope requirements vary across forks and CI environments.
- Raw status comments can clutter issue threads.
- Local snapshots are sufficient for orchestrator-side monitoring.

A future option (`-PublishHeartbeat`) may post minimal status comments to
the linked GitHub issue, gated behind explicit token scope verification.

### No raw log dumping

The snapshot contains **metadata only** — elapsed time, state classification,
and timestamps. It never includes stdout/stderr content, file paths, or
command output. This prevents accidental secret leakage.

### Process exit detection

The script polls `Get-Process` to detect when the worker exits. After exit,
it reads the exit code and writes a final `done` or `failed` snapshot before
terminating.

## Integration with SOP

This monitor implements the "running heartbeat visibility" requirement from
the [worker acceptance checklist](worker-acceptance-checklist.md). It fills
the gap between worker launch and `agent:done` described in the
[SOP batch execution section](SOP.md#batch-execution).

## Files

| File | Purpose |
|------|---------|
| `scripts/ai/wait-claude-batch.ps1` | PowerShell monitor script |
| `scripts/ai/monitor-state.schema.json` | JSON Schema for snapshots |
| `docs/ai-native/worker-heartbeat.md` | This document |
