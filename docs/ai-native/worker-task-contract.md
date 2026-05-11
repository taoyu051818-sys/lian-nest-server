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

### rolePacket

Identifies which role prompt governs this worker's behavior.

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
