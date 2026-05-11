# Worker Task Contract

Every worker task is defined by a JSON contract. This contract is embedded in the worker prompt as a control appendix and governs what the worker may do.

## Schema

```json
{
  "taskType": "execution | research | review",
  "risk": "low | medium | high",
  "conflictGroup": "string",
  "targetIssue": "number",
  "targetPR": "number | null",
  "issues": ["number"],
  "expectedPR": true,
  "allowedFiles": ["glob patterns"],
  "forbiddenFiles": ["glob patterns"],
  "validationCommands": ["shell commands"],
  "rolePacket": {
    "actorRole": "role-name",
    "description": "brief role description"
  },
  "attentionAreas": {
    "focus": ["list of focus areas"],
    "knownBlindspots": ["list of known blindspots"]
  },
  "reviewAndAcceptance": {
    "requiredReviewRoles": ["role-name"],
    "acceptanceOwner": "human-owner | role-name"
  },
  "budgets": {
    "maxFiles": "number",
    "maxLinesChanged": "number",
    "softTimeMinutes": "number",
    "hardTimeMinutes": "number"
  },
  "complexityAssessment": {
    "level": "low | low-medium | medium | high",
    "drivers": ["list"],
    "splitRecommendation": "string | null"
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": "number"
  },
  "pmPhase": "string"
}
```

## Field Definitions

### taskType

- `execution`: Write or modify code/docs within allowed files.
- `research`: Read-only exploration, produce a report.
- `review`: Evaluate existing code or PR against criteria.

### risk

- `low`: Docs, config, isolated module change.
- `medium`: Cross-module change, API modification.
- `high`: Auth, data migration, public API surface.

### conflictGroup

Workers in the same conflict group must not run concurrently on overlapping files. Group by module or feature area.

### allowedFiles / forbiddenFiles

Glob patterns defining the worker's edit boundary. The worker MUST NOT edit files outside `allowedFiles` or inside `forbiddenFiles`. If the task requires out-of-scope changes, the worker must stop and report the blocker.

### validationCommands

Shell commands the worker must run and capture output for. Results are attached as validation evidence in the PR.

### issues

Array of related issue numbers beyond the target issue. Used to track dependencies or related work. Can be empty.

### expectedPR

Whether this task is expected to produce a PR. `true` for execution tasks, `false` for research or investigation tasks.

### rolePacket

Identifies which role prompt governs this worker's behavior.

- `actorRole`: The role name matching a prompt in `ops/agent-prompts/`.
- `description`: One-line summary of what this worker is doing.

### attentionAreas

Guidance for the worker on what to focus on and what pitfalls to avoid.

- `focus`: Key constraints or priorities the worker must keep in mind.
- `knownBlindspots`: Patterns or mistakes the worker should actively avoid.

### reviewAndAcceptance

Defines who reviews and accepts the PR.

- `requiredReviewRoles`: Roles that must review before merge (maps to `pr-review-gate.md` reviewers).
- `acceptanceOwner`: Who has final acceptance authority — `human-owner` or a specific role name.

### budgets

- `maxFiles`: Maximum number of files to modify.
- `maxLinesChanged`: Maximum total lines changed (added + removed).
- `softTimeMinutes`: Target completion time.
- `hardTimeMinutes`: Hard cutoff; worker must publish partial progress before this.

### stragglerPolicy

What happens if the worker approaches `hardTimeMinutes` without completing:
- `open_pr_or_comment_blocker`: Open a PR with whatever is done, or comment a blocker on the issue.
- `publishPartial`: true = always publish partial progress.
- `maxExtensionMinutes`: Additional time granted if progress is being made.

### pmPhase

The wave phase this task belongs to (e.g., `foundation-wave-1`, `feature-wave-1`). Maps to the wave planning table in `ops/agent-prompts/pm-gate.md`. Used for sequencing and prioritization.

## Backend Required Fields

Backend tasks (NestJS runtime, Prisma schema, database migrations, health gates) require additional metadata beyond the base contract. These fields are **mandatory** for any backend worker task JSON.

### sourceOfTruthDocs

Array of file paths or URLs that define the authoritative spec for this task. Every code change must trace back to a documented contract, schema, or SOP.

**Why required**: Backend changes affect data integrity and runtime stability. Reviewers need to verify the worker followed the agreed spec, not invented behavior.

```json
"sourceOfTruthDocs": [
  "docs/ai-native/worker-task-contract.md",
  "docs/contracts/feed-read-only-contract.md"
]
```

### blockedBy

Array of issue numbers or worker task IDs that must merge before this task can start. If empty, the task is unblocked.

**Why required**: Backend layers have hard sequencing (runtime foundation before feature workers). Incorrect ordering causes cascading failures.

```json
"blockedBy": [68]
```

### mainHealthPolicy

Defines what health checks must pass before the worker can open a PR. One of:

- `"gate-all"`: All existing health checks must pass (default for runtime/feature workers).
- `"gate-docs-only"`: Only docs consistency checks required (docs workers).
- `"gate-none"`: No automated health gate (research tasks).

**Why required**: Different backend worker tiers have different health requirements. A foundation worker needs full build + Prisma validate; a docs worker only needs link checks.

```json
"mainHealthPolicy": "gate-all"
```

### generatedCodePolicy

Defines how the worker should handle generated artifacts (e.g., Prisma client). One of:

- `"forbid"`: Worker must not commit generated files. Use for most feature and docs workers.
- `"allow-with-regenerate-note"`: Worker may commit generated files but MUST include the regenerate command in the commit message. Use for schema migration workers.
- `"source-artifact"`: Generated output IS the deliverable (e.g., API type generation). Use for type-gen workers.

**Why required**: Prisma 7 generated client (`src/generated/prisma/**`) is ~2k files. Without a clear policy, workers either bloat PRs with stale generated code or break builds by not regenerating.

```json
"generatedCodePolicy": "allow-with-regenerate-note"
```

### Full Backend Schema Extension

When constructing a backend worker task JSON, include all base fields **plus** these four. The combined schema:

```json
{
  "...base fields from Schema section above...": "",
  "sourceOfTruthDocs": ["docs/..."],
  "blockedBy": [],
  "mainHealthPolicy": "gate-all | gate-docs-only | gate-none",
  "generatedCodePolicy": "forbid | allow-with-regenerate-note | source-artifact"
}
```

For concrete examples by worker tier, see [backend-task-json-examples.md](backend-task-json-examples.md).

## Example

```json
{
  "taskType": "execution",
  "risk": "low",
  "conflictGroup": "ai-native-docs",
  "targetIssue": 2,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "docs/ai-native/**",
    "ops/agent-prompts/**",
    "README.md"
  ],
  "forbiddenFiles": [
    ".env",
    ".env.*",
    "node_modules/**",
    "dist/**",
    "src/**",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": [
    "manual docs review",
    "check links/paths are internally consistent"
  ],
  "rolePacket": {
    "actorRole": "ai-native-process-architect",
    "description": "Build the AI-native development SOP, role prompts, review gates, and worker contracts for this repo."
  },
  "attentionAreas": {
    "focus": [
      "Issue #2 owns docs/process only",
      "Define roles, worker JSON contract, PR gate, issue lifecycle",
      "Keep instructions executable for future Claude Code batches"
    ],
    "knownBlindspots": [
      "Do not depend on old repo-specific paths unless marked as temporary",
      "Do not edit runtime code"
    ]
  },
  "reviewAndAcceptance": {
    "requiredReviewRoles": ["pm-gate", "migration-auditor"],
    "acceptanceOwner": "human-owner"
  },
  "budgets": {
    "maxFiles": 16,
    "maxLinesChanged": 900,
    "softTimeMinutes": 35,
    "hardTimeMinutes": 70
  },
  "complexityAssessment": {
    "level": "low-medium",
    "drivers": ["process docs", "role prompt design"],
    "splitRecommendation": "docs-only"
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": 10
  },
  "pmPhase": "foundation-wave-1"
}
```
