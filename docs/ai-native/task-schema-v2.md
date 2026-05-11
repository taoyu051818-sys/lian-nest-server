# Task Schema v2

Next-generation control-plane schema for the fact-to-task worker protocol.

**Schema file**: [`schemas/task-v2.schema.json`](../../schemas/task-v2.schema.json)

## What changed from v1

| Area | v1 | v2 |
|---|---|---|
| Task classification | `taskType` only | Added `workerClass` for finer routing |
| Role routing | Nested `rolePacket.actorRole` | Top-level `actorRole` (+ v1 compat wrapper) |
| Attention | Nested `attentionAreas.focus/knownBlindspots` | Top-level `attentionFocus`/`knownBlindspots` (+ v1 compat wrapper) |
| Review | Nested `reviewAndAcceptance.requiredReviewRoles/acceptanceOwner` | Top-level `requiredReviewRoles`/`acceptanceOwner` (+ v1 compat wrapper) |
| File control | `allowedFiles`/`forbiddenFiles` only | Added `writeSet` (expected writes) and `sharedLocks` (read-only shared access) |
| Dependencies | `blockedBy` (issue numbers) | Added `dependsOnFacts`/`producesFacts` for fact-based dependency resolution |
| Validation | `validationCommands` | Renamed to `validation` (same semantics) |
| Budget | `budgets` (plural) | Renamed to `budget` (singular, + v1 compat alias) |
| Observability | None | Added `telemetry` (heartbeat, log level, tags) |
| Rollback | None | Added `rollbackPlan` (strategy + notes) |
| Backend fields | Not in schema | Added `sourceOfTruthDocs`, `blockedBy`, `mainHealthPolicy`, `generatedCodePolicy` |

## v1 compatibility

The launcher supports both v1 and v2 JSON. For v2, it normalizes v1-style nested objects:

- `rolePacket.actorRole` → top-level `actorRole`
- `attentionAreas.focus` → top-level `attentionFocus`
- `attentionAreas.knownBlindspots` → top-level `knownBlindspots`
- `reviewAndAcceptance.requiredReviewRoles` → top-level `requiredReviewRoles`
- `reviewAndAcceptance.acceptanceOwner` → top-level `acceptanceOwner`
- `budgets` → `budget`

If both the nested wrapper and the top-level field are present, the top-level field wins.

## New fields

### workerClass

Task classification string for routing and scheduling. Examples: `schema-task-v2`, `backend-runtime`, `docs-worker`, `feature-worker`. The launcher uses this to select worker templates and conflict resolution strategies.

### writeSet

Subset of `allowedFiles` — exact file paths or narrow globs the worker is expected to write. The launcher monitors file changes and logs a warning if the worker touches files outside `writeSet` but inside `allowedFiles`. This catches scope creep early without blocking the worker.

### sharedLocks

File paths or globs that this task reads but does not write. The launcher grants shared (read) locks on these files. Multiple tasks in the same `conflictGroup` may hold shared locks simultaneously, but no task may hold an exclusive (write) lock while shared locks are active. This enables safe concurrent reads of shared state (e.g., Prisma schema, config files).

### dependsOnFacts

Array of fact references that must be established before this task can run. Each entry has:
- `factId`: Unique identifier (e.g., `fact:prisma-schema:User`, `fact:api:GET /users`)
- `description`: Human-readable assertion
- `source` (optional): Where the fact was produced

The launcher validates that all `dependsOnFacts` exist in the fact registry before scheduling the task. If any fact is missing, the task is held in a pending state until the producing task completes.

### producesFacts

Array of facts this task commits to producing. Each entry has:
- `factId`: Unique identifier
- `description`: What the fact will assert
- `confidence` (optional): `definite` | `likely` | `conditional`

Downstream tasks reference these in their `dependsOnFacts`. The launcher tracks fact production for dependency graph resolution. If a task completes without producing its declared facts, the launcher flags a contract violation.

### telemetry

Observability settings for the worker process:
- `emitHeartbeat` (default: `true`): Periodic heartbeat events
- `heartbeatIntervalSeconds` (default: `120`): Seconds between heartbeats
- `logLevel` (default: `normal`): `silent` | `normal` | `verbose`
- `tags`: Freeform tags for telemetry filtering

### rollbackPlan

Defines how to undo this task's changes if they cause problems post-merge:
- `strategy`: `git-revert` | `manual-fixforward` | `auto-revert-if-ci-fails`
- `notes` (optional): Additional guidance for the human reviewer

### Promoted fields

These fields exist in v1 as nested properties. In v2 they are promoted to top-level for easier access by workers and scripts:

- `actorRole` (was `rolePacket.actorRole`)
- `roleDescription` (was `rolePacket.description`)
- `attentionFocus` (was `attentionAreas.focus`)
- `knownBlindspots` (was `attentionAreas.knownBlindspots`)
- `requiredReviewRoles` (was `reviewAndAcceptance.requiredReviewRoles`)
- `acceptanceOwner` (was `reviewAndAcceptance.acceptanceOwner`)
- `budget` (was `budgets`)

### Backend fields

Previously documented in [worker-task-contract.md](worker-task-contract.md) as backend-required extensions. Now part of the formal v2 schema:

- `sourceOfTruthDocs`: Authoritative spec files
- `blockedBy`: Issue/task IDs that must merge first
- `mainHealthPolicy`: `gate-all` | `gate-docs-only` | `gate-none`
- `generatedCodePolicy`: `forbid` | `allow-with-regenerate-note` | `source-artifact`

## Example

```json
{
  "taskType": "execution",
  "workerClass": "schema-task-v2",
  "risk": "low",
  "conflictGroup": "schema-task-v2",
  "targetIssue": 363,
  "targetPR": null,
  "issues": [363],
  "expectedPR": true,
  "allowedFiles": [
    "schemas/task-v2.schema.json",
    "docs/ai-native/task-schema-v2.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "scripts/**",
    ".github/**"
  ],
  "writeSet": [
    "schemas/task-v2.schema.json",
    "docs/ai-native/task-schema-v2.md"
  ],
  "sharedLocks": [
    "docs/ai-native/worker-task-contract.md",
    "scripts/ai/task.schema.json"
  ],
  "validation": [
    "npm run check",
    "npm run build"
  ],
  "actorRole": "schema-contract-worker",
  "roleDescription": "Add task schema v2 for fact-to-task worker protocol",
  "attentionFocus": [
    "Read the GitHub issue body first",
    "Stay inside allowedFiles and respect forbiddenFiles",
    "Keep the slice independently reviewable"
  ],
  "knownBlindspots": [
    "Do not expand scope to shared package, Prisma, generated, or runtime files",
    "Do not leak secrets or .env values"
  ],
  "dependsOnFacts": [],
  "producesFacts": [
    {
      "factId": "fact:schema:task-v2",
      "description": "task-v2.schema.json exists and validates",
      "confidence": "definite"
    }
  ],
  "requiredReviewRoles": ["architecture-review"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 6,
    "maxLinesChanged": 500,
    "softTimeMinutes": 45,
    "hardTimeMinutes": 90
  },
  "complexityAssessment": {
    "level": "low",
    "drivers": ["bounded ownership", "high parallel control-plane wave"],
    "splitRecommendation": null
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": 15
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["wave10", "fact-to-task", "control-plane"]
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Schema-only change, revert is safe with no runtime impact"
  },
  "pmPhase": "self-cycle-wave10-fact-to-task-control-plane",
  "sourceIssue": "https://github.com/taoyu051818-sys/lian-nest-server/issues/363",
  "knowledgeRefs": [
    "docs/ai-native/worker-task-contract.md"
  ],
  "promptHandoff": "Add task schema v2 for fact-to-task worker protocol"
}
```

## Migration path

1. **Launcher**: Update the launcher to detect `$id` containing `task-v2` and apply v2 normalization (merge nested wrappers to top-level fields).
2. **Compiler**: Update `compile-issue-to-task-json.ps1` to emit v2 JSON by default.
3. **Guard**: Update `ops:guard` to validate task JSON against the v2 schema.
4. **Workers**: No changes required — workers read the control appendix as a string and extract fields they need. The v2 fields are additive.
5. **Backward**: v1 task JSON continues to work. The launcher normalizes it to v2 internally.
