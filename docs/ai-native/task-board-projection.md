# Task Board Projection

Defines a durable, Hermes-inspired task board projection for the
LIAN AI-native control plane. Provides a machine-readable view of
task lifecycle states and transitions, consumed by the Command
Steward, orchestrator, and launch gate.

> **Closes:** [#1211](https://github.com/taoyu051818-sys/lian-nest-server/issues/1211)
>
> **See also:**
> [command-steward-agent.md](command-steward-agent.md) for the
> human-facing control-plane interface,
> [issue-lifecycle.md](issue-lifecycle.md) for GitHub issue state
> definitions, [worker-task-contract.md](worker-task-contract.md)
> for the task JSON schema,
> [launch-gate.md](launch-gate.md) for pre-launch validation,
> [active-workers-state.md](active-workers-state.md) for the
> running worker projection,
> [launch-locks-state.md](launch-locks-state.md) for lock state.

---

## Purpose

The AI-native control plane dispatches parallel workers against
GitHub issues. Without a unified task board projection, worker
state is scattered across GitHub labels, branch names, worktree
directories, and lock files. This document defines a single
projection that:

1. **Consolidates task state.** One file captures every task's
   lifecycle position — triage, todo, ready, running, blocked, done, or archived.
2. **Enables conflict detection.** The launch gate and orchestrator
   read the projection to prevent scheduling collisions.
3. **Supports stale reclaim.** Workers that stop heartbeating are
   detected and their tasks can be reclaimed.

### Relationship to GitHub (Source of Truth)

GitHub issues and PRs remain the **authoritative source of truth**
for task semantics — acceptance criteria, business rules, scope,
and review decisions. The task board projection is a
**derived operational view** — it mirrors lifecycle state for
scheduling and coordination purposes.

| Concern | Source of Truth |
|---------|----------------|
| Task definition, scope, acceptance | GitHub issue body |
| Review, approval, merge | GitHub PR |
| Lifecycle position (ready/running/blocked/done) | **This projection** |
| Scheduling boundaries | Task JSON (`allowedFiles`, `conflictGroup`) |

If the projection and GitHub disagree, **GitHub wins**. The
reconciler detects and resolves drift (see
[state-reconciler.md](state-reconciler.md)).

---

## States

```
          triage             queue              claim              heartbeat-ok
 TRIAGE ────────► TODO ────────► OPEN ────────► READY ──────────────────► RUNNING
                  │  ▲           │               │  ▲                        │  ▲
                  │  │           │               │  │                        │  │
           triage │  │ backlog   │        block  │  │  reclaim        block  │  │  reclaim
                  ▼  │           ▼               ▼  │                        ▼  │
                TRIAGE        TODO             BLOCKED                      BLOCKED
                                                        │                       │
                                                        │  resolve              │  resolve
                                                        ▼                       ▼
                                                       READY                  RUNNING
                                                                                │
                                                                         complete│
                                                                                ▼
                                                                              DONE
                                                                                │
                                                                         archive│
                                                                                ▼
                                                                           ARCHIVED
```

### State Definitions

| State | Meaning | Who Sets |
|-------|---------|----------|
| `TRIAGE` | Issue needs triage before being actionable. Has `agent:triage` label. | Steward / Intake |
| `TODO` | Issue triaged and backlogged but not yet queued for execution. Has `agent:todo` label. | Steward |
| `OPEN` | Issue exists but no worker has claimed it. Matches GitHub `OPEN` state with no `agent:*` label. | GitHub state |
| `READY` | Issue triaged, task JSON compiled, eligible for dispatch. Has `agent:queued` label. | Orchestrator / Steward |
| `RUNNING` | Worker actively executing. Has `agent:running` label and an active heartbeat. | Worker |
| `BLOCKED` | Worker cannot proceed — dependency, gate failure, or external blocker. Has `agent:blocked` label. | Worker / Reviewer |
| `DONE` | Work completed — PR merged or task finished. Has `agent:done` label. | Worker / Merge gate |
| `ARCHIVED` | Task is no longer relevant or has been superseded. Has `agent:archived` label. | Steward / Reconciler |

---

## Projection Schema

The projection lives at `.github/ai-state/task-board.json`.

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "2026-05-12T09:00:00Z",
  "tasks": [
    {
      "issue": 258,
      "state": "running",
      "conflictGroup": "auth-core",
      "worker": {
        "branch": "claude/wave6-20260511-090000-issue-258",
        "claimant": "backend-programmer",
        "claimedAt": "2026-05-11T09:00:00Z",
        "lastHeartbeat": "2026-05-11T09:25:00Z",
        "expiresAt": "2026-05-11T10:30:00Z"
      },
      "blockedReason": null,
      "linkedPR": null
    },
    {
      "issue": 310,
      "state": "blocked",
      "conflictGroup": "posts",
      "worker": {
        "branch": "claude/wave6-20260511-100000-issue-310",
        "claimant": "backend-programmer",
        "claimedAt": "2026-05-11T10:00:00Z",
        "lastHeartbeat": "2026-05-11T10:15:00Z",
        "expiresAt": "2026-05-11T11:30:00Z"
      },
      "blockedReason": "Waiting on issue #258 to merge first (blockedBy dependency)",
      "linkedPR": null
    },
    {
      "issue": 275,
      "state": "done",
      "conflictGroup": "ai-native-docs",
      "worker": null,
      "blockedReason": null,
      "linkedPR": 276
    }
  ]
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `markerVersion` | `number` | Schema version. Current: `1`. |
| `capturedAt` | `string` (ISO 8601) | When the projection was last written. |
| `tasks` | `array` | Task entries. Empty array when no tasks are tracked. |

### Task Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issue` | `number` | Yes | GitHub issue number. |
| `state` | `string` | Yes | One of `triage`, `todo`, `open`, `ready`, `running`, `blocked`, `done`, `archived`. |
| `conflictGroup` | `string` | Yes | Conflict group from task JSON. |
| `worker` | `object \| null` | Yes | Worker details when `state` is `ready`, `running`, or `blocked`. `null` for `triage`, `todo`, `open`, `done`, and `archived`. |
| `worker.branch` | `string` | Yes | Git worktree branch name. |
| `worker.claimant` | `string` | Yes | Role that claimed the task (e.g. `backend-programmer`). |
| `worker.claimedAt` | `string` (ISO 8601) | Yes | When the task was claimed. |
| `worker.lastHeartbeat` | `string` (ISO 8601) | Yes | Last heartbeat timestamp. Used for stale detection. |
| `worker.expiresAt` | `string` (ISO 8601) | Yes | When the claim expires if not refreshed. Derived from task `hardTimeMinutes`. |
| `blockedReason` | `string \| null` | Yes | Human-readable reason when `state` is `blocked`. `null` otherwise. |
| `linkedPR` | `number \| null` | Yes | PR number when a PR has been opened. `null` if no PR yet. |

---

## Operations

Every task transition is an explicit operation. The projection
does not infer state — it is written by known actors at known
moments.

### claim

A worker claims a task for execution. Transitions from `READY` to
`RUNNING`.

| Property | Value |
|----------|-------|
| **Actor** | Orchestrator (on behalf of worker) |
| **Precondition** | Task is `READY` or `OPEN`. No conflicting lock held. Launch gate passes. |
| **Effect** | Sets `state` to `running`. Populates `worker` fields. Acquires launch lock. |
| **Anti-stomp** | Only one claim per `conflictGroup` at a time. Claim fails if a non-expired claim already exists for the same conflict group. |

### heartbeat

Worker signals liveness. Refreshes the `expiresAt` deadline.

| Property | Value |
|----------|-------|
| **Actor** | Worker |
| **Precondition** | Task is `RUNNING` or `BLOCKED`. Worker owns the claim. |
| **Effect** | Updates `lastHeartbeat` and extends `expiresAt` by the configured interval. |
| **Frequency** | Every 10–15 minutes. Missing two consecutive heartbeats marks the task stale. |

### complete

Worker signals task completion. Transitions to `DONE`.

| Property | Value |
|----------|-------|
| **Actor** | Worker / Merge gate |
| **Precondition** | Task is `RUNNING`. PR is merged or task is otherwise finished. |
| **Effect** | Sets `state` to `done`. Clears `worker` (sets to `null`). Sets `linkedPR`. Releases launch lock. |
| **Label** | Sets `agent:done` label on the GitHub issue. |

### block

Worker signals it cannot proceed. Transitions from `RUNNING` to
`BLOCKED`.

| Property | Value |
|----------|-------|
| **Actor** | Worker / Reviewer |
| **Precondition** | Task is `RUNNING`. |
| **Effect** | Sets `state` to `blocked`. Populates `blockedReason`. Lock is held (not released). |
| **Label** | Sets `agent:blocked` label on the GitHub issue. |

### reclaim

Orchestrator reclaims a stale or abandoned task. Transitions back
to `READY` for re-dispatch.

| Property | Value |
|----------|-------|
| **Actor** | Orchestrator / State reconciler |
| **Precondition** | Task is `RUNNING` or `BLOCKED`. Claim has expired (`expiresAt` in the past AND no heartbeat in the last 30 minutes). |
| **Effect** | Sets `state` to `ready`. Clears `worker`. Releases the launch lock. |
| **Label** | Sets `agent:queued` label on the GitHub issue. |
| **Safety** | Reclaim does NOT delete the worktree. The stale worktree is left for human review before cleanup. |

---

## Anti-Stomp Rules

Prevent concurrent actors from corrupting the projection:

| Rule | Enforcement |
|------|-------------|
| **One claim per conflict group** | Claim operation checks the projection for an existing non-expired claim in the same `conflictGroup`. If one exists and is not stale, claim is rejected. |
| **Heartbeat ownership check** | Heartbeat updates require the caller to match the existing `claimant`. A different role cannot refresh another worker's heartbeat. |
| **Complete requires ownership** | Only the owning worker (or the merge gate on its behalf) can mark a task `done`. |
| **Reclaim requires expiry** | Reclaim is only allowed when `expiresAt` is in the past AND `lastHeartbeat` is older than 30 minutes. This prevents reclaiming slow-but-active workers. |
| **Projection writes are atomic** | Each write replaces the full file. No partial updates. Consumers read the full projection, not individual task entries. |

---

## Stale Worker Reclaim Policy

A worker is considered **stale** when:

1. `expiresAt` is in the past, AND
2. `lastHeartbeat` is older than 30 minutes.

### Detection

The state reconciler scans the projection on each cycle and
compares `lastHeartbeat` against the current time. Stale entries
are reported in the reconciler's drift report.

### Reclaim Flow

```
Reconciler detects stale task
         │
         ▼
  Is the worker's PR still open?
    ├── Yes → Leave PR open, reclaim task to READY
    └── No  → Check if branch was merged
              ├── Merged → Mark DONE
              └── Not merged → Reclaim to READY, flag worktree for cleanup
```

### Safety Constraints

| Constraint | Rationale |
|------------|-----------|
| Never auto-delete worktrees | Stale worktrees may contain partial work worth preserving. Human reviews before cleanup. |
| Never force-push or reset branches | A reclaimed task gets a new worktree. The old branch is left intact. |
| Log all reclaims | Every reclaim operation writes an entry to the audit log with the stale task's issue, branch, and last heartbeat time. |

---

## Integration with Existing Projections

The task board projection composes with the existing state files:

| Projection | Relationship |
|------------|-------------|
| `active-workers.json` | Task board subsumes this for lifecycle state. Active workers projection remains the source for `conflictGroup` conflict detection in the launch gate. |
| `launch-locks.json` | Task board tracks claim ownership. Launch locks track file-level write conflicts. Both must agree on which workers are active. |
| `main-health.json` | Health state gates which worker types may launch. Task board does not override health gates. |
| GitHub issue labels (`agent:*`) | Labels are the human-visible mirror. The task board is the machine-readable mirror. Both must agree; the reconciler enforces consistency. |

### Consumers

| Consumer | Usage |
|----------|-------|
| **Command Steward** | Reads the projection for the daily brief — counts tasks by state, identifies stale workers. |
| **Launch gate** | Reads to detect conflict group overlaps before dispatch (may read `active-workers.json` instead for this purpose). |
| **State reconciler** | Reads to detect drift between projection state, GitHub labels, and PR status. |
| **Orchestrator** | Reads before dispatch to find claimable tasks. Writes on claim, complete, and reclaim. |
| **Monitoring** | Reads `capturedAt` to detect stale projections. |

---

## Mapping to GitHub

| Projection State | GitHub Issue State | `agent:*` Label |
|------------------|--------------------|-----------------|
| `TRIAGE` | `OPEN` | `agent:triage` |
| `TODO` | `OPEN` | `agent:todo` |
| `OPEN` | `OPEN` (no agent label) | None |
| `READY` | `OPEN` | `agent:queued` |
| `RUNNING` | `OPEN` | `agent:running` |
| `BLOCKED` | `OPEN` | `agent:blocked` |
| `DONE` | `CLOSED` (after merge) | `agent:done` |
| `ARCHIVED` | `CLOSED` | `agent:archived` |

The reconciler ensures these stay in sync. If the projection says
`RUNNING` but the GitHub issue has `agent:done`, the reconciler
flags drift and resolves in favor of GitHub (source of truth).

---

## Relationship to Knowledge-Driven Scaling

The task board projection supports
[knowledge-driven-scaling.md](knowledge-driven-scaling.md) Rule 1
(Knowledge Writeback):

| Scaling Rule | How Task Board Supports It |
|--------------|---------------------------|
| Knowledge writeback | `DONE` tasks in the projection are checked against `knowledge-updates.ndjson` for corresponding entries. |
| Verifiable value | `DONE` tasks without a merged PR or knowledge entry are flagged as `unverified-value`. |
| Governed scale | The projection's task count by state feeds the scale-tier decision (how many workers are active vs. completed). |

---

## Design Decisions

- **Projection, not log.** Each write replaces the full state.
  No append-only history. History lives in GitHub (issues, PRs,
  audit log).
- **GitHub is source of truth.** The projection is derived. When
  in doubt, reconcile toward GitHub state.
- **No secrets.** Task entries contain only scheduling metadata —
  no tokens, credentials, or PII.
- **Schema versioning.** `markerVersion` enables forward-compatible
  changes without breaking consumers.
- **Atomic writes.** The full file is replaced on each update.
  Consumers always read a consistent snapshot.
- **Heartbeat-gated reclaim.** Reclaim requires both expiry AND
  missed heartbeats. This prevents reclaiming slow-but-active
  workers.

---

## Non-Goals

This document does **not**:

- Define the task JSON schema (see
  [worker-task-contract.md](worker-task-contract.md)).
- Define launch permissions or health gates (see
  [launch-gate.md](launch-gate.md),
  [main-health-policy.md](main-health-policy.md)).
- Implement runtime scripts or WebUI changes. This is a policy
  and schema definition only.
- Replace the `agent:*` label system on GitHub. Labels remain the
  human-visible surface; this projection is the machine-readable
  complement.

---

## References

- [Command Steward Agent](command-steward-agent.md) — Human-facing
  control-plane interface
- [Issue Lifecycle](issue-lifecycle.md) — GitHub issue state
  definitions and label conventions
- [Worker Task Contract](worker-task-contract.md) — Task JSON
  schema
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Active Workers State](active-workers-state.md) — Running worker
  projection
- [Launch Locks State](launch-locks-state.md) — Lock state
  projection
- [Knowledge-Driven Scaling](knowledge-driven-scaling.md) — Macro
  scaling rules
- [State Reconciler](state-reconciler.md) — Drift detection
- [#1211](https://github.com/taoyu051818-sys/lian-nest-server/issues/1211)
  — This feature
