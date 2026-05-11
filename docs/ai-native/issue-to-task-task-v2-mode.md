# Issue-to-Task Compiler: task-v2 Output Mode

The issue-to-task compiler supports an opt-in `-OutputMode v2` flag that
emits task-v2-compatible JSON while preserving full backward compatibility
with the default v1 output.

## Usage

```powershell
# v1 mode (default) — unchanged behavior
./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue.json

# v2 mode — emits task-v2 schema fields
./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue.json -OutputMode v2

# Dry-run with v2
./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue.json -OutputMode v2

# Write v2 output
./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue.json -OutputMode v2 -DryRun:$false -OutputFile ./tasks/task-v2.json
```

## What Changes in v2 Mode

### Promoted Fields

Nested v1 wrappers are promoted to top-level fields. The v1 wrappers
(`rolePacket`, `attentionAreas`, `reviewAndAcceptance`) are kept in the
output for launcher backward compatibility.

| v1 (nested) | v2 (top-level) |
|---|---|
| `rolePacket.actorRole` | `actorRole` |
| `rolePacket.description` | `roleDescription` |
| `attentionAreas.focus` | `attentionFocus` |
| `attentionAreas.knownBlindspots` | `knownBlindspots` |
| `reviewAndAcceptance.requiredReviewRoles` | `requiredReviewRoles` |
| `reviewAndAcceptance.acceptanceOwner` | `acceptanceOwner` |

### Renamed Fields

| v1 | v2 |
|---|---|
| `validationCommands` | `validation` |
| `budgets` | `budget` |

### New v2-Only Fields

These fields are passed through from the input JSON when present:

| Field | Description |
|---|---|
| `workerClass` | Task classification for routing. Defaults to `conflictGroup` if omitted. |
| `writeSet` | Subset of `allowedFiles` — exact paths the worker is expected to write. |
| `sharedLocks` | Read-only file paths for concurrent shared access. |
| `dependsOnFacts` | Facts that must exist before this task can run. |
| `producesFacts` | Facts this task commits to producing. |
| `telemetry` | Heartbeat, log level, and tag settings. |
| `rollbackPlan` | Strategy for undoing changes post-merge. |
| `sourceOfTruthDocs` | Authoritative spec files. |
| `blockedBy` | Issue/task IDs that must merge first. |
| `mainHealthPolicy` | Health gate policy (`gate-all`, `gate-docs-only`, `gate-none`). |
| `generatedCodePolicy` | Generated artifact handling policy. |

## Schema Conformance

- **v1 output**: conforms to `scripts/ai/task.schema.json`
- **v2 output**: conforms to `schemas/task-v2.schema.json`

The v2 schema requires `workerClass` in addition to the v1 required fields.
If the input does not provide `workerClass`, the compiler derives it from
`conflictGroup` and emits a warning.

## Backward Compatibility

- Default `-OutputMode` is `v1`. Existing scripts that do not pass the flag
  are unaffected.
- v2 output includes the v1 compatibility wrappers (`rolePacket`,
  `attentionAreas`, `reviewAndAcceptance`) so the launcher can normalize
  either format.
- No changes to input format. All v2-only fields are optional pass-throughs.

## See Also

- [Task Schema v2](task-schema-v2.md) — Full v2 schema documentation
- [Issue-to-Task Compiler](issue-to-task-compiler.md) — Base compiler docs
- [Worker Task Contract](worker-task-contract.md) — Field definitions
