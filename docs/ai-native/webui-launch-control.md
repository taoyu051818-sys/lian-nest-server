# WebUI Launch Control

Preview-first self-cycle launch wrapper for WebUI-triggered orchestration.

> **Closes:** [#656](https://github.com/taoyu051818-sys/lian-nest-server/issues/656)
>
> **Cross-references:**
> [self-cycle-runner.md](self-cycle-runner.md) for the standard orchestrator,
> [self-cycle-autopilot-plan-mode.md](self-cycle-autopilot-plan-mode.md) for autopilot plan mode,
> [launch-gate.md](launch-gate.md) for the pre-launch validation policy,
> [provider-pool.md](provider-pool.md) for provider availability and capacity,
> [provider-pool-webui-architecture.md](provider-pool-webui-architecture.md) for the WebUI architecture.

---

## Purpose

The standard self-cycle runner (`run-self-cycle.ps1`) is the core orchestrator but lacks a controlled entry point for WebUI-triggered launches. The WebUI needs a wrapper that adds:

1. **Label allowlist** — only approved labels can trigger launches
2. **Health gate** — red/black health blocks before discovery starts
3. **Provider capacity gate** — exhausted/at-capacity providers block early
4. **MaxTasks cap** — configurable safety limit on parallelism
5. **Plan-only default** — dry-run unless explicitly overridden

`webui-launch-control.ps1` provides this controlled gateway. It validates gates early, then delegates to `run-self-cycle.ps1` for the actual pipeline.

---

## Command

```powershell
# Plan-only (default) — shows what would happen
./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

# Execute mode — launches workers after gate checks
./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute

# Custom MaxTasks cap
./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -MaxTasks 5

# Custom allowlist file
./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:custom-label" -Repo owner/name -LabelAllowlistFile ./my-allowlist.json
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-IssueLabel` | No | `agent:codex-action-needed` | GitHub issue label for discovery. Must be in the allowlist. |
| `-MaxTasks` | No | `10` | Maximum tasks per cycle. Hard cap. Valid range: 1-50. |
| `-Execute` | No | `$false` | Switch from plan-only to execute mode. Launches workers. |
| `-Repo` | No | `$env:GH_REPO` | GitHub repo in OWNER/NAME format. |
| `-HealthFile` | No | `./.github/ai-state/main-health.json` | Path to main health state marker. |
| `-ProviderPoolStateFile` | No | `./.github/ai-state/provider-pool.json` | Path to provider pool state. |
| `-ProviderPoolPolicyFile` | No | `./.github/ai-policy/provider-pool-policy.json` | Path to provider pool policy. |
| `-LabelAllowlistFile` | No | (built-in) | Path to JSON file with `{ "allowedLabels": [...] }`. |

---

## How It Works

### Pipeline Flow

```
Step 1: Label Allowlist Validation
    Check IssueLabel against allowlist
    If not allowed → BLOCK (exit 1)

        |
        v

Step 2: MaxTasks Cap
    Validate MaxTasks parameter (1-50)
    Warn at 80% threshold

        |
        v

Step 3: Main Health State Gate
    Read main-health.json (green/yellow/red/black)
    If red/black → BLOCK (exit 1)
    If missing → BLOCK (fail-closed)

        |
        v

Step 4: Provider Pool Capacity Gate
    Read provider-pool.json + provider-pool-policy.json
    If all exhausted/disabled + policy blocks → BLOCK (exit 1)
    If all at capacity + policy blocks → BLOCK (exit 1)
    If missing → SKIP (pass)

        |
        v

Step 5: Delegate to run-self-cycle.ps1
    Pass -IssueLabel, -MaxTasks, -Repo
    If -Execute: pass -Execute flag
    Otherwise: dry-run (plan-only)
```

### Gate Summary

| Gate | Blocked When | Exit Code | Fail-Closed |
|------|-------------|-----------|-------------|
| Label allowlist | Label not in allowlist | 1 | Yes |
| Health | State is red or black | 1 | Yes (missing = blocked) |
| Provider pool | All exhausted/disabled (policy-enabled) | 1 | No (missing = skip) |
| MaxTasks | Parameter out of range | PowerShell error | N/A |

---

## Label Allowlist

### Built-in Allowlist

The default allowlist includes:

- `agent:codex-action-needed` — standard execution tasks
- `agent:codex-docs` — documentation tasks
- `agent:codex-health` — health-repair tasks
- `agent:codex-research` — research tasks

### Custom Allowlist File

Provide a JSON file with the `allowedLabels` array:

```json
{
  "allowedLabels": [
    "agent:codex-action-needed",
    "agent:custom-label",
    "agent:docs-only"
  ]
}
```

The file can also be a flat array:

```json
["agent:codex-action-needed", "agent:custom-label"]
```

---

## Safety Invariants

1. **Plan-only by default.** Without `-Execute`, the wrapper produces a dry-run plan. Workers are never launched.
2. **Label allowlist is strict.** Only explicitly allowed labels pass. Unknown labels are blocked.
3. **Health gate is fail-closed.** A missing or unreadable health file blocks the launch.
4. **Provider gate respects policy.** Blocking behavior follows `blockWhenAllExhausted` and `blockWhenAtCapacity` policy flags.
5. **Early exit on block.** The wrapper stops at the first blocking gate — later gates are not evaluated.
6. **No modification to run-self-cycle.ps1.** This is a wrapper only. The underlying orchestrator is unchanged.
7. **MaxTasks is a hard cap.** Enforced by `run-self-cycle.ps1` after issue discovery.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Plan complete (dry-run) or execute complete |
| 1 | Blocked by gate (label, health, or provider) or delegate failure |
| 2 | Fatal error (missing inputs, script failure) |

---

## Final Status Values

| Status | Meaning |
|--------|---------|
| `blocked-by-label-allowlist` | Label not in allowlist |
| `blocked-by-health` | Health state is red, black, or unknown |
| `blocked-by-provider-pool` | All providers exhausted/at-capacity |
| `plan-complete` | Dry-run delegation finished |
| `execute-complete` | Execute delegation finished |
| `delegate-failed` | run-self-cycle.ps1 exited non-zero |

---

## Integration with WebUI

The WebUI server (`tools/provider-pool-webui/server.js`) can invoke this wrapper to trigger controlled self-cycles:

```powershell
# From WebUI button click — always plan-only first
./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

# If operator confirms in WebUI — execute
./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
```

The wrapper is designed to be called as a child process. Its structured output (step-by-step pass/fail/blocked) is suitable for WebUI consumption.

---

## Relationship to Other Modes

| Mode | Entry Point | Behavior |
|------|-------------|----------|
| Standard dry-run | `run-self-cycle.ps1` | Stops at every human gate |
| Autopilot plan | `run-self-cycle.ps1 -AutopilotPlan` | Non-stop dry-run through all steps |
| Execute | `run-self-cycle.ps1 -Execute` | Launches workers after human confirmation |
| **WebUI launch control** | `webui-launch-control.ps1` | Pre-validates gates, then delegates |
| WebUI execute | `webui-launch-control.ps1 -Execute` | Pre-validates + launches workers |

---

## Testing

```powershell
# Run all fixture-based tests
pwsh ./scripts/ai/webui-launch-control.test.ps1
```

Tests cover: label allowlist, health gates (green/yellow/red/black/missing), provider capacity (available/exhausted/at-capacity/missing), MaxTasks boundaries, custom allowlist files, and combined gate scenarios. No live GitHub access or worker launches.

---

## Design Constraints

- **Dry-run by default.** Mutating actions require `-Execute`.
- **No autonomous merge.** Merge decisions remain human-owned.
- **No modification to run-self-cycle.ps1.** This is a wrapper, not a patch.
- **Fail-closed on health.** Unknown/missing health blocks the launch.
- **Idempotent in plan-only mode.** Running twice produces the same plan.
- **Early exit.** Blocked at gate N means gates N+1 are not evaluated.

---

## References

- [Self-Cycle Runner](self-cycle-runner.md) — standard orchestrator
- [Autopilot Plan Mode](self-cycle-autopilot-plan-mode.md) — non-stop dry-run planning
- [Launch Gate](launch-gate.md) — pre-launch validation policy
- [Main Health Policy](main-health-policy.md) — health state definitions
- [Provider Pool](provider-pool.md) — provider availability and capacity
- [WebUI Architecture](provider-pool-webui-architecture.md) — dashboard and API server
