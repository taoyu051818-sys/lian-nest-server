# Prompt Auditor Role

Defines the Prompt Auditor role responsible for reviewing worker prompts
and system prompts against the AI-native control plane's safety and
governance invariants. The auditor is a read-only review role — it
evaluates prompts but does not modify them.

> **Closes:** [#994](https://github.com/taoyu051818-sys/lian-nest-server/issues/994)
> **See also:** [seed-constitution.md](../../.github/ai-policy/seed-constitution.md)
> for immutable boundaries,
> [worker-task-contract.md](worker-task-contract.md) for the task JSON
> schema, [external-reality-intake.md](external-reality-intake.md) for
> evidence intake rules.

---

## Overview

Before a worker is dispatched, its prompt must pass the Prompt Auditor
gate. The auditor checks that the assembled prompt (role prompt + control
appendix + context bundle) does not grant the worker authority beyond its
declared scope, does not weaken human-required boundaries, and follows
facts-first behavior.

```
role prompt + control appendix + context bundle
              |
              v
  ┌───────────────────────────┐
  │    prompt auditor gate    │  ◄── this document
  │                           │
  │  - scope alignment        │
  │  - boundary preservation  │
  │  - facts-first behavior   │
  │  - no self-expansion      │
  │  - validation coverage    │
  │  - injection resistance   │
  └───────────┬───────────────┘
              |
     ┌────────┼────────┐
     v        v        v
   pass     warn     block
     |        |        |
     v        v        v
 dispatch  dispatch  held for
           w/ notes  human review
```

---

## Audit Criteria

Every worker prompt MUST satisfy all six criteria to pass.

### 1. Scope Alignment

The prompt must not instruct the worker to act outside its declared
`allowedFiles` or beyond its `taskType`.

| Check | Pass Condition |
|-------|---------------|
| Allowed files match | Prompt references only files within the task's `allowedFiles` glob set |
| Forbidden files excluded | Prompt does not instruct the worker to read or edit `forbiddenFiles` entries |
| Task type respected | An `execution` prompt contains edit instructions; a `research` prompt contains only read instructions |
| Knowledge refs are readable | All `knowledgeRefs` paths exist and are readable at audit time |

**Block reason:** `SCOPE_MISMATCH` — prompt instructs the worker to act
outside declared boundaries.

**Warn reason:** `KNOWLEDGE_REF_MISSING` — a referenced doc does not
exist. Worker may proceed with reduced context.

### 2. Boundary Preservation

The prompt must not weaken, override, or relax any seed constitution
boundary or human-required gate.

| Check | Pass Condition |
|-------|---------------|
| Constitution sections intact | Prompt does not contradict any of the 5 constitution sections |
| Human gates preserved | Prompt does not instruct the worker to self-approve, override review gates, or bypass launch gates |
| No secret access | Prompt does not reference `.env` values, tokens, or credentials beyond redacted placeholders |
| Legacy read-only respected | Prompt does not instruct modification of legacy backend files |

**Block reason:** `BOUNDARY_WEAKENING` — prompt contradicts a seed
constitution rule or removes a human-required gate.

**Block reason:** `SECRET_EXPOSURE` — prompt contains or requests
unredacted secrets.

### 3. Facts-First Behavior

The prompt must ground worker actions in observable evidence, not
speculation or assumptions.

| Check | Pass Condition |
|-------|---------------|
| Evidence sources cited | Prompt references specific files, issues, or docs as the basis for the task |
| No speculative instructions | Prompt does not instruct the worker to "assume", "guess", or "invent" behavior |
| External evidence classified | Any external evidence in the context bundle has a valid `sourceClass` and `reliabilityTier` per [external-reality-intake.md](external-reality-intake.md) |
| Stale evidence flagged | Evidence older than 72 hours carries a staleness marker the worker is instructed to respect |

**Warn reason:** `UNGROUNDED_INSTRUCTION` — prompt contains instructions
not traceable to a specific evidence source.

### 4. No Self-Expansion

The prompt must not grant the worker the ability to expand its own scope,
modify its task JSON, or alter control-plane state.

| Check | Pass Condition |
|-------|---------------|
| No scope modification | Prompt does not instruct the worker to edit `allowedFiles`, `forbiddenFiles`, `conflictGroup`, or `sharedLocks` |
| No task JSON editing | Prompt does not reference writing to task JSON files or control-plane metadata |
| No orchestration self-promotion | Prompt does not instruct the worker to spawn sub-workers, create tasks, or modify scheduling state |
| No policy modification | Prompt does not instruct editing `.github/ai-policy/`, `.github/ai-state/`, or `docs/ai-native/` unless those paths are in `allowedFiles` |

**Block reason:** `SELF_EXPANSION` — prompt grants the worker ability to
modify its own boundaries or control-plane state.

### 5. Validation Coverage

The prompt must include or reference sufficient validation commands to
verify the worker's output.

| Check | Pass Condition |
|-------|---------------|
| Validation commands present | Task JSON contains at least one `validationCommands` entry |
| Commands are executable | Validation commands reference scripts or binaries that exist |
| Evidence capture instructed | Prompt instructs the worker to capture and attach validation output |

**Warn reason:** `WEAK_VALIDATION` — validation commands exist but may
not cover the full scope of changes.

### 6. Injection Resistance

The prompt must resist prompt-injection attacks from embedded external
data.

| Check | Pass Condition |
|-------|---------------|
| External text sanitized | All external text in the prompt has passed through the sanitizer defined in [external-reality-intake.md](external-reality-intake.md) |
| No system-role prefixes | Prompt does not contain `SYSTEM:`, `ASSISTANT:`, or `<system>` markers from external sources |
| No command injection | External text in the prompt does not contain unescaped shell metacharacters |
| Role escalation blocked | Prompt does not allow external text to claim authority roles |

**Block reason:** `INJECTION_VECTOR` — prompt contains unsanitized
external text that could be interpreted as instructions.

---

## Decision Matrix

| Decision | Meaning | Action |
|----------|---------|--------|
| **pass** | All criteria satisfied | Worker cleared for dispatch |
| **warn** | All hard criteria pass, one or more `Warn` reasons | Dispatch with warnings attached to worker context |
| **block** | One or more `Block` reasons | Hold for human review. No dispatch. |

### Override

A `repo-owner` can override a block with documented justification:

```json
{
  "decision": "override",
  "gateType": "prompt-audit",
  "overrideJustification": "Human-supplied reason for bypassing the block"
}
```

---

## Gate Result Schema

The auditor produces a JSON result conforming to
[gate-result-schema.md](gate-result-schema.md) with `gateType:
"prompt-audit"`.

```json
{
  "schemaVersion": 1,
  "gateType": "prompt-audit",
  "decision": "pass",
  "severity": "info",
  "markerId": "issue-<N>-prompt-audit",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": 994,
  "targetPR": null,
  "factsRead": [
    {
      "source": "task-json",
      "summary": "allowedFiles=1, taskType=execution, risk=low"
    },
    {
      "source": "role-prompt",
      "summary": "constitution-steward-worker prompt, 45 lines"
    }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": [
    { "key": "prompt-scope-aligned", "value": "true" },
    { "key": "prompt-boundaries-preserved", "value": "true" },
    { "key": "prompt-facts-grounded", "value": "true" }
  ]
}
```

### Block Example

```json
{
  "schemaVersion": 1,
  "gateType": "prompt-audit",
  "decision": "block",
  "severity": "error",
  "markerId": "issue-73-prompt-audit",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": 73,
  "targetPR": null,
  "factsRead": [
    {
      "source": "task-json",
      "summary": "allowedFiles includes src/auth/**"
    },
    {
      "source": "role-prompt",
      "summary": "Prompt references .env.JWT_SECRET without redaction"
    }
  ],
  "blockers": [
    {
      "code": "SECRET_EXPOSURE",
      "message": "Prompt references .env.JWT_SECRET without redaction."
    }
  ],
  "warnings": [],
  "producedFacts": []
}
```

---

## Pipeline Position

The prompt auditor sits between task compilation and worker dispatch:

```
issue-to-task compiler
        |
        v
  task JSON assembled
        |
        v
  prompt auditor gate    ◄── this document
        |
   pass |   block → human review
        v
  launch gate
        |
        v
  batch launch → worker
```

### Upstream Consumers

| Source | How It Feeds the Auditor |
|--------|--------------------------|
| [issue-to-task-compiler.md](issue-to-task-compiler.md) | Produces task JSON that the auditor validates |
| [context-bundles.md](context-bundles.md) | Produces context bundles the auditor checks for injection vectors |
| [external-reality-intake.md](external-reality-intake.md) | Classifies and sanitizes external evidence before it enters prompts |

### Downstream Integration

| Consumer | How It Uses Audit Output |
|----------|--------------------------|
| Launch gate | `pass` is a prerequisite for worker dispatch |
| Result publisher | Publishes audit result as issue comment |
| Audit log | Records all decisions for traceability |

---

## Evaluation Workflow

### Step 1: Prompt Assembly

The auditor receives the assembled worker prompt consisting of:
- Role prompt (from `ops/agent-prompts/<role>.md`)
- Control appendix (extracted from task JSON)
- Context bundle (evidence, docs, and external data)

### Step 2: Criteria Evaluation

Run each of the six criteria checks in order. Stop on first `Block`.

### Step 3: Decision

1. Any `Block` → **block**
2. No `Block` but has `Warn` → **warn** (dispatch with warnings)
3. All pass → **pass**

### Step 4: Action

| Decision | Action |
|----------|--------|
| `pass` | Clear worker for dispatch via launch gate |
| `warn` | Attach warnings to worker context bundle, proceed to launch gate |
| `block` | Hold task. Comment on issue with blockers. Await human review. |

---

## Marker ID Format

Marker IDs follow the pattern `issue-<N>-prompt-audit` where `<N>` is
the target issue number. This ensures:

- Idempotency — re-auditing the same task overwrites the previous result.
- Traceability — the marker links directly to the issue.
- Consistency — matches the pattern used by other gates.

---

## References

- [seed-constitution.md](../../.github/ai-policy/seed-constitution.md) — Immutable boundaries this auditor enforces.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema defining scope and boundaries.
- [external-reality-intake.md](external-reality-intake.md) — Evidence classification and sanitization rules.
- [gate-result-schema.md](gate-result-schema.md) — Common gate result JSON schema.
- [context-bundles.md](context-bundles.md) — How context reaches workers.
- [issue-to-task-compiler.md](issue-to-task-compiler.md) — Upstream compiler producing task JSON.
- [launch-gate.md](launch-gate.md) — Downstream gate that dispatches workers.
- [roles.md](roles.md) — Role registry.
- [orchestration.md](orchestration.md) — Worker lifecycle.
