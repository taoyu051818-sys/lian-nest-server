# Issue-to-Task Compiler

Transforms structured issue JSON into worker task JSON contracts.

Two implementations exist:

| Script | Language | Mode |
|--------|----------|------|
| `scripts/ai/compile-issue-to-task-json.ps1` | PowerShell | Single-issue compilation from file/stdin |
| `scripts/ai/compile-issues-to-tasks.js` | Node.js | Batch compilation from GitHub issues by label |

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
- `knowledgeRefs` -- file paths or URLs for semantic context (see below)
- `promptHandoff` -- concise description of what to build and why
- `llmExtracted` -- boolean, true when LLM produced the semantic fields (see below)

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
  },
  "knowledgeRefs": [
    "docs/ai-native/worker-task-contract.md"
  ],
  "promptHandoff": "Build the issue-to-task compiler skeleton with structured JSON input and dry-run mode."
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

## Semantic Context Handoff

The task JSON is a **control envelope** -- it carries scheduling metadata,
file boundaries, and routing. It is not the full semantic source for the
task. Workers must read the GitHub issue body and referenced docs to
understand what the task actually means.

The compiler emits three fields to support this handoff:

| Field | Purpose | Example |
|-------|---------|---------|
| `sourceIssue` | GitHub issue URL -- the semantic source of truth | `https://github.com/taoyu051818-sys/lian-nest-server/issues/195` |
| `knowledgeRefs` | File paths or URLs the worker should read | `["docs/contracts/feed-read-only-contract.md"]` |
| `promptHandoff` | Concise description of what to build and why | `"Improve issue-to-task compiler to preserve issue body as semantic context"` |

### How Workers Use These Fields

1. Read `sourceIssue` to get the full issue body, acceptance criteria, and
   business rules.
2. Read each `knowledgeRefs` entry for contracts, architecture docs, or SOPs
   referenced in the issue.
3. Use `promptHandoff` as the initial prompt context -- it captures the
   issue title or a concise summary without requiring the worker to parse
   the full body first.

### What NOT to Encode in Task JSON

- Full issue body text (use `sourceIssue` pointer instead)
- Business rules or acceptance criteria (live in the issue body)
- Implementation instructions (live in the issue body or `knowledgeRefs`)
- Contract details (reference via `knowledgeRefs`)

## LLM Extraction vs Deterministic Parsing

The compiler supports two input paths. Both produce valid task JSON;
they differ in **where the semantic fields come from**.

### Deterministic parsing (default)

When `llmExtracted` is absent or `false`, the compiler expects only
structural fields: `targetIssue`, `taskType`, `risk`, `conflictGroup`,
`allowedFiles`, `validationCommands`, `rolePacket`. Semantic fields
(`knowledgeRefs`, `promptHandoff`, `attentionAreas`) are optional
pass-throughs.

**Use deterministic parsing when:**
- The issue body is structured JSON (CONTROL APPENDIX format).
- A human or script has already extracted the fields.
- You want maximum reliability with no LLM dependency.

### LLM extraction

When the input contains `"llmExtracted": true`, the compiler applies
stricter validation: `knowledgeRefs` and `promptHandoff` must be present
and non-empty. This signals that an LLM (e.g. Claude) parsed the issue
body and produced the semantic fields.

**Use LLM extraction when:**
- The issue body is free-form markdown (no CONTROL APPENDIX).
- You want richer context (handoff description, knowledge references)
  derived from the issue body automatically.
- A human reviews the compiled task JSON before launching.

**Fallback guarantee:** If LLM extraction fails or produces incomplete
output, the compiler still emits valid task JSON with the structural
fields. The deterministic path is always available. LLM extraction
augments the compiler; it never replaces the fallback.

### How the compiler handles each path

| Input | `llmExtracted` | Required fields | Semantic fields |
|-------|---------------|-----------------|-----------------|
| Structured JSON | absent/false | Structural only | Optional pass-through |
| LLM-produced JSON | `true` | Structural + knowledgeRefs + promptHandoff | Validated, warned if missing |

In both cases, missing semantic fields produce **warnings**, not errors.
The compiler always emits task JSON if the structural fields are valid.

## Integration

The compiler fits into the orchestration workflow:

1. **Issue author** writes structured issue metadata (JSON body or fixture).
2. **Compiler** validates and emits task JSON.
3. **Launch gate** (`check-launch-gate.ps1`) checks permissions and health.
4. **Batch launcher** (`batch-launch.ps1`) creates worktree and runs worker.
5. **Worker** implements and opens PR.

### Self-Cycle Runner Handoff

The self-cycle runner (`run-self-cycle.ps1`) can invoke issue discovery and
task compilation automatically via the `-IssueLabel` parameter:

```powershell
# Discover issues by label, compile to task JSON, review in dry-run
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

# After review, feed the compiled task file into the pipeline
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/discovered-tasks.json -Execute
```

When `-IssueLabel` is used, the runner:

1. Fetches open issues with the specified label via `gh issue list`.
2. Parses each issue body for CONTROL APPENDIX metadata (taskType, risk,
   conflictGroup, allowedFiles, validationCommands, rolePacket).
3. Builds task JSON contracts with conservative defaults for missing fields.
4. Writes the compiled array to a temp file.
5. In dry-run mode: prints contracts and exits for human review.
6. In execute mode: feeds the task file into the standard pipeline
   (state reconciler, health gate, launch gate, batch launch).

This removes the manual step of creating task JSON files from issues while
preserving the human review gate before any work is launched.

## Node.js Batch Compiler

The Node.js variant (`compile-issues-to-tasks.js`) fetches open issues
from GitHub by label and compiles their CONTROL APPENDIX metadata into
task contracts in a single batch. It replaces the manual per-issue
workflow of the PowerShell script when dispatching multiple issues.

### Usage

```bash
# Compile all open issues with the default label
node scripts/ai/compile-issues-to-tasks.js --stdout

# Specify a different label and output path
node scripts/ai/compile-issues-to-tasks.js \
  --label "agent:codex-action-needed" \
  --out .github/ai-state/compiled-tasks.json

# Specify a remote repo
node scripts/ai/compile-issues-to-tasks.js --repo owner/name --stdout
```

### Output Format

The output is a JSON envelope containing:

| Field | Description |
|-------|-------------|
| `schemaVersion` | Always `1` |
| `capturedAt` | ISO timestamp |
| `sourceLabel` | The label used to fetch issues |
| `totalIssues` | Number of issues fetched from GitHub |
| `compiledTasks` | Number of issues successfully compiled |
| `skippedCount` | Issues without a valid CONTROL APPENDIX |
| `tasks` | Array of compiled task contracts |
| `skipped` | Array of `{ number, title, reason }` for skipped issues |

### Differences from PowerShell Script

| Aspect | PowerShell (`compile-issue-to-task-json.ps1`) | Node.js (`compile-issues-to-tasks.js`) |
|--------|----------------------------------------------|---------------------------------------|
| Input | Single issue JSON file or stdin | GitHub issues by label (`gh issue list`) |
| Output | Single task JSON | Array of task contracts |
| Dry-run | Default mode | N/A (always reads, writes only with `--out`) |
| GitHub API | No | Yes (`gh` CLI) |
| Use case | Manual single-issue compilation | Batch dispatch in self-cycle runner |

## See Also

- [Worker Task Contract](worker-task-contract.md) -- Schema and field definitions
- [Backend Task JSON Examples](backend-task-json-examples.md) -- Example task files
- [Launch Gate](launch-gate.md) -- Pre-launch permission checks
- [Orchestration](orchestration.md) -- Full orchestration flow
- [#149](https://github.com/nicholasxsxs/lian-nest-server/issues/149) -- This feature
