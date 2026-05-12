# Candidate Gap Dedupe Policy

Defines how the orchestrator detects and resolves duplicate candidate
gaps before scheduling workers. Prevents redundant work from consuming
worker slots, provider quota, and reviewer capacity.

> **Closes:** [#1040](https://github.com/taoyu051818-sys/lian-nest-server/issues/1040)

---

## Problem

The planning loop produces candidate gaps — proposed tasks that address
an observed gap in coverage, health, or capability. Without deduplication,
the same gap can generate multiple candidates across planning cycles or
from overlapping signals. Launching duplicate workers wastes resources
and creates merge conflicts that block unrelated work.

Duplicate candidates arise from:

- Repeated planning cycles observing the same stale row or health failure.
- Multiple opportunity signals citing the same source facts.
- Overlapping file ownership across independently proposed tasks.
- The same domain or route being flagged by different gap types.

---

## Goals

- Define a deterministic dedupe key for candidate gaps.
- Document the five dedupe dimensions: route, domain, file ownership,
  source facts, and conflict group.
- Provide a merge strategy when duplicates are detected.
- Keep the policy local-only — no runtime changes, no secrets committed.

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of the dedupe script (planning doc only).
- No changes to the gap ledger entry schema.

---

## Dedupe Key

A candidate gap's dedupe key is a composite of five dimensions. Two
candidates are duplicates when their keys match on **all five** dimensions.

```
dedupeKey = hash(route, domain, fileOwnership, sourceFacts, conflictGroup)
```

Candidates that match on four or fewer dimensions are **not** duplicates
— they may address the same domain from different angles or touch
different files within the same conflict group.

---

## Dedupe Dimensions

### 1. Route

The API route or CLI command the candidate targets.

| Field | Type | Description |
|-------|------|-------------|
| `route` | string or null | Normalized route path (e.g. `GET /api/users`). `null` for non-route tasks (docs, scripts, infra). |

**Matching rule:** Exact string match after normalization (lowercase,
trailing slash stripped). Two candidates targeting the same route are
candidates for deduplication on this dimension.

**Normalization:**

```
"GET /api/Users/"  →  "get /api/users"
"GET /api/users/:id"  →  "get /api/users/:id"
"docs/ai-native/foo.md"  →  null  (not a route)
```

---

### 2. Domain

The feature domain or module area the candidate affects.

| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | Feature domain identifier (e.g. `auth`, `feed`, `profile`, `messages`, `notifications`, `ai-native`). |

**Matching rule:** Exact string match. Domains are drawn from the
existing conflict group vocabulary but are broader — a single domain
may contain multiple conflict groups (e.g. `auth` domain contains
`auth-core` and `auth-permissions` groups).

**Domain source:** Derived from the candidate's `conflictGroup` prefix
or the `allowedFiles` path prefix. When ambiguous, the compiler assigns
the domain explicitly.

| Domain | Conflict groups |
|--------|-----------------|
| `auth` | `auth-core`, `auth-permissions` |
| `posts` | `posts` |
| `feed` | `feed` |
| `messages` | `messages` |
| `notifications` | `notifications` |
| `profile` | `profile` |
| `ai-native` | `ai-native-docs`, `ai-policy-docs` |
| `infra` | `infrastructure`, `scripts` |

---

### 3. File Ownership

The set of files the candidate intends to edit.

| Field | Type | Description |
|-------|------|-------------|
| `fileOwnership` | string[] | Normalized file paths from `allowedFiles`. |

**Matching rule:** Set intersection. Two candidates overlap when their
`fileOwnership` sets share at least one file path. Full overlap (all
files match) is a strong duplicate signal. Partial overlap means the
candidates are related but not identical — they may be serialized
via conflict groups rather than deduplicated.

**Dedupe decision:**

| Overlap | Action |
|---------|--------|
| Full (100%) | Deduplicate — keep the higher-priority candidate. |
| Partial (>0%, <100%) | Do not deduplicate — serialize via conflict group. |
| None (0%) | No dedupe relationship. |

---

### 4. Source Facts

The evidence or observations that motivated the candidate.

| Field | Type | Description |
|-------|------|-------------|
| `sourceFacts` | string[] | Fact IDs from the opportunity signal or gap ledger entry. Format: `fact:<domain>:<slug>`. |

**Matching rule:** Set intersection. Two candidates share source facts
when their `sourceFacts` sets overlap. Shared facts indicate the
candidates were motivated by the same observation and likely propose
overlapping solutions.

**Dedupe decision:**

| Overlap | Action |
|---------|--------|
| All facts shared | Strong duplicate signal — deduplicate. |
| Some facts shared | Related candidates — consider merging experiments. |
| No facts shared | Independent observations — no dedupe. |

---

### 5. Conflict Group

The parallelism control group from the worker task contract.

| Field | Type | Description |
|-------|------|-------------|
| `conflictGroup` | string | From the task JSON `conflictGroup` field. |

**Matching rule:** Exact string match. Candidates in the same conflict
group already cannot run in parallel (enforced by the launch gate).
When two candidates share a conflict group, the dedupe policy may
merge them into a single task rather than serializing two workers.

**Interaction with launch gate:** The launch gate blocks concurrent
dispatch of same-group tasks. The dedupe policy runs **before** the
launch gate — it merges or eliminates duplicate candidates so the gate
never sees them.

---

## Dedupe Decision Matrix

The orchestrator evaluates all five dimensions to determine the action:

| Route | Domain | File Ownership | Source Facts | Conflict Group | Action |
|:-----:|:------:|:--------------:|:------------:|:--------------:|--------|
| match | match | full overlap | all shared | match | **Merge** — combine into one task. |
| match | match | full overlap | all shared | diff | **Deduplicate** — keep higher priority. |
| match | match | full overlap | partial | match | **Merge** — combine experiments. |
| match | match | full overlap | partial | diff | **Deduplicate** — keep higher priority. |
| match | match | partial overlap | any | match | **Serialize** — conflict group handles it. |
| match | match | partial overlap | any | diff | **Serialize** — conflict group handles it. |
| match | match | none | all shared | any | **Merge** — same observation, different files. |
| match | diff | any | any | any | No dedupe — different domains. |
| diff | match | any | any | any | No dedupe — different routes. |
| diff | diff | any | any | any | No dedupe — independent candidates. |

---

## Merge Strategy

When two candidates are merged, the resulting task inherits:

| Field | Source |
|-------|--------|
| `targetIssue` | Higher-priority candidate's issue. |
| `conflictGroup` | Shared conflict group (must match for merge). |
| `allowedFiles` | Union of both candidates' `allowedFiles`. |
| `sourceFacts` | Union of both candidates' `sourceFacts`. |
| `risk` | Maximum risk level across both candidates. |
| `validationCommands` | Union of both candidates' validation commands. |
| `sharedLocks` | Union of both candidates' `sharedLocks`. |
| `budgets.maxFiles` | Sum of both candidates' `maxFiles`. |
| `budgets.maxLinesChanged` | Sum of both candidates' `maxLinesChanged`. |
| `budgets.softTimeMinutes` | Maximum across both candidates. |
| `budgets.hardTimeMinutes` | Maximum across both candidates. |

The merged task's prompt handoff describes the combined scope. The
original candidate IDs are recorded in `meta.mergedFrom` for audit
traceability.

---

## Priority Ordering

When deduplicating (not merging), the orchestrator keeps the candidate
with higher priority. Priority is determined by the same ordering used
for slot allocation:

| Priority | Candidate characteristic |
|----------|--------------------------|
| 1 | Health/CI repair (main health red/yellow) |
| 2 | Runtime feature (main health green) |
| 3 | Docs |
| 4 | Research |

On equal priority, prefer:

1. Candidate with more source facts (stronger evidence).
2. Candidate with smaller file ownership (tighter scope).
3. Candidate created earlier (`createdAt` timestamp).

---

## Integration Points

### Planning Loop

The planning loop runs dedupe before producing the launch plan. It
reads all candidate gaps from the current cycle, computes dedupe keys,
and merges or eliminates duplicates.

```
plan-next-batch.ps1
       │
       ▼
  collect candidate gaps
       │
       ▼
  compute dedupe keys (route, domain, fileOwnership, sourceFacts, conflictGroup)
       │
       ▼
  merge / deduplicate / pass through
       │
       ▼
  produce launch plan
       │
       ▼
  check-launch-gate.ps1
```

### Launch Gate

The launch gate receives already-deduplicated candidates. Duplicate
conflict groups that survived dedupe (partial file overlap) are caught
by the gate's existing conflict group check.

### Gap Ledger

Deduplication events are **not** recorded in the gap ledger. The ledger
records realized gaps (worker failures, health gate failures), not
planning decisions. Dedupe is an internal optimization of the planning
loop.

### Opportunity Signals

Multiple opportunity signals may reference the same source facts. The
dedupe policy prevents the planning loop from promoting all of them
to separate tasks. The source fact overlap check catches this case.

---

## Configuration

Dedupe behavior is policy-driven, not hardcoded:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dedupe.enabled` | `true` | Master switch for dedupe logic. |
| `dedupe.fileOverlapThreshold` | `1.0` | File ownership overlap ratio for full dedupe (1.0 = 100% overlap required). |
| `dedupe.sourceFactOverlapThreshold` | `0.5` | Source fact overlap ratio for partial dedupe signal. |
| `dedupe.mergeEnabled` | `true` | Whether to merge candidates (vs. keep-and-serialize). |

Operators adjust these values in the planning policy file. Disabling
dedupe is a diagnostic escape hatch — the launch gate still prevents
concurrent conflicts.

---

## Design Decisions

- **Five-dimension composite key:** Prevents false positives from
  single-dimension matching. A shared domain alone is not enough to
  deduplicate — the candidates must agree on route, files, facts, and
  conflict group.
- **Merge over eliminate:** When candidates are duplicates, merging
  preserves all source facts and file ownership. Elimination discards
  evidence. Merge is the default; elimination only applies when merge
  would exceed budget constraints.
- **Dedupe before gate:** The planning loop runs dedupe before the
  launch gate, so the gate only sees unique candidates. This keeps the
  gate's responsibility narrow (policy + health + conflict) and avoids
  conflating dedupe logic with enforcement.
- **No ledger entries for dedupe:** Deduplication is a planning
  optimization, not a gap event. Recording it would pollute the ledger
  with non-actionable entries.

---

## References

- [Gap Ledger](gap-ledger.md) — Append-only gap event log.
- [Gap Ledger Schema](gap-ledger-schema.md) — Entry JSON schema.
- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared locks.
- [Launch Gate](launch-gate.md) — Pre-launch validation.
- [Launch Plan Schema](launch-plan-schema.md) — Compiled launch plan schema.
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot allocation and priority ordering.
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal structure with source facts.
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema.
- [#1040](https://github.com/taoyu051818-sys/lian-nest-server/issues/1040) — This feature.
