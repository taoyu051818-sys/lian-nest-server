# Sustained 30-Worker Concurrency Policy

Defines how the orchestrator maintains approximately 30 active workers
during high-throughput waves by combining provider pool state, open PR
backlog depth, launch lock availability, and resource pressure signals.

> **Closes:** [#562](https://github.com/taoyu051818-sys/lian-nest-server/issues/562)

---

## Target

| Metric | Value | Notes |
|--------|-------|-------|
| Active worker ceiling | 30 | Soft target — actual count may fluctuate 25–35 |
| Batch dispatch cadence | every 5–10 min | Top-up batches fill gaps left by completed workers |
| Minimum dispatch threshold | 25 | Below this, top-up is triggered immediately |
| Maximum in-flight PRs | 40 | Prevents merge queue saturation |

---

## Signals

The scheduler reads four signals before dispatching a top-up batch.

### 1. Active Workers Count

**Source:** `.github/ai-state/active-workers.json`

The `workers` array length is the canonical count of in-flight workers. The
scheduler reads this before every dispatch decision.

| Count | Action |
|-------|--------|
| `< 25` | Dispatch top-up immediately |
| `25–30` | Dispatch top-up on next cadence tick |
| `30–35` | Hold — within tolerance |
| `> 35` | Pause dispatch — investigate stragglers or stuck workers |

### 2. Provider Pool Capacity

**Source:** `.github/ai-state/provider-pool.json`

The scheduler must not dispatch more workers than the provider pool can
serve. Available capacity is:

```
available_capacity = sum(maxConcurrency - currentConcurrency)
                     for each provider with status "available"
```

| Available Capacity | Action |
|--------------------|--------|
| `>= 5` | Normal dispatch |
| `1–4` | Dispatch only high-priority tasks |
| `0` | Block dispatch — all providers exhausted or at cap |

See [Provider Pool Guard](provider-pool-guard.md) for validation logic.

### 3. Open PR Backlog Depth

**Source:** `gh pr list --state open`

The open PR count indicates merge pressure. When too many PRs are open,
adding more workers creates review and merge bottlenecks.

| Open PRs | Action |
|----------|--------|
| `< 25` | Normal dispatch |
| `25–35` | Dispatch docs and low-risk tasks only |
| `> 35` | Pause dispatch — clear merge backlog first |

### 4. Launch Lock Availability

**Source:** `.github/ai-state/launch-locks.json`

The scheduler checks that pending tasks do not conflict with held locks.
A task is dispatchable only when its `conflictGroup` and `sharedLocks`
do not overlap any active lock.

| Held Locks | Action |
|------------|--------|
| `< 15` | Normal dispatch |
| `15–25` | Reduced batch size — dispatch 5 at a time |
| `> 25` | Pause — too many locks held, wait for releases |

---

## Top-Up Batch Composition

When the scheduler decides to dispatch, it builds a top-up batch from the
pending task queue.

### Selection Algorithm

```
1. Read active worker count (N).
2. Compute slots = max(0, 30 - N).
3. If slots == 0, return empty batch.
4. Filter pending tasks:
   a. Remove tasks whose conflictGroup is in active workers.
   b. Remove tasks whose sharedLocks overlap held locks.
   c. Remove tasks blocked by main-health policy.
5. Sort remaining tasks by priority (docs-first, then by issue number).
6. Take min(slots, len(available_tasks)) tasks.
7. Return batch.
```

### Batch Size Limits

| Condition | Max Batch Size |
|-----------|----------------|
| Normal | 10 |
| Provider capacity < 5 | 5 |
| Open PRs > 25 | 5 |
| Held locks > 15 | 5 |

---

## Straggler Detection

A worker is a **straggler** when it has been active beyond its
`hardTimeMinutes` budget without completing.

### Detection

```
for each worker in active-workers.json:
  if (now - worker.startedAt) > hardTimeMinutes * 1.5:
    flag as straggler
```

### Handling

| Straggler Age | Action |
|---------------|--------|
| `1.0–1.5x` budget | Log warning — worker may be slow |
| `1.5–2.0x` budget | Mark for heartbeat check |
| `> 2.0x` budget | Consider worker dead — release lock, free slot |

The scheduler does not auto-kill stragglers. It frees the slot for
dispatch but leaves the worker process running for manual cleanup.

---

## Wave Lifecycle

A wave is a sustained period of ~30 concurrent workers.

```
Wave start
    │
    ▼
Dispatch initial batch (fill to 30)
    │
    ▼
┌─► Poll signals every 5 min
│       │
│       ├── Count < 25 → dispatch top-up
│       ├── Provider exhausted → back off
│       ├── PRs > 35 → pause dispatch
│       └── No slots available → wait
│       │
│       ▼
│   Process completions
│       │
│       ├── Release launch locks
│       ├── Update active workers state
│       └── Remove from PR backlog count
│       │
└───────┘
    │
    ▼
Wave end (all tasks dispatched and completed)
```

---

## Integration Points

| Component | How It Participates |
|-----------|---------------------|
| [Active Workers State](active-workers-state.md) | Provides `workers` array length |
| [Provider Pool](provider-pool.md) | Provides available capacity |
| [Provider Pool Guard](provider-pool-guard.md) | Validates provider availability before dispatch |
| [Launch Locks State](launch-locks-state.md) | Provides held lock count and conflict data |
| [Launch Gate](launch-gate.md) | Blocks tasks violating health/conflict rules |
| [Parallel Work Policy](parallel-work-policy.md) | Defines conflict groups and shared locks |
| [Worker Telemetry Calculator](worker-telemetry-calculator.md) | Records dispatch/completion timestamps |
| [Worker Heartbeat](worker-heartbeat.md) | Detects stragglers via process liveness |

---

## Configuration

The scheduler reads thresholds from a policy overlay (future) or uses
the defaults defined in this document.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `targetConcurrency` | 30 | Soft ceiling for active workers |
| `minDispatchThreshold` | 25 | Below this, top-up triggers immediately |
| `maxOpenPRs` | 40 | Pause dispatch above this count |
| `topUpBatchSize` | 10 | Max tasks per top-up batch |
| `reducedBatchSize` | 5 | Batch size under resource pressure |
| `pollIntervalMinutes` | 5 | How often the scheduler re-evaluates |
| `stragglerMultiplier` | 1.5 | Factor of `hardTimeMinutes` before straggler flag |

---

## Monitoring

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Active worker count | `active-workers.json` | `< 20` or `> 35` |
| Provider available capacity | `provider-pool.json` | `== 0` |
| Open PR count | `gh pr list` | `> 35` |
| Held launch locks | `launch-locks.json` | `> 25` |
| Straggler count | heartbeat + active workers | `> 5` |
| Top-up dispatch latency | scheduler logs | `> 15 min` |

### Dashboard Inputs

The scheduler should emit structured events for downstream dashboards:

```jsonc
{
  "event": "top-up-dispatch",
  "timestamp": "2026-05-11T12:00:00Z",
  "activeWorkers": 22,
  "targetConcurrency": 30,
  "dispatchedCount": 8,
  "providerCapacity": 12,
  "openPRs": 18,
  "heldLocks": 7,
  "stragglers": 1
}
```

---

## Design Decisions

- **Soft target, not hard cap.** The 30-worker ceiling is a guideline.
  The scheduler prefers to keep workers busy rather than wait for an
  exact count.
- **Signal-driven, not time-driven.** Top-up decisions depend on actual
  state (active count, provider capacity, PR depth), not a fixed timer.
  This adapts naturally to variable task durations and provider outages.
- **Straggler tolerance.** Slow workers are not killed — their slots are
  freed for new dispatch, but the processes run until they complete or
  are manually cleaned up. This prevents data loss from interrupted work.
- **No secrets.** All state files contain scheduling metadata only. No
  API keys, tokens, or credentials are stored or transmitted.
- **Projection model.** Each state file is a projection (replace-on-write),
  not a log. Consumers read the latest snapshot without parsing history.

---

## References

- [Active Workers State](active-workers-state.md) — running worker projection
- [Provider Pool](provider-pool.md) — quota-aware concurrency architecture
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch provider validation
- [Launch Locks State](launch-locks-state.md) — conflict lock projection
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Parallel Work Policy](parallel-work-policy.md) — conflict group definitions
- [Worker Heartbeat](worker-heartbeat.md) — process liveness monitoring
- [Worker Telemetry Calculator](worker-telemetry-calculator.md) — cost/progress tracking
- [#562](https://github.com/taoyu051818-sys/lian-nest-server/issues/562) — this feature
