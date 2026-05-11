# Local Resource Concurrency Runbook

How CPU, memory, and disk pressure influence worker concurrency and when to
pause launches.

> **Closes:** [#829](https://github.com/taoyu051818-sys/lian-nest-server/issues/829)
>
> **Cross-references:**
> [local-resource-policy.md](local-resource-policy.md) for threshold definitions,
> [local-resource-pressure-policy.md](local-resource-pressure-policy.md) for
> pressure zones, [launch-gate-resource-policy.md](launch-gate-resource-policy.md)
> for launch gate integration, [local-resource-sampler.md](local-resource-sampler.md)
> for sampling commands.

---

## Audience

Operators and orchestrators deciding whether to launch, defer, or pause
worker dispatch based on host machine resource pressure.

---

## Decision Flow

```
1. Sample resources     →  sample-local-resource.ps1
2. Classify pressure    →  green / yellow / red per resource
3. Apply worst-case     →  any red = red, any yellow = yellow
4. Decide action        →  see table below
```

---

## Action Matrix

| Pressure Zone | New Workers | Active Workers | Operator Action |
|---------------|------------|----------------|-----------------|
| **Green** | Allowed | Continue | None — normal throughput |
| **Yellow** | Blocked | Continue (degraded) | Wait for in-flight workers to finish, or cancel non-critical tasks |
| **Red** | Blocked | Risk of abort | Pause launches, investigate, free resources before resuming |

---

## Resource Thresholds

### CPU

| Zone | Utilization | Concurrency Effect |
|------|:-----------:|---------------------|
| Green | <= 50% | Full dispatch |
| Yellow | 51 – 80% | Dispatch blocked; active workers may stall |
| Red | > 80% | Dispatch blocked; timeouts and OOM risk |

### Memory

| Zone | Utilization | Concurrency Effect |
|------|:-----------:|---------------------|
| Green | <= 70% | Full dispatch |
| Yellow | 71 – 85% | Dispatch blocked; swap pressure degrades latency |
| Red | > 85% | Dispatch blocked; OS may OOM-kill workers |

### Disk

| Zone | Utilization | Concurrency Effect |
|------|:-----------:|---------------------|
| Green | <= 75% | Full dispatch |
| Yellow | 76 – 90% | Dispatch blocked; large builds may fail |
| Red | > 90% | Dispatch blocked; log writes and builds abort |

### Process Count

| Zone | Running Workers | Concurrency Effect |
|------|:--------------:|---------------------|
| Green | <= 15 | Full dispatch |
| Yellow | 16 – 25 | Dispatch blocked; approaching ceiling |
| Red | > 25 | Dispatch blocked; system contention |

---

## When to Pause Launches

Pause **all** new worker dispatch when **any** of these conditions hold:

1. **CPU red** — sustained > 80% utilization.
2. **Memory red** — > 85% RAM usage; OOM kill imminent.
3. **Disk red** — > 90% on working-directory volume; writes will fail.
4. **Process count red** — > 25 live workers; resource contention.
5. **Launch gate blocks** — `resourceBlocking: true` in the gate report.
6. **Global state unknown** — resource state file missing or unparseable
   (fail-closed).

---

## How to Sample

```powershell
# Formatted text report
./scripts/ai/sample-local-resource.ps1

# JSON for programmatic checks
./scripts/ai/sample-local-resource.ps1 -Json

# Snapshot before a launch gate check
./scripts/ai/sample-local-resource.ps1 -Json > ./resource-snapshot.json
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json
```

---

## How to Check the Launch Gate

```powershell
# Standard gate check (resource guard included)
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json

# JSON output with resource fields
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -Json
```

Key fields in the gate report:

| Field | Meaning |
|-------|---------|
| `resourceGlobalState` | `healthy`, `constrained`, `critical`, or `unknown` |
| `resourceBlocking` | `true` → launch is blocked by resource guard |
| `resourceWarnings` | Human-readable per-resource warnings |
| `resourceChecks` | Per-resource level and threshold details |

---

## Recovery Actions

| Bottleneck | Action |
|------------|--------|
| CPU | Wait for in-flight workers to complete; reduce `globalMaxWorkers` in provider pool policy |
| Memory | Wait for workers to finish; check for memory leaks in long-running processes |
| Disk | Clean build artifacts (`rm -rf dist/ .cache/`), prune worktrees (`git worktree prune`), rotate logs |
| Process count | Wait for workers to finish current tasks; investigate hung processes |

Recovery is automatic — the sampler runs at each gate check, so when resources
free up, the next launch attempt will pass.

---

## Worst-Case Derivation

The launch gate combines per-resource zones into a single main state:

```
ANY resource red    → main state = red    → blocks all runtime launches
ANY resource yellow → main state = yellow → blocks all runtime launches
ALL green           → main state = green  → launches allowed
```

Health-repair and foundation-fix workers are permitted in yellow and red states
because they are the mechanism for recovering from degraded health.

---

## WebUI Dashboard

The control-plane dashboard shows per-resource pressure badges:

| Zone | Badge | Label |
|------|-------|-------|
| Green | Green, static | "Healthy" |
| Yellow | Amber, slow pulse | "Elevated" |
| Red | Red, fast pulse | "Critical" |

The **overall badge** uses worst-case derivation. When the main state is
yellow or red, the `launch-worker` action is blocked in the Action Readiness
panel.

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-policy/local-resource-policy.json` | Threshold definitions |
| `.github/ai-state/local-resource.json` | Current resource state snapshot |
| `scripts/ai/sample-local-resource.ps1` | Resource sampler |
| `scripts/ai/check-launch-gate.ps1` | Launch gate with resource guard |
| `scripts/guards/check-local-resource.js` | Standalone Node.js resource guard |

---

## References

- [local-resource-policy.md](local-resource-policy.md) — Absolute threshold definitions
- [local-resource-pressure-policy.md](local-resource-pressure-policy.md) — Pressure zone classification
- [local-resource-guard.md](local-resource-guard.md) — Standalone guard tool
- [launch-gate-resource-policy.md](launch-gate-resource-policy.md) — Launch gate integration
- [local-resource-sampler.md](local-resource-sampler.md) — Sampling commands and output schema
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules
