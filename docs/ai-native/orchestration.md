# Self-Hosted AI Orchestration

This document describes how `lian-nest-server` owns and runs AI worker orchestration locally, without depending on external CI or `lian-platform-server`.

## Overview

The self-hosted batch launcher runs Claude Code workers directly from this repository. It reads task JSON files, validates them against the launch gate, creates isolated git worktrees, and invokes Claude Code in `--print` mode with strict tool boundaries.

```
task.json → batch-launch.ps1 → launch gate → git worktree → run-claude-print.ps1 → Claude Code → commit → done
```

## Components

| File | Purpose |
|------|---------|
| `scripts/ai/batch-launch.ps1` | Entry point — validates task, runs launch gate, creates worktree, launches worker |
| `scripts/ai/check-launch-gate.ps1` | Pre-launch gate — validates tasks against main health and conflict metadata |
| `scripts/ai/run-claude-print.ps1` | Worker runner — invokes Claude Code with constrained tools |
| `scripts/ai/task.schema.json` | JSON Schema for task contracts |
| `docs/ai-native/orchestration.md` | This file |

## Task Contract

Every task is defined by a JSON file conforming to `scripts/ai/task.schema.json`. The contract specifies:

- **What** to do: `taskType`, `rolePacket`, `attentionAreas`
- **Where** to do it: `allowedFiles`, `forbiddenFiles`
- **How** to validate: `validationCommands`
- **Boundaries**: `budgets`, `risk`, `conflictGroup`

See [worker-task-contract.md](worker-task-contract.md) for the full field reference.

## Usage

### Dry Run (default)

```powershell
# Single task
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json

# Task array (batch)
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/batch-wave-1.json
```

Prints the launch plan without making changes. Shows branch names, worktree
paths, and file boundaries for every task. Displays gate decisions and
conflict-group violations for review.

### Execute

```powershell
# Single task
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json -Execute

# Task array (batch)
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/batch-wave-1.json -Execute
```

Creates worktrees and runs workers sequentially. The launcher enforces:

1. **Task contract validation** — every task must have all required fields.
2. **Duplicate conflict-group rejection** — non-doc groups with more than one
   task are rejected before any worker is dispatched.
3. **Launch gate** — the gate check runs on the full batch; blocked tasks
   prevent execution.

### Manual Worker

```powershell
./scripts/ai/run-claude-print.ps1 -TaskFile ./tasks/issue-86.json -Branch claude/issue-86 -Worktree .claude/worktrees/claude/issue-86
```

Runs the worker directly against an existing worktree.

## Task JSON Examples

### Single Task

```json
{
  "taskType": "execution",
  "risk": "low",
  "conflictGroup": "ai-launcher-self-hosting",
  "targetIssue": 86,
  "targetPR": null,
  "issues": [86],
  "expectedPR": true,
  "allowedFiles": [
    "scripts/ai/batch-launch.ps1",
    "scripts/ai/run-claude-print.ps1",
    "scripts/ai/task.schema.json",
    "docs/ai-native/orchestration.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": ["git diff --check"],
  "rolePacket": {
    "actorRole": "devops-automation-engineer",
    "description": "Self-hosted AI batch launcher skeleton worker."
  },
  "budgets": {
    "maxFiles": 4,
    "maxLinesChanged": 450,
    "softTimeMinutes": 15,
    "hardTimeMinutes": 30
  }
}
```

### Task Array (Batch)

A task file may contain an array of task objects. Each task is processed
sequentially. Tasks with the same non-doc `conflictGroup` are rejected.

```json
[
  {
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "ai-batch-launcher",
    "targetIssue": 163,
    "allowedFiles": ["scripts/ai/batch-launch.ps1", "docs/ai-native/orchestration.md"],
    "forbiddenFiles": ["src/**"],
    "validationCommands": ["npm run check"],
    "rolePacket": { "actorRole": "automation-launcher-worker", "description": "Upgrade batch launcher." }
  },
  {
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "ai-policy-docs",
    "targetIssue": 164,
    "allowedFiles": ["docs/ai-native/parallel-work-policy.md"],
    "forbiddenFiles": ["src/**"],
    "validationCommands": ["npm run check"],
    "rolePacket": { "actorRole": "docs-worker", "description": "Update parallel work policy." }
  }
]
```

**Duplicate conflict-group rule:** If two tasks share the same `conflictGroup`
and at least one touches non-doc files, the launcher rejects the batch before
dispatch. Docs-only groups (all `allowedFiles` under `docs/`) are exempt.

## Security Model

### No Secrets Required

The launcher does not embed or require production secrets. Workers operate on local git worktrees and use the developer's existing `gh` CLI authentication.

### Tool Boundaries

Workers are restricted to:
- `Edit` and `Write` — file operations within allowedFiles
- `Bash(git *)` — git operations for committing
- `Bash(npm run *)` — validation commands
- Specific validation commands from the task contract

Workers cannot:
- Push to remote (orchestrator handles this)
- Access the network beyond `gh` CLI
- Edit files outside allowedFiles
- Run arbitrary shell commands

### Worktree Isolation

Each worker runs in its own git worktree under `.claude/worktrees/`. This prevents workers from interfering with each other or the main working directory.

## Relationship to Existing Tooling

| Tool | Status | Notes |
|------|--------|-------|
| `scripts/merge-queue-assistant.js` | Unchanged | Still used for merge queue management |
| `scripts/post-merge-health-gate.js` | Unchanged | Still used for post-merge validation |
| `lian-platform-server` orchestrator | Reference only | This launcher is independent |

The self-hosted launcher is additive — it does not replace or modify existing tooling.

## Future Work

- [x] Launch gate integration — `check-launch-gate.ps1` runs automatically in `batch-launch.ps1`
- [x] Parallel worker launch with conflict group enforcement — `batch-launch.ps1` accepts task arrays and rejects duplicate non-doc conflict groups
- [ ] Task queue integration (read from GitHub issues directly)
- [ ] PR creation automation after successful worker completion
- [ ] Integration with merge queue assistant for end-to-end flow
- [ ] Worker output logging and audit trail

## References

- [Worker Task Contract](worker-task-contract.md) — full JSON schema documentation
- [Worker Acceptance Checklist](worker-acceptance-checklist.md) — PR review criteria
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [SOP](SOP.md) — full AI-native development lifecycle
- [Parallel Work Policy](parallel-work-policy.md) — conflict group rules
