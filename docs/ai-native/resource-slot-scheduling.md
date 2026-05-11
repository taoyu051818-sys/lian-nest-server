# Resource Slot Scheduling Model

Defines how the orchestrator allocates worker slots across four independent
resource dimensions: provider API quota, local machine capacity, GitHub API
rate limits, and the operator-configured worker cap.

> **Closes:** [#530](https://github.com/taoyu051818-sys/lian-nest-server/issues/530)

---

## Problem

The orchestrator can launch many workers in parallel, but each worker competes
for finite resources. Without a unified slot model, the launcher checks each
constraint in isolation — provider quota, CPU/memory, GitHub API budget, and
the user's configured max — leading to over-dispatch when individual checks
pass but the combined pressure exceeds capacity.

## Goals

- Model concurrency as a single "slot" abstraction bounded by the tightest
  resource dimension at any moment.
- Document each resource dimension's capacity, depletion signal, and recovery
  path.
- Provide a clear decision flow the launcher can follow before dispatching
  each worker.
- Keep the model local-only — no runtime changes, no secrets committed.

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of the slot allocator script (planning doc only).
- No bypass of provider terms or account policy.

---

## Slot Concept

A **resource slot** is a unit of concurrency permission. A worker may only
launch when a slot is available on **every** resource dimension simultaneously.

```
Worker launch requires:

  provider-quota slot  ✓
  local-machine slot   ✓
  github-api slot      ✓
  user-max slot        ✓
       ─────────────────
       all four = LAUNCH
       any blocked = WAIT
```

The effective concurrency at any moment is:

```
effectiveSlots = min(
  providerQuotaSlots,
  localMachineSlots,
  githubApiSlots,
  userMaxSlots
)
```

---

## Resource Dimensions

### 1. Provider API Quota

**What it constrains:** Number of concurrent LLM API calls across all
credentials in the provider pool.

| Field | Source | Default |
|-------|--------|---------|
| `providerQuotaSlots` | Sum of `maxConcurrency` across all `available` providers in `provider-pool.json` | 3 |
| Depletion signal | HTTP 429, "quota exceeded" from provider | — |
| Recovery | Auto-recovery after cooldown (15 min rate-limit, 60 min quota) | — |
| Hard block | All providers `exhausted` or `disabled` | Fail-closed |

**State file:** `.github/ai-state/provider-pool.json`

**Policy file:** `.github/ai-policy/provider-pool-policy.json`

When a provider hits a rate limit or quota exhaustion, its capacity drops to 0
until the cooldown expires. The state updater records the event; the launcher
re-reads the state before each dispatch.

See [Provider Pool](provider-pool.md) and [Provider Pool Guard](provider-pool-guard.md)
for full details.

---

### 2. Local Machine Capacity

**What it constrains:** CPU cores and available RAM on the host running the
orchestrator.

| Field | Source | Default |
|-------|--------|---------|
| `localMachineSlots` | `floor(availableCores / coresPerWorker)` or `floor(availableRamMB / ramPerWorkerMB)`, whichever is lower | Derived at launch |
| coresPerWorker | Policy config | 1 |
| ramPerWorkerMB | Policy config | 512 |
| Depletion signal | OS-level: process spawn failure, OOM kill | — |
| Recovery | Slot freed when worker process exits | — |
| Hard block | 0 slots available | Delay dispatch |

The launcher queries local machine state before batch dispatch. On Windows,
this uses `Get-CimInstance Win32_Processor` for core count and
`Get-CimInstance Win32_OperatingSystem` for free memory. On CI or containers,
the values come from environment limits (e.g., `NUMBER_OF_PROCESSORS`).

**Sizing example:**

| Machine | Cores | RAM (free) | coresPerWorker | ramPerWorker | Slots |
|---------|-------|------------|----------------|--------------|-------|
| 8-core, 16 GB | 8 | 12 GB | 1 | 512 MB | min(8, 24) = **8** |
| 4-core, 8 GB | 4 | 6 GB | 1 | 512 MB | min(4, 12) = **4** |
| 2-core, 4 GB | 2 | 3 GB | 1 | 512 MB | min(2, 6) = **2** |

---

### 3. GitHub API Rate Limit

**What it constrains:** Number of GitHub REST/GraphQL API calls per hour.
Workers use the API for issue reads, PR creation, label updates, and comment
posting.

| Field | Source | Default |
|-------|--------|---------|
| `githubApiSlots` | Derived from remaining rate limit budget | 5,000 req/hr (authenticated) |
| Calls per worker (estimated) | Issue read + PR create + label updates + comments | ~15–30 calls |
| Depletion signal | HTTP 403 with `X-RateLimit-Remaining: 0` | — |
| Recovery | Resets at `X-RateLimit-Reset` (hourly rolling window) | — |
| Hard block | Remaining calls < reserve threshold | Delay dispatch |

The launcher checks the rate limit header from the most recent `gh` CLI call.
When remaining calls drop below a reserve threshold (default: 50), the launcher
pauses dispatch until the window resets.

**Estimation model:**

```
githubApiSlots = floor(remainingCalls / callsPerWorker)
```

Where `callsPerWorker` is a conservative estimate per worker session. Workers
that only read docs or produce local files consume near-zero GitHub API budget;
workers that create PRs and post comments consume the full estimate.

---

### 4. User-Max Workers

**What it constrains:** The operator-configured ceiling on total concurrent
workers, regardless of other resource availability.

| Field | Source | Default |
|-------|--------|---------|
| `userMaxSlots` | `concurrency.globalMaxWorkers` in `provider-pool-policy.json` | 3 |
| Depletion signal | Active worker count reaches `globalMaxWorkers` | — |
| Recovery | Slot freed when any worker completes or fails | — |
| Hard block | `activeWorkers >= globalMaxWorkers` | Delay dispatch |

This is the simplest dimension — a fixed integer cap set by the operator. It
exists as a safety net independent of provider quota or machine capacity. Even
if providers and the machine have headroom, the operator may want to limit
parallelism to control costs or review workload.

**Active worker tracking:**

The active workers state file (`.github/ai-state/active-workers.json`) tracks
currently running workers. The launcher increments the count on dispatch and
decrements on worker completion or failure.

See [Active Workers State](active-workers-state.md) for the projection schema.

---

## Decision Flow

The launcher evaluates slots before each worker dispatch:

```
batch-launch.ps1
       │
       ▼
  Read provider-pool.json
       │
       ├── providerQuotaSlots = sum(maxConcurrency for available providers)
       │
       ▼
  Query local machine
       │
       ├── localMachineSlots = min(floor(cores/coresPerWorker), floor(ramMB/ramPerWorkerMB))
       │
       ▼
  Check GitHub API rate limit
       │
       ├── githubApiSlots = floor(remainingCalls / callsPerWorker)
       │
       ▼
  Read active-workers.json
       │
       ├── activeWorkerCount = len(workers)
       ├── userMaxSlots = globalMaxWorkers - activeWorkerCount
       │
       ▼
  effectiveSlots = min(providerQuotaSlots, localMachineSlots, githubApiSlots, userMaxSlots)
       │
       ├── effectiveSlots <= 0  →  BLOCK dispatch, log reason
       │
       ▼
  effectiveSlots > 0  →  dispatch up to effectiveSlots workers
```

### Blocking Reasons

When dispatch is blocked, the launcher logs which dimension is the bottleneck:

| Dimension | Log message | Recovery action |
|-----------|-------------|-----------------|
| Provider quota | `blocked:provider-exhausted` | Wait for cooldown expiry or add provider |
| Local machine | `blocked:local-capacity` | Wait for worker to free resources |
| GitHub API | `blocked:github-rate-limit` | Wait for rate limit reset |
| User max | `blocked:user-max-workers` | Wait for worker completion or raise `globalMaxWorkers` |

---

## Interaction with Existing Policies

### Launch Gate

The launch gate (`check-launch-gate.ps1`) validates health policy and conflict
groups. Slot scheduling runs **after** the gate passes — a task must clear
both the gate (policy/health) and the slot check (resources) to launch.

```
check-launch-gate.ps1     →  policy + health + conflict validation
       │
       ▼ (pass)
  slot availability check  →  resource dimension validation
       │
       ▼ (slots available)
  dispatch worker
```

### Conflict Groups

Conflict group rules ([Parallel Work Policy](parallel-work-policy.md)) are
orthogonal to slot scheduling. Two tasks in the same conflict group cannot
run concurrently even if slots are available. The launcher enforces conflict
group serialization first, then allocates slots for the remaining eligible
tasks.

### Provider Pool Guard

The provider pool guard (`check-provider-pool.js`) validates policy/state
consistency and reports launch readiness. The slot model extends this by
adding three more dimensions beyond provider quota. The guard's readiness
check feeds into the `providerQuotaSlots` component of the slot calculation.

### Worker Heartbeat

The heartbeat monitor ([Worker Heartbeat](worker-heartbeat.md)) tracks
process liveness but does not affect slot allocation. A `stale` worker still
holds its slot — the slot is only released when the process exits (`done` or
`failed`). The no-kill guarantee means stale workers must be resolved by the
operator or reconciler, not by the slot allocator.

### Telemetry Budget Policy

Cost-overrun escalation ([Telemetry Budget Policy](telemetry-budget-policy.md))
can force-stop a worker, which frees its slot. But the slot model does not
directly read cost telemetry — it only counts active processes.

---

## Slot Allocation Strategy

When multiple tasks are eligible and slots are available, the launcher uses
a priority ordering:

| Priority | Task characteristic | Reason |
|----------|-------------------|--------|
| 1 | Foundation-fix (main health red/yellow) | Recovery work unblocks everything else |
| 2 | Health/CI repair | Same rationale as foundation-fix |
| 3 | Runtime-feature (main health green) | Core delivery work |
| 4 | Docs | Low risk, can wait |
| 5 | Research | Informational, no deadline pressure |

Within the same priority, tasks are ordered by:
1. Fewer dependents first (merge-order heuristic from parallel work policy).
2. Smaller diff size on equal dependency count.

---

## Monitoring

### Slot Utilization Telemetry

The launcher should emit a slot utilization record after each dispatch cycle:

```json
{
  "capturedAt": "2026-05-11T12:00:00Z",
  "slots": {
    "providerQuota": { "available": 3, "total": 3 },
    "localMachine": { "available": 6, "total": 8 },
    "githubApi": { "available": 4850, "total": 5000 },
    "userMax": { "available": 1, "total": 3 }
  },
  "effectiveSlots": 1,
  "bottleneck": "userMax",
  "dispatched": 1,
  "blocked": 0
}
```

This record is informational — it helps operators identify which dimension is
the persistent bottleneck and where to invest capacity.

### Stale Slot Detection

If a worker process exits but the launcher fails to decrement the active
count (e.g., launcher crash), the active-workers projection becomes stale.
The state reconciler detects this by comparing the projection's `capturedAt`
against the heartbeat monitor's terminal snapshots. When divergence is found,
the reconciler corrects the active count.

---

## Configuration

All slot parameters are policy-driven, not hardcoded:

| Parameter | Location | Default | Tunable |
|-----------|----------|---------|---------|
| `globalMaxWorkers` | `provider-pool-policy.json` → `concurrency` | 3 | Yes |
| `maxConcurrency` (per provider) | `provider-pool-policy.json` → `providers[]` | 1–3 | Yes |
| `coresPerWorker` | Slot policy (planned) | 1 | Yes |
| `ramPerWorkerMB` | Slot policy (planned) | 512 | Yes |
| `callsPerWorker` | Slot policy (planned) | 20 | Yes |
| `githubRateReserve` | Slot policy (planned) | 50 | Yes |

Operators adjust these values based on their machine specs, API tier, and
cost tolerance. The slot model adapts automatically — no code changes needed.

---

## Current State

This is the **planning slice** (issue #530). The following are defined:

- [x] Slot concept and resource dimension model
- [x] Four-dimension capacity definitions
- [x] Decision flow and blocking reasons
- [x] Integration points with existing policies
- [x] Allocation strategy and priority ordering
- [x] Monitoring and telemetry shape

### Future Slices

- [ ] Slot policy JSON file (`.github/ai-policy/resource-slot-policy.json`)
- [ ] Slot allocator script (`scripts/ai/allocate-slots.ps1`)
- [ ] Local machine capacity probe (cross-platform)
- [ ] GitHub API rate limit probe integration
- [ ] Slot utilization telemetry writer
- [ ] Stale slot detection in state reconciler
- [ ] Dry-run slot allocation with mock resources

---

## References

- [Provider Pool](provider-pool.md) — API credential pool and quota management
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch provider validation
- [Active Workers State](active-workers-state.md) — running worker projection
- [Worker Heartbeat](worker-heartbeat.md) — process liveness monitoring
- [Parallel Work Policy](parallel-work-policy.md) — conflict group rules
- [Launch Gate](launch-gate.md) — health policy and conflict validation
- [Telemetry Budget Policy](telemetry-budget-policy.md) — cost limits and escalation
- [Worker Task Contract](worker-task-contract.md) — task JSON schema
- [Orchestration](orchestration.md) — batch launcher overview
