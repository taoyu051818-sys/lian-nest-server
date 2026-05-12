# Parallel Guard Execution Policy

Defines how multiple guard checks execute in parallel and how their
individual results reduce into a single gate decision. Applies to
launch gates, PR review gates, and merge gates across the AI-native
control plane.

> **Closes:** [#1046](https://github.com/taoyu051818-sys/lian-nest-server/issues/1046)
>
> **Reference:** [Gate Result Schema](gate-result-schema.md) for output
> format, [Controlled Auto-Merge](controlled-auto-merge.md) for merge
> guard integration, [Parallel Work Policy](parallel-work-policy.md) for
> conflict group rules.

---

## Problem

The existing guard system runs guards sequentially within the controlled
auto-merge script (boundary, handoff, docs authority, generated Prisma).
As the guard surface grows to cover route parity, semantic consistency,
risk policy, telemetry budgets, and secret scanning, sequential execution
becomes a bottleneck. Worse, there is no formal contract for how
multiple guard outcomes combine into one gate decision — blocking vs.
warning semantics are implicit.

This policy defines the parallel execution model and the reducer that
collapses N guard results into a single pass/block/warn/override
decision.

## Goals

- Define which guards may run concurrently and which must serialize.
- Define the reducer contract: how guard results collapse into one gate
  decision.
- Reuse the [gate-result.schema.json](gate-result-schema.md) output
  format for individual guard results and the aggregate gate decision.
- Keep the contract local-only — planning doc, no runtime changes.

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of guard scripts (contract only).
- No bypass of risk policy, review gates, or shared lock rules.

---

## Guard Registry

Eight guards participate in the parallel execution model. Each guard
has a scope, blocking behavior, and required inputs.

| Guard | Scope | Behavior | Required Input | Source Doc |
|-------|-------|----------|---------------|------------|
| Boundary | Per-PR diff | **Blocking** | `.ai/task-manifest.json` | [controlled-auto-merge.md](controlled-auto-merge.md) |
| Handoff | Per-PR body | **Blocking** | PR body | [controlled-auto-merge.md](controlled-auto-merge.md) |
| Docs Authority | Repo-wide | Warning | `docs/` directory | [controlled-auto-merge.md](controlled-auto-merge.md) |
| Route Parity | Per-PR diff | **Blocking** | Controller/resolver files | [writeset-sharedlocks-policy.md](writeset-sharedlocks-policy.md) |
| Semantic | Per-PR diff | Warning | Changed source files | This doc |
| Risk | Per-PR diff | **Blocking** | `.github/ai-policy/risk-policy.json` | [risk-policy.md](risk-policy.md) |
| Telemetry | Per-worker | Warning | Telemetry JSON record | [telemetry-budget-guard.md](telemetry-budget-guard.md) |
| Secret Scan | Per-PR diff | **Blocking** | Changed files content | This doc |

### Behavioral Definitions

**Blocking** guards produce a `block` decision that prevents gate
passage. A single blocking guard failure is sufficient to stop the
pipeline.

**Warning** guards produce a `warn` decision that surfaces findings but
does not prevent gate passage. Warnings are included in the aggregate
result for human review.

---

## Guard Scopes and Independence

Guards are independent when they read disjoint inputs and do not share
state. Independence determines parallel eligibility.

| Guard | Reads | Write Dependencies |
|-------|-------|--------------------|
| Boundary | `allowedFiles`, `forbiddenFiles`, PR diff | None |
| Handoff | PR body text | None |
| Docs Authority | `docs/**/*.md` file tree | None |
| Route Parity | Controller/resolver file list | None |
| Semantic | Changed source files, imports | None |
| Risk | `risk-policy.json`, PR diff file list | None |
| Telemetry | Telemetry JSON record | None |
| Secret Scan | Changed file contents | None |

All eight guards read independent inputs. No guard depends on another
guard's output. All may run concurrently.

---

## Execution Model

### Phase 1: Collect Inputs

Gather all required inputs for each guard before execution begins.

```
Input:  PR diff, PR body, task manifest, risk policy, telemetry record
Output: input bundles per guard
```

If a required input is missing, the guard is **skipped** (fail-closed).
Skipped guards do not contribute a result to the reducer — they are
treated as absent, not as failures.

### Phase 2: Parallel Dispatch

Dispatch all eligible guards concurrently. Each guard produces a
[gate-result](gate-result-schema.md) JSON object.

```
Input:  input bundles from Phase 1
Output: array of gate-result objects (one per guard)
```

Guards with all inputs present execute in parallel. Guards with missing
inputs are skipped and omitted from the result array.

### Phase 3: Reduce

Collapse the array of guard results into a single aggregate gate
decision. See [Reducer Contract](#reducer-contract) below.

```
Input:  array of gate-result objects
Output: single aggregate gate-result
```

---

## Reducer Contract

The reducer receives an array of individual guard results and produces
one aggregate gate result. It operates by applying the following rules
in order.

### Rule 1: Any Block → Aggregate Block

If **any** guard result has `decision: "block"`, the aggregate decision
is `block`. The aggregate collects all blockers from blocking guards.

```
guards = [pass, pass, block, warn, pass]
→ aggregate decision: block
→ aggregate blockers: union of all block guard blockers
```

### Rule 2: No Block + Any Warn → Aggregate Warn

If no guard produced `block` but at least one produced `warn`, the
aggregate decision is `warn`. Warnings are collected for human review.

```
guards = [pass, warn, pass, warn]
→ aggregate decision: warn
→ aggregate warnings: union of all warning guard findings
```

### Rule 3: All Pass → Aggregate Pass

If every guard result has `decision: "pass"`, the aggregate decision is
`pass`.

```
guards = [pass, pass, pass]
→ aggregate decision: pass
```

### Rule 4: Override Propagation

If any guard result has `decision: "override"`, it is treated as `pass`
in the reduction but the `overrideJustification` is preserved in the
aggregate result. Multiple overrides are concatenated.

```
guards = [pass, override("flaky test"), pass]
→ aggregate decision: pass
→ aggregate overrideJustification: "flaky test"
```

### Rule 5: Empty Input → Block

If the guard result array is empty (all guards skipped due to missing
inputs), the aggregate decision is `block`. A gate cannot pass without
at least one guard running.

```
guards = []
→ aggregate decision: block
→ aggregate blockers: [{ "code": "NO_GUARDS_RAN", "message": "..." }]
```

---

## Aggregate Result Schema

The aggregate result conforms to [gate-result.schema.json](gate-result-schema.md)
with the following conventions:

| Field | Source |
|-------|--------|
| `schemaVersion` | `1` |
| `gateType` | Inherited from the gate context (`launch`, `pr-review`, `merge`) |
| `decision` | Computed by the reducer rules above |
| `severity` | Highest severity across all guard results (`critical` > `error` > `warning` > `info`) |
| `markerId` | `<context>-<id>-parallel-guards` (e.g. `pr-42-parallel-guards`) |
| `capturedAt` | Timestamp of the reducer execution |
| `targetIssue` | Inherited from gate context |
| `targetPR` | Inherited from gate context |
| `factsRead` | Union of all guard `factsRead` arrays |
| `blockers` | Union of all blocking guard `blockers` arrays |
| `warnings` | Union of all warning guard `warnings` arrays |
| `producedFacts` | Union of all guard `producedFacts` arrays |
| `overrideJustification` | Concatenated from all override guard results |

### Example: Aggregate Pass

```json
{
  "schemaVersion": 1,
  "gateType": "merge",
  "decision": "pass",
  "severity": "info",
  "markerId": "pr-42-parallel-guards",
  "capturedAt": "2026-05-12T10:00:00.000Z",
  "targetIssue": 38,
  "targetPR": 42,
  "factsRead": [
    { "source": "task-manifest", "summary": "Boundary check passed" },
    { "source": "pr-body", "summary": "All 7 handoff sections present" },
    { "source": "risk-policy", "summary": "No high-risk categories matched" }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": []
}
```

### Example: Aggregate Block

```json
{
  "schemaVersion": 1,
  "gateType": "merge",
  "decision": "block",
  "severity": "error",
  "markerId": "pr-55-parallel-guards",
  "capturedAt": "2026-05-12T10:05:00.000Z",
  "targetIssue": 50,
  "targetPR": 55,
  "factsRead": [
    { "source": "task-manifest", "summary": "Boundary check failed" },
    { "source": "risk-policy", "summary": "High-risk category: auth/session" }
  ],
  "blockers": [
    { "code": "BOUNDARY_VIOLATION", "message": "Changed file src/main.ts outside allowedFiles" },
    { "code": "HIGH_RISK_NO_REVIEW", "message": "Auth/session changes require architect review" }
  ],
  "warnings": [],
  "producedFacts": []
}
```

### Example: Aggregate Warn

```json
{
  "schemaVersion": 1,
  "gateType": "merge",
  "decision": "warn",
  "severity": "warning",
  "markerId": "pr-60-parallel-guards",
  "capturedAt": "2026-05-12T10:10:00.000Z",
  "targetIssue": 58,
  "targetPR": 60,
  "factsRead": [
    { "source": "docs/", "summary": "Docs authority check completed" },
    { "source": "telemetry", "summary": "Token usage at 85% of budget" }
  ],
  "blockers": [],
  "warnings": [
    { "code": "DUPLICATE_H1_TITLE", "message": "Duplicate H1: 'Overview' in two docs files" },
    { "code": "TOKEN_BUDGET_WARNING", "message": "Output tokens at 85% of execution budget" }
  ],
  "producedFacts": []
}
```

---

## Guard Definitions

### Boundary Guard

**Scope:** Per-PR diff. **Behavior:** Blocking.

Checks that each PR's changed files stay inside `allowedFiles` globs and
do not touch `forbiddenFiles` globs from the task manifest. Violations
block the gate.

**Input:** `.ai/task-manifest.json` with `allowedFiles` and
`forbiddenFiles` arrays.

**Output blockers:**

| Code | Meaning |
|------|---------|
| `BOUNDARY_VIOLATION` | Changed file outside `allowedFiles` |
| `FORBIDDEN_FILE_TOUCH` | Changed file matches `forbiddenFiles` pattern |

### Handoff Guard

**Scope:** Per-PR body. **Behavior:** Blocking.

Validates that the PR body contains all seven required handoff sections:
Summary, Changed Files, Linked Issues, Validation, Non-Goals,
Risk / Rollback, and Follow-up Handoff.

**Input:** PR body text from `gh pr view`.

**Output blockers:**

| Code | Meaning |
|------|---------|
| `MISSING_HANDOFF_SECTION` | Required section absent from PR body |

### Docs Authority Guard

**Scope:** Repo-wide. **Behavior:** Warning.

Runs `check-docs-authority.js` to detect duplicate basenames, duplicate
H1 titles, and missing frontmatter. Does not block the gate.

**Input:** `docs/` directory tree.

**Output warnings:**

| Code | Meaning |
|------|---------|
| `DUPLICATE_BASENAME` | Two docs files share the same filename |
| `DUPLICATE_H1_TITLE` | Two docs files share the same H1 heading |
| `MISSING_FRONTMATTER` | Docs file lacks required frontmatter fields |

### Route Parity Guard

**Scope:** Per-PR diff. **Behavior:** Blocking.

Checks that controller and resolver files do not register duplicate or
conflicting route endpoints. Uses the `route-parity` shared lock
definitions from [writeset-sharedlocks-policy.md](writeset-sharedlocks-policy.md).

**Input:** Changed controller/resolver file list from PR diff.

**Output blockers:**

| Code | Meaning |
|------|---------|
| `DUPLICATE_ROUTE` | Two controllers register the same HTTP method + path |
| `CONFLICTING_RESOLVER` | Two resolvers expose the same GraphQL field |

### Semantic Guard

**Scope:** Per-PR diff. **Behavior:** Warning.

Checks for semantic consistency issues that do not violate explicit rules
but may indicate problems: unused imports after a rename, inconsistent
naming conventions, or missing re-exports.

**Input:** Changed source files and their import graphs.

**Output warnings:**

| Code | Meaning |
|------|---------|
| `UNUSED_IMPORT` | Import no longer referenced after the change |
| `MISSING_RE_EXPORT` | New module not re-exported from barrel file |
| `NAMING_INCONSISTENCY` | Identifier does not match expected convention |

### Risk Guard

**Scope:** Per-PR diff. **Behavior:** Blocking.

Matches changed files against [risk-policy.json](risk-policy.md)
categories. If any matched category requires `architect-review` or
`architect-review-plus-dry-run` and the required review is not present,
the guard blocks.

**Input:** `.github/ai-policy/risk-policy.json`, PR diff file list.

**Output blockers:**

| Code | Meaning |
|------|---------|
| `HIGH_RISK_NO_REVIEW` | High-risk file area requires architect review |
| `DESTRUCTIVE_MIGRATION_NO_DRY_RUN` | Migration requires dry-run validation |

### Telemetry Guard

**Scope:** Per-worker. **Behavior:** Warning.

Validates worker telemetry records against the telemetry budget policy.
Reports wall-clock, token, and cost overruns as warnings.

**Input:** Worker telemetry JSON record.

**Output warnings:**

| Code | Meaning |
|------|---------|
| `WALL_CLOCK_OVERRUN` | Elapsed time exceeds soft or hard limit |
| `TOKEN_BUDGET_WARNING` | Token usage exceeds warning threshold |
| `COST_OVERRUN` | Estimated cost exceeds warning threshold |

### Secret Scan Guard

**Scope:** Per-PR diff. **Behavior:** Blocking.

Scans changed file contents for patterns that match secrets, tokens,
credentials, or `.env` values. Uses the `sanitizeObject` patterns from
the [webui-operation-runbook.md](webui-operation-runbook.md).

**Input:** Changed file contents from PR diff.

**Output blockers:**

| Code | Meaning |
|------|---------|
| `SECRET_DETECTED` | File content matches a secret pattern |
| `ENV_VALUE_LEAK` | Value from `.env` file appears in changed code |

---

## Skipped Guards

A guard is skipped when its required input is not present. Skipped
guards do not produce a result and are excluded from the reducer array.

| Guard | Skipped When |
|-------|-------------|
| Boundary | `.ai/task-manifest.json` does not exist |
| Handoff | PR body cannot be retrieved |
| Docs Authority | `docs/` directory does not exist |
| Route Parity | No controller/resolver files in PR diff |
| Semantic | No source files in PR diff |
| Risk | `.github/ai-policy/risk-policy.json` does not exist |
| Telemetry | No telemetry record provided |
| Secret Scan | PR diff cannot be retrieved |

If all guards are skipped, the reducer applies Rule 5 (empty input →
block) and the gate fails closed.

---

## Interaction with Existing Policies

### Controlled Auto-Merge

The four existing guards (boundary, handoff, docs authority, generated
Prisma) are a subset of this policy. When `-RunGuards` is specified,
the merge script should dispatch guards according to this policy and
reduce results using the reducer contract. The generated Prisma guard
is subsumed by the boundary guard (generated files without schema
changes are a boundary ownership violation).

### Risk Policy

The risk guard is the gate-level enforcement of
[risk-policy.md](risk-policy.md). It reads the same policy JSON and
applies the same category matching, but produces a gate result instead
of a launch restriction.

### Telemetry Budget Policy

The telemetry guard is the gate-level enforcement of
[telemetry-budget-guard.md](telemetry-budget-guard.md). It runs
advisory checks and reports findings as warnings in the aggregate
result.

### Parallel Work Policy

Guards themselves are stateless reads — they do not conflict with each
other or with worker write sets. The parallel execution model in this
policy is orthogonal to the worker parallelism model in
[parallel-work-policy.md](parallel-work-policy.md).

### Gate Result Schema

Individual guard results and the aggregate result both conform to
[gate-result.schema.json](gate-result-schema.md). The `markerId`
convention distinguishes per-guard results (`pr-<N>-guard-<type>`)
from the aggregate (`pr-<N>-parallel-guards`).

---

## Rollback

Guards are read-only checks — they do not modify files or state. If a
guard fails and blocks the gate, the corrective action is to fix the
offending change and re-run the gate. No rollback of guard execution is
needed.

---

## References

- [Gate Result Schema](gate-result-schema.md) — Output format
- [Controlled Auto-Merge](controlled-auto-merge.md) — Merge guard integration
- [Risk Policy](risk-policy.md) — Risk category definitions
- [Telemetry Budget Guard](telemetry-budget-guard.md) — Telemetry validation
- [Writeset SharedLocks Policy](writeset-sharedlocks-policy.md) — Route parity lock
- [Parallel Work Policy](parallel-work-policy.md) — Worker parallelism rules
- [WebUI Operation Runbook](webui-operation-runbook.md) — Secret scan patterns
- [PR Review Gate](pr-review-gate.md) — Review criteria
- [#1046](https://github.com/taoyu051818-sys/lian-nest-server/issues/1046) — This feature
