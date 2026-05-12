# Review Capacity Aware Scheduling

Defines how the orchestrator accounts for review bandwidth, PR pileup, merge
queue saturation, and downstream health gate limits when dispatching workers.
This extends the four-dimension resource slot model with a fifth dimension:
**review capacity**.

> **Closes:** [#1037](https://github.com/taoyu051818-sys/lian-nest-server/issues/1037)

---

## Problem

The resource slot model ([resource-slot-scheduling.md](resource-slot-scheduling.md))
constrains dispatch by provider quota, local machine capacity, GitHub API rate
limits, and user-max workers. These dimensions govern how many workers can
**run** — but they do not govern how many PRs can be **reviewed and merged**.

When workers produce PRs faster than reviewers can process them, the open-PR
count grows unbounded. This causes:

- **Reviewer overload** — required roles accumulate review debt, slowing every
  PR in the queue.
- **Stale PRs** — long-lived PRs develop merge conflicts and drift from `main`.
- **Merge queue saturation** — the controlled auto-merge batch processes PRs
  sequentially; a deep queue delays all PRs behind the slowest review.
- **Health gate thrashing** — post-merge health checks run after each batch;
  rapid merges without review digestion create noisy health transitions.

---

## Review Capacity Slot

A **review capacity slot** is permission to dispatch a worker that will produce
a PR requiring review. A worker may only launch when a review slot is available
in addition to the four resource slots.

```
Worker launch requires:

  provider-quota slot    ✓
  local-machine slot     ✓
  github-api slot        ✓
  user-max slot          ✓
  review-capacity slot   ✓
       ─────────────────────
       all five = LAUNCH
       any blocked = WAIT
```

---

## Capacity Dimensions

### 1. Open PR Limit

**What it constrains:** Total number of open PRs across all workers.

| Field | Source | Default |
|-------|--------|---------|
| `maxOpenPRs` | Policy config | 8 |
| Depletion signal | `openPRCount >= maxOpenPRs` | — |
| Recovery | Any PR merges or closes | — |
| Hard block | Limit reached | Delay dispatch |

The launcher counts open PRs via `gh pr list --state open`. When the count
reaches `maxOpenPRs`, no new workers are dispatched — even if resource slots
are available.

**Why 8:** The default assumes two reviewers processing ~4 PRs each per cycle.
Adjust based on reviewer capacity and PR complexity.

### 2. Reviewer Role Saturation

**What it constrains:** Number of PRs awaiting review from a specific role.

| Field | Source | Default |
|-------|--------|---------|
| `maxPendingPerRole` | Policy config | 4 |
| Depletion signal | Any required role has >= `maxPendingPerRole` pending reviews | — |
| Recovery | Role submits review (approve or request-changes) | — |
| Hard block | At least one role saturated | Delay dispatch for tasks requiring that role |

The launcher inspects the `requiredReviewRoles` from each queued task's contract.
If any role already has `maxPendingPerRole` or more PRs awaiting its review, the
task is held.

**Per-role tracking:**

| Role | Current pending | Limit | Saturated? |
|------|----------------|-------|------------|
| ai-architecture-reviewer | 3 | 4 | No |
| control-plane-reviewer | 4 | 4 | Yes |
| migration-auditor | 1 | 4 | No |
| security-reviewer | 0 | 4 | No |

A task requiring `control-plane-reviewer` would be blocked; a task requiring
only `migration-auditor` would proceed.

### 3. Merge Queue Depth

**What it constrains:** Number of PRs in the merge-ready queue (approved,
checks passing, awaiting merge window).

| Field | Source | Default |
|-------|--------|---------|
| `maxMergeQueueDepth` | Policy config | 6 |
| Depletion signal | `mergeReadyCount >= maxMergeQueueDepth` | — |
| Recovery | Merge batch executes and merges PRs | — |
| Hard block | Queue full | Delay dispatch |

The merge-ready queue includes PRs that have passed all reviews and checks but
have not yet been included in a merge batch. When the queue is full, new workers
producing more PRs would only deepen the backlog.

### 4. Health Gate Cooldown

**What it constrains:** Minimum interval between merge batches to allow health
gate signals to stabilize.

| Field | Source | Default |
|-------|--------|---------|
| `healthGateCooldownMinutes` | Policy config | 10 |
| Depletion signal | Time since last merge batch < cooldown | — |
| Recovery | Cooldown expires | — |
| Soft block | Within cooldown window | Delay dispatch, do not hard-block |

After a merge batch completes (whether health gate passes or fails), the
launcher enforces a cooldown before dispatching workers that would add to the
merge queue. This prevents rapid-fire merge-then-dispatch cycles.

---

## Effective Review Capacity

The effective review capacity at any moment is:

```
effectiveReviewSlots = min(
  maxOpenPRs - openPRCount,
  min(maxPendingPerRole - pendingPerRole[role]) for each required role of queued tasks,
  maxMergeQueueDepth - mergeReadyCount
)
```

When `effectiveReviewSlots <= 0`, the launcher blocks dispatch and logs the
bottleneck dimension.

---

## Decision Flow

The launcher evaluates review capacity **after** resource slots pass:

```
Resource slot check (4 dimensions)
       │
       ├── all pass
       ▼
  Review capacity check
       │
       ├── openPRCount >= maxOpenPRs?        → BLOCK: "review:open-pr-limit"
       │
       ├── any requiredRole saturated?       → BLOCK: "review:role-saturated:<role>"
       │
       ├── mergeReadyCount >= maxMergeQueue? → BLOCK: "review:merge-queue-full"
       │
       ├── within healthGateCooldown?        → BLOCK: "review:health-cooldown"
       │
       ▼
  All clear → dispatch worker
```

### Blocking Reasons

| Dimension | Log message | Recovery action |
|-----------|-------------|-----------------|
| Open PR limit | `review:open-pr-limit` | Wait for PR to merge or close |
| Role saturation | `review:role-saturated:<role>` | Wait for role to submit review |
| Merge queue full | `review:merge-queue-full` | Wait for merge batch to execute |
| Health gate cooldown | `review:health-cooldown` | Wait for cooldown to expire |

---

## Interaction with Existing Policies

### Resource Slot Scheduling

Review capacity is the fifth dimension alongside provider quota, local machine,
GitHub API, and user-max. The effective concurrency becomes:

```
effectiveSlots = min(
  providerQuotaSlots,
  localMachineSlots,
  githubApiSlots,
  userMaxSlots,
  reviewCapacitySlots
)
```

A task must clear all five dimensions to launch.

### Parallel Work Policy

Conflict group rules remain orthogonal. Two tasks in the same conflict group
still cannot run concurrently — review capacity does not relax serialization.
The launcher enforces conflict groups first, then resource slots, then review
capacity.

### Controlled Auto-Merge

The merge queue depth limit aligns with the controlled auto-merge script's
batch processing. The script merges PRs sequentially with `--squash`. A deep
queue means longer batch execution times and higher risk of mid-batch conflicts.

### PR Review Gate

The reviewer role saturation dimension maps directly to the
[pr-review-gate.md](pr-review-gate.md) required reviews. Each role listed in
`requiredReviewRoles` contributes to the pending count.

---

## Configuration

All review capacity parameters are policy-driven:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxOpenPRs` | 8 | Maximum total open PRs |
| `maxPendingPerRole` | 4 | Maximum pending reviews per role |
| `maxMergeQueueDepth` | 6 | Maximum PRs in merge-ready queue |
| `healthGateCooldownMinutes` | 10 | Minutes to wait after a merge batch |

These values should be tuned to the team's review throughput and PR complexity.

---

## Monitoring

### Review Capacity Telemetry

The launcher should emit a review capacity record after each dispatch cycle:

```json
{
  "capturedAt": "2026-05-12T09:30:00Z",
  "reviewCapacity": {
    "openPRs": { "current": 5, "limit": 8 },
    "roleSaturation": {
      "ai-architecture-reviewer": { "pending": 2, "limit": 4 },
      "control-plane-reviewer": { "pending": 3, "limit": 4 }
    },
    "mergeQueue": { "current": 3, "limit": 6 },
    "healthGateCooldown": { "active": false, "expiresAt": null }
  },
  "effectiveReviewSlots": 3,
  "bottleneck": null
}
```

---

## References

- [Resource Slot Scheduling](resource-slot-scheduling.md) — Four-dimension resource model
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group rules
- [PR Review Gate](pr-review-gate.md) — Required review roles and checklist
- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge script
- [Merge Policy](merge-policy.md) — Machine-readable merge eligibility
- [Worker Task Contract](worker-task-contract.md) — Task JSON with `requiredReviewRoles`
