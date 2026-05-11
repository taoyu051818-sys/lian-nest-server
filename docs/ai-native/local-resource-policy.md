# Local Resource Policy

Defines machine-readable thresholds for CPU, memory, disk, and process count
that control whether a worker may launch on the local host.

> **Closes:** [#521](https://github.com/taoyu051818-sys/lian-nest-server/issues/521)

---

## Purpose

The orchestrator dispatches multiple Claude Code workers on a single machine.
Without resource guards, concurrent workers can exhaust CPU, RAM, or disk,
causing OOM kills, stalled builds, or failed log writes.

This policy codifies per-resource thresholds so the orchestrator can
programmatically decide: **launch**, **launch with warning**, or **block**.

The JSON lives at `.github/ai-policy/local-resource-policy.json` and is the
source of truth for:

- CPU utilization thresholds
- Memory utilization thresholds
- Disk usage thresholds (targeting the working-directory volume)
- Process count ceilings
- Composite decision logic (how checks combine)
- Remediation guidance per resource

---

## File Location

```
.github/ai-policy/local-resource-policy.json
```

---

## Schema Overview

| Section | Purpose |
|---------|---------|
| `policyVersion` | Schema version for forward compatibility |
| `cpu` | CPU utilization thresholds and sampling commands |
| `memory` | RAM utilization thresholds and sampling commands |
| `disk` | Disk usage thresholds for the working-directory volume |
| `processCount` | Maximum concurrent worker process count |
| `compositeDecision` | How individual checks combine into launch/no-launch |
| `remediation` | Recommended actions when a check blocks or warns |
| `enforcement` | Fail-closed enforcement mode and orchestrator binding |

---

## Resource Thresholds

### CPU

| Level | Threshold | Meaning |
|-------|:---------:|---------|
| **Block** | 90% | Do not launch. Sustained high CPU risks stalled workers. |
| **Warn** | 75% | Launch with warning. Workers may experience degraded throughput. |
| **Healthy** | 50% | Nominal. Full throughput available. |

Measured as average CPU utilization over a 60-second window.

### Memory

| Level | Threshold | Meaning |
|-------|:---------:|---------|
| **Block** | 92% | Do not launch. Risk of OOM kill by the OS. |
| **Warn** | 80% | Launch with warning. Workers may be swapped, degrading latency. |
| **Healthy** | 60% | Nominal. Full throughput available. |

Measured as percentage of total physical RAM in use (instant sample).

### Disk

| Level | Threshold | Meaning |
|-------|:---------:|---------|
| **Block** | 95% | Do not launch. Build artifacts and logs will fail to write. |
| **Warn** | 85% | Launch with warning. Large outputs may cause intermittent failures. |
| **Healthy** | 70% | Nominal. Full throughput available. |

Measured on the volume hosting the current working directory (instant sample).

### Process Count

| Level | Threshold | Meaning |
|-------|:---------:|---------|
| **Block** | 30 | Do not launch. Maximum live worker ceiling reached. |
| **Warn** | 25 | Launch with warning. Approaching the process ceiling. |
| **Healthy** | 15 | Nominal. Full throughput available. |

Counted by enumerating processes whose command line includes the worker
entrypoint marker (`claude-worker`).

---

## Composite Decision Rule

The orchestrator evaluates resources in this order:

1. **processCount** (cheapest, most likely binding constraint)
2. **cpu** (OS call, moderate cost)
3. **memory** (OS call, moderate cost)
4. **disk** (filesystem call, least likely binding constraint)

Decision logic:

| Condition | Result |
|-----------|--------|
| ANY resource at or above block threshold | **Block launch** |
| ANY resource at or above warn threshold (none at block) | **Warn, proceed** |
| ALL resources below warn thresholds | **Clear, proceed** |

If the sampling script fails or returns an unexpected format, the launch is
blocked (fail-closed). This prevents silent resource exhaustion when tooling
is broken.

---

## Sampling Commands

The JSON includes OS-specific sampling commands for each resource. These are
templates — the orchestrator selects the command matching the current platform.

| Resource | Windows | Linux |
|----------|---------|-------|
| CPU | `Get-CimInstance Win32_Processor` | `/proc/stat` |
| Memory | `Get-CimInstance Win32_OperatingSystem` | `free` |
| Disk | `Get-PSDrive` | `df -P .` |

All samples are taken once at the pre-launch gate, not as continuous polling.

---

## Remediation

When a launch is blocked or warned, the recommended actions are:

### CPU Block
- Wait for current workers to complete before retrying.
- Reduce concurrency in `provider-pool-policy.json` if sustained high CPU.

### Memory Block
- Wait for current workers to complete or be killed by the OS.
- Check for memory leaks in long-running worker processes.
- Consider reducing `globalMaxWorkers` in `provider-pool-policy.json`.

### Disk Block
- Clean build artifacts: `rm -rf dist/ .cache/`
- Prune old worktrees: `git worktree prune`
- Rotate or compress large log files.

### Process Block
- Wait for workers to finish their current task.
- Investigate hung processes that are not making progress.
- Force-terminate zombie workers if confirmed stuck.

---

## Enforcement

- **Mode:** advisory-with-blocking
- **Enforced by:** orchestrator pre-launch gate
- **Fail-closed:** yes

The orchestrator MUST check resource thresholds before every worker launch.
Advisory mode means warnings are logged but launches proceed; blocking mode
means launches are halted until resources free up.

---

## Relationship to Other Policies

| Policy | Relationship |
|--------|-------------|
| [launch-policy.md](launch-policy.md) | This policy adds resource-level guards that complement health-state gating. Both must pass for a launch to proceed. |
| [provider-pool-guard.md](provider-pool-guard.md) | Provider pool guards API quota; this policy guards local machine resources. They are independent checks. |
| [provider-pool-policy.json](../../.github/ai-policy/provider-pool-policy.json) | `globalMaxWorkers` in that policy should stay consistent with the process count ceiling here. |
| [launch-policy.json](../../.github/ai-policy/launch-policy.json) | Timeout defaults and worker types are orthogonal to resource thresholds. |

---

## Consuming the JSON

Scripts should read `.github/ai-policy/local-resource-policy.json` and use:

- `cpu.thresholds`, `memory.thresholds`, `disk.thresholds`, `processCount.thresholds` — per-resource decision boundaries.
- `[resource].samplingCommand` — OS-specific commands to read current utilization.
- `compositeDecision.decisionOrder` — evaluation order (cheapest first).
- `compositeDecision.rule` — `block-if-any-block` logic.
- `remediation` — user-facing guidance per resource type.
- `enforcement.failClosed` — if true, script failures block the launch.

---

## References

- [launch-policy.md](launch-policy.md) — Health-state launch gating.
- [provider-pool-guard.md](provider-pool-guard.md) — API quota guard.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [worker-heartbeat.md](worker-heartbeat.md) — Worker liveness checks.
- `.github/ai-policy/local-resource-policy.json` — Machine-readable policy (this file's source).
