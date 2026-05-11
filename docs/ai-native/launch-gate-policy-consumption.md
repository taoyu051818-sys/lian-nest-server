# Launch Gate Policy Consumption

Describes how `check-launch-gate.ps1` reads and applies the machine-readable
launch policy and provider pool state during pre-launch validation.

> **Closes:** [#399](https://github.com/taoyu051818-sys/lian-nest-server/issues/399)

---

## Overview

The launch gate reads two optional JSON files before evaluating tasks:

1. **Launch policy** (`.github/ai-policy/launch-policy.json`) — provides the
   permission matrix and timeout defaults.
2. **Provider pool state** (`.github/ai-state/provider-pool.json`) — provides
   API provider availability for quota-aware concurrency warnings.

When either file is absent, the gate falls back to hardcoded defaults and
continues with a warning. This preserves backwards compatibility with existing
workflows.

---

## Files Consumed

| File | Default Path | Required | Purpose |
|------|-------------|:--------:|---------|
| Launch policy | `.github/ai-policy/launch-policy.json` | No | Permission matrix, timeout defaults |
| Provider pool | `.github/ai-state/provider-pool.json` | No | Provider availability, capacity, cooldown |
| Health state | `.github/ai-state/main-health.json` | No | Main branch health marker |
| Running tasks | (user-specified) | No | Active worker conflict groups |

---

## Launch Policy Consumption

### What Is Read

The gate reads these sections from `launch-policy.json`:

| Section | Key Path | Used For |
|---------|----------|----------|
| `launchPermissionMatrix.matrix` | `[state]` | Allowed worker types per health state |
| `timeoutDefaults.byWorkerType` | `[type]` | Default soft/hard/extension budgets per task |

### Permission Matrix

The gate extracts the `matrix` object from `launchPermissionMatrix`:

```json
{
  "launchPermissionMatrix": {
    "matrix": {
      "green":  ["runtime-feature", "foundation-fix", "docs", "health-repair", "test-only", "research"],
      "yellow": ["foundation-fix", "docs", "health-repair", "research"],
      "red":    ["foundation-fix", "health-repair", "research"],
      "black":  []
    }
  }
}
```

Each health state maps to an array of permitted worker types. The gate uses
this instead of the hardcoded matrix when the policy file is present.

### Timeout Defaults

When `timeoutDefaults.byWorkerType` is present, each task result includes a
`timeoutDefaults` object:

```json
{
  "workerType": "runtime-feature",
  "timeoutDefaults": {
    "softTimeMinutes": 30,
    "hardTimeMinutes": 60,
    "maxExtensionMinutes": 15
  }
}
```

Task JSON may override these values. The gate provides them as defaults for
the orchestrator to apply when the task does not specify its own budget.

### Fallback Behavior

When the policy file is missing or unparseable:

- The gate emits a `[warn]` message.
- It uses the hardcoded default matrix (identical to pre-399 behavior).
- Timeout defaults are omitted from task results.
- The gate continues evaluation — it does not abort.

---

## Provider Pool Consumption

### What Is Read

The gate reads the `providers[]` array and `global` summary from
`provider-pool.json`:

| Field | Source | Used For |
|-------|--------|----------|
| `providers[].id` | state | Identifying which provider has an issue |
| `providers[].status` | state | `available`, `exhausted`, or `disabled` |
| `providers[].currentConcurrency` | state | Whether provider is at capacity |
| `providers[].maxConcurrency` | state | Capacity ceiling |
| `providers[].cooldownExpiresAt` | state | When an exhausted provider may recover |

### Warning Logic

The gate checks each provider and emits warnings for:

| Condition | Warning |
|-----------|---------|
| Provider at capacity | `Provider 'X' is at capacity (N/M).` |
| Provider exhausted | `Provider 'X' is exhausted (cooldown until T).` |
| Provider disabled | `Provider 'X' is disabled (manual intervention required).` |
| All providers unavailable | `CRITICAL: No providers available.` |

Provider pool warnings are **non-blocking** — they appear in the report as
advisory information. The gate does not block task launch based on provider
state alone. The orchestrator or batch-launch script may choose to act on
these warnings.

### Fallback Behavior

When the provider pool file is missing or unparseable:

- The gate emits a `[warn]` or `[step]` message.
- Provider pool checks are skipped entirely.
- No provider warnings appear in the report.

---

## New Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-PolicyFile` | `./.github/ai-policy/launch-policy.json` | Path to launch policy JSON |
| `-ProviderPoolFile` | `./.github/ai-state/provider-pool.json` | Path to provider pool state JSON |
| `-DryRun` | `$false` | Print effective configuration and exit without evaluating tasks |

---

## Report Schema Changes

The JSON report now includes these additional fields:

```json
{
  "reportVersion": 1,
  "policyLoaded": true,
  "policyVersion": 1,
  "providerPoolLoaded": true,
  "providerPoolWarnings": [],
  "tasks": [
    {
      "timeoutDefaults": {
        "softTimeMinutes": 30,
        "hardTimeMinutes": 60,
        "maxExtensionMinutes": 15
      }
    }
  ]
}
```

### New Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `policyLoaded` | boolean | Whether the launch policy JSON was loaded |
| `policyVersion` | number or null | `policyVersion` from the policy file |
| `providerPoolLoaded` | boolean | Whether the provider pool JSON was loaded |
| `providerPoolWarnings` | string[] | Advisory warnings about provider availability |

### New Per-Task Fields

| Field | Type | Description |
|-------|------|-------------|
| `timeoutDefaults` | object or null | Default budget values from policy, keyed by worker type |

---

## Dry-Run Mode

Pass `-DryRun` to validate configuration without evaluating tasks:

```powershell
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -DryRun
```

This prints:

- Effective file paths and load status
- Permission matrix source (policy file vs hardcoded defaults)
- Permission matrix contents
- Provider pool warnings

JSON output is available with `-Json -DryRun`.

---

## Console Output Changes

The report header now shows policy and provider pool status:

```
========================================
  Launch Gate Report
========================================

Main state: green
Policy:          loaded (v1)
Provider pool:   loaded (0 warnings)
Tasks evaluated: 3
```

Provider pool warnings appear before the final pass/fail verdict:

```
Provider pool warnings:
  Provider 'provider-default' is exhausted (cooldown until 2026-05-11T13:00:00Z).
```

---

## Backwards Compatibility

| Aspect | Behavior |
|--------|----------|
| No policy file | Hardcoded default matrix used, warning emitted |
| No provider pool file | Provider checks skipped, step message emitted |
| Existing parameters | All preserved, no defaults changed |
| Exit codes | Unchanged (0 = pass, 1 = blocked, 2 = bad args) |
| JSON report | New fields are additive; existing fields unchanged |
| Console output | New lines are additive; existing format unchanged |

---

## References

- [launch-policy.json](../../.github/ai-policy/launch-policy.json) — Machine-readable launch policy
- [provider-pool.json](../../.github/ai-state/provider-pool.json) — Provider pool state projection
- [launch-policy.md](launch-policy.md) — Launch policy documentation
- [provider-pool.md](provider-pool.md) — Provider pool architecture
- [launch-gate.md](launch-gate.md) — Launch gate checker and report format
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions
