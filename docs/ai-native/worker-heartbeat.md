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

### Publish on Complete

Opt in to publishing a sanitized result comment when the worker exits:

```powershell
# Target an issue
.\scripts\ai\wait-claude-batch.ps1 `
    -ProcessId 12345 `
    -PublishOnComplete `
    -Repo "owner/repo" `
    -IssueNumber 87

# Target a PR with a specific result kind
.\scripts\ai\wait-claude-batch.ps1 `
    -ProcessId 12345 `
    -PublishOnComplete `
    -Repo "owner/repo" `
    -PRNumber 90 `
    -PublishKind review
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

### Local snapshots only by default

The default mode writes snapshots to a local file only. GitHub comment
publishing is opt-in via `-PublishOnComplete`. Reasons for opt-in default:

- Token scope requirements vary across forks and CI environments.
- Raw status comments can clutter issue threads.
- Local snapshots are sufficient for orchestrator-side monitoring.

### Publish-on-complete

When `-PublishOnComplete` is set, the monitor invokes
`publish-agent-result.ps1` after the worker exits. This posts a single
sanitized summary comment with idempotent markers to the target issue or
PR. Key guarantees:

- **No raw logs** — only state, exit code, and elapsed time are published.
- **Idempotent by marker** — re-running the monitor updates the same
  comment. If the marker already exists, the publisher PATCHes the
  existing comment instead of creating a duplicate. See the
  [idempotency contract](result-publishing.md#idempotency-contract)
  for full details.
- **Local-only default** — publishing never happens unless explicitly opted in.
- **Fail-safe** — publish errors are warnings; the monitor always writes the
  final local snapshot regardless.

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

## Monitor Contract

The heartbeat monitor follows a formal contract that the orchestrator and
state reconciler depend on.

### Expected Behaviors

| Behavior | Guarantee |
|----------|-----------|
| Snapshot cadence | Writes a JSON snapshot every `PollIntervalMs` (default 15s) while the process is alive. |
| Final snapshot | Always writes a `done` or `failed` snapshot on process exit, even if the last poll was recent. |
| No raw logs | Snapshots contain metadata only — state, elapsed time, timestamps, exit code. No stdout/stderr content. |
| No secrets | Snapshot fields never include tokens, paths, env vars, or command output. |
| Idempotent file | Each snapshot overwrites the previous one; the file always reflects the latest state. |
| Label mapping | The `label` field maps heartbeat states to `agent:*` labels for reconciler consumption. |

### Label Mapping

The monitor maps its internal states to the `agent:*` label vocabulary used
by the state reconciler and issue lifecycle:

| Heartbeat State | Mapped Label | Reconciler Interpretation |
|-----------------|--------------|---------------------------|
| `running` | `agent:running` | Worker is active |
| `running:no-output` | `agent:running` | Worker is active but silent — may need attention |
| `stale` | `agent:running` | Worker is likely hung — reconciler should flag |
| `done` | `agent:done` | Worker completed successfully |
| `failed` | `agent:running` | Worker exited non-zero — may need re-launch |

The label is written into each snapshot so the state reconciler can
consume it without re-classifying the heartbeat state.

### Snapshot Completeness

A well-formed snapshot includes all fields from the schema. The monitor
populates:

| Field | Source | Notes |
|-------|--------|-------|
| `taskId` | `-TaskId` param or PID | Always set |
| `issueNumber` | `-IssueNumber` param | Null if not provided |
| `prNumber` | `-PRNumber` param | Null if not provided |
| `label` | Derived from state | Always set (see mapping above) |

## Stale State Visibility for Reconciliation

The heartbeat monitor is the primary source of truth for detecting silent
or hung workers. The state reconciler consumes heartbeat snapshots as
"worker evidence" (highest precedence in the evidence chain).

### How Stale Detection Works

```
Worker produces output  -->  lastOutputAt resets
         |
         | (time passes with no output)
         v
noOutputMs > 60s   -->  state: running:no-output
noOutputMs > 5min  -->  state: stale
```

When the state reconciler encounters a worker in `stale` state:

1. The snapshot's `label` field still reads `agent:running`.
2. The reconciler's `stale-running` rule checks whether the issue has
   been `agent:running` for longer than the stale threshold (default 72h).
3. If the heartbeat shows `stale` but the issue label is still
   `agent:running`, this is strong evidence of a hung worker.

### Reconciler Integration

The state reconciler evaluates evidence in this precedence order:

1. **Worker evidence** (heartbeat snapshots, result comments)
2. **PR state** (open, merged, closed)
3. **Issue labels** (`agent:*`)

The heartbeat snapshot is the canonical worker evidence. When the
reconciler detects:

| Heartbeat State | Issue Label | PR State | Reconciler Action |
|-----------------|-------------|----------|-------------------|
| `stale` | `agent:running` | No open PR | Flag as `stale-running` (warning) |
| `done` | `agent:running` | Merged PR | Flag as `merged-pr-open-issue` (error) |
| `done` | `agent:done` | No merged PR | Flag as `done-without-merge` (error) |
| `failed` | `agent:running` | No open PR | Suggest re-launch or `agent:blocked` |

### Reading Snapshot for Downstream Tools

The snapshot file (`monitor-state.json`) is designed for machine consumption:

```powershell
# Read current state
$snapshot = Get-Content ./scripts/ai/monitor-state.json | ConvertFrom-Json

# Check if worker is stale
if ($snapshot.state -eq "stale") {
    Write-Warning "Worker $($snapshot.taskId) is stale ($($snapshot.noOutputMs)ms silent)"
}

# Feed to state reconciler
$snapshot.label  # "agent:running", "agent:done", etc.
```

## Files

| File | Purpose |
|------|---------|
| `scripts/ai/wait-claude-batch.ps1` | PowerShell monitor script |
| `scripts/ai/publish-agent-result.ps1` | Result publisher (invoked by `-PublishOnComplete`) |
| `scripts/ai/monitor-state.schema.json` | JSON Schema for snapshots |
| `docs/ai-native/worker-heartbeat.md` | This document |
