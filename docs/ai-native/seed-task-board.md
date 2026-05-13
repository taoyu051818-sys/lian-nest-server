# Seed Task Board

Seeds `.github/ai-state/task-board.json` from open GitHub issues.
Fetches issues via `gh CLI`, projects them through
`project-task-board.js`, and writes the result. Idempotent --
overwrites the existing task-board.json on each run.

---

## Problem

The task board projection (`task-board.json`) is the machine-readable
source of truth for task lifecycle state. Without a seeder, the
projection must be built manually or left empty, which breaks gap
discovery (`empty-ready`, `blocked-lane`, `stale-running` signals)
and prevents the orchestrator from finding claimable tasks.

## Solution

`seed-task-board.js` automates the initial population and refresh of
the task board projection. It:

1. Fetches open issues from GitHub via `gh issue list`
2. Fetches open PRs via `gh pr list`
3. Reads `active-workers.json` for running worker state
4. Passes all inputs to `buildProjection()` from `project-task-board.js`
5. Writes the resulting projection to disk (or stdout)

---

## Algorithm

### 1. Issue Fetch

```bash
gh issue list --state open --limit 200 --json number,title,body,labels
```

Labels are mapped to task board states:

| Label | State |
|-------|-------|
| `agent:triage` | `triage` |
| `agent:todo` | `todo` |
| `agent:queued` | `ready` |
| `agent:running` | `running` |
| `agent:blocked` | `blocked` |
| `agent:done` | `done` |
| `agent:archived` | `archived` |
| (no agent label) | `open` |

### 2. PR Fetch

```bash
gh pr list --state open --limit 200 --json number,title,body,headRefName
```

PRs are used to detect linked PRs in the projection.

### 3. Active Workers

Reads `.github/ai-state/active-workers.json` if it exists. Workers
provide claimant, branch, heartbeat, and expiry data for tasks in
`running` or `blocked` states.

### 4. Projection Build

All inputs are passed to `buildProjection(issues, openPRs, activeWorkers, launchLocks)`.
The `launchLocks` parameter is always `null` -- locks are managed
separately by the launch gate.

---

## Output

The projection conforms to the [Task Board Projection](task-board-projection.md)
schema:

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-13T12:00:00Z",
  "tasks": [
    {
      "issue": 258,
      "state": "running",
      "conflictGroup": "auth-core",
      "worker": { ... },
      "blockedReason": null,
      "linkedPR": null
    }
  ]
}
```

---

## Usage

```bash
# Seed task board to default path (.github/ai-state/task-board.json)
node scripts/ai/seed-task-board.js

# Print projection to stdout
node scripts/ai/seed-task-board.js --stdout

# Specify a different repo
node scripts/ai/seed-task-board.js --repo owner/name

# Custom output path
node scripts/ai/seed-task-board.js --out /path/to/task-board.json

# Show help
node scripts/ai/seed-task-board.js --help
```

---

## Integration Points

| System | Interaction |
|--------|------------|
| [Task Board Projection](task-board-projection.md) | Defines the schema and states this seeder produces |
| [Task-Board Driven Discovery](task-board-driven-discovery.md) | Reads the seeded projection to find gaps |
| [Top-Up Controller](self-cycle-top-up-controller.md) | Reads ready count from the seeded projection |
| [State Reconciler](state-reconciler.md) | Detects drift between projection and GitHub state |
| `project-task-board.js` | Provides `buildProjection()` used by this seeder |

---

## Design Decisions

- **Idempotent.** Each run overwrites the full projection file.
  No incremental updates.
- **Read-only on GitHub.** Uses `gh CLI` to fetch but never mutates
  issues or labels.
- **Launch locks excluded.** The seeder does not read launch locks.
  Lock state is managed by the launch gate and reconciler separately.
- **200-issue limit.** Matches the `gh issue list` default. Repos
  with more than 200 open issues will have incomplete projections.
