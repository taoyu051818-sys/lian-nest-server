# Auto-Merge Queue Mode

Queue-based controlled auto-merge for orchestration exit. This is the
final control-loop layer that allows Codex to exit routine orchestration
by processing PRs from a queue file with state tracking and configurable
exit conditions.

> **Closes:** [#591](https://github.com/taoyu051818-sys/lian-nest-server/issues/591)

---

## When to Use

Use queue mode when you need to:

- Process multiple PRs from a managed queue
- Track merge progress across batches
- Support orchestration exit conditions
- Maintain state between merge runs
- Integrate with the broader AI-native orchestration system

**Do NOT use queue mode for:**

- One-off merges (use inline `-PRs` instead)
- PRs not in the queue file
- High-risk PRs requiring human review

---

## Quick Start

```powershell
# Queue mode dry-run (default) — validate queue file
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name

# Queue mode execute — process queue with real merges
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute

# Show queue status
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueStatus

# Reset queue state
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueReset
```

---

## Queue File Format

The queue file (default: `.ai/merge-queue.json`) contains PRs to process
in priority order:

```json
{
  "queue": [
    { "pr": 42, "priority": 1 },
    { "pr": 45, "priority": 2 },
    { "pr": 50, "priority": 3 }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `queue` | array | List of PRs to process |
| `queue[].pr` | integer | PR number |
| `queue[].priority` | integer | Priority (lower = higher priority) |

### Queue File Location

Default: `.ai/merge-queue.json`

Override with `-QueueFile`:

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -QueueFile .\custom-queue.json
```

---

## Queue State

Queue mode tracks state between runs in `.ai/merge-queue-state.json`:

```json
{
  "processedPRs": [42, 45],
  "failedPRs": [51],
  "totalBatches": 2,
  "totalMerged": 2,
  "totalFailed": 1,
  "lastBatchId": "merge-batch-2026-05-11T17-30-00Z",
  "lastRunTimestamp": "2026-05-11T17:35:00.0000000Z",
  "state": "idle"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `processedPRs` | array | PRs successfully processed |
| `failedPRs` | array | PRs that failed processing |
| `totalBatches` | integer | Total batches executed |
| `totalMerged` | integer | Total PRs merged |
| `totalFailed` | integer | Total PRs failed |
| `lastBatchId` | string | ID of last batch |
| `lastRunTimestamp` | string | ISO 8601 UTC timestamp |
| `state` | string | Current state (`idle`, `running`) |

### State Management

- **idle**: Queue is not processing
- **running**: Queue is actively processing

The state file is automatically updated after each batch.

---

## Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `-QueueMode` | Yes* | Enable queue processing mode | — |
| `-Repo` | Yes** | Target repository in `OWNER/NAME` format | `GH_REPO` env |
| `-Execute` | No | Perform real merges (default is dry-run) | dry-run |
| `-QueueFile` | No | Path to queue file | `.ai/merge-queue.json` |
| `-MaxBatches` | No | Maximum batches to process (0 = unlimited) | `1` |
| `-MaxFailures` | No | Maximum failures before stopping | `1` |
| `-RunHealthGate` | No | Run post-merge health gate | — |
| `-PostHealthCommand` | No | Custom health command | `scripts/post-merge-health-gate.js` |
| `-RunGuards` | No | Run guard checks before merge | — |
| `-QueueStatus` | No | Show queue status and exit | — |
| `-QueueReset` | No | Reset queue state and exit | — |

\* Either `-QueueMode`, `-QueueStatus`, or `-QueueReset` is required.
\** Falls back to `GH_REPO` environment variable.

---

## Exit Conditions

Queue mode stops processing when any of the following occur:

| Condition | Description |
|-----------|-------------|
| Max batches reached | Processed `$MaxBatches` batches |
| Max failures reached | Encountered `$MaxFailures` failures |
| No pending PRs | All PRs in queue have been processed |
| Manual stop | Ctrl+C or process termination |

### Default Behavior

- **MaxBatches = 1**: Process only one batch (default)
- **MaxFailures = 1**: Stop on first failure (default)

### Unlimited Processing

```powershell
# Process all PRs in queue (unlimited batches, stop on first failure)
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -MaxBatches 0

# Process up to 5 batches, allow 3 failures
.\scripts\ai\merge-clean-pratch.ps1 -QueueMode -Repo owner/name -MaxBatches 5 -MaxFailures 3
```

---

## Safety Guarantees

| Guarantee | How |
|-----------|-----|
| Dry-run default | No merges without `-Execute` |
| Explicit queue | Only PRs in queue file are processed |
| Priority ordering | PRs processed by priority (lower = first) |
| State tracking | Processed/failed PRs tracked between runs |
| Fail-fast | Stops on first failure (configurable) |
| Guard integration | `-RunGuards` enforces boundary checks |
| Health gate | `-RunHealthGate` verifies post-merge health |
| Manifest write | Every batch writes a manifest |

---

## Queue Processing Flow

```
1. Read queue file (.ai/merge-queue.json)
2. Read queue state (.ai/merge-queue-state.json)
3. Determine next batch (pending PRs, sorted by priority)
4. Process batch:
   a. Validate each PR (eligibility + guards)
   b. If dry-run: mark as processed, write manifest
   c. If execute: merge PRs, update state, write manifest
5. Check exit conditions
6. If more batches allowed, go to step 3
7. Write final state, exit
```

### Batch Processing

Each batch:

1. **Validates PRs**: Checks eligibility (non-draft, CLEAN, mergeable)
2. **Runs guards** (if `-RunGuards`): Task boundary, PR handoff, docs authority, generated Prisma
3. **Merges or validates**:
   - Dry-run: Marks PRs as processed, writes manifest
   - Execute: Merges PRs sequentially, stops on first failure
4. **Updates state**: Records processed/failed PRs
5. **Writes manifest**: Batch manifest to `.ai/merge-batch-manifests/`

---

## Integration with Orchestration

Queue mode is the final control-loop layer that allows Codex to exit
routine orchestration:

### Orchestration Exit

```powershell
# Codex calls queue mode to process remaining PRs
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute -MaxBatches 0

# Queue processes all PRs, exits when done
# Codex exits orchestration loop
```

### State Recovery

If queue mode is interrupted (Ctrl+C, process kill):

1. State is saved after each batch
2. Next run resumes from where it left off
3. Processed PRs are skipped

```powershell
# First run (interrupted after batch 1)
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute

# Second run (resumes from batch 2)
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute
```

### Health Gate Integration

```powershell
# Run health gate after each batch
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute -RunHealthGate

# Custom health command
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute -RunHealthGate -PostHealthCommand "scripts/custom-check.js --strict"
```

---

## Queue Management

### Show Queue Status

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueStatus
```

Output:

```
========================================================================
  Queue Status
========================================================================

  Queue file  : F:\repo\.ai\merge-queue.json
  State       : idle
  Total PRs   : 5
  Pending     : 2
  Processed   : 2
  Failed      : 1
  Batches run : 2
  Total merged: 2

  Last batch  : merge-batch-2026-05-11T17-30-00Z
  Last run    : 2026-05-11T17:35:00.0000000Z

  Pending PRs:
    PR #50 (priority: 3)
    PR #60 (priority: 4)

  Failed PRs:
    PR #51
```

### Reset Queue State

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueReset
```

This resets the state file, allowing reprocessing of all PRs in the queue.

### Update Queue File

Edit `.ai/merge-queue.json` to add/remove/reorder PRs:

```json
{
  "queue": [
    { "pr": 42, "priority": 1 },
    { "pr": 45, "priority": 2 },
    { "pr": 50, "priority": 3 },
    { "pr": 60, "priority": 4 },
    { "pr": 70, "priority": 5 }
  ]
}
```

Queue mode will automatically pick up new PRs on next run.

---

## Self-Test

Validate queue mode behavior without contacting GitHub:

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueSelfTest
```

Tests:

1. Queue file creation and reading
2. Queue state initialization
3. Queue state persistence
4. Next batch extraction
5. Queue state reset
6. Queue file update

---

## Examples

### Basic Queue Processing

```powershell
# Create queue file
@"
{
  "queue": [
    { "pr": 42, "priority": 1 },
    { "pr": 45, "priority": 2 }
  ]
}
"@ | Set-Content .ai/merge-queue.json

# Dry-run queue
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name

# Execute queue
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute
```

### Orchestration Exit

```powershell
# Codex processes all queued PRs
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute -MaxBatches 0 -RunHealthGate

# Exit orchestration when queue is empty
```

### Recovery After Interruption

```powershell
# First run (interrupted)
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute
# Ctrl+C after batch 1

# Second run (resumes)
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -Execute
# Continues from batch 2
```

### Custom Queue File

```powershell
# Use custom queue file
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -QueueFile .\my-queue.json

# Process up to 3 batches
.\scripts\ai\merge-clean-pr-batch.ps1 -QueueMode -Repo owner/name -QueueFile .\my-queue.json -MaxBatches 3
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Queue processed successfully (all batches completed) |
| 1 | Queue failed (max failures reached or error) |

---

## Manifest Integration

Each batch in queue mode writes a manifest to `.ai/merge-batch-manifests/`
with the same schema as non-queue mode. The manifest includes:

- `batchId`: Unique batch identifier
- `timestamp`: ISO 8601 UTC timestamp
- `repository`: Target repository
- `mode`: `dry-run` or `execute`
- `prs`: Per-PR outcomes
- `preCommit` / `postCommit`: Git SHAs (execute only)
- `healthGate`: Health gate result
- `blockedPrs`: PRs blocked by guards
- `failureReason`: Batch failure reason

See [controlled-auto-merge.md](controlled-auto-merge.md) for full manifest schema.

---

## See Also

- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge script
- [Merge Closure SOP](merge-closure-sop.md) — Merge procedure
- [Merge Queue Assistant](merge-queue-assistant.md) — PR discovery
- [Merge Policy](merge-policy.md) — Policy definitions
- [SOP](SOP.md) — Full development lifecycle
- [#591](https://github.com/taoyu051818-sys/lian-nest-server/issues/591) — This feature
