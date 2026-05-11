# Issue-to-Task Compiler

Transforms structured issue JSON into worker task JSON contracts.
The compiler script lives at `scripts/ai/compile-issue-to-task-json.ps1`.

## Overview

The issue-to-task compiler reads issue metadata and emits a task JSON
file conforming to `scripts/ai/task.schema.json`. It acts as the first
stage of the orchestration pipeline, converting issue specifications
into machine-readable worker contracts.

Dry-run is the default mode. No files are written unless `-DryRun:$false`
is passed explicitly.

## Input Format

The compiler accepts **structured JSON** (not raw issue markdown).
Input can come from a file or stdin.

### Required Fields

The compiler refuses to emit task JSON when any of these fields are
missing, null, or empty:

| Field | Type | Description |
|-------|------|-------------|
| `targetIssue` | integer | GitHub issue number |
| `taskType` | string | `execution`, `research`, or `review` |
| `risk` | string | `low`, `medium`, or `high` |
| `conflictGroup` | string | Concurrency group identifier |
| `allowedFiles` | string[] | Glob patterns for editable files (min 1) |
| `validationCommands` | string[] | Commands to run before PR (min 1) |
| `rolePacket` | object | Must contain `actorRole` (non-empty) |

### Optional Fields

These are passed through to the task JSON if present:

- `targetPR` -- existing PR number, or null for new work
- `issues` -- additional related issue numbers
- `expectedPR` -- whether the task should produce a PR (default: true)
- `forbiddenFiles` -- glob patterns the worker must not edit
- `attentionAreas` -- focus areas and known blindspots
- `reviewAndAcceptance` -- reviewer roles and acceptance owner
- `budgets` -- file/line/time limits
- `complexityAssessment` -- complexity level and drivers
- `stragglerPolicy` -- behavior when approaching time limits
- `pmPhase` -- wave phase identifier

### Example Input

```json
{
  "targetIssue": 149,
  "taskType": "execution",
  "risk": "medium",
  "conflictGroup": "ai-issue-task-compiler",
  "allowedFiles": [
    "scripts/ai/compile-issue-to-task-json.ps1",
    "docs/ai-native/issue-to-task-compiler.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": [
    "git diff --check"
  ],
  "rolePacket": {
    "actorRole": "devops-automation-engineer",
    "description": "Issue-to-task compiler skeleton worker."
  }
}
```

## Specificity Checks

The compiler warns (but does not block) when:

- `forbiddenFiles` is empty or missing -- worker may edit unintended files
- `allowedFiles` contains overly broad patterns (`*`, `**`, `**/*`)
- `validationCommands` has fewer than 1 entry

The compiler **blocks** (exits with error) when:

- Any required field is missing, null, or an empty array/string
- `taskType` is not one of `execution`, `research`, `review`
- `risk` is not one of `low`, `medium`, `high`
- `allowedFiles` is empty
- `rolePacket.actorRole` is empty

## Usage

### Dry run (default) -- prints compiled task JSON

```powershell
./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue-149.json
```

### Write task JSON to file

```powershell
./scripts/ai/compile-issue-to-task-json.ps1 `
  -IssueFile ./fixtures/issue-149.json `
  -DryRun:$false `
  -OutputFile ./tasks/issue-149.json
```

### Pipe from stdin

```powershell
Get-Content issue.json -Raw | ./scripts/ai/compile-issue-to-task-json.ps1
```

### Rejected input example

```
>> Validating issue fields
   FAIL: Issue is underspecified. Missing required fields: allowedFiles, risk
```

## Output

The compiled task JSON includes all required fields from
`task.schema.json` plus any optional fields present in the input.
The output can be fed directly into:

- `batch-launch.ps1` -- to launch a worker
- `check-launch-gate.ps1` -- to validate against the launch gate

## Design Constraints

- **Structured JSON input only.** Raw markdown parsing is not supported
  in this skeleton. Future iterations may add markdown extraction.
- **No live GitHub calls.** The compiler reads from local files or
  stdin. It does not call `gh issue view` or any GitHub API.
- **Dry-run by default.** Output is printed to stdout unless
  `-DryRun:$false` and `-OutputFile` are both specified.
- **Fail-fast validation.** Missing required fields cause immediate
  exit with a non-zero code. The compiler does not emit partial JSON.

## Integration

The compiler fits into the orchestration workflow:

1. **Issue author** writes structured issue metadata (JSON body or fixture).
2. **Compiler** validates and emits task JSON.
3. **Launch gate** (`check-launch-gate.ps1`) checks permissions and health.
4. **Batch launcher** (`batch-launch.ps1`) creates worktree and runs worker.
5. **Worker** implements and opens PR.

## See Also

- [Worker Task Contract](worker-task-contract.md) -- Schema and field definitions
- [Backend Task JSON Examples](backend-task-json-examples.md) -- Example task files
- [Launch Gate](launch-gate.md) -- Pre-launch permission checks
- [Orchestration](orchestration.md) -- Full orchestration flow
- [#149](https://github.com/nicholasxsxs/lian-nest-server/issues/149) -- This feature
