# Merge Capacity and Batch Policy

Defines batch size limits, risk-based merge rules, and stop-on-main-red
behavior for the controlled auto-merge pipeline. Prevents broad implicit
merging by enforcing explicit per-PR allowlists and small-batch ceilings.

> **Closes:** [#1038](https://github.com/taoyu051818-sys/lian-nest-server/issues/1038)

---

## Problem

Without batch capacity limits, the merge pipeline can accumulate large
sets of PRs that are merged in rapid sequence. This creates three risks:

1. **Blast radius** -- a single bad merge in a large batch can break
   main, and identifying the culprit requires bisecting many commits.
2. **Review fatigue** -- large batches discourage thorough per-PR review
   because the reviewer must hold too many changes in working memory.
3. **Implicit coupling** -- merging unrelated PRs in one batch creates
   a false sense of atomicity; if the batch partially fails, the
   remaining PRs may have invisible dependencies on the merged ones.

---

## Batch Size Limits

| Risk tier | Max PRs per batch | Rationale |
|-----------|-------------------|-----------|
| Low (`docs/**`, `scripts/**`, config) | 5 | Docs and config are independent; larger batches are safe but still bounded for blast radius. |
| Medium (cross-module, API surface) | 3 | Medium-risk changes need tighter coupling verification per batch. |
| High (`src/**`, `prisma/**`, auth, deps) | 1 | High-risk PRs are always single-merge with mandatory human review. |

**Enforcement:** The merge script (`merge-clean-pr-batch.ps1`) rejects
batches that exceed the limit for the highest-risk PR in the batch.
Mixed-risk batches use the most restrictive tier.

### Risk Tier Classification

A PR's risk tier is determined by the files it changes:

| Changed files | Risk tier |
|---------------|-----------|
| Only `docs/**`, `.github/ai-policy/**`, `ops/**` | Low |
| `scripts/**`, config files (`.github/**`) | Low |
| Any file under `src/**` | High |
| Any file under `prisma/**` | High |
| `package.json` or `package-lock.json` | High |
| `src/modules/auth/**` | High |
| Anything else | Medium |

If a PR touches files in multiple tiers, the highest tier wins.

---

## Stop-on-Main-Red

The merge pipeline MUST halt all merges when `main` is unhealthy.

| Main health state | Merge behavior |
|-------------------|---------------|
| `green` | Proceed with merge batch. |
| `yellow` | Proceed with low-risk batches only. Medium and high-risk batches are blocked. |
| `red` | **All merges blocked.** No PRs may merge until main recovers to `green` or `yellow`. |

### Recovery Flow

```
main turns red
       │
       ▼
  All merges blocked (stop-on-main-red)
       │
       ▼
  Fix issue created (category: bug + hotfix)
       │
       ▼
  Fix worker launched (highest priority)
       │
       ▼
  Fix PR merges (single-merge, human-reviewed)
       │
       ▼
  Post-merge health gate re-runs
       │
       ├── PASS → main green/yellow → resume merge pipeline
       │
       └── FAIL → stay red, create another fix issue
```

The health gate state is read from `.github/ai-state/main-health.json`.
See [main-health-policy.md](main-health-policy.md) for state definitions.

---

## No Broad Implicit Merging

The merge pipeline enforces explicit allowlists at three layers:

1. **Script layer:** `merge-clean-pr-batch.ps1` only processes PRs
   passed via `-PRs` or `-AllowlistFile`. It never discovers or guesses.
2. **Guard layer:** The task boundary guard validates each PR's changed
   files against `allowedFiles` and `forbiddenFiles` from the task manifest.
3. **Policy layer:** High-risk categories are always human-required,
   regardless of the allowlist.

These layers are defined in [controlled-auto-merge.md](controlled-auto-merge.md)
and [merge-policy.md](merge-policy.md). The capacity policy adds a
**fourth constraint**: batch size must not exceed the risk-tier ceiling.

### What "No Broad Implicit Merging" Means

- **No auto-discovery:** The merge script never scans for "all eligible PRs"
  and merges them. Each PR must be explicitly listed.
- **No risk escalation by batching:** A low-risk PR does not become
  "batch-approved" for high-risk merging by being grouped with other PRs.
  Each PR retains its individual risk classification.
- **No implicit ordering:** PRs in a batch are merged in the order listed,
  not inferred from dependency graphs. The operator (or orchestrator) is
  responsible for correct ordering.

---

## Batch Composition Rules

| Rule | Description |
|------|-------------|
| Single risk tier per batch preferred | Mixing low and high-risk PRs in one batch is allowed but uses the most restrictive tier's limits. |
| No conflicting conflict groups | All PRs in a batch must belong to different conflict groups (see [parallel-work-policy.md](parallel-work-policy.md)). |
| No draft PRs | Draft PRs are never included in any batch. |
| All PRs must be CLEAN | Status checks must pass before inclusion. No "merge and hope" for failing PRs. |
| Stop on first failure | If any PR in the batch fails to merge, the remaining PRs are not merged. The operator must remove the failing PR and re-batch. |

---

## Capacity Scaling

The batch size limits are policy-driven, not hardcoded. Operators may
adjust them based on team velocity and risk tolerance.

| Parameter | Location | Default |
|-----------|----------|---------|
| `maxBatchSize.lowRisk` | `.github/ai-policy/merge-capacity-policy.json` | 5 |
| `maxBatchSize.mediumRisk` | `.github/ai-policy/merge-capacity-policy.json` | 3 |
| `maxBatchSize.highRisk` | `.github/ai-policy/merge-capacity-policy.json` | 1 |

When the policy file is absent, the defaults above apply.

---

## Interaction with Existing Policies

### Merge Policy

[merge-policy.md](merge-policy.md) defines eligibility checks, guard
checks, and risk policy. The capacity policy adds batch size limits on
top of those checks. A batch must pass **both** merge policy and capacity
policy to proceed.

### Controlled Auto-Merge

[controlled-auto-merge.md](controlled-auto-merge.md) is the script that
executes merges. It reads the capacity policy to enforce batch size limits.
When `-RunGuards` is specified, the capacity check runs alongside the
existing guard checks.

### Resource Slot Scheduling

[resource-slot-scheduling.md](resource-slot-scheduling.md) governs how
many workers can run concurrently. Merge capacity is orthogonal -- it
limits how many PRs merge in one batch, not how many workers run in
parallel. A batch of 5 low-risk PRs may be merged while 3 workers are
still running on separate tasks.

### Parallel Work Policy

[parallel-work-policy.md](parallel-work-policy.md) governs which tasks
can run concurrently. The capacity policy governs how many PRs merge in
one batch. Both must be satisfied: a batch must not include PRs from
conflicting conflict groups, and the batch size must not exceed the
risk-tier ceiling.

### Worker Task Contract

[worker-task-contract.md](worker-task-contract.md) defines `allowedFiles`
and `forbiddenFiles` per task. The capacity policy uses these boundaries
to classify PR risk tier and enforce per-tier batch limits.

---

## Audit Trail

Every merge batch produces a manifest (see
[controlled-auto-merge.md](controlled-auto-merge.md#merge-batch-manifest)).
The capacity policy adds two fields to the manifest:

| Field | Type | Description |
|-------|------|-------------|
| `batchSize` | number | Number of PRs in the batch |
| `riskTier` | string | `low`, `medium`, or `high` -- the most restrictive tier in the batch |

These fields enable post-merge audit of whether capacity limits were
respected.

---

## References

- [merge-policy.md](merge-policy.md) -- Eligibility, guards, risk policy
- [controlled-auto-merge.md](controlled-auto-merge.md) -- Batch merge script
- [merge-closure-sop.md](merge-closure-sop.md) -- Post-merge procedure
- [parallel-work-policy.md](parallel-work-policy.md) -- Conflict groups
- [resource-slot-scheduling.md](resource-slot-scheduling.md) -- Worker concurrency
- [main-health-policy.md](main-health-policy.md) -- Health states
- [worker-task-contract.md](worker-task-contract.md) -- Task JSON schema
- [#1038](https://github.com/taoyu051818-sys/lian-nest-server/issues/1038) -- This document
