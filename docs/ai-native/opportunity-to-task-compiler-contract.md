# Opportunity-to-Task Compiler Contract

Defines how accepted opportunity signals become bounded task JSON
candidates without bypassing human or risk gates.

> **Closes:** [#979](https://github.com/taoyu051818-sys/lian-nest-server/issues/979)
>
> **Cross-references:**
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> opportunity signal fields,
> [task-schema-v2.md](task-schema-v2.md) for task JSON fields,
> [issue-to-task-compiler.md](issue-to-task-compiler.md) for the
> existing issue-based compiler,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for upstream
> idea promotion criteria,
> [external-intake-executable-loop.md](external-intake-executable-loop.md)
> for the full intake loop,
> [opportunity-loop-runbook.md](opportunity-loop-runbook.md) for the
> detect-compile-write cycle.

---

## Audience

Operators, orchestrators, and architects who need to understand how
opportunity signals transition from validated observations into
executable worker tasks while preserving all human and risk gates.

---

## Overview

The opportunity-to-task compiler transforms an accepted opportunity
signal into a task v2 JSON contract. It sits between the opportunity
signal lifecycle and the existing launch pipeline.

```
opportunity signal (status: accepted)
        │
        ▼
  ┌─────────────────────────────┐
  │ opportunity-to-task compiler │ ◄── this document
  │                             │
  │  - field mapping            │
  │  - gate preservation        │
  │  - scope derivation         │
  │  - validation emission      │
  └──────────┬──────────────────┘
             │
             ▼
       task v2 JSON candidate
             │
             ▼
       launch gate
             │
             ▼
       batch launch → worker
```

The compiler does **not** bypass any gate. It preserves the acceptance
gate from the signal, maps experiment scope to file boundaries, and
requires human approval before any worker is dispatched.

---

## Input: Accepted Opportunity Signal

The compiler accepts an opportunity signal with `status: "accepted"`.
Signals in any other state are rejected.

### Required Input Fields

All fields from [opportunity-signal-schema.md](opportunity-signal-schema.md)
are required. The compiler validates that:

| Field | Validation |
|-------|-----------|
| `status` | Must be `"accepted"` |
| `signalId` | Must match `opp-<uuid>` format |
| `sourceFacts` | At least one entry |
| `hypothesis.claim` | Non-empty string |
| `experiment.scope` | Non-empty string describing change boundary |
| `experiment.successCriteria` | At least one measurable criterion |
| `experiment.type` | One of: `code-change`, `config-change`, `data-collection`, `prototype`, `ab-test` |
| `acceptanceGate.requiredReviewRoles` | At least one role |
| `acceptanceGate.acceptanceOwner` | Non-empty string |
| `risk.level` | One of: `low`, `medium`, `high` |

### Rejection Conditions

The compiler refuses to emit task JSON when:

- `status` is not `"accepted"`
- Any required field is missing, null, or empty
- `experiment.scope` is broader than a single module boundary
- `experiment.successCriteria` has zero entries

---

## Field Mapping

The compiler maps opportunity signal fields to task v2 JSON fields.

### Direct Mappings

| Signal Field | Task v2 Field | Transform |
|-------------|--------------|-----------|
| `signalId` | `targetIssue` | Not directly mapped; see issue creation below |
| `risk.level` | `risk` | Direct: `low` / `medium` / `high` |
| `experiment.type` | `taskType` | `code-change` → `execution`, `config-change` → `execution`, `data-collection` → `research`, `prototype` → `execution`, `ab-test` → `research` |
| `acceptanceGate.requiredReviewRoles` | `requiredReviewRoles` | Direct pass-through |
| `acceptanceGate.acceptanceOwner` | `acceptanceOwner` | Direct pass-through |
| `acceptanceGate.healthGate` | `mainHealthPolicy` | `gate-all` / `gate-docs-only` / `gate-none` |

### Derived Mappings

| Signal Field | Task v2 Field | Derivation Rule |
|-------------|--------------|-----------------|
| `experiment.scope` | `allowedFiles` | Scope string converted to glob patterns. Single endpoint → `src/**/<module>/**`. Single feature flag → config file path. Staging only → `docs/**` or test files. |
| `experiment.scope` | `forbiddenFiles` | Complement of `allowedFiles`. Always includes `src/**` except the target module, plus standard forbidden set (`.env`, `dist/`, `node_modules/`, `prisma/migrations/`). |
| `experiment.scope` | `writeSet` | Same as `allowedFiles` — the worker is expected to write only within scope. |
| `experiment.successCriteria` | `validation` | Each criterion becomes a verification command or check description. At least one must be a runnable command. |
| `experiment.description` | `promptHandoff` | Concise description of what the experiment does and why. |
| `hypothesis.claim` | `knowledgeRefs` | Signal JSON path appended to knowledge refs so the worker can read the full signal context. |
| `risk.concerns` | `knownBlindspots` | Each concern becomes a blindspot the worker must avoid. |
| `risk.mitigations` | `attentionFocus` | Each mitigation becomes a focus area. |
| `sourceFacts` | `dependsOnFacts` | Each source fact maps to a fact dependency with `factId` and `description`. |

### Generated Fields

| Task v2 Field | Value |
|--------------|-------|
| `taskType` | Derived from `experiment.type` (see above) |
| `workerClass` | `opportunity-experiment` |
| `conflictGroup` | `opp-<signalId>` (e.g., `opp-a1b2c3d4`) |
| `expectedPR` | `true` for `code-change` and `config-change`; `false` for `data-collection` |
| `targetIssue` | Set to the GitHub issue number after issue creation (see below) |
| `targetPR` | `null` (new work) |
| `issues` | Array containing `targetIssue` |
| `pmPhase` | Inherited from the planning cycle that triggered compilation |
| `rollbackPlan.strategy` | `git-revert` for `code-change`; `manual-fixforward` for others |
| `rollbackPlan.notes` | Copied from `experiment.rollbackPlan` if present |
| `telemetry.emitHeartbeat` | `true` |
| `telemetry.heartbeatIntervalSeconds` | `120` |
| `telemetry.logLevel` | `normal` |
| `telemetry.tags` | `["opportunity", signalId] |

---

## Gate Preservation

The compiler preserves all human and risk gates. No gate is skipped or
weakened during compilation.

### Acceptance Gate → Review Roles

The signal's `acceptanceGate` maps directly to the task's review
configuration:

| Acceptance Gate Field | Task v2 Field | Gate Behavior |
|----------------------|--------------|---------------|
| `requiredReviewRoles` | `requiredReviewRoles` | Worker PR requires approval from these roles |
| `acceptanceOwner` | `acceptanceOwner` | Final authority to merge or reject |
| `healthGate` | `mainHealthPolicy` | Controls pre-experiment health checks |
| `criteria` | N/A (stored in issue body) | Visible to reviewers during PR review |

### Risk Gate

The signal's `risk.level` sets the task's `risk` field. Higher risk
levels trigger stricter launch gate checks:

| Risk Level | Launch Gate Behavior |
|-----------|---------------------|
| `low` | Standard health check |
| `medium` | Health check + conflict group collision check |
| `high` | Health check + conflict group check + explicit owner approval |

### Human Approval Requirement

The compiler **never** auto-launches a worker. The compiled task JSON is
always subject to:

1. **Launch gate** (`check-launch-gate.ps1`) — validates health, conflict
   groups, and resource availability.
2. **Human review** — the acceptance owner must approve before dispatch.
3. **Batch launcher** (`batch-launch.ps1`) — executes only after gates pass.

---

## Scope Derivation

The `experiment.scope` field drives file boundary derivation. The
compiler applies these rules to produce `allowedFiles` and
`forbiddenFiles`.

### Scope Patterns

| Scope Expression | `allowedFiles` | `forbiddenFiles` (supplement) |
|-----------------|---------------|-------------------------------|
| `"single endpoint: GET /api/users"` | `src/**/users/**` | Everything outside `src/**/users/**` |
| `"one feature flag: enable-dark-mode"` | `src/**/theme/**`, `config/features.*` | Everything outside theme module |
| `"staging only"` | `docs/**`, `test/**` | `src/**`, `prisma/**` |
| `"auth module"` | `src/modules/auth/**` | Everything outside `src/modules/auth/**` |
| `"database migration"` | `prisma/migrations/**`, `prisma/schema.prisma` | `src/**` |

### Standard Forbidden Set

Every compiled task includes these forbidden patterns regardless of
scope:

- `.env`, `**/.env`
- `node_modules/**`
- `dist/**`
- `llm_io_logs/**`
- `C:/Users/LENOVO/.claude/**`
- `package.json`
- `package-lock.json`

### Scope Validation

The compiler blocks when:

- `experiment.scope` cannot be resolved to at least one glob pattern
- Resolved `allowedFiles` exceeds 10 entries
- Resolved `allowedFiles` contains `**` or `*` (too broad)
- `allowedFiles` crosses module boundaries defined in
  `docs/architecture/`

---

## Validation Emission

The compiler derives `validation` commands from
`experiment.successCriteria`.

### Mapping Rules

| Success Criterion Type | Validation Command |
|----------------------|-------------------|
| Measurable metric (e.g., "P95 below 200ms") | Check description (validated by reviewer) |
| Testable condition (e.g., "No increase in error rate") | `npm run check` or domain-specific test |
| Structural check (e.g., "Query count drops to 2") | Check description with measurement instructions |
| File-level check (e.g., "Schema validates") | `npm run build` or `npm run check` |

### Minimum Validation Set

Every compiled task includes at least:

1. `npm run check` — type checking
2. One success-criterion-derived validation

---

## Issue Creation

Opportunity signals do not have pre-existing GitHub issues. The compiler
creates one during compilation.

### Issue Body

The generated issue includes:

1. **Title** — derived from `hypothesis.claim`
2. **Description** — `experiment.description` with context from
   `hypothesis.reasoning`
3. **Source facts** — linked evidence with `factId` and `source`
4. **Acceptance criteria** — from `experiment.successCriteria`
5. **Risk assessment** — from `risk.level`, `risk.concerns`, and
   `risk.mitigations`
6. **CONTROL APPENDIX** — generated from the mapped task v2 fields

### Issue Labels

| Label | Condition |
|-------|-----------|
| `agent:queued` | Always |
| `opportunity-derived` | Always |
| `risk:low` / `risk:medium` / `risk:high` | Based on `risk.level` |
| `experiment-type:<type>` | Based on `experiment.type` |

### Issue-to-Task Linkage

After issue creation, the compiler sets:

- `targetIssue` → newly created issue number
- `issues` → `[targetIssue]`
- `sourceIssue` → GitHub issue URL

---

## Output: Task v2 JSON Candidate

The compiled task JSON conforms to
[task-schema-v2.md](task-schema-v2.md). Example output:

```json
{
  "taskType": "execution",
  "workerClass": "opportunity-experiment",
  "risk": "medium",
  "conflictGroup": "opp-a1b2c3d4",
  "targetIssue": 980,
  "targetPR": null,
  "issues": [980],
  "expectedPR": true,
  "allowedFiles": ["src/**/users/**"],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": ["src/**/users/**"],
  "sharedLocks": ["prisma/schema.prisma"],
  "validation": [
    "npm run check",
    "npm run build"
  ],
  "actorRole": "opportunity-experiment-worker",
  "roleDescription": "Validate latency hypothesis via DataLoader batching",
  "attentionFocus": [
    "Set DataLoader cache TTL to 30s",
    "Cap batch size at 100 with cursor-based pagination"
  ],
  "knownBlindspots": [
    "DataLoader caching could serve stale avatar URLs if cache TTL misconfigured",
    "Batch size could cause memory pressure for large user lists"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:perf:p95-latency-spike",
      "description": "P95 latency on GET /api/users spiked from 120ms to 450ms"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:perf:p95-latency-post-fix",
      "description": "P95 latency after DataLoader batching",
      "confidence": "conditional"
    }
  ],
  "requiredReviewRoles": ["architect"],
  "acceptanceOwner": "codex orchestrator",
  "budget": {
    "maxFiles": 6,
    "maxLinesChanged": 300,
    "softTimeMinutes": 30,
    "hardTimeMinutes": 60
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Revert the DataLoader commit; the N+1 returns but is functionally correct."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["opportunity", "opp-a1b2c3d4"]
  },
  "sourceIssue": "https://github.com/taoyu051818-sys/lian-nest-server/issues/980",
  "knowledgeRefs": [
    ".github/ai-state/opportunity-signals/opp-a1b2c3d4.json"
  ],
  "promptHandoff": "Add batch-loading for avatar URLs using DataLoader with a 30s cache TTL to validate the N+1 query hypothesis."
}
```

---

## Pipeline Integration

The compiler fits into the existing orchestration pipeline after the
opportunity signal lifecycle and before the launch gate.

```
calculate-meta-signals.js
        │
        v
suggest-next-tasks-from-meta-signals.js
        │
        v
agent idea review gate
        │
        v
opportunity signal lifecycle
(draft → validated → accepted)
        │
        v
  opportunity-to-task compiler    ◄── this document
        │
        v
  GitHub issue created (CONTROL APPENDIX)
        │
        v
  launch gate (check-launch-gate.ps1)
        │
        v
  batch launch (batch-launch.ps1) → worker
```

### Upstream Consumers

| Source | How It Feeds Signals |
|--------|---------------------|
| [opportunity-signal-schema.md](opportunity-signal-schema.md) | Defines the accepted signal structure |
| [agent-idea-review-gate.md](agent-idea-review-gate.md) | Validates ideas before signal creation |
| [external-intake-executable-loop.md](external-intake-executable-loop.md) | Routes evidence to opportunity signals |

### Downstream Integration

| Consumer | How It Uses Compiled Task |
|----------|--------------------------|
| Launch gate | Validates health, conflict groups, resource availability |
| Batch launcher | Creates worktree, dispatches worker |
| Worker | Reads task JSON for file boundaries, validation commands, context |
| Result publisher | Links task completion back to signal for loop closure |

---

## Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Signal not accepted | `status !== "accepted"` | Reject compilation; signal must reach `accepted` state first |
| Scope too broad | `allowedFiles` exceeds 10 or contains `**` | Block compilation; signal needs narrower experiment scope |
| Missing success criteria | `experiment.successCriteria` is empty | Block compilation; signal is underspecified |
| Scope crosses module boundaries | `allowedFiles` spans multiple modules | Block compilation; split signal into separate experiments |
| Issue creation fails | `gh issue create` exits non-zero | Retry; check GitHub API permissions |
| Launch gate rejects | Health or conflict group check fails | Defer to next planning cycle; signal remains `accepted` |

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-state/opportunity-signals/opp-<uuid>.json` | Accepted signal input |
| `tasks/issue-<N>.json` | Compiled task v2 JSON output |
| `.github/ai-state/fact-events.ndjson` | Compilation fact events |
| `.github/ai-state/meta-signals.json` | Health signals for launch gate |

---

## References

- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal fields and lifecycle
- [Task Schema v2](task-schema-v2.md) — Target task JSON schema
- [Issue-to-Task Compiler](issue-to-task-compiler.md) — Existing issue-based compiler
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Upstream idea promotion
- [External Intake Executable Loop](external-intake-executable-loop.md) — Full intake protocol
- [Opportunity Loop Runbook](opportunity-loop-runbook.md) — Detect-compile-write cycle
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Worker Task Contract](worker-task-contract.md) — Base task contract
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
