# Write Planned Issues

Turns vetted planner output into GitHub issues with dry-run as default
and explicit execute mode. The script lives at
`scripts/ai/write-planned-issues.ps1`.

## Overview

The planner issue writer is the final control-loop layer. It reads the
JSON plan produced by `plan-next-batch.ps1 -Json`, filters for ready
candidates, and creates GitHub issues with the standard template
(Goal, Scope, Acceptance, Constraints) and a CONTROL APPENDIX block.

Dry-run is the **default mode**. No GitHub API calls are made unless
`-Execute` is passed explicitly.

## Pipeline Position

```
plan-next-batch.ps1 -Json   (propose candidates)
        |
        v
write-planned-issues.ps1    (this script — create issues)
        |
        v
compile-issue-to-task-json   (compile issue -> task JSON)
        |
        v
batch-launch.ps1             (launch workers)
```

The planner issue writer closes the gap between planning and execution:
a human reviews the plan, then the writer materializes approved
candidates as GitHub issues that downstream workers can pick up.

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-PlanFile` | No | stdin | Path to plan JSON from `plan-next-batch.ps1 -Json` |
| `-Execute` | No | `$false` | Create issues on GitHub (default: dry-run only) |
| `-Label` | No | `agent:codex-action-needed` | Label to apply to created issues |
| `-Repo` | No | `$env:GH_REPO` | GitHub repo in `OWNER/NAME` format |
| `-MaxIssues` | No | `10` | Max issues to create from the plan |
| `-Help` | No | — | Show usage examples and exit |

## Usage

### Dry-run from file

```powershell
# 1. Generate plan
./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json > plan.json

# 2. Preview what would be created
./scripts/ai/write-planned-issues.ps1 -PlanFile plan.json
```

### Dry-run from pipe

```powershell
./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json | ./scripts/ai/write-planned-issues.ps1
```

### Execute: create issues

```powershell
./scripts/ai/write-planned-issues.ps1 -PlanFile plan.json -Execute -Repo owner/name
```

### Custom label

```powershell
./scripts/ai/write-planned-issues.ps1 -PlanFile plan.json -Execute -Label "wave:16" -Repo owner/name
```

### Show help

```powershell
./scripts/ai/write-planned-issues.ps1 -Help
```

## Input Format

The script accepts the JSON output of `plan-next-batch.ps1 -Json`.
The plan must contain a `candidates` array. Each candidate should have:

| Field | Required | Description |
|-------|----------|-------------|
| `issueNumber` | Yes | Original issue number (used as reference) |
| `title` | Yes | Issue title |
| `taskType` | No | `execution`, `research`, or `review` (default: `execution`) |
| `risk` | No | `low`, `medium`, or `high` (default: `medium`) |
| `conflictGroup` | No | Concurrency group (default: `ai-auto`) |
| `actorRole` | No | Worker role (default: `automation-cycle-worker`) |
| `allowedFiles` | No | File patterns (default: `docs/**`) |
| `forbiddenFiles` | No | File patterns to exclude |
| `validationCommands` | No | Commands to validate (default: `npm run check`) |
| `readiness` | Yes | `ready`, `blocked`, or `done` |
| `sliceRef` | No | Migration matrix slice ID |
| `sliceStatus` | No | Current slice status |
| `readinessNote` | No | Human-readable readiness explanation |
| `compositeScore` | No | Signal-aware ranking score |

Only candidates with `readiness: "ready"` are written. Blocked and done
candidates are skipped automatically.

## Output Format

Each created issue follows the standard template:

```markdown
## Goal
<title>

## Scope
Task type: <taskType>
Slice: <sliceRef>  (if present)

Readiness: <readinessNote>  (if present)

## Acceptance
- `<validationCommand>` passes

## Constraints
- Stay within allowed files.
- Do not edit forbidden files.

---
CONTROL APPENDIX (launcher generated)
Task type: <taskType>
Risk: <risk>
Conflict group: <conflictGroup>
Target issue: <issueNumber>
...
Role packet:
Actor role: <actorRole>
```

The CONTROL APPENDIX block is machine-readable metadata that downstream
scripts (`compile-issue-to-task-json.ps1`) can parse to build worker
task contracts.

## Security

### Dry-run by default

The script never makes GitHub API calls unless `-Execute` is passed.
This is a hard safety boundary — reviewing the dry-run output before
executing is the expected workflow.

### Secret scanning

All candidate content (titles, file paths, assembled issue bodies) is
scanned against secret patterns before any API call:

- GitHub tokens (`ghp_`, `gho_`, `github_pat_`)
- GitLab tokens (`glpat-`)
- AWS keys (`AKIA`)
- Slack tokens (`xoxb-`, `xoxp-`)
- Bearer tokens
- Private keys
- Passwords, secrets, tokens (key=value patterns)

If any pattern matches, the script exits with error and does NOT create
issues. The pattern match is included in the error message.

### No secrets in output

The script never embeds, reads, or outputs:

- API keys, tokens, or cookies
- `.env` file contents
- Raw stdout/stderr logs
- LLM transcripts

## Integration with Other Scripts

| Script | Relationship |
|--------|-------------|
| `plan-next-batch.ps1` | Upstream producer — generates the plan JSON this script consumes |
| `compile-issue-to-task-json.ps1` | Downstream consumer — compiles created issues into task contracts |
| `batch-launch.ps1` | Downstream consumer — launches workers against compiled tasks |
| `publish-agent-result.ps1` | Sibling — publishes worker results back to issues |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (dry-run completed or issues created) |
| 1 | Validation failure (bad plan JSON, missing fields, secret detected) |
| 2 | Invalid arguments |

## Typical Workflow

```powershell
# 1. Propose next batch
./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json > plan.json

# 2. Review proposed batch
./scripts/ai/write-planned-issues.ps1 -PlanFile plan.json

# 3. After human review, create issues
./scripts/ai/write-planned-issues.ps1 -PlanFile plan.json -Execute -Repo owner/name

# 4. Issues are now live with CONTROL APPENDIX blocks
#    Workers can pick them up via compile-issue-to-task-json.ps1
```

## Limitations

- **Structured JSON input only.** The script expects plan JSON from
  `plan-next-batch.ps1 -Json`. Raw markdown plan input is not supported.
- **Ready candidates only.** Candidates with `readiness: blocked` or
  `readiness: done` are skipped. Resolve blockers in the planner first.
- **No deduplication.** Re-running with the same plan creates duplicate
  issues. Check existing issues before executing.
- **No issue update.** The script only creates new issues. To update
  existing issues, use `gh issue edit` directly.

## References

- [Planning Loop](planning-loop.md) — Upstream planner documentation
- [Issue Lifecycle](issue-lifecycle.md) — Issue states and labels
- [Issue-to-Task Compiler](issue-to-task-compiler.md) — Downstream compiler
- [Orchestration](orchestration.md) — Full orchestration flow
- [SOP](SOP.md) — AI-native development lifecycle
