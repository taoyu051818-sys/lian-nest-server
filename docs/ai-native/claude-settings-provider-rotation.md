# Claude Settings Provider Rotation Bridge

Dry-run-first local settings rotation bridge for Claude provider credentials.
Simulates the rotation workflow without reading, printing, or storing actual
secret values.  Operates entirely on provider pool state and policy metadata.

> **Closes:** [#660](https://github.com/taoyu051818-sys/lian-nest-server/issues/660)
>
> **Script:** [`scripts/ai/rotate-claude-settings-provider.ps1`](../../scripts/ai/rotate-claude-settings-provider.ps1)
> **Tests:** [`scripts/ai/rotate-claude-settings-provider.test.ps1`](../../scripts/ai/rotate-claude-settings-provider.test.ps1)
>
> **Cross-references:**
> [provider-pool.md](provider-pool.md) for pool architecture,
> [provider-quota-rotation.md](provider-quota-rotation.md) for cooldown rules,
> [provider-key-router.md](provider-key-router.md) for routing contract,
> [provider-local-secret-store.md](provider-local-secret-store.md) for credential storage.

---

## Overview

The rotation bridge is the final WebUI control-console layer that enables
routine Codex orchestration to handle provider credential rotation.  When a
provider's credential is compromised, expired, or quota-exhausted, the rotation
bridge:

1. Validates the target provider exists in pool policy and state.
2. Checks current provider status and secret source availability.
3. Creates a backup plan (state file backup path).
4. Validates rotation preconditions.
5. In apply mode: transitions provider state to "available", resets failure
   counters, clears cooldowns, and performs an atomic state write.

The bridge never reads, prints, stores, or commits actual API keys, tokens,
cookies, or credential values.

---

## Safety Model

### Dry-Run Default

All invocations default to dry-run mode.  In dry-run mode:

- The rotation plan is computed and displayed.
- No state files are modified.
- No backup files are created.
- No secrets are resolved or read.
- The exit code reflects whether rotation *would* succeed, not whether it did.

To execute an actual rotation, two flags are required:

```powershell
./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId prov-a -Apply -ConfirmRotation
```

The `-ConfirmRotation` flag acts as a safety gate — `-Apply` alone is rejected
with an error.

### Backup/Validate/Atomic Replace

When `-Apply -ConfirmRotation` is passed:

1. **Backup**: The current state file is copied to a timestamped `.bak` file.
2. **Validate**: The updated state is computed in memory.
3. **Atomic write**: The updated state is written to a temp file, then moved
   atomically over the original with `Move-Item -Force`.
4. **Rollback on failure**: If the atomic write fails, the backup is restored.

```
state.json  ──copy──>  state.json.bak.20260511T143000
    │
    ▼
state.json.tmp.a1b2c3  (write new state)
    │
    ▼
Move-Item  ──>  state.json  (atomic replace)
```

### No Secret Reads

The script checks secret source *existence* only:

| Source Type | Check Performed |
|-------------|----------------|
| `env-var` | `[Environment]::GetEnvironmentVariable($key)` — returns bool, not value |
| `credential-manager` | `cmdkey /list:$key` — checks entry exists |
| `claude-settings` | `Test-Path ~/.claude/settings.json` — checks file exists |

No secret value is ever read, printed, logged, or stored.

---

## Usage

### Dry-Run Preview (Default)

```powershell
# Human-readable preview
./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary

# Machine-readable JSON
./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary -Json
```

### Apply Rotation

```powershell
# Rotate with confirmation
./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary -Apply -ConfirmRotation

# Rotate with reason
./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary -Apply -ConfirmRotation -Reason "key compromised"
```

### Custom Paths

```powershell
./scripts/ai/rotate-claude-settings-provider.ps1 -PolicyPath ./my-policy.json -StatePath ./my-state.json -ProviderId prov-a
```

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `PolicyPath` | `string` | `.github/ai-policy/provider-pool-policy.json` | Path to provider pool policy |
| `StatePath` | `string` | `.github/ai-state/provider-pool.json` | Path to provider pool state |
| `ProviderId` | `string` | *(required)* | Provider to rotate |
| `Json` | `switch` | `$false` | Emit JSON output |
| `Apply` | `switch` | `$false` | Execute rotation (dry-run is default) |
| `ConfirmRotation` | `switch` | `$false` | Required safety gate for `-Apply` |
| `Reason` | `string` | `""` | Human-readable reason for rotation |

---

## Rotation Preconditions

| Current Status | Can Rotate? | Effect |
|:--------------:|:-----------:|--------|
| `available` | Yes | Resets failure counters, preserves concurrency |
| `exhausted` | Yes | Clears cooldown, resets failures, re-enables |
| `disabled` | Yes | Re-enables provider, clears cooldown |

Rotation is always possible regardless of current status — the bridge is
designed to be the "fix and re-enable" path.

---

## Output Format

### Human-Readable (Default)

```
>> Loading policy: .github/ai-policy/provider-pool-policy.json
   OK: Policy loaded: 2 provider(s)
>> Loading state: .github/ai-state/provider-pool.json
   OK: State loaded: 2 provider(s)
>> Locating provider: provider-secondary
   OK: Provider found: provider-secondary (status=exhausted)
>> Checking secret source availability (existence only — no values read)
   OK: Secret source available: env-var (key: ANTHROPIC_API_KEY)
>> Building rotation plan

=== ROTATION PLAN ===

  Provider:     provider-secondary
  Current:      status=exhausted concurrency=0/2
  Target:       status=available concurrency=unchanged
  Cooldown:     clear (2099-12-31T23:59:59Z)
  Failures:     3 consecutive -> 0
  Secret:       env-var (ANTHROPIC_API_KEY)
  Secret avail: True
  Backup:       .github/ai-state/provider-pool.json.bak.20260511T143000
  Can rotate:   True
  Reason:       key compromised

   OK: Rotation plan previewed for provider: provider-secondary
   (dry-run — no state changes)
```

### JSON Output

```json
{
  "tool": "rotate-claude-settings-provider",
  "status": "preview",
  "providerId": "provider-secondary",
  "plan": {
    "providerId": "provider-secondary",
    "currentState": {
      "status": "exhausted",
      "currentConcurrency": 0,
      "maxConcurrency": 2,
      "cooldownExpiresAt": "2099-12-31T23:59:59Z",
      "consecutiveFailures": 3,
      "totalQuotaEvents": 5
    },
    "targetState": {
      "status": "available",
      "cooldownExpiresAt": null,
      "consecutiveFailures": 0
    },
    "secretSource": {
      "type": "env-var",
      "key": "ANTHROPIC_API_KEY",
      "available": true
    },
    "backupPlan": {
      "willBackupState": true,
      "backupPath": ".github/ai-state/provider-pool.json.bak.20260511T143000",
      "willBackupSecretRef": false,
      "note": "State file backup created before rotation (dry-run only shows plan)"
    },
    "validationChecks": [
      { "check": "provider-exists-in-policy", "passed": true },
      { "check": "provider-exists-in-state", "passed": true },
      { "check": "state-file-writable", "passed": true },
      { "check": "secret-source-exists", "passed": true }
    ],
    "canRotate": true,
    "blockReason": "",
    "reason": "key compromised",
    "dryRun": true,
    "capturedAt": "2026-05-11T14:30:00Z"
  },
  "reason": "key compromised",
  "dryRun": true,
  "timestamp": "2026-05-11T14:30:00Z"
}
```

---

## Exit Codes

| Code | Status | Meaning |
|:----:|--------|---------|
| `0` | `preview` / `rotated` | Rotation plan valid (dry-run) or rotation applied |
| `1` | `no-rotation` | Provider not found or rotation blocked |
| `2` | `error` | File I/O error, malformed JSON, or write failure |

---

## Integration with Provider Ecosystem

```
provider-pool-policy.json          Defines allowed providers and limits
         │
         ▼
provider-pool.json                 Tracks runtime provider status
         │
         ▼
┌─────────────────────────────────────────────────┐
│  rotate-claude-settings-provider.ps1             │
│  (THIS SCRIPT)                                   │
│                                                  │
│  Validates provider, builds rotation plan,       │
│  transitions state, atomic backup/replace        │
└─────────────────────────────────────────────────┘
         │
         ▼
provider-pool.json                 Updated state (available, failures reset)
         │
         ▼
provider-key-router.ps1            Re-evaluates routing with updated state
```

---

## WebUI Integration

The rotation bridge is designed to be called from the provider pool WebUI
control console.  The WebUI must:

1. Call the script in dry-run mode first to display the rotation plan.
2. Require explicit operator confirmation before calling with `-Apply -ConfirmRotation`.
3. Display the backup path and validation checks from the JSON output.
4. Never bypass the confirmation gate.

The script enforces this at the CLI level: `-Apply` without `-ConfirmRotation`
exits with code 1.

---

## Security Invariants

1. **No secrets read.** The script checks secret source *existence* only.
2. **No secrets in output.** JSON output contains source type and key name, never values.
3. **Dry-run default.** All automation defaults to preview mode.
4. **Double confirmation.** Apply requires both `-Apply` and `-ConfirmRotation`.
5. **Atomic writes.** State file is updated via temp-file + move, with rollback on failure.
6. **Backup before mutation.** A timestamped backup is created before any state change.

---

## Human-Required Boundaries

| Action | Why Human-Owned |
|--------|-----------------|
| Passing `-Apply -ConfirmRotation` | Executes actual state mutation |
| Choosing to rotate a disabled provider | Credential fix has security implications |
| Rotating when secret source is unavailable | Requires manual credential update first |

---

## References

- [Provider Pool](provider-pool.md) — Pool architecture and state management
- [Provider Quota Rotation](provider-quota-rotation.md) — Cooldown and exhaustion rules
- [Provider Key Router](provider-key-router.md) — Routing contract and selection
- [Provider Local Secret Store](provider-local-secret-store.md) — Credential storage and resolution
- [Provider Rotation Local Secrets](provider-rotation-local-secrets.md) — Secret rotation runbook
