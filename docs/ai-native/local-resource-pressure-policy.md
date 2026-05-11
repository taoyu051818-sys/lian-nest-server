# Local Resource Pressure Policy

Defines the green/yellow/red pressure classification zones for CPU,
memory, and disk that drive launch-gate decisions and WebUI health
indicators.

> **Closes:** [#734](https://github.com/taoyu051818-sys/lian-nest-server/issues/734)

---

## Purpose

The [local-resource-policy.md](local-resource-policy.md) defines
absolute launch-block/warn/healthy thresholds. This document defines
the **pressure classification** system that sits alongside those
thresholds: three color zones (green, yellow, red) per resource that
the sampler emits and the launch gate consumes.

Pressure classification serves two roles:

1. **Launch gate** — derives a worst-case main state from all resource
   signals and blocks or allows task dispatch accordingly.
2. **WebUI dashboard** — surfaces per-resource color badges so
   operators can see machine health at a glance.

---

## Classification Thresholds

### CPU

| Zone | Range | Meaning |
|------|-------|---------|
| **Green** | <= 50% | Nominal. Full throughput available. |
| **Yellow** | 51 - 80% | Elevated. Workers may experience degraded throughput. |
| **Red** | > 80% | Critical. New launches blocked; risk of stalled workers. |

Measured as overall CPU utilization (instant sample).

### Memory

| Zone | Range | Meaning |
|------|-------|---------|
| **Green** | <= 70% | Nominal. Full throughput available. |
| **Yellow** | 71 - 85% | Elevated. Workers may be swapped, degrading latency. |
| **Red** | > 85% | Critical. Risk of OOM kill by the OS. |

Measured as percentage of total physical RAM in use (instant sample).

### Disk

| Zone | Range | Meaning |
|------|-------|---------|
| **Green** | <= 75% | Nominal. Full throughput available. |
| **Yellow** | 76 - 90% | Elevated. Large build outputs may cause failures. |
| **Red** | > 90% | Critical. Build artifacts and logs will fail to write. |

Measured on the volume hosting the current working directory (instant
sample).

---

## Worst-Case Derivation

The launch gate combines per-resource zones into a single main state
using worst-case logic:

```
if ANY resource is red   → main state = red
if ANY resource is yellow → main state = yellow
otherwise                → main state = green
```

This is the same "block-if-any-block" principle used by the absolute
thresholds in `local-resource-policy.json`, applied to the zone model.

---

## Launch Gate Behavior

| Main State | Runtime Tasks | Health-Repair Tasks |
|------------|--------------|---------------------|
| **Green**  | Allowed | Allowed |
| **Yellow** | Blocked | Allowed |
| **Red**    | Blocked | Allowed |

Health-repair tasks (low-risk fixes targeting system health) are
permitted in degraded states because they are the mechanism for
recovering from resource pressure.

---

## Sampling

The sampler (`scripts/ai/sample-local-resource.ps1`) collects raw
metrics and the test suite (`scripts/ai/test-resource-pressure-sampler.js`)
verifies classification logic.

| Resource | Windows Command | Linux Command |
|----------|----------------|---------------|
| CPU | `Get-Counter '\Processor(_Total)\% Processor Time'` | `/proc/stat` |
| Memory | `Get-CimInstance Win32_OperatingSystem` | `free` |
| Disk | `Get-PSDrive` | `df -P .` |

All samples are taken once at the pre-launch gate, not as continuous
polling.

---

## Relationship to Absolute Thresholds

The pressure zones (this document) and the absolute thresholds
(`local-resource-policy.json`) serve complementary roles:

| Aspect | Pressure Zones | Absolute Thresholds |
|--------|---------------|-------------------|
| Values | 3 zones per resource | 3 levels (block/warn/healthy) |
| Consumer | Launch gate main state, WebUI badges | Pre-launch gate hard block |
| Enforcement | Advisory (yellow) + blocking (red) | Hard block at launchBlock |
| Source | `sample-local-resource.ps1` inline logic | `local-resource-policy.json` |

The absolute thresholds in the JSON policy are the authoritative
pre-launch gate. Pressure zones provide a coarser, UI-friendly view
of the same signals.

---

## Relationship to Other Policies

| Policy | Relationship |
|--------|-------------|
| [local-resource-policy.md](local-resource-policy.md) | Absolute thresholds for pre-launch gate. Pressure zones are a parallel classification. |
| [launch-policy.md](launch-policy.md) | Health-state gating. Resource pressure contributes to main health state. |
| [provider-pool-guard.md](provider-pool-guard.md) | API quota guard. Independent of local machine resources. |

---

## References

- [local-resource-policy.md](local-resource-policy.md) — Absolute threshold definitions.
- `.github/ai-policy/local-resource-policy.json` — Machine-readable thresholds.
- `scripts/ai/sample-local-resource.ps1` — Resource sampler.
- `scripts/ai/test-resource-pressure-sampler.js` — Classification test suite.
- `scripts/ai/check-launch-gate.resource-pressure.test.ps1` — Launch gate integration tests.
