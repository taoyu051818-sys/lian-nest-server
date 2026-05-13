# Runtime Health Monitoring Strength

Investigation into the LIAN production-aware health system as a unique
architectural strength. Documents what exists, why it matters, and what
must be preserved in future architecture changes.

> **Closes:** [#1453](https://github.com/taoyu051818-sys/lian-nest-server/issues/1453)
>
> **Cross-references:**
> [runtime-signal-intake-contract.md](runtime-signal-intake-contract.md)
> for the signal intake boundary,
> [main-health-policy.md](main-health-policy.md) for health state policy,
> [self-healing.md](self-healing.md) for automated recovery,
> [meta-signals.md](meta-signals.md) for aggregate scoring,
> [launch-gate.md](launch-gate.md) for enforcement.

---

## Summary

LIAN has a multi-layered runtime health system that monitors build vitality,
resource pressure, PR queue staleness, worker lifecycle orphans, and
meta-signal trust scoring. This operational layer catches failure modes that
pure agent frameworks (SWE-agent, aider, MetaGPT) do not model. The system
is not a single script — it is an interconnected set of signals, policies,
and enforcement gates that together form a production safety net.

**Key finding:** The health system is load-bearing infrastructure. Removing
or degrading any layer creates blind spots that allow broken code, resource
exhaustion, or orphaned workers to propagate unchecked.

---

## Architecture Overview

```
                    ┌──────────────────────────────┐
                    │     launch gate (enforce)     │
                    │  check-launch-gate.ps1        │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │   health state (4-state SM)   │
                    │   green / yellow / red / black │
                    └──────────────┬───────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
  ┌───────┴────────┐    ┌──────────┴─────────┐    ┌────────┴────────┐
  │  constitution   │    │   signal calculators│    │  post-merge     │
  │  health checker │    │   (meta/risk/entropy│    │  health gate    │
  │  (14 checks)    │    │    /telemetry)      │    │  (build+test)   │
  └───────┬────────┘    └──────────┬──────────┘    └────────┬────────┘
          │                        │                        │
          └────────────────────────┼────────────────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │   intake boundary (validate,  │
                    │   stale-check, redact, wrap)  │
                    └──────────────────────────────┘
```

---

## Signal Inventory

### Runtime Health Checks (check-constitution-health.js)

The constitution health checker runs 14 checks in three groups:

**Static compliance (checks 1-7):**

| # | Check | What It Catches |
|---|-------|----------------|
| 1 | Three Law 1: reality before judgment | Policy changes without evidence |
| 2 | Three Law 2: selection before memory | Broken invariants |
| 3 | Three Law 3: governed recursion | Self-approval mechanisms |
| 4 | Constitution Rule 1 | High-risk file tampering |
| 5 | Constitution Rule 3 | Launch during red health |
| 6 | Constitution Rule 5 | Worker scope expansion |
| 7 | SOP boundary violations | Direct storage access, silent fallbacks |

**Runtime health (checks 8-14):**

| # | Check | Threshold | Severity |
|---|-------|-----------|----------|
| 8 | State file staleness | TTLs: 10-60 min per file | violation/warning |
| 9 | Meta signals vitality | trust <30 (violation), <60 (warn) | violation/warning |
| 10 | Build health | `npm run check` exit code | violation |
| 11 | Worker lifecycle / orphan detection | >30 min stale, >10 min running | violation/warning |
| 12 | Conflict group contention | Multiple workers same group | violation |
| 13 | PR queue staleness | PRs open >7 days | warning |
| 14 | Resource pressure | memory >90% (violation), >75% (warn) | violation/warning |

### Signal Calculators

| Calculator | Output | Purpose |
|------------|--------|---------|
| `calculate-meta-signals.js` | trust, failureScore, frictionScore, riskScore, cost, topPain | Aggregate health summary for planning |
| `calculate-risk-signals.js` | Composite risk score | External risk overlay (CVEs, compliance) |
| `calculate-operational-entropy.js` | Entropy from 5 sources | Friction measurement |
| `calculate-worker-telemetry.js` | Per-worker telemetry | Timing, tokens, cost, quality |

### Enforcement Gates

| Gate | When | What It Blocks |
|------|------|----------------|
| Launch gate | Before every worker dispatch | Workers when health is red/black, resource critical, conflict contention |
| Post-merge health gate | After every merge to main | Downstream workers when build/test fails |
| Auto-trigger health gate | On health degradation | Re-checks with 5-minute cooldown |

### Health State Machine

```
  green ──[failure]──▶ yellow ──[failure]──▶ red ──[escalation]──▶ black
    │                    │                     │                      │
    │ all workers        │ fix-only + docs     │ no workers           │ no workers
    │ allowed            │ allowed             │ (recovery only)      │ (recovery only)
    │                    │                     │                      │
    └──[recovery]────────┴──[recovery]─────────┴──[recovery]──────────┘
```

### Self-Healing Pipeline

```
health gate fails
  → write-main-health-state.ps1 records state
  → classify-health-failure.js categorizes (regex, confidence)
  → create-health-followup.js proposes recovery issues
  → recovery workers dispatched
  → health gate re-run confirms recovery
```

---

## Why This Is Unique

### Comparison with Other Agent Frameworks

| Capability | LIAN | SWE-agent | aider | MetaGPT |
|------------|------|-----------|-------|---------|
| Build vitality monitoring | Yes (post-merge gate) | No | No | No |
| Resource pressure tracking | Yes (CPU/mem/disk/concurrency) | No | No | No |
| Worker orphan detection | Yes (telemetry events) | No | No | No |
| PR queue staleness | Yes (gh pr list) | No | No | No |
| Meta-signal trust scoring | Yes (failure+friction formula) | No | No | No |
| 4-state health machine | Yes (green/yellow/red/black) | No | No | No |
| Automated failure classification | Yes (regex + confidence) | No | No | No |
| Launch gating by health state | Yes (pre-dispatch) | No | No | No |
| Self-healing recovery routing | Yes (issue creation) | No | No | No |
| Conflict group contention | Yes (concurrent worker check) | No | No | No |

Pure agent frameworks focus on task execution. They do not model the
operational environment — whether the build is healthy, whether resources
are available, whether workers are stuck, or whether the PR queue is
backing up. LIAN's health system closes this gap.

### What the Health System Prevents

1. **Broken code propagation.** The post-merge health gate blocks
   downstream workers when build or tests fail. Without this, a broken
   commit cascades into every subsequent worker.

2. **Resource exhaustion.** The resource pressure check blocks dispatch
   when memory exceeds 90% or process count exceeds 500. Without this,
   workers compete for scarce resources and fail unpredictably.

3. **Orphaned workers.** The lifecycle check detects workers that started
   but never completed (>30 min stale). Without this, ghost workers
   accumulate and waste resources.

4. **Silent degradation.** The meta-signal trust score aggregates failure
   and friction into a single number. Without this, gradual degradation
   goes unnoticed until a catastrophic failure.

5. **Unbounded risk.** The launch gate enforces the 4-state health machine.
   Without this, workers launch into broken environments and compound
   failures.

---

## Preservation Requirements

When upgrading the architecture (graph orchestration, memory system, tool
registry), these properties MUST be preserved:

### 1. Health Must Remain a First-Class Signal Source

Any new orchestration layer (graph, DAG, workflow engine) must consume
health signals at decision points. Specifically:

- **Graph nodes** that dispatch work MUST check health state before
  proceeding. A "health check" node type should exist in any graph
  orchestration design.
- **Planning loops** MUST incorporate meta-signals into prioritization.
  A task that would launch into a red health state MUST be deferred.

### 2. Fail-Closed Defaults Must Be Preserved

The intake contract specifies that health and resource signals fail-closed
(block work), while operational signals fail-neutral. Any new signal
routing must maintain this invariant:

| Signal Category | Missing/Stale Behavior | Rationale |
|-----------------|----------------------|-----------|
| Health | Block all workers | Prevents cascading failures |
| Resource | Block dispatch | Prevents resource exhaustion |
| Operational | Assume no problems | Avoids false alarm cascades |

### 3. Worker Lifecycle Tracking Must Be Preserved

The orphan detection mechanism (telemetry events + staleness check) must
survive any worker management redesign. Workers that start but never
complete are a silent resource leak.

### 4. The 4-State Health Machine Is the Enforcement Primitive

The green/yellow/red/black state machine is the single source of truth
for "can work proceed." Any new enforcement mechanism must either:

- Read from `main-health.json` directly, or
- Replicate the same 4-state semantics with the same worker permission
  matrix.

### 5. Signal Calculators Are the Aggregation Layer

The meta-signal, risk-signal, operational-entropy, and worker-telemetry
calculators produce the derived signals that planning consumes. Any new
aggregation layer must produce equivalent outputs or the planning loop
loses its risk-awareness.

---

## Current Gaps

These gaps exist today and should be addressed in future work:

1. **Planning loop is signal-blind.** `plan-next-batch.ps1` does not read
   meta-signals. It operates purely on issue metadata. The meta-signal
   task suggestions script produces suggestions separately but does not
   feed back into planning.

2. **No unified intake layer.** Each consumer reads source files directly.
   There is no shared intake module that applies validation, staleness,
   and redaction uniformly.

3. **Worker metrics collector not implemented.** The schema is defined
   but no script produces metric rows.

4. **Telemetry budget is advisory.** Token/cost fields are not wired
   into the task or heartbeat schemas.

---

## References

- [Runtime Signal Intake Contract](runtime-signal-intake-contract.md)
- [Main Health Policy](main-health-policy.md)
- [Health State Schema](health-state-schema.md)
- [Post-Merge Health Gate](post-merge-health-gate.md)
- [Self-Healing](self-healing.md)
- [Meta Signals Calculator](meta-signals.md)
- [Launch Gate](launch-gate.md)
- [Local Resource Health Schema](local-resource-health-schema.md)
- [Resource Pressure Sampler](resource-pressure-sampler.md)
- [External Intake Executable Loop](external-intake-executable-loop.md)
- [Parallel Health Check Policy](parallel-health-check-policy.md)
- [Main Health Schema Validation](main-health-schema-validation.md)
