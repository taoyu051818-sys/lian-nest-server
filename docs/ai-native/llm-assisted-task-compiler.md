# LLM-Assisted Task Compiler Handoff Contract

Defines how an LLM (Claude/Codex) interprets issue text into structured task JSON while preserving schema validation and deterministic guard checks. This document is the control-loop contract that lets Codex exit routine orchestration.

> **Status:** Contract defined. Schema at `schemas/task-compiler-handoff.schema.json`.
>
> **Cross-references:**
> - [Issue-to-Task Compiler](issue-to-task-compiler.md) — deterministic compiler path
> - [Task Schema v2](task-v2.schema.json) — output schema
> - [Issue-to-Task v2 Mode](issue-to-task-task-v2-mode.md) — v2 output fields
> - [Loop Model](loop-model.md) — self-cycle runner phases

---

## Purpose

The deterministic issue-to-task compiler (`compile-issue-to-task-json.ps1`) works
when the input is structured JSON with a CONTROL APPENDIX. It cannot parse
free-form issue markdown.

The LLM-assisted handoff bridges this gap: an LLM reads the issue body, extracts
the structural fields, and produces a handoff contract. The deterministic compiler
then validates the extraction and emits the final task JSON.

This contract ensures:

1. LLM output is **schema-validated** before it becomes task JSON.
2. **Confidence signals** are explicit — no silent guessing.
3. **Dry-run is the default** — no task is dispatched without human approval
   when confidence is low.
4. **Fallback is deterministic** — if LLM extraction fails, the system falls
   back to the structured-only path with no data loss.

---

## Handoff Contract Schema

The handoff contract conforms to `schemas/task-compiler-handoff.schema.json`.
Every LLM extraction produces a contract object before the orchestrator compiles
the final task JSON.

### Required Fields

| Field | Type | Purpose |
|-------|------|---------|
| `schemaVersion` | `1` | Schema version constant |
| `sourceType` | enum | What the LLM was given: `issue-body`, `structured-json`, or `hybrid` |
| `extractionResult` | object | Fields the LLM extracted, with required structural fields |
| `fieldConfidence` | object | Per-field confidence: `deterministic`, `high`, `medium`, `low` |
| `validationGate` | object | Deterministic validation results after extraction |
| `exitSignal` | enum | Orchestrator control: `ready`, `needs-human-review`, `fallback-to-deterministic`, `blocked` |

### Optional Fields

| Field | Type | Purpose |
|-------|------|---------|
| `sourceIssue` | integer | GitHub issue number |
| `sourceChecksum` | string | SHA-256 prefix of raw input for idempotency |
| `fallbackPayload` | object | Partial extraction when falling back |
| `dryRun` | boolean | Default `true` — no dispatch without explicit approval |
| `capturedAt` | datetime | ISO-8601 extraction timestamp |
| `llmModel` | string | Model identifier for audit trail |
| `extractionDurationMs` | integer | Wall-clock extraction time |

---

## Extraction Flow

```
Issue text (markdown)
       │
       ▼
┌─────────────────┐
│  LLM extracts   │──▶ handoff contract
│  fields         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  validation     │────▶│  exit signal     │
│  gate           │     │  decision        │
└─────────────────┘     └───────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
         ┌────────┐      ┌──────────┐      ┌──────────┐
         │ ready  │      │ needs-   │      │ fallback │
         │        │      │ human-   │      │ -to-     │
         │        │      │ review   │      │ determ.  │
         └───┬────┘      └────┬─────┘      └────┬─────┘
             │                │                  │
             ▼                ▼                  ▼
      compile task-v2   human reviews    deterministic
      and dispatch      then re-evaluate  path only
```

### Step 1: LLM Extraction

The LLM receives the issue body (and optionally structured metadata) and
produces the `extractionResult` object. Required structural fields:

- `taskType` — `execution`, `research`, or `review`
- `risk` — `low`, `medium`, or `high`
- `conflictGroup` — concurrency group identifier
- `allowedFiles` — glob patterns for editable files (min 1)
- `validationCommands` — commands to run before PR (min 1)
- `actorRole` — role name for the worker

Optional semantic fields extracted when present:

- `roleDescription`, `promptHandoff`, `knowledgeRefs`
- `attentionFocus`, `knownBlindspots`
- `budget`, `complexityAssessment`
- `forbiddenFiles`

### Step 2: Confidence Assignment

Every extracted field gets a confidence level:

| Level | Meaning | Example |
|-------|---------|---------|
| `deterministic` | Copied verbatim from structured input | `taskType` from CONTROL APPENDIX |
| `high` | Explicitly stated in issue body | `risk: high` in issue text |
| `medium` | Inferred from context | `conflictGroup` derived from feature area |
| `low` | Guessed or defaulted | `budget` estimated from issue complexity |

Fields at `low` confidence trigger `needs-human-review` in the exit signal.

### Step 3: Validation Gate

The deterministic compiler applies the same specificity checks it uses for
structured input:

- All required fields present and non-empty
- `taskType` is a valid enum value
- `risk` is a valid enum value
- `allowedFiles` is non-empty
- `actorRole` is non-empty

Additionally, for LLM extraction:

- `knowledgeRefs` and `promptHandoff` are warned if missing (not blocking)
- Any field with `low` confidence is flagged for human review

### Step 4: Exit Signal

The `exitSignal` determines the orchestrator's next action:

| Signal | Meaning | Orchestrator Action |
|--------|---------|-------------------|
| `ready` | All fields valid, confidence adequate | Compile task-v2 and dispatch |
| `needs-human-review` | Low confidence or validation warnings | Route to human for approval before dispatch |
| `fallback-to-deterministic` | LLM extraction failed | Use structured input only, ignore LLM output |
| `blocked` | Hard validation failure | Cannot proceed; log and wait for human |

---

## Dry-Run Default

All LLM-assisted handoffs default to `dryRun: true`. The orchestrator:

1. Produces the handoff contract.
2. Prints the extraction result and validation gate for review.
3. Does **not** compile or dispatch task JSON unless:
   - `dryRun` is explicitly set to `false`, AND
   - `exitSignal` is `ready` or `needs-human-review` (with human approval).

This prevents silent mis-extraction from launching workers.

---

## Integration with the Deterministic Compiler

The LLM-assisted path wraps the existing deterministic compiler — it does not
replace it.

### Input Paths

| Path | Input | Extraction | Validation |
|------|-------|-----------|------------|
| **Deterministic** (default) | Structured JSON | Direct field copy | Standard specificity checks |
| **LLM-assisted** | Issue markdown | LLM extraction | Standard checks + confidence gate |
| **Hybrid** | Structured JSON + issue body | LLM enriches semantic fields | Standard checks + confidence gate |

### How They Connect

1. **Deterministic path** — unchanged. Structured JSON goes directly to the
   compiler. `llmExtracted` is absent or `false`.

2. **LLM-assisted path** — the LLM produces a handoff contract. If `exitSignal`
   is `ready`, the `extractionResult` becomes the input to the deterministic
   compiler with `llmExtracted: true`.

3. **Hybrid path** — structured JSON provides the structural fields (high
   confidence). The LLM enriches with `promptHandoff`, `knowledgeRefs`,
   `attentionFocus`, and `knownBlindspots`. The compiler merges both sources.

### Fallback Guarantee

If LLM extraction fails at any point:

1. Set `exitSignal: fallback-to-deterministic`.
2. Populate `fallbackPayload` with any fields the LLM did extract.
3. The deterministic compiler uses the structured input path with the
   partial overrides from `fallbackPayload.extractedFields`.

The system never produces invalid task JSON. The deterministic path is always
available.

---

## Confidence Thresholds

The orchestrator uses confidence levels to gate automation:

| Threshold | Behavior |
|-----------|---------|
| All fields `deterministic` or `high` | Auto-proceed if `validationGate.passed` is true |
| Any field `medium` | Proceed with advisory warning in PR body |
| Any field `low` | Route to `needs-human-review`; do not auto-dispatch |
| Any field `fail` in validation gate | Route to `blocked`; do not proceed |

These thresholds are advisory for the orchestrator. The schema does not enforce
them — the orchestrator reads `fieldConfidence` and `validationGate` to make
the routing decision.

---

## Example Handoff Contract

```json
{
  "schemaVersion": 1,
  "sourceType": "issue-body",
  "sourceIssue": 587,
  "sourceChecksum": "a1b2c3d4e5f6",
  "extractionResult": {
    "taskType": "execution",
    "risk": "medium",
    "conflictGroup": "task-compiler-llm-handoff",
    "allowedFiles": [
      "docs/ai-native/llm-assisted-task-compiler.md",
      "schemas/task-compiler-handoff.schema.json"
    ],
    "forbiddenFiles": [
      "src/**",
      "prisma/**",
      "package.json"
    ],
    "validationCommands": [
      "npm run check",
      "npm run build"
    ],
    "actorRole": "ai-native-final-layer-worker",
    "roleDescription": "Add LLM-assisted task compiler handoff contract.",
    "promptHandoff": "Define the handoff contract so Codex can exit routine orchestration with schema-validated LLM extraction.",
    "knowledgeRefs": [
      "docs/ai-native/issue-to-task-compiler.md",
      "docs/ai-native/issue-to-task-task-v2-mode.md",
      "schemas/task-v2.schema.json"
    ]
  },
  "fieldConfidence": {
    "taskType": "deterministic",
    "risk": "deterministic",
    "conflictGroup": "deterministic",
    "allowedFiles": "deterministic",
    "validationCommands": "deterministic",
    "actorRole": "deterministic",
    "knowledgeRefs": "high",
    "promptHandoff": "high"
  },
  "validationGate": {
    "passed": true,
    "checks": [
      { "field": "taskType", "status": "pass" },
      { "field": "risk", "status": "pass" },
      { "field": "conflictGroup", "status": "pass" },
      { "field": "allowedFiles", "status": "pass" },
      { "field": "validationCommands", "status": "pass" },
      { "field": "actorRole", "status": "pass" }
    ],
    "humanReviewRequired": false
  },
  "exitSignal": "ready",
  "dryRun": true,
  "capturedAt": "2026-05-11T14:30:00Z",
  "llmModel": "claude-sonnet-4-6",
  "extractionDurationMs": 3200
}
```

---

## Exit Signal Protocol

The exit signal is the contract's primary control mechanism. It tells the
orchestrator whether Codex can exit the routine orchestration loop.

### Signal Definitions

**`ready`** — The LLM successfully extracted all required fields with adequate
confidence. The validation gate passed. The orchestrator may compile task-v2
JSON and dispatch the worker.

**`needs-human-review`** — The extraction is structurally valid but has fields
at `low` confidence or validation warnings. The orchestrator must pause and
route to a human for approval before proceeding.

**`fallback-to-deterministic`** — The LLM extraction failed or produced
incomplete output. The orchestrator falls back to the deterministic path using
only structured input fields. The `fallbackPayload` carries any partial
extraction for override.

**`blocked`** — Hard validation failure. Required fields are missing or invalid
even after fallback. The orchestrator cannot proceed and must log the blocker.

### Transition Rules

```
ready ──────────────────▶ compile task-v2, dispatch worker
needs-human-review ─────▶ human approves ──▶ ready
                        └─ human rejects ──▶ blocked
fallback-to-deterministic ▶ deterministic compiler, standard path
blocked ──────────────────▶ log blocker, wait for human
```

---

## What This Contract Does NOT Do

- **Does not replace the deterministic compiler.** The LLM produces a handoff
  contract; the compiler still validates and emits the final task JSON.
- **Does not auto-merge.** The exit signal controls dispatch, not merge. Merge
  decisions remain human-owned.
- **Does not store secrets.** The contract contains no API keys, tokens, or
  provider configuration. Model identifiers are for audit only.
- **Does not bypass seed constitution.** High-risk boundaries and
  human-required gates are enforced regardless of exit signal.

---

## See Also

- [Issue-to-Task Compiler](issue-to-task-compiler.md) — Deterministic path
- [Issue-to-Task v2 Mode](issue-to-task-task-v2-mode.md) — v2 output fields
- [Task Schema v2](task-v2.schema.json) — Output JSON schema
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [PR Handoff Template](pr-handoff-template.md) — Worker PR body contract
- [Gate Result Schema](gate-result-schema.md) — Gate evaluation output
- [#587](https://github.com/taoyu051818-sys/lian-nest-server/issues/587) — This feature
