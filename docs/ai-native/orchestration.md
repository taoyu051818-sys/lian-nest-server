# Self-Hosted AI Orchestration

This document describes how `lian-nest-server` owns and runs AI worker orchestration locally, without depending on external CI or `lian-platform-server`.

## Overview

The self-hosted batch launcher runs Claude Code workers directly from this repository. It reads task JSON files, creates isolated git worktrees, and invokes Claude Code in `--print` mode with strict tool boundaries.

```
task.json → batch-launch.ps1 → git worktree → run-claude-print.ps1 → Claude Code → commit → done
```

## Components

| File | Purpose |
|------|---------|
| `scripts/ai/batch-launch.ps1` | Entry point — validates task, creates worktree, launches worker |
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
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json
```

Prints the launch plan without making changes.

### Execute

```powershell
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json -Execute
```

Creates a worktree, runs the worker, and commits results.

### Manual Worker

```powershell
./scripts/ai/run-claude-print.ps1 -TaskFile ./tasks/issue-86.json -Branch claude/issue-86 -Worktree .claude/worktrees/claude/issue-86
```

Runs the worker directly against an existing worktree.

## Task JSON Example

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

- [ ] Task queue integration (read from GitHub issues directly)
- [ ] Parallel worker launch with conflict group enforcement
- [ ] PR creation automation after successful worker completion
- [ ] Integration with merge queue assistant for end-to-end flow
- [ ] Worker output logging and audit trail

## References

- [Worker Task Contract](worker-task-contract.md) — full JSON schema documentation
- [Worker Acceptance Checklist](worker-acceptance-checklist.md) — PR review criteria
- [SOP](SOP.md) — full AI-native development lifecycle
- [Parallel Work Policy](parallel-work-policy.md) — conflict group rules
