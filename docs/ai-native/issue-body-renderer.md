# Issue Body Renderer

Single-source issue body renderer for the autonomous issue-production system.
The script lives at `scripts/ai/render-planned-issue-body.js`.

## Overview

Three independent `buildIssueBody` implementations previously existed in the
codebase (PowerShell in `write-planned-issues.ps1`, Node.js in
`propose-self-cycle-issues.js`, and Node.js in `create-issues.js`). All
produced the same canonical template but drifted on optional fields and
section ordering.

This module is the single source of truth for issue body rendering. All
callers should delegate to `renderIssueBody()` instead of inlining their own
template logic.

## Template Structure

The renderer produces the following sections in order:

```markdown
## Goal
<title>

## Scope
Task type: <taskType>
[Rationale: <rationale>]
[Readiness: <readinessNote>]
[Slice: <sliceRef>]

## Evidence           (optional — included when candidate.evidence is set)
<evidence>

## Acceptance
- `<validationCommand>` passes

## Rollback           (optional — included when candidate.rollback is set)
<rollback>

## Constraints
- Stay within allowed files.
- Do not edit forbidden files.

---
CONTROL APPENDIX (launcher generated)
Task type: <taskType>
Risk: <risk>
Conflict group: <conflictGroup>
Target issue: <issueNumber>
Target PR:
Issues: <issueNumber>
Expected PR: True
Allowed files:
- <file patterns>
Forbidden files:
- <file patterns> or (none specified)
Validation commands:
- <commands>
Use these boundaries as hard constraints...
Do NOT output secrets, tokens...

Role packet:
Actor role: <actorRole>
[Macro goal: <macroGoal>]
[Slice status: <sliceStatus>]
[Composite score: <compositeScore>]
```

## API

### `renderIssueBody(candidate)`

Returns the complete issue body markdown string.

### `renderControlAppendix(candidate)`

Returns only the CONTROL APPENDIX block. Useful when the caller needs to
build the human-readable sections independently but still needs the
machine-readable metadata block.

### `makeCandidate(overrides)`

Returns a candidate object with sensible defaults. Accepts an optional
overrides object.

## Candidate Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `title` | Yes | `''` | Issue title, rendered as the Goal text |
| `taskType` | No | `'execution'` | Task type for Scope and CONTROL APPENDIX |
| `risk` | No | `'low'` | Risk level: `low`, `medium`, `high` |
| `conflictGroup` | No | `'ai-auto'` | Conflict group identifier |
| `actorRole` | No | `'automation-cycle-worker'` | Actor role for the role packet |
| `allowedFiles` | No | `['docs/**', 'scripts/ai/**']` | File globs the worker may touch |
| `forbiddenFiles` | No | `['src/**', 'prisma/**', 'package.json']` | File globs the worker must not touch |
| `validationCommands` | No | `['npm run check']` | Commands to validate the PR |
| `rationale` | No | `''` | Why this issue exists (rendered in Scope) |
| `readinessNote` | No | `''` | Readiness status note (rendered in Scope) |
| `sliceRef` | No | `''` | Architecture slice reference (rendered in Scope) |
| `evidence` | No | `''` | Evidence supporting this issue (rendered as Evidence section) |
| `rollback` | No | `''` | Rollback plan (rendered as Rollback section) |
| `macroGoal` | No | `''` | High-level goal for the role packet |
| `sliceStatus` | No | `''` | Slice status for the role packet |
| `compositeScore` | No | `''` | Composite score for the role packet |
| `issueNumber` | No | `null` | Issue number (if known) |

## CLI Usage

```bash
# Show help
node scripts/ai/render-planned-issue-body.js --help

# Render from a JSON file
node scripts/ai/render-planned-issue-body.js --candidate candidate.json

# Render from stdin
echo '{"title":"Fix a bug"}' | node scripts/ai/render-planned-issue-body.js --stdin

# Render only the CONTROL APPENDIX
node scripts/ai/render-planned-issue-body.js --candidate candidate.json --control-only
```

## Downstream Compatibility

The CONTROL APPENDIX format is the critical contract. Downstream parsers
(`plan-next-batch.ps1`, `compile-issue-to-task-json.ps1`) use regex patterns
to extract fields:

- `Risk:\s*(low|medium|high)` — risk level
- `Conflict group:\s*(\S+)` — conflict group
- `Task type:\s*(\S+)` — task type
- `Actor role:\s*(.+)` — actor role
- `Allowed files:\s*\n((?:- .+\n?)+)` — allowed file list

The renderer preserves the exact field labels and line structure that these
parsers expect.

## Migration Path

Existing `buildIssueBody` implementations should be replaced with calls to
this module:

1. `scripts/ai/propose-self-cycle-issues.js` — `require('./render-planned-issue-body').renderIssueBody`
2. `scripts/ai/write-planned-issues.ps1` — invoke via `node -e` or refactor to JS
3. `tools/provider-pool-webui/actions/create-issues.js` — `require('../../scripts/ai/render-planned-issue-body').renderIssueBody`
